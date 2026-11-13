# 双拓扑改造：Team 服务（0.2.1）与 subagent 树（0.2.2）

> 分支 `feat/dual-api`。目标：同一份代码在 0.2.1-rc.2 与 0.2.2-rc.2 上都能跑，旧内核行为零回归。

## 0. 结论先行

0.2.2-rc.2 里团队能力**没有消失**，只是换了模型：`dsh-agent-team` 退化成任务板，成员关系搬到了 `ctx.subagents` 的具名子 agent 树上。所以这活不是"救回被删的包"，是把五个成员相关的调用点从 `ctx.agentTeams` 迁到 `ctx.subagents`，其余（任务板）原样保留。

## 1. 探测为什么不是 `startActivation`

`0.2.1-rc.2` 的 `dsh-subagent` **已经有 `startActivation`**，但签名是嵌套的：

```
0.2.1  { provider, childId?, signal, request: { parent, prompt, maxDepth, outputSchema } }
0.2.2  { provider, label, name, signal, delivery, parent, prompt, … }        // 扁平
```

而且 0.2.1 的服务里没有 `rootOf`、没有 `namesOf` —— 也就是说它**没法给树成员取名**，而名册恰恰要靠这两件事（成员名 + 归属根）。

所以 `lib/team-bridge.js` 的探测问的是"树能力"，不是版本号：

```
startActivation && rootOf && namesOf
```

只探 `startActivation` 会在 0.2.1 上命中新分支，然后把扁平 spec 喂给嵌套 API，第一次招人就炸。

## 2. 映射表落点

| 旧调用 | 新调用 | 落点 |
|---|---|---|
| `ctx.agentTeams.spawnTeammate` | `ctx.subagents.startActivation`（`provider: 'spawn'`、`delivery: 'parent'`、带 `name`） | `lib/team-bridge.js` `spawnMember()` |
| `ctx.agentTeams.sendMessage` | `ctx.subagents.sendMessage`（名字先解析成 session id） | `lib/team-bridge.js` `deliverMessage()` |
| `ctx.agentTeams.listMembers` | `ctx.subagents.listDescendants` + 过滤 `depth === 1 && mode === 'continuable'` | `lib/team-bridge.js` `listTeammates()` |
| `ctx.agentTeams.tryMembership` | `ctx.subagents.rootOf` + `namesOf` | `lib/team-bridge.js` `membershipOf()` |
| `ctx.systemPrompt.getSectionOrder` | **两版都在**，保留；加了 `typeof === 'function'` 兜底 | `index.js` `sectionOrder()` |
| `ctx.agentTeams.createTask / getTask / listTasks / updateTask` | 不变 | `index.js:1109`、`index.js:1322` |

`membershipOf()` 保持旧返回形状 `{ role, name, root }`，所以 13 个调用点全部一行替换。`lead` 的判定是"树根 + 没有 `parentSession`"：员工被用户 fork 出来的会话是新的独立树根，但它不是这条团队的老板，不能给它装 boss 工具。

名册只取**直接子节点**：办公室面板、容量规则、`@role` 路由说的都是那七个正式角色，员工自己再开的临时工不占座 —— 与旧 `listMembers()` 的口径一致（它同样不列孙辈）。

## 3. 工具注册：没有撞名，不需要改名

work-team 自己注册的只有五个（`index.js:1424-1427`、`index.js:1661-1664`）：

`team_start` / `hire_teammate` / `dispatch_tasks` / `team_status` / `request_hire`

0.2.2 内核提供的名字：

| 来源包 | 工具 |
|---|---|
| `dsh-tool-subagent-control` | `list_agents` / `send_message` / `interrupt_agent` / `wait_agent` |
| `dsh-tool-agent-team` | `team_task_create` / `team_task_get` / `team_task_list` / `team_task_update` |
| `dsh-tool-subagent` | `subagent` / `subagent_fork` / `list_subagent_models` |

**零交集**。`send_message`、`team_task_*` 从来是内核 Team 包注册进 `agent.ctx` 的，本插件不注册，所以也不存在重复注册。

两条**只做声明、不做注册**的陈旧条目留着无害，但值得知道：

- `lib/toolset.js:79` 的 `OWN_LAYER_TOOLS` 仍列 `spawn_teammate` —— 0.2.2 内核已删该工具。白名单只过滤**继承来的**工具，列一个不存在自己的层工具不会抛错，只是空声明。
- `lib/toolset.js:74` 列 `interrupt_agent` —— 0.2.2 的 `dsh-tool-subagent-control` 默认 `interrupt: false`，该工具默认不注册，同样是空声明。

`index.js` 里针对 `spawn_teammate` 的容量 guard 保留，但在树拓扑下直接放行（那条工具不存在，且名册读是异步的，同步 guard 平面拿不到数）。

## 4. 不升级内核怎么验证新路径

三条，从轻到重：

1. **只跑单测**（最稳，已验证通过）：

   ```
   cd /tmp/work-team-022
   node scripts/link-host-deps.mjs      # worktree 没有 node_modules，先链宿主包
   node --test test/dual-topology.test.js
   ```

   `test/dual-topology.test.js` 里 `makeTreeHost()` 就是一个只有树拓扑的假 Host，`agent/created` → `team_start` 全程走 `startActivation`；另一条用例只给 `ctx.agentTeams`，断言五个映射点全部落到旧方法。

2. **在真 0.2.1 上强制走新分支**：把桩换成真实服务不改代码做不到（探测是按能力），所以真机验证只能在 0.2.2 上做。要在 0.2.1 上"预习"，用 `test/dual-topology.test.js` 的 `makeTreeHost()` 作模板，把 `ctx.get('subagents')` 指向 `/tmp/dsh-preflight` 那套真实服务即可（需要那个 profile 起得来）。

3. **别忘的边界**：`listTeammatesSync()` 只服务旧平面的同步 guard，树拓扑下会抛 `listTeammatesSync is only available on the Team-service topology`；这是有意的，防止有人在异步语境里误用。

## 5. 风险与未验证点

1. **`spawn` 后端名是硬编码**。`SPAWN_PROVIDER = 'spawn'` 取自 `dsh-base` 的默认 `providerName`。若部署把 in-process spawn 的 `providerName` 改成别的，招人会以"未知后端"失败。旧代码同样硬编码 `provider: 'spawn'`，不是本次引入的，但树拓扑下失败信息会更早出现（`expectProvider` 立刻抛）。
2. **成员状态词表变了**。旧名册给 `active` / `provisioning` / `failed`；树拓扑只能给 `running` / `inactive`。`team_status` 的 schema 文档已含这四个词，但 `@role` 派活里"员工失败了"那条降级文案（`index.js:886`）在树拓扑下永远不会触发 —— 失败的子 agent 会直接从 catalog 里消失，表现成"没招过"（`missing`）而不是 `failed`。这是语义差异，不是 bug。
3. **`listDescendants` 依赖 catalog 投影**。`dsh-base` 把 `session-query-sqlite` 配成 `openAt: never`，catalog 投影仍可用（`list_agents` 同样依赖它），但若部署关掉了投影注册，名册会抛错。`listTeammates()` 没有吞异常 —— 与旧路径抛 `listMembers` 错误的行为一致。
4. **`parentSession` 判据未在真机验证**。`membershipOf()` 靠 `agent.session.header.parentSession === undefined` 认定"这是用户会话树根"。0.2.1 上 `tryMembership` 的口径是 Team 包的显式成员表，两者在"用户从员工会话 fork"这一种情形上试图对齐但没有真机对拍。风险是 fork 出来的会话被误判为 lead（多一层 boss 工具），或反过来主会话被误判（这种情况下团队完全不装）。**这条最值得在 0.2.2 真机上第一件事验证。**
5. **`agent/created` / `agent/pre-step` / `agent/disposed` 三个钩子**已核 0.2.2 内核仍在、payload 形状一致（`{ agent, messages, signal, step, modelSelection }`），但没跑过真机。
6. **`client.js` 未改**：它不直接请求 `/api/*`，八个 `dsh.client.inject` 包在 0.2.2 全部存在，服务面（`api-session-controller` / `api-remotes` / `sessionProjections.stateOf`）本次没有改名。若真机上办公室面板显示异常，问题在数据来源（名册状态词表，见第 2 条）而不在这个文件。
7. **未在 0.2.2 真机加载过**。所有 0.2.2 侧的核实都是读 `/tmp/dsh-preflight/pkg/node_modules/@deepseek-ai/` 的源码与类型声明，`npm test` 跑在 0.2.1 的真实宿主包（`schemastery` / `dsh-tools`）上。
