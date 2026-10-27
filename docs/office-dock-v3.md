# 工位条 V3 · 状态优先单行轨道 — 设计规格

> 只出规格，未改代码。每条判断后面带核实来源（`client.js:行号` 或宿主包 CSS）。
> 承现有语汇：`.wt-seat` / `.wt-avatar-wrap` / `.wt-dot` / `.wt-seat-open` / `wt-sparkle` / `wt-pulse`。
> 只做减法 + 一套新轨道：不引入色板、不引入图标库、不引入第二套圆角语汇。
> 色值 **全部** 走 `--dsw-alias-*`；尺寸全部给到 px，没有留空项。

---

## 0. 先修正四条事实（读完代码后的偏差）

| 说法 | 实际 | 依据 |
|---|---|---|
| 轨道现在比输入框宽是「宿主行为」 | 槽位外壳是 `display:contents`（**不生成盒子**），所以 `.wt-dock` 是 `.wSkVaW_composerStack` 的直接 flex 子项，被拉满整个会话列；而输入框卡是 `width:100%` 于 `.uV2eYG_root`（左右各 16px 内距）再 `max-width:var(--dsh-composer-card-max-width)`、靠 `align-items:center` 居中。**两者宽度公式本来就不同**，所以轨道左边顶到列边、输入框居中缩进。修法是把轨道宽度改成和卡同一套公式（§5.4），而不是调内距。 | 宿主：`SlotOutlet` 的 `ANCHOR_STYLE={display:'contents'}`（`dsh-client-ui-renderer`）、`.uV2eYG_root` / `.uV2eYG_card`、`.wSkVaW_composerStack` |
| 横滚是内容太多 | 横滚只有一处来源：`.wt-dock-cards` 的 `overflow-x:auto`（`client.js:240`）+ `::-webkit-scrollbar`（`:241`）。**删掉这一个选择器，横滚在结构上就不存在了**，不需要 `overflow:hidden` 兜底。 | `client.js:240-242` |
| 「三行文字」是排版问题 | 是三行 DOM：`.wt-card-name` / `.wt-card-role` / `.wt-card-status`（`client.js:977-983`）。第三行 `t('status.'+status)` 在 7 张卡里重复 7 次「待命」。 | `client.js:245-249`、`:983` |
| 删卡片会牵连很多地方 | `MemberCard` 全仓只有一个调用点（`client.js:1261`）。删它是封闭改动。**但 `.wt-dock-error` 必须留下** —— `OfficeAction` 还在用（`client.js:2428`）。 | `grep` 结果 |

另两条边界（写迁移清单前必须知道）：

- `handoffs` 从来没进过工位条，只喂 `OfficeRow`（`client.js:2257`）。所以**交接动效不是工位条的责任**，V3 不碰。
- `.wt-dot` 被派活浮层复用（`client.js:1333`），**保留**，只加尺寸修饰。

---

## 1. 三层结构

一句话一层，超出这句的都不属于这一层。

```
┌ .wt-dock ──────────────────────────────── 容器：一行 32px，透明，只在 hover/focus 时给淡底 ┐
│  ┌ .wt-facepile ── 轨道左段：在场感 ─┐ ┌ .wt-chips ─┐ ┌ .wt-dock-sum ─── 轨道右段 ─┐ │
│  │ ⬤ ⬤ ⬤ ⬤ ⬤  +2                  │ │ ⬤ 小前 …  │ │ 干活中 2 · 等你回复 1   ›  │ │
│  └──────────────────────────────────┘ └───────────┘ └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

| 层 | 选择器 | 职责（一句话） |
|---|---|---|
| **容器** | `.wt-dock` | 只负责「一行、32px、可点开办公室」，不画边框、不画底色。 |
| **轨道** | `.wt-facepile` / `.wt-chips` / `.wt-dock-sum` | 三段横向分区：谁在场 → 谁在动 → 一共几个在动。段的宽度预算固定，`sum` 是唯一的弹性段。 |
| **单元** | `.wt-seat`（含 `.wt-seat-hit` / `.wt-chip`）+ `.wt-seat-tip` | 一个人 = 一个 20px 头像或一枚 24px chip；hover 长出浮层，浮层里放派活入口。 |

**为什么这么分**：容器一旦有边框，它就和下面的输入框卡抢层级（诊断 #1）；所以容器的全部视觉职责被降为「hover 时才出现的一层淡底」。视觉重量交给单元 —— 单元只在有人活动时才变成 chip。盒子数量从「1 外框 + 7 内框」降到「0 外框 + 0–2 内框」。

---

## 2. 四种密度线框

宽度单位：字符位不精确，精确值在 §5。`⬤` = 20px 头像，`▭` = 24px chip。

### 2.1 空闲（7 人全待命，`data-density="rest"`）

```
┌──────────────────────────────────────────────────────────────────────┐  32px
│  ⬤⬤⬤⬤⬤ +2                                                       ›  │  头像 55% / › 40%
└──────────────────────────────────────────────────────────────────────┘
   76px  22px                        ← flex:1 空白即「打开办公室」的点击面 →
```

- 没有摘要文字 → **「待命」出现 0 次**（验收要求 ≤1 次，这里取 0）。
- 没有 chip、没有标题、没有外框。整条只剩一排暗下去的脸 + 一个 40% 的 `›`。
- 为什么留脸不留空：这是插件的身份，也是唯一的鼠标入口。压到 55% 是**沿用现有语汇里的值**（`.wt-avatar-wrap::after` 静止态就是 `opacity:.55`，`client.js:264`），不是新拍的数字。

### 2.2 混合（2 在岗 + 1 等你，`data-density="active"`）

```
┌──────────────────────────────────────────────────────────────────────┐  32px
│  ⬤⬤⬤⬤⬤ +2   ▭小前 工位条 V3 设计…  ▭阿策 等你回复   干活中 2 · 等你回复 1  › │
└──────────────────────────────────────────────────────────────────────┘
   └─ 5+2 ─┘    └──── chip ≤190 ────┘  └── chip ──┘   └──── sum ≤160 ────┘
```

- chip 只给**有事的**人，最多 2 个，按 §3 优先级取前 2。
- 第 3 个以后的有事成员退回 facepile（facepile 的顺序已经是按优先级排的，所以「谁在动」永远在最左边）。
- 摘要只报**非零的活动项**，按优先级排列；`待命` 不计数（理由见 §3.3）。

### 2.3 溢出（容器 ≤671px，chip 先折叠）

```
容器 672–936px   L   ⬤⬤⬤⬤⬤ +2  ▭ ▭  干活中 2 · 等你回复 1  ›
容器 480–671px    M   ⬤⬤⬤⬤⬤ +2  ▭    干活中 2 · 等你回复 1  ›     ← 第 2 枚 chip 消失
容器 320–479px    S   ⬤⬤⬤⬤⬤ +2       等你回复 1              ›     ← chip 全消失，摘要只剩 1 段
容器 <320px       XS  ⬤⬤⬤⬤⬤ +2                            ›     ← 摘要全消失
```

> 这一组数是**设计档位**，按 `.wt-dock` 的 border-box 宽写（= 输入框卡宽）。写进 CSS 的 `@container` 值要再减 28px 内距（643 / 451 / 291），推导见 §5.3 第 5 条。

**折叠顺序 = 信息贬值顺序**：先丢第 2 枚 chip（信息在摘要里还有计数）→ 再丢全部 chip（摘要还在）→ 再丢摘要的第 2 段起 → 最后丢摘要。`facepile + N` 永远不折 —— 它是这条轨道的存在理由。

**为什么 idle 是「先折叠」的**：`ranked` 先按状态优先级排序，idle 排最后（权重 6），所以宽度不够时被挤进 `+N` 的一定是 idle 的人。折叠发生在**选择**层，不在 CSS 层 —— CSS 藏头像会让 `+N` 的数字和画面对不上。

### 2.4 窄屏（视口 <760px）

```
视口 760px → 会话列约 430–500px → 容器 = min(列宽 - 32, 952) = 398–468px → 落在 S 档

┌──────────────────────────────────────────────┐  32px
│  ⬤⬤⬤⬤⬤ +2          干活中 2              ›  │
└──────────────────────────────────────────────┘
```

**删掉 `@media (max-width:760px)` 里的两条工位条规则**（`client.js:433-436`）：`@container` 已经在量真实可用宽度，媒体查询量的是视口，两者对不上（右栏拉宽时视口不变而容器变窄）。保留媒体查询会得到「容器还有 600px 却被降级」的错误折叠。

---

## 3. 状态矩阵

状态由 `deriveStatus` 产出。**V3 当时没动这个函数，只改它被怎么画；V4 重写了它**（见 §3.4），因为它原来的输入 `completionUnread` 把「入职回合结束」也当成「有新结果」。

### 3.1 矩阵

| state | 圆点色 token | 圆点动效 | 升格 chip | 进 facepile | 排序权重 | chip 上的短语 |
|---|---|---|---|---|---|---|
| `waiting` | `--dsw-alias-state-warn-primary` | `wt-pulse 1s` | ✅ | ✅ | 0 | `t('status.waiting')` |
| `error` | `--dsw-alias-state-error-primary` | 无 | ✅ | ✅ | 1 | `t('status.error')` |
| `failed` | `--dsw-alias-state-error-primary` | 无 | ✅ | ✅ | 2 | `t('status.failed')` |
| `done` | `--dsw-alias-state-success-primary` | 无 | ✅ | ✅ | 3 | `t('status.done')` |
| `working` | `--dsw-alias-state-business-primary` | `wt-pulse 1.4s` | ✅ | ✅ | 4 | `dockPhrase(task)`，空则 `t('status.working')` |
| `provisioning` | `--dsw-alias-state-business-primary` | `wt-pulse 1.4s` | ✅ | ✅ | 5 | `t('status.provisioning')` |
| `ready` | `color-mix(in srgb, --dsw-alias-state-success-primary 45%, --dsw-alias-label-secondary)` | 无 | ❌ | ✅ | 6 | — |
| `idle` | `--dsw-alias-state-idle-primary` | 无 | ❌ | ✅ | 7 | — |

- 圆点颜色 **一行新色值都不加**：直接复用 `.wt-dot` 的既有类（`client.js:250-254`），V3 只加一条尺寸/定位修饰（§4）。
- `working` / `provisioning` 共用蓝色 + 脉冲；`provisioning` 原本靠 `.wt-avatar-wrap::after` 的虚线旋转环区分（`client.js:266`），V3 在 facepile 里关掉了 `::after`，所以两者在 20px 上同形。**接受**：入职中是秒级瞬时态，且它排最后，几乎不会成为 chip。
- `ready`（V4 新增）和 `idle` 一样**不进 chip、不进摘要**，只换圆点色与状态文案：成功色降饱和混 `--dsw-alias-label-secondary`（`.wt-dot.ready` / `.wt-st-ready`），头像环降到 `.34` 且不加动画。理由：入职报到是「有人坐下了」，不是「有东西要你看」。

### 3.2 为什么 waiting 排第一、error 第二

`waiting` = `pendingInteraction`，人还活着、正卡在等你一句话；`error` = 上一轮异常结束，已经停了，没有「正在流失的时间」。所以**能立刻解除阻塞的排前面**。`done` 排 `working` 前面：未读结果是可消费的，在跑的任务是不可消费的。

### 3.3 为什么摘要里不出现「待命」

诊断 #2 的原话是「7 次重复的『待命』，全是零信息噪声」。保留 1 次仍然是 0 信息 —— 总数已经由 `facepile + N` 表达，明细在右侧办公室 tab。所以 V3 的摘要只报**非零活动项**，`待命` 出现次数 = **0**。这比验收线（≤1 次）更严，也顺手把「静态占满注意力」（诊断 #5）解决掉。

摘要形如：`干活中 2 · 等你回复 1`。全空闲时**没有摘要**（§2.1）。`ready` 同理不报：一支刚组建完的团队，摘要必须是空的。

### 3.4 V4：状态改由「回合结算」驱动

**问题。** 旧 `deriveStatus` 是 `unread === true → done`。平台的 `completionUnread` 记的是「非主会话从 running 变停止」，而入职报到（`onboardingText` 让员工回一句「已就位」）**就是一次真实回合**。于是「只发了开启团队」也会得到 7 个 `done`，工位条汇总成「有新结果 7」。

**信号。** 客户端按可见性轮询 `ctx.remote.session.projections({ sessionId })`，读 `values.subagentTiming`：

| 字段 | 含义 | 用法 |
|---|---|---|
| `settledMs` | 该员工 descriptor 之后累计已结算回合毫秒，**单调递增** | 与本地账 `ackedMs` 比大小 = 「有没有新的已结算回合」 |
| `active` | 存在即有一个回合没走到 `turn/end` | `working` 的唯一来源（替代拿不到的 `running`） |
| `lastTurnCompleted` | 最近一次结算是否正常结束 | `false → error` |

**本地账**（`localStorage` 键 `dsh-work-team:ack:<leadSessionId>`，值 `{ [memberSessionId]: { ackedMs, readyMs, readySeen } }`）：

- `readyMs`：**报到的阈值** —— 第一次观测到「已结算」时的 `settledMs` 总量（也就是入职那一回合的累计值），0 表示还没见过任何结算。
- `ackedMs`：读者已经看过的总量，点开会话时抬高。
- `readySeen`：只给降级路径用（没有 `settledMs` 时算不了阈值）。老记录迁移：没有 `readyMs` 时 `readyMs = readySeen ? ackedMs : 0`。

规则：

- 首次见到成员且 `phase === 'provisioning'` → `{ ackedMs: 0, readyMs: 0, readySeen: false }`：它的第一次结算会记下阈值并显示「已就位」。
- 首次见到成员但已是 `active`（面板开得晚 / 换设备 / 清过存储）→ 交给第一次读数判定：读到「没有未闭合回合」或「`settledMs > 0`」就 `readyMs = ackedMs = settledMs, readySeen = true`（直接「待命」，刷新不会冒出一轮假「有新结果」）；读到「`active` 且 `settledMs === 0`」说明这一回合就是入职，保持未确认，等它结算成「已就位」。`spawnTeammate` 与入职 prompt 在同一个 Host step 里排队，所以行完全可能带着「入职回合还没结束」出现，不能只看 `phase`。
- 点开成员会话成功（`openMember`）→ `ackedMs = 当前 settledMs`，并挂 `pendingAck`：下一次「已关闭」的读数也一并采纳（打开前刚结算、还没轮询到的那一回合，不再补一个徽标）。
- 成员会话消失 → 删掉该条；`localStorage` 不可用 → 退化为内存 Map，规则不变。
- `listSnapshot()` 抛异常 = 列表服务不可用 ≠ 成员消失：此时直接跳过本轮，绝不清账（一次异常清空会把整队的未读永久吞掉）。

**优先级（`deriveStatus`，从高到低）**：`failed` → `provisioning` → `waiting`(pendingInteraction) → `working`(active) → `error`(lastTurnCompleted===false) → `idle`(settledMs===0) → 主路按阈值：`settledMs <= readyMs && ackedMs < readyMs → ready`、`settledMs > readyMs && settledMs > ackedMs → done`、其余 `idle`（没有 `readyMs` 的老记录退回 `readySeen===false → ready`）；降级路：`running → working`、`unread && readySeen → done`、`!readySeen → ready`、其余 `idle`。

**为什么是阈值而不是布尔**：早期版本用「观察到 `active` 且 `settledMs > 0` 就消费报到」来判断入职已过。但一个短回合的开始和结束完全可能落在两次 2 秒轮询之间——`active` 一次都观测不到，报到永远消费不掉，之后每次结算都回「已就位」，真活报不出来。阈值只看「总量涨没涨」，不依赖任何一次观测的时机。

**轮询**：模块级单例，办公室 tab 与工位条按引用计数共用一份；页面可见时 2000ms 一次、挂载立即读一次、`visibilitychange` 切回可见补读一次；同一成员上一次读未返回则跳过本轮；`byId[id].agentAvailable === false` 且上一轮已无未闭合回合时不再重读（结论已稳定）。读失败 `console.warn` 一次、保留旧值，连续两次失败后该成员降级到旧信号（`completionUnread` + 首次豁免）。

**为什么不再用 `completionUnread`**：它是平台给「会话停下来了」用的粗粒度提醒位，无法区分「入职」和「干完活」；而且它只会被下一次 running 清掉，不随「你看过了」清掉。回合结算单调递增，配合本地账才有「这条结果我读过没有」的语义。

---

## 4. CSS 契约

### 4.1 删除（6 条，全部有替代）

> 行号对照的是 **V3 落地前**的 `client.js`。落地后行号整体位移，按选择器找。

| 行号 | 选择器 | 删因 |
|---|---|---|
| 238 | `.wt-dock-title` | Dock 不再渲染标题；`grep` 确认落地后全仓已无引用（`OfficeAction` 用的是 `-head` / `-count`，不含它） |
| 240-242 | `.wt-dock-cards` + 两条滚动条 | **横滚的唯一来源**；`Dock` 不再需要这一层 |
| 245-249 | `.wt-card-main` / `-name` / `-role` / `-status` | 三行文字的载体，随 `MemberCard` 一起消失 |
| 255-256 | `.wt-dock-more` + `:hover` | 被 `.wt-more` 取代（不再是带框按钮） |
| 372-375 | `.wt-dock-cards` 的 `scroll-padding` / `.wt-card[role=button]` 两条 / `.wt-card` 的 min/max 过渡 | 卡片不再是可聚焦按钮；过渡随折叠逻辑一起消失 |
| 377-381 | `.wt-seat-act` + 3 条状态规则 | 它的 DOM（`client.js:1270-1281` 的悬浮 `↗`）被浮层里的 `.wt-tip-act` 取代 |

### 4.2 保留（10 条，改值不改名）

| 行号 | 选择器 | 处置 |
|---|---|---|
| 235 | `.wt-dock` | **重写**（见 4.3），类名不变 |
| 236-237 | `.wt-dock-head` + `:hover` | **必须保留**：`OfficeAction` **直接复用**工位条这套头部结构（头像堆 + 人数）当标题栏按钮（落地后 `client.js:2606`）。它不在 dock 里，V3 只是让 `Dock` 不再渲染，样式一行不动 —— 订正：v1 把它列进删除表，那是错的 |
| 239 | `.wt-dock-count` | **必须保留**：同一套头部结构里的人数文本（`client.js:2612`）。同上订正 |
| 279 + 370 | `.wt-bubble` + `@keyframes wt-bubble` | **必须保留**：`DispatchCandidateRow` 的「等你回复」气泡在用（`bubble: status === 'waiting'`，落地后 `client.js:1155`）。订正：v1 说「唯一调用点是 MemberCard」，漏了这一个 |
| 243-244 | `.wt-card` + `:hover` | 保留，唯一使用者变成 `.wt-seat-open`；`min/max-width:136/168px` 被 `.wt-seat-open` 覆盖，留着无害 |
| 250-254 | `.wt-dot` + 5 个状态类 | **原样保留**，是 V3 圆点的唯一色源（V4 追加第 6 个 `.wt-dot.ready`） |
| 257 | `.wt-dock-error` | **保留**：`OfficeAction` 在用（`client.js:2428`） |
| 263-280 | `.wt-avatar-wrap` 全套 | 保留；facepile 里只关 `::after`（见 4.3） |
| 376, 382-391 | `.wt-seat` / `.wt-seat-open` / `-input` / `-send` / `-sent` / `-error` | 保留；只改 `.wt-seat` 的 `display` 与 `.wt-seat-open` 的 `max-width`（`377-381` 的 `.wt-seat-act` 见 4.1 删除项） |
| 437-442 | `prefers-reduced-motion` 块 | 保留，把新选择器追加到 `:439` 那一行的列表里 |

### 4.3 新增（可直接抄）

```css
/* ── V3 轨道：容器 ───────────────────────────────────────────────── */
.wt-dock { box-sizing:border-box; display:flex; align-items:center; gap:10px; height:32px; width:min(calc(100% - 32px), var(--dsh-composer-card-max-width)); margin:0 auto; padding:0 14px; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-primary); container-type:inline-size; transition:background-color .12s ease-out; }
.wt-dock:hover, .wt-dock:focus-within { background:var(--dsw-alias-bg-layer-1); }
.wt-dock[data-mode="dispatch"] { height:auto; min-height:32px; }
.wt-dock[data-mode="dispatch"] .wt-seat { flex:1 1 auto; min-width:0; display:flex; }

/* ── 轨道左段：facepile ─────────────────────────────────────────── */
.wt-facepile { display:flex; align-items:center; flex:none; transition:opacity .15s ease-out; }
.wt-facepile .wt-seat + .wt-seat { margin-left:-6px; }
.wt-facepile .wt-avatar-wrap { box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base); }
.wt-seat .wt-avatar-wrap::after { display:none; }
.wt-dock[data-density="rest"] .wt-facepile { opacity:.55; }
.wt-dock:hover .wt-facepile, .wt-dock:focus-within .wt-facepile { opacity:1; }
.wt-facepile .wt-seat:hover { z-index:2; }

/* ── 单元：头像按钮 + 状态点 ─────────────────────────────────────── */
.wt-seat { position:relative; display:inline-flex; flex-direction:row; align-items:center; flex:none; }
.wt-seat-hit { position:relative; display:inline-flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:50%; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.wt-seat-hit::after { content:''; position:absolute; inset:-2px; }
.wt-seat-hit:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.wt-seat .wt-avatar-wrap .wt-dot { position:absolute; right:-1px; bottom:-1px; width:6px; height:6px; box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base); }

/* ── +N ────────────────────────────────────────────────────────── */
.wt-more { flex:none; display:inline-flex; align-items:center; height:20px; margin-left:2px; padding:0 4px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:10.5px; line-height:1; font-variant-numeric:tabular-nums; cursor:pointer; }
.wt-more:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }
.wt-more:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

/* ── 轨道中段：chip ────────────────────────────────────────────── */
.wt-chips { display:flex; align-items:center; gap:8px; flex:none; min-width:0; }
.wt-chip { box-sizing:border-box; display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px 0 2px; border:0.5px solid var(--dsw-alias-border-l1); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; flex:none; transition:border-color .12s ease-out; }
.wt-chip:hover { border-color:var(--dsw-alias-brand-primary); }
.wt-chip:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.wt-chip-name { min-width:0; max-width:52px; font-size:12px; font-weight:600; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wt-chip-phrase { min-width:0; max-width:96px; font-size:11px; line-height:16px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* ── 轨道右段：摘要（同时是「打开办公室」的点击面） ───────────────── */
.wt-dock-sum { flex:1 1 auto; min-width:0; height:100%; display:inline-flex; align-items:center; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; cursor:pointer; }
.wt-dock-sum:hover { color:var(--dsw-alias-label-primary); }
.wt-dock-sum:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-1px; }
.wt-dock-sum[data-error="true"] { color:var(--dsw-alias-state-error-primary); }
.wt-sum-seg { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.wt-sum-seg + .wt-sum-seg::before { content:'·'; margin:0 6px; opacity:.5; }
.wt-sum-chev { flex:none; margin-left:auto; padding-left:10px; color:var(--dsw-alias-label-tertiary); font-size:14px; line-height:1; transition:opacity .15s ease-out; }
.wt-dock[data-density="rest"] .wt-sum-chev { opacity:.4; }
.wt-dock:hover .wt-sum-chev, .wt-dock:focus-within .wt-sum-chev { opacity:1; }

/* ── hover 浮层（名字 / 角色 / 当前任务 / 派活） ──────────────────── */
.wt-seat-tip { box-sizing:border-box; position:absolute; left:50%; bottom:calc(100% + 6px); transform:translateX(-50%); z-index:40; display:flex; align-items:center; gap:6px; height:24px; padding:0 4px 0 8px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary); font-size:11px; line-height:1; white-space:nowrap; box-shadow:0 4px 12px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); opacity:0; visibility:hidden; pointer-events:none; transition:opacity .12s ease-out, visibility 0s linear .12s; }
.wt-seat-tip::after { content:''; position:absolute; left:0; right:0; bottom:-8px; height:8px; }
.wt-seat:hover .wt-seat-tip, .wt-seat:focus-within .wt-seat-tip { opacity:1; visibility:visible; pointer-events:auto; transition-delay:.38s, .38s; }
/* 键盘不等待：Tab 落到 ↗ 上时它必须已经可见。必须写在上一条之后（同特异性，靠顺序取胜）。 */
.wt-seat:focus-within .wt-seat-tip { transition-delay:0s, 0s; }
.wt-seat[data-tip="true"] .wt-seat-tip { opacity:1; visibility:visible; pointer-events:auto; transition-delay:0s, 0s; }
.wt-facepile .wt-seat:first-child .wt-seat-tip { left:0; transform:none; }
.wt-chips .wt-seat:last-child .wt-seat-tip { left:auto; right:0; transform:none; }
.wt-tip-name { font-weight:600; }
.wt-tip-role, .wt-tip-task { color:var(--dsw-alias-label-secondary); }
.wt-tip-task { max-width:120px; overflow:hidden; text-overflow:ellipsis; }
.wt-tip-act { flex:none; display:inline-grid; place-items:center; width:18px; height:18px; padding:0; border:0; border-radius:5px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:10px; line-height:1; cursor:pointer; }
.wt-tip-act:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.wt-tip-act:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

/* ── 折叠：容器查询（阈值推导见 §5.3） ─────────────────────────────
   @container 量的是**内容盒**（border-box 宽 − 28 的左右内距），
   所以 §5.3 的 border-box 档位 672/480/320 要各减 28：643/451/291。 */
@container (max-width: 643px) { .wt-chip[data-rank="2"] { display:none; } }
@container (max-width: 451px) { .wt-chips { display:none; } }
@container (max-width: 451px) { .wt-sum-seg + .wt-sum-seg { display:none; } }
@container (max-width: 291px) { .wt-dock-sum .wt-sum-seg { display:none; } }
```

### 4.4 三处改值

```css
/* client.js:382 派单输入：从固定 220 变成「在轨道里铺满、最多 420」 */
.wt-seat-open { min-width:0; max-width:min(100%, 420px); width:100%; }   /* 其余声明不动 */
/* client.js:244 打开态是输入面，不该有卡片的上浮 */
.wt-card.wt-seat-open:hover { transform:none; }
/* client.js:439 追加到既有 reduced-motion 列表末尾 */
.wt-chip, .wt-seat-tip, .wt-more, .wt-dock-sum, .wt-sum-chev, .wt-facepile, .wt-tip-act, .wt-seat-hit
```

`prefers-reduced-motion` 分支写在哪：**不新开 `@media` 块**，把上面 8 个选择器追加进 `client.js:439` 已有的那条 `animation:none !important; transition:none !important;` 列表。理由：那份列表就是本插件的「关动效」白名单，新开一块会出现两个真相。圆点脉冲已经在 `:438` 的 `.wt-dot` 里被关掉，无需重复。

### 4.5 为什么轨道上不写 `overflow:hidden`

写了会**裁掉 hover 浮层**（浮层向上长 24px + 6px 间距）。不写也不会横滚，因为：(a) 唯一的 `overflow-x:auto` 随 `.wt-dock-cards` 删除；(b) 除 `.wt-dock-sum` 外每个子项都是 `flex:none` 且有上界，`.wt-dock-sum` 是 `flex:1 1 auto; min-width:0` + 省略号。溢出由 §5.3 的档位保证不发生，而不是靠裁剪掩盖。

---

## 5. 尺寸与间距

### 5.1 表

| 项 | 值 | 说明 |
|---|---|---|
| 轨道高 | **32px**（`data-mode="summary"`） | `box-sizing:border-box` |
| 轨道宽 | `min(calc(100% - 32px), var(--dsh-composer-card-max-width))` | 与输入框卡同宽同居中，推导见 5.4 |
| 轨道左右内距 | **14px** | 等于输入框正文左内距 `.uV2eYG_input{padding-left:14px}` |
| 轨道组间距 `gap` | **10px** | 与 `.wt-panel-head` 的 `gap:8px`、`.wt-row` 的 `gap:8px` 同量级，取 10 是因为 32px 高、横向更需要呼吸 |
| facepile 头像 | **20px** | `RoleAvatar size={20}` |
| facepile 重叠 | **-6px**（步进 14px） | 5 枚 = 76px |
| facepile 描边环 | `1.5px`，色 `--dsw-alias-bg-base` | 只做「切开」，不表达状态 |
| 状态点 | **6px**，`right:-1px; bottom:-1px` | 环同为 1.5px `bg-base` |
| chip 高 | **24px** | 32 − 4×2 = 24，上下各留 4px |
| chip 头像 | **18px** | |
| chip 内距 | `padding:0 8px 0 2px` | 左 2px 让头像贴住胶囊边，像 token |
| chip 内 gap | **6px** | 头像↔名字、名字↔短语 |
| chip 名字 | 12px / 600 / `line-height:16px` | |
| chip 短语 | 11px / `line-height:16px` / `max-width:96px` | 超出省略 |
| chip 名字封顶 | **52px** | `.wt-chip-name{max-width:52px; overflow:hidden; text-overflow:ellipsis}`；2 个汉字约 26px，不截断 |
| chip 最大宽 | **190px** | 2 + 18 + 6 + **52** + 6 + 96 + 8 + 2 = 190（末位 2 = 0.5px 边框在 DPR1 各渲染 1px） |
| 摘要字号 | 11px / `line-height:16px` | 与 `.wt-dock-count` 一致（`client.js:239`） |
| 摘要段间距 | `·` 左右各 6px | 复用 `.wt-head-stat + .wt-head-stat::before`（`client.js:285`） |
| 摘要最大宽 | **160px** | 弹性段，超了省略 |
| `+N` | 高 20px，字号 10.5px，`margin-left:2px` | |
| `›` | 14px，`padding-left:10px`，色 `--dsw-alias-label-tertiary` | |
| 浮层 | 高 **24px**，离头像 `bottom:calc(100% + 6px)`，圆角 8px | 桥接条 8px 高 |
| 派单态高 | **54px**（无错）/ **66px**（有错误行） | 无错时内容 44 被 `min-height:54` 托住；带错时 `12(内距) + 30(输入行) + 6(行距) + 16(错误行) + 2(0.5px 边框在 DPR1 各渲染 1px) = 66` |

### 5.2 四档的**固定段**预算（`gap:10px`；`›` 22px 计入固定段）

摘要段是唯一的弹性项，不参与溢出判断 —— 它永远吃掉剩下的宽度。所以只算固定段。

chip 宽按**名字封顶 52px** 计（不是按「两三个汉字」估）：`2 + 18 + 6 + 52 + 6 + 96 + 8 + 2 = 190`。这条上限是硬约束 —— 没有它，一个 10 字名字就能把 L 档顶出 20px。

| 档 | facepile | `+N` | gap | chips | gap | `›` | 内距(14×2) | **固定段合计** | 该档下界 |
|---|---|---|---|---|---|---|---|---|---|
| L（2 chip） | 76 | 22 | 10 | 388 | 10 | 22 | 28 | **556** | 672 |
| M（1 chip） | 76 | 22 | 10 | 190 | 10 | 22 | 28 | **358** | 480 |
| S（0 chip） | 76 | 22 | 10 | — | — | 22 | 28 | **158** | 320 |
| XS | 76 | 22 | 10 | — | — | 22 | 28 | **158** | 319 |

### 5.3 阈值与「永不横滚」的证明

- L 固定段 556 → 阈值 **672**（余 116，留给摘要）。
- M 固定段 358 → 阈值 **480**（余 122）。
- S 固定段 158 → 阈值 **320**（余 162）。
- 320 以下进 XS：固定段仍是 158，摘要整个隐掉。

**结构性保证**（这才是「永不横滚」的依据，不是靠 `overflow:hidden`）：

1. 除 `.wt-dock-sum` 外，每个子项都是 `flex:none` 且有上界 → 固定段宽度可枚举，最大 **556px**（L 档，名字已封顶 52px）。
2. `.wt-dock-sum` 是唯一的 `flex:1 1 auto; min-width:0` → 宽度不够时**先被压的是它**，它压到 0 也不会挤别人。
3. 每档在**各自下界**处，固定段都小于下界：556 < 672、358 < 480、158 < 320、158 < 319。所以任何宽度下 `›` 都不会被挤出去，也不存在「内容比容器宽」的状态。
4. 容器查询量的是 `.wt-dock` 自己的宽度（`container-type:inline-size`），也就是输入框卡的宽度 —— 和用户的真实可用宽度一一对应，不像媒体查询量视口。
5. **换算**：`@container` 尺寸查询比的是**内容盒**（border-box − 28 的左右内距），而上面三档是按 border-box 推的。所以写进 CSS 的阈值是 **643 / 451 / 291**（= 672/480/320 − 28）。差 1px 的边界按 `max-width` 的闭区间取整，落地值 643/451/291 与档位表逐行对应。
6. **反证（小审实测）**：若查询量的是 border-box，那么容器 671 时 `max-width:643` 不该命中、第 2 枚 chip 应当还在；实测它被隐藏 → 确系内容盒。

### 5.4 与输入框的对齐（可证）

宿主真实结构（`dsh-client-ui-conversation`）：

```
.wSkVaW_composerStack   display:flex; flex-direction:column; gap:6px
├─ [slot conversation.input.dock]  → 外壳 display:contents（不生成盒子）
│    └─ .wt-dock                     ← 我们的轨道，直接是 stack 的 flex 子项
└─ .uV2eYG_root        padding:0 16px 4px; display:flex; flex-direction:column; align-items:center
     └─ .uV2eYG_card    width:100%; max-width:var(--dsh-composer-card-max-width)
          └─ .uV2eYG_input  padding:4px 8px 0 14px   ← 正文左内距 = 14px
```

设会话列宽 `C`、`M = var(--dsh-composer-card-max-width)`（= `clamp(680, C×0.64, 920) + 32`，即 712–952）：

- 输入框卡宽 = `min(C - 32, M)`，居中 → 卡左沿 = `16 + max(0, (C - 32 - M) / 2)`
- 输入框正文左沿 = 卡左沿 + **14**
- 现状轨道：`width` 未设 → flex 拉伸到 `C`，`padding-left:10` → 内容左沿 = 10。**和上面那个式子毫无关系**，所以怎么调内距都对不齐。

V3 把轨道宽度改成和卡**同一套公式**，问题就消失了：

```css
width: min(calc(100% - 32px), var(--dsh-composer-card-max-width));  /* = 卡宽 */
margin: 0 auto;                                                     /* = 卡居中 */
padding: 0 14px;                                                    /* = 正文内距 */
```

代入验证：

| 情况 | 卡左沿 | 正文左沿 | 轨道内容左沿 | 差 |
|---|---|---|---|---|
| 窄（`C-32 ≤ M`） | `16` | `30` | `(C-(C-32))/2 + 14 = 30` | **0** |
| 宽（`C-32 > M`） | `16 + (C-32-M)/2` | `30 + (C-32-M)/2` | `(C-M)/2 + 14 = 30 + (C-32-M)/2` | **0** |

> **轨道内容左沿 ≡ 输入框正文左沿**，任何列宽下都成立。

实测复核（小审，`C = 704 / 512 / 352`）：`dockW == cardW == 672 / 480 / 320`，两边左沿都是 `16`，**Δ = 0**。原因：变量里的 `100%` 在轨道与卡**各自解析**，两边都落到 `C − 32`，所以共用同一个 `min()` 也不会分叉。

垂直：槽位外壳不存在，轨道与 `.uV2eYG_root` 就是 `gap:6px` 的兄弟。chip 下沿距轨道下沿 4px（24 在 32 里居中），所以 **chip 下沿到输入框卡上沿 = 4 + 6 = 10px**。不需要任何负 margin。

顺带：轨道 hover 淡底的盒子 = 输入框卡的盒子（同宽同居中），读起来像「卡的影子」，不是第三条边。

---

## 6. 交互与可达性

### 6.1 指针

| 目标 | 动作 | 结果 |
|---|---|---|
| 头像（facepile） | click | 打开该成员会话（沿用 `onOpen`） |
| 头像 / chip | hover 380ms | 浮层：名字 · 角色 ·（有任务时）任务短语 · `↗` |
| 浮层 `↗` | click | 进入派单态（`.wt-seat-open`，沿用 `onExpand`） |
| chip | click | 打开该成员会话 |
| 摘要 / `›` / 右侧空白 | click | 打开侧栏办公室 tab（`openPanel`） |
| `+N` | click | 打开侧栏办公室 tab |
| 派单态 | `Esc` / 点外部 | 收起（沿用 `client.js:1228` 与 `2318-2328`） |

浮层延迟 380ms：低于 300ms 会跟着鼠标划过一路弹，高于 500ms 会让人以为没有。离开不延迟（`visibility` 在 120ms 后关），保证移动鼠标去点 `↗` 时不会闪。桥接条 8px 覆盖头像与浮层之间的 6px 空隙。

**为什么派活入口要挪进浮层**：32px 的轨道放不下「卡片右上角 24px 的 ↗」。挪进浮层后入口深度从「hover 1 层」变成「hover 1 层 + 浮层内 1 次点击」，但换来了 20px 头像仍能被精确命中，且 `.wt-seat-open` 这套派单 UI 一行不用改。这是本次唯一一处「多一步」的取舍。

**触屏（`hover:none`）**：浮层靠 hover 是打不开的，所以给一个 6 行的兜底 —— 第一次点开浮层，第二次点开会话，`↗` 在浮层里照常可点。**能力一项不少**。

```js
const touch = useMemo(() => window.matchMedia?.('(hover: none)').matches === true, []);
const [tipSeat, setTipSeat] = useState(null);   // 只在 touch 下用
const pick = (id) => {
  if (touch && tipSeat !== id) { setTipSeat(id); return; }
  setTipSeat(null);
  onOpen(id);
};
// .wt-seat 上挂 data-tip={tipSeat === member.id ? 'true' : undefined}
```

```css
.wt-seat[data-tip="true"] .wt-seat-tip { opacity:1; visibility:visible; pointer-events:auto; transition-delay:0s, 0s; }
```

### 6.1.1 裁定：派单态在宽轨道下右侧留白（2026-10-26）

**结论：保持左对齐，不改（选项 a）。**

理由一句话：派单输入框的左沿必须继续压在输入框正文那条 14px 竖线上 —— 那是整条轨道唯一的对齐契约（§5.4）；一旦居中，点开工位时输入框会横向跳一段，而且它和下方 composer 的正文会错开。

- 选项 b（seat 一起收窄）视觉上等于现状：卡片本来就 `max-width:420` 且左对齐；而把 seat 改成 `flex:none` 会让卡片的 `width:100%` 失去参照，反而塌掉。
- 选项 c（居中）直接违反 §5.4，否决。

留白是临时态（只在点开工位时出现），用户视线在光标上，不在右侧。

### 6.2 键盘

Tab 落点顺序（**最多 5 站**）：

```
[chip 1] → [chip 1 的 ↗] → [chip 2] → [chip 2 的 ↗] → [摘要按钮] → （输入框）
```

- **facepile 头像 `tabIndex={-1}`**：7 个人再加 7 站，会把输入框推得太远；而办公室 tab 的 `.wt-row-hit` 本来就是完整键盘可达的花名册（`client.js:303-305`）。这是有意的取舍，不是遗漏。
- 浮层在 `:focus-within` 时保持可见，所以 `↗` 聚焦时看得见。
- 派单态收起后焦点必须回到原座位。`DockSeat` 现有的回焦写在 `client.js:1148`（查 `.wt-card[role="button"]`），V3 没有这个节点，而且收起时组件已经卸载、`seatRef` 是空的 —— 所以把回焦**上移到 `Dock`**，用 `expandedId` 的翻转来驱动：

```js
const dockRef = useRef(null);
const lastSeat = useRef(null);
useEffect(() => {
  if (expandedId !== null) { lastSeat.current = expandedId; return; }
  const id = lastSeat.current;
  if (id === null) return;
  lastSeat.current = null;
  dockRef.current
    ?.querySelector(`[data-wt-seat="${id}"] .wt-seat-hit, [data-wt-seat="${id}"] .wt-chip`)
    ?.focus?.();
}, [expandedId]);
```

`DockSeat` 里那段 `if (!expanded) { … focus … }` 整块删掉，只留「挂载即聚焦输入框」（`client.js:1152-1154`，`scrollIntoView` 一并删）。

### 6.3 aria

| 元素 | 属性 | zh | en（locale 键） |
|---|---|---|---|
| 轨道容器 | `role="group"` + `aria-label` | `员工办公室` | `Work Team`（`dock.title`） |
| 头像按钮 | `aria-label` | `打开 {name} 的会话` | `Open {name}'s chat`（**`row.open` 已存在**） |
| chip | `aria-label`（`phrase ≠ status`） | `{name}，{status}：{phrase}` | `{name}, {status}: {phrase}`（新键 `dock.chipAriaTask`） |
| chip | `aria-label`（`phrase === status`） | `{name}，{status}` | `{name}, {status}`（新键 `dock.chipAria`） |
| `+N` | `aria-label` | `还有 {count} 人` | `{count} more`（新键 `dock.moreAria`） |
| 浮层 `↗` | `aria-label` | `给 {name} 派活` | `Dispatch to {name}`（新键 `dock.dispatchTo`） |
| 摘要按钮（活动态） | 无 `aria-label` | 用可见文本 | 用可见文本 |
| 摘要按钮（空闲态） | `aria-label` | `展开办公室` | `Open office`（`dock.expand`） |
| `›` | `aria-hidden="true"` | — | — |
| 状态点 | 无文本 | 圆点在 `aria-hidden` 的头像里；状态由 chip 的 `aria-label` 承担。facepile 头像不在 Tab 序内，它的状态由办公室 tab 的 `.wt-row-state-label` 承担（`client.js:315`） | — |

摘要按钮在**有文本时不要另加 `aria-label`**：S 档 CSS 会隐藏第 2 段起，若 aria 仍念全部，可见文本与可访问名不一致（WCAG 2.5.3）。

新增 3 个 locale 键，zh/en 各一份，加在 `client.js:84` 与 `:160` 附近：

```js
'dock.chipAria': '{name}，{status}',                          // en: '{name}, {status}'
'dock.chipAriaTask': '{name}，{status}：{phrase}',            // en: '{name}, {status}: {phrase}'
'dock.moreAria': '还有 {count} 人',                           // en: '{count} more'
'dock.dispatchTo': '给 {name} 派活',                          // en: 'Dispatch to {name}'
```

### 6.3.1 裁定：chip 的 aria 重复（2026-10-26）

**结论：`phrase === status` 时省掉后半段（选项 a）。**

理由一句话：非 working 的 chip，可见文本就是「名字 + 状态」，可访问名再把状态重复一遍只是让读屏多念四个字；而 working 的短语是任务名，和状态不同，必须留。

小前要改的只有三行：

```js
const status = t(`status.${entry.status}`);
const phrase = entry.status === 'working' ? dockPhrase(task) || t('status.working') : status;
const aria = phrase === status
  ? fillCopy(t('dock.chipAria'), { name, status })
  : fillCopy(t('dock.chipAriaTask'), { name, status, phrase });
// 'aria-label': aria
```

效果：`小审，等你回复` / `小设，干活中：工位条 V3 设计规格`。

否决 (b)：aria 里重复不是「上下文」，是同一句念两遍，读屏用户会以为有两件事。
否决 (c)：换句式（例如「小审在等你回复」）会让 zh/en 两套模板都要重写，收益不抵成本。

---

## 7. 迁移清单

### 7.1 类名

| 类名 | 处置 |
|---|---|
| `.wt-dock` | 保留（重写声明） |
| `.wt-seat` / `.wt-seat-open` / `.wt-seat-input` / `.wt-seat-send` / `.wt-seat-sent` / `.wt-seat-error` | **全部保留**，派单态零改动 |
| `.wt-seat-act` | 删除（DOM 被浮层 `.wt-tip-act` 取代，见 4.1） |
| `.wt-card` | 保留，唯一使用者是 `.wt-seat-open` |
| `.wt-dot` + 5 个状态类 | 保留（派活浮层在用），V3 追加一条定位修饰；V4 追加 `.wt-dot.ready` |
| `.wt-avatar-wrap` / `.wt-avatar-svg` / `.wt-eyes` / `.wt-hands` / `.wt-sparkle` | 保留 |
| `.wt-dock-error` | **保留**（`OfficeAction` 在用） |
| `.wt-bubble` + `@keyframes wt-bubble` | **保留**（`DispatchCandidateRow` 的等待气泡在用，见 §4.2 订正） |
| `.wt-dock-head` / `.wt-dock-count` | **保留**（`OfficeAction` 在用） |
| `.wt-dock-title` | 删除（落地后全仓已无引用） |
| `.wt-dock-cards` / `.wt-dock-more` | 删除 |
| `.wt-card-main` / `-name` / `-role` / `-status` | 删除 |
| `.wt-facepile` / `.wt-more` / `.wt-chips` / `.wt-chip` / `.wt-chip-name` / `.wt-chip-phrase` / `.wt-dock-sum` / `.wt-sum-seg` / `.wt-sum-chev` / `.wt-seat-hit` / `.wt-seat-tip` / `.wt-tip-*` | 新增 |

### 7.2 组件

| 组件 | 处置 |
|---|---|
| `MemberCard`（`client.js:946-986`） | **删除**（唯一调用点 `1261`） |
| `RoleAvatar`（`client.js:889-937`） | **只加一个 `dot` 参数**（在 `:935` 前插 `dot ? h('span', { className: 'wt-dot ' + status }) : null`）。`bubble` 参数**保留** —— v1 说它只有 `MemberCard` 一个调用点，漏了 `DispatchCandidateRow`（`bubble: status === 'waiting'`），删了侧栏等待气泡就没了。圆点必须长在 `.wt-avatar-wrap` 里 —— 它是 `position:relative`（`:263`），是唯一能贴住头像右下角的定位祖先；`.wt-seat` 在 chip 上比头像宽，贴不住。 |
| `DockSeat`（`client.js:1123-1282`） | 收缩为**只管派单态**：只在 `expandedId === member.id` 时挂载，内部不再判断 `expanded`；删 `scrollIntoView`（`1152`）与整块收起回焦（`1144-1150`，回焦上移到 `Dock`，见 §6.2） |
| `DockFace` | **新增**（~18 行）：`.wt-seat > button.wt-seat-hit > RoleAvatar(20, status, sparkle)` + `.wt-seat-tip` |
| `DockChip` | **新增**（~22 行）：`.wt-seat > button.wt-chip > RoleAvatar(18) + .wt-chip-name + .wt-chip-phrase` + `.wt-seat-tip` |
| `Dock`（`client.js:2306-2393`） | **重写 render 部分**（`2338-2392`）；state / `openPanel` / 外部点击收起全部不动 |
| `OfficeAction`（`2395-2435`） | **不动** |

### 7.3 `Dock` 的取数与排序（唯一有坑的地方）

`useSessionStatus` 是 `useSyncExternalStore` 语义，选择器每次返回**新数组**会触发无限重渲染。现有的计数（`client.js:2092-2103`）返回 `number` 是安全的；V3 需要**每人一个状态**，所以用字符串签名把快照压成原始值：

```js
const STATUS_RANK = { waiting:0, error:1, failed:2, done:3, working:4, provisioning:5, idle:6 };
const FACE_MAX = 5;
const CHIP_MAX = 2;

// 三个布尔压成 3 个字符，7 个人 = 21 字符，=== 稳定
const sig = useSessionStatus((state) =>
  members.map((m) => {
    const s = state.get(m.id);
    return `${s?.running ? 1 : 0}${s?.pendingInteraction ? 1 : 0}${s?.completionUnread ? 1 : 0}`;
  }).join(''),
);
const timingSig = useSessions((state) =>
  members.map((m) => (projectionOf(state, m.id, 'subagentTiming')?.lastTurnCompleted === false ? '0' : '1')).join(''),
);
// ↑ V3 的写法。V4 把结算读到的时序搬进模块级 store（§3.4）：
//   useMemberWatch(sessionId, members) 负责订阅成员，useRuntimeVersion() 负责重渲染。
useMemberWatch(sessionId, members);
const runtimeVersion = useRuntimeVersion();

const ranked = useMemo(() => members.map((member, index) => ({
  member,
  role: roleOrFallback(member),
  status: deriveStatus(member, {
    running: sig[index * 3] === '1',
    pending: sig[index * 3 + 1] === '1',
    unread: sig[index * 3 + 2] === '1',
    timing: memberRuntime.runtimeOf(member.id),
    ack: memberRuntime.ackOf(member.id),
  }),
  index,
})).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.index - b.index), [members, sig, runtimeVersion]);

// ready 和 idle 一样不进 chip、不进摘要：刚组建完的团队，工位条必须是静的
const active   = ranked.filter((e) => e.status !== 'idle' && e.status !== 'ready');
const chips    = active.slice(0, CHIP_MAX);          // ranked 已按优先级排好
const faces    = ranked.slice(0, FACE_MAX);
const more     = Math.max(0, members.length - FACE_MAX);
const density  = active.length === 0 ? 'rest' : 'active';
```

摘要段（顺序即优先级，CSS 只负责隐藏尾巴；V4 起 `ready` 不在这个列表里）：

```js
const SUMMARY_STATES = ['waiting', 'error', 'failed', 'done', 'working', 'provisioning'];
const segments = SUMMARY_STATES
  .filter((state) => ranked.some((e) => e.status === state))
  .map((state) => ({ key: state, text: `${t(`status.${state}`)} ${ranked.filter((e) => e.status === state).length}` }));
```

chip 短语：

```js
function dockPhrase(subject) {
  if (!subject) return '';
  const head = String(subject).split(/[：:·—，,]/)[0].trim();
  return head === '' ? String(subject) : head;
}
// working → dockPhrase(taskFor(name)) || t('status.working')
// 其余状态 → t(`status.${status}`)
```

### 7.4 DOM 骨架（CSS 依赖这套嵌套，别改）

`.wt-seat` 必须是 `.wt-facepile` / `.wt-chips` 的**直接子元素**（`+ .wt-seat` 的负边距、`:first-child` / `:last-child` 的浮层夹边都靠这个）；`.wt-dot` 必须长在 `RoleAvatar` 里（`.wt-avatar-wrap` 是唯一贴着头像的定位祖先）。

```jsx
h('div', {
  className: 'wt-dock', ref: dockRef, role: 'group', 'aria-label': t('dock.title'),
  'data-density': density,
  'data-mode': expandedId === null ? 'summary' : 'dispatch',
},
  expandedId === null
    ? [
        h('div', { className: 'wt-facepile', key: 'faces' },
          ...faces.map((e) => h(DockFace, { key: e.member.id, entry: e, sparkle: sparkles.has(e.member.name), task: taskFor(e.member.name), t, onOpen, onExpand: () => expand(e.member.id) })),
          more === 0 ? null : h('button', {
            key: 'more', type: 'button', className: 'wt-more',
            'aria-label': fillCopy(t('dock.moreAria'), { count: more }), onClick: openPanel,
          }, `+${more}`),
        ),
        chips.length === 0 ? null : h('div', { className: 'wt-chips', key: 'chips' },
          ...chips.map((e, i) => h(DockChip, { key: e.member.id, entry: e, rank: i + 1, sparkle: sparkles.has(e.member.name), task: taskFor(e.member.name), t, onOpen, onExpand: () => expand(e.member.id) })),
        ),
        h('button', {
          key: 'sum', type: 'button', className: 'wt-dock-sum', onClick: openPanel,
          'data-error': officeError === '' ? undefined : 'true',
          title: officeError === '' ? t('dock.expand') : officeError,
          'aria-label': officeError === '' && segments.length === 0 ? t('dock.expand') : undefined,
        },
          officeError === ''
            ? segments.map((s) => h('span', { className: 'wt-sum-seg', key: s.key }, s.text))
            : h('span', { className: 'wt-sum-seg' }, officeError),
          h('span', { className: 'wt-sum-chev', 'aria-hidden': 'true' }, '›'),
        ),
      ]
    : members.filter((m) => m.id === expandedId).map((member) =>
        h(DockSeat, { key: member.id, member, expanded: true, /* 其余 props 同现状 */ })),
);
```

`DockFace` / `DockChip` 的共同外壳（两者只有内层按钮不同）：

```jsx
h('div', { className: 'wt-seat', 'data-wt-seat': entry.member.id },
  /* DockFace: */ h('button', { type: 'button', className: 'wt-seat-hit', tabIndex: -1,
      'aria-label': fillCopy(t('row.open'), { name }), onClick: () => onOpen(entry.member.id) },
    h(RoleAvatar, { role: entry.role, size: 20, status: entry.status, sparkle, dot: true })),
  /* DockChip: */ h('button', { type: 'button', className: 'wt-chip', 'data-rank': rank,
      'aria-label': phrase === status ? fillCopy(t('dock.chipAria'), { name, status }) : fillCopy(t('dock.chipAriaTask'), { name, status, phrase }), onClick: () => onOpen(entry.member.id) },
    h(RoleAvatar, { role: entry.role, size: 18, status: entry.status, sparkle, dot: true }),
    h('span', { className: 'wt-chip-name' }, name),
    h('span', { className: 'wt-chip-phrase' }, phrase)),
  h('span', { className: 'wt-seat-tip' },
    h('span', { className: 'wt-tip-name' }, name),
    h('span', { className: 'wt-tip-role' }, entry.role.zh.role),
    task === '' ? null : h('span', { className: 'wt-tip-task' }, task),
    h('button', { type: 'button', className: 'wt-tip-act',
      'aria-label': fillCopy(t('dock.dispatchTo'), { name }), onClick: onExpand }, '↗')),
);
```

### 7.5 验收自查（对着 §2/§5 逐条打勾）

| 验收项 | 结果 | 依据 |
|---|---|---|
| 7 人满编条高 ≤32px | ✅ 32px | `.wt-dock{height:32px}`；派单态是唯一例外（54/66px，用户主动触发） |
| 无横向滚动 | ✅ 结构上不可能 | 唯一 `overflow-x:auto`（`:240`）被删；`Dock` 不再渲染 `.wt-dock-cards` |
| 空闲态「待命」≤1 次 | ✅ 0 次 | 摘要不报 idle（§3.3） |
| 每个 px/token/选择器可直接抄 | ✅ | §4.3 是完整可粘贴块；§5.1 是数值表 |
| 全部 `--dsw-alias-*`，无硬编码色值 | ✅ | 新规则里出现的色值只有 `--dsw-alias-{bg-base,bg-layer-1,bg-layer-2,bg-overlay,border-l1,border-l2,brand-primary,label-primary,label-secondary,label-tertiary}` + `color-mix` 引用 `label-primary`；无 hex、无 rgb() |
| 不引入新依赖 / slot 名不变 | ✅ | 只用现有 React + CSS；`conversation.input.dock` 不变 |

### 7.6 落地顺序（给小前）

1. 删 `MemberCard` + §4.1 的 6 条 CSS，跑一遍确认办公室 tab 与标题栏没塌。
2. 加 §4.3 整块 CSS（此时 `.wt-dock` 会瞬间变成 32px，卡片样式还在，画面会短暂错位 —— 正常）。
3. 重写 `Dock` render（§7.3），新增 `DockFace` / `DockChip`。
4. 收缩 `DockSeat` 到派单态，改回焦选择器。
5. 加 4 个 locale 键（`dock.chipAria` / `chipAriaTask` / `moreAria` / `dispatchTo`），zh/en 同时。
6. 手工验收：7 人全待命 / 1 人 working / 2 working + 1 waiting / 窗口拖到 500px / 拖到 320px / 派单态 / 派单失败（看错误行）。

---

## 8. 落地回执（V3.1 · 2026-10-26）

小前按本规格落地（task-2）后，逐条复核的结果。**以下为最终口径，与上文冲突时以本节为准**（上文已同步改好）。

### 8.1 两条裁定

| # | 问题 | 裁定 | 一句话理由 | 小前要做 |
|---|---|---|---|---|
| 1 | 非 working 的 chip aria 重复（`小审，等你回复：等你回复`） | **(a) 相等时省掉后半段** | 可见文本就是「名字 + 状态」，可访问名再重复一遍只是让读屏多念四个字；working 的短语是任务名，与状态不同，必须留。 | 见 §6.3.1：`dock.chipAria` 改成 `{name}，{status}`，另加 `dock.chipAriaTask`，三行判断 |
| 2 | 派单态宽轨道右侧留白 500+ | **(a) 就这样，左对齐** | 输入框左沿必须继续压在 composer 正文那条 14px 竖线上（§5.4 的唯一对齐契约）；居中会让输入框点开时横向跳一段，且与下方正文错位。 | 无（保持现状） |

选项 b 被否的具体原因：seat 收窄视觉上等于现状（卡片本就 `max-width:420` 且左对齐），而把 seat 改成 `flex:none` 会让卡片的 `width:100%` 失去参照直接塌掉。

### 8.2 五处偏离：全部确认

| # | 偏离 | 裁定 | 备注 |
|---|---|---|---|
| 1 | 容器查询阈值 **643 / 451 / 291**（原写 671/479/319） | **确认，且是我的错** | `@container` 尺寸查询比的是**内容盒**，而我的档位是按 border-box 推的；减掉左右各 14px 内距正好是这三个值。已改 §4.3 / §5.3 第 5 条 |
| 2 | `.wt-dock-head` / `.wt-dock-count` 没删 | **确认** | `OfficeAction` 复用工位条的头部结构（头像堆 + 人数）当标题栏按钮，`2606` / `2612` 是活引用；它不在 dock 里，所以只让 `Dock` 不再渲染、样式原样保留。**但 `.wt-dock-title` 是死的** —— 落地后全仓已无引用，可单独删掉。v3.1 已把这三者从 §4.1 删除表移出并改到 §4.2，本节补上「为什么」 |
| 3 | `.wt-bubble` / `@keyframes wt-bubble` / `bubble` 参数都留着 | **确认，且是我的错** | v1 写「唯一调用点是 `MemberCard:972`」，漏了 `DispatchCandidateRow:1155`（`bubble: status === 'waiting'`）。删了侧栏等待气泡就没了。已改 §4.1 / §4.2 / §7.1 / §7.2 |
| 4 | `.wt-chip` / `.wt-seat-tip` 加 `box-sizing:border-box` | **确认** | `height:24px` + `border:0.5px` 在 content-box 下会渲染成 25px，直接破坏 32px 轨道的 4px 上下留白。已并入 §4.3 |
| 5 | `.wt-seat-open` 的 `min-width:220px → 0` | **确认** | 220 在窄轨道下会顶出边界；且卡片本就 `width:100%`，`min-width` 只在 <420 时生效，正常宽度零影响。已并入 §4.4 |

### 8.3 额外补丁：确认

`.wt-seat:focus-within .wt-seat-tip { transition-delay:0s, 0s }` —— **必须加，而且是 bug 不是优化**：原规则把键盘路径也套了 380ms，Tab 会落到一个暂时看不见的 `↗` 上。

一个实现约束：这条与 `.wt-seat:hover .wt-seat-tip, .wt-seat:focus-within .wt-seat-tip` **特异性相同**（都是 0,3,0），所以必须写在它**之后**，靠顺序取胜。已并入 §4.3 并在注释里标注。

### 8.4 一处我自己发现、需要小前看一眼的（不在五条里）

`.wt-dock-error` 被从 `flex:none; max-width:min(260px,42%)` 改成了 `flex:1 1 auto; max-width:none; height:20px; padding:0 6px; border:0`。`Dock` 已经不用它了，现在唯一的使用者是 `OfficeAction`（标题栏）。在标题栏那个容器里 `flex:1 1 auto` 会让错误行吃掉全部剩余宽度 —— 视觉上大概率没问题（长错误本来就该占满），但这是对「§7.2 OfficeAction 不动」的一次实质改动。**不是否决**，只是请小前确认标题栏在长错误文案下的观感，别让它把 `7 人` 挤走。
