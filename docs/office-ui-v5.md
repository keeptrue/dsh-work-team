# 员工办公室 V5 · 实现与降级策略

> 落地文件：`client.js`（CSS 模板 + `Corridor` / `DeskCard` / `EmptyDesk`）。
> 视觉契约：`docs/office-ui-v5-spec.md`（小设）；本文只记录**实现**与**降级**，
> 数值冲突时以契约为准，机制冲突时以本文为准。
> 锁住这些行为的测试：`test/office-v5.test.js`（source pin）。

---

## 0. 一句话

**走路是事件的证据，不是装饰。** 只有「员工 ↔ 员工」的真实事件能让走廊动；
看不见、或用户要求减少动效时，动效退成一次闪烁，且**一个定时器都不排**。

---

## 1. 移动：只有两个来源，今天只有一个会响

`Corridor` 的走路只有一条入口（`useEffect`），它合并两个 store：

| store | 写入者 | 触发条件 | 今天会响吗 |
|---|---|---|---|
| `handoffs` | `flashHandoff()`，**全文件唯一调用点**在任务 diff 里 | 任务 `in_progress` 期间 `ownerName` 变了 | ✅ 会 |
| `dialogues` | `flashDialogue()`，**没有调用点** | 宿主投影「员工 ↔ 员工对话」 | ❌ 不会（预留） |

`flashDialogue` 是**预留入口**，不是假事件：客户端目前拿不到员工之间的对话投影，
所以它一行调用都没有，走廊也永远不会为聊天走路。哪天宿主开始投影，接上
`flashDialogue(from, to)` 就会走，但要知道它和 handoff 不是同一条分镜：

- 共用：起立/取件时长、按排数算的走路、回程、`tEnd - 180` 的交叉淡入、reduced-motion
  与「两端可见」两道护栏；
- 没有：纸（`.wt-walker-card` 只挂给 handoff）、接收方的 `data-wt-receive` 与 gift、
  `wt-plate-take` / `wt-dot-take` / `wt-fig-take`。对话不是交接，不该凭空递东西；
- 相位名是 `chat`（不是 `give`/`nod`），CSS 已支持。

也就是说：接线本身不用改动画，但**别指望对话有交接的接收戏**——这是设计，不是缺口。
`test/office-v5.test.js` 把「`flashDialogue(` 只出现一次（定义）」钉死了——加调用点
必须是一次有意识的改动。

**为什么没有 ambient**：随机漫步没有事件，却在画面上声称「有人过去了」。整段（effect、
`data-kind="ambient"` 时长覆盖、`Math.random`、只为它服务的 `busy` / `lastActor` /
`itemsRef`）已删除。`client.js` 里 `ambient` 一词现在为 0，测试守着。

**为什么派单不走路**：`lead → 员工` 是派活，不是交接。`flashHandoff` 只有一个调用点，
且要求「任务本来在进行中、只是换了负责人」，所以派单永远不会触发 walker。

### 1.1 键空间（这条错了整段动画都是死代码）

两套键**不能混**：

- `handoffs` 的 map key = `member.name` = 角色 id（`designer`），也就是 `task.ownerName`
  携带的值（宿主 `ownerName = members.find(id).name`）；
- `roleOrFallback(member).zh.name` = 显示名（`小设`），只用于**标签**。

所以 `flashHandoff` 的每条标记多存一个 `peer`（对方的 raw name），`Corridor` 用
`{ from: name, to: mark.peer }` 解析座位；`indexOf` 的键是
`item.member.name` / `item.role.id`。同一处修正也让内置座位的 `taskFor(role.id)` 生效
（原先按显示名取任务，桌牌 title 里永远没有任务）。

---

## 2. 交接分镜：两端都有戏

| 段 | 时刻 | 谁 | 发生什么 |
|---|---|---|---|
| ① 起立 | 0 | walker | `wt-stand` 120ms，从 `translateY(2px) scale(.96)` 站直 |
| ② 取件 | 120–420ms | walker | `wt-card-pick` 300ms，纸从桌牌位置（`translateY(34px)`）升到手上，落在 -8° |
| ③ 沿路 | 420ms → `tGive` | walker | `wt-walk-out`，`linear`，人 + 纸一起沿路滑到收件人那一排 |
| ④ 到达 | `tGive` | walker | `data-phase="give"`：侧身、把纸递出去（`wt-fig-give` / `wt-card-give`，**都是 140ms**，正好等于 `tNod − tGive`；`nod` 用静态终态接住同一姿势，不回弹） |
| ⑤ 接收 | `tNod` | 收件人 | `data-wt-receive`：纸落入桌牌（`wt-gift-drop`）+ 桌牌闪（`wt-plate-take`）+ 点脉冲（`wt-dot-take`）+ 人物侧身接（`wt-fig-take`）。前两个 **0.8s**：rows=1 时接收窗口只有 860ms，0.9s 会被 `tEnd` 砍掉 |
| ⑥ 回座 | `tBack` | walker | `wt-walk-back`，`linear`，空手走回 |
| ⑦ 落座 | `tEnd-180` | 两端 | 送件人淡入（`absent` 清掉），walker 同时淡出 180ms（`wt-seat-fade`） |

**时间轴按排数算**，不按事件算（`rows = |toIdx - fromIdx|`）：

```js
pick = 420; walkMs = min(2400, 160 + rows*240); backMs = min(1600, rows*200);
tGive = pick + walkMs; tNod = tGive + 140; tBack = tNod + 480; tEnd = tBack + backMs + 180;
```

| rows | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| end (ms) | 1820 | 2260 | 2700 | 3140 | 3580 | 4020 | 4460 |

JS 把 `--wt-walk-ms` / `--wt-back-ms` / `--wt-pick-ms` 写进 walker 的 inline style，
CSS 用 `var(--wt-walk-ms, 400ms)` 取时长——**同一个钟**，不会各算各的。
`steps(24)` / `steps(18)` 已换成 `linear`：7 排时一步跨 30px，44px 的人看起来像瞬移。

**几何是量出来的**：walker 的 `top = 送件人桌底 − track 顶 − 44`，
`--wt-dy = 收件人桌顶 − 送件人桌顶`。层高或 gap 改了不用改 JS；
`--wt-lane` 是车道宽唯一真值（46 / 340px 容器以上 56），桌网、道路、支路、walker 全读它。

纸的落点是**分侧**的，锚点和漂移是两件独立的事：

- **锚点**贴着车道那一端：左桌 `right:8px`，右桌 `left:8px`。契约原文只有 `right:8px`，
  只对左桌成立；右桌会落在桌牌外侧端，离手约 60px。
- **漂移**指向车道（也就是送件人站的那一侧）：右桌 `-6/-1px`，左桌 `+6/+1px`。
  契约原文只有 `-6px`，只对右桌成立；左桌会朝远离车道的一侧飘。

两处都按契约的意图（「从手上过来」）把另一侧补齐，数值本身没改。

---

## 3. 降级：三种情况，一个都不排队定时器

| 情况 | 判定 | 结果 |
|---|---|---|
| `prefers-reduced-motion: reduce` | effect 第一行 `return` | 无 walker、无 gift、无 receive 动画；`[data-wt-handoff]` 的 `wt-flash` 保留（纯透明度，不移动）。**不排任何 timer** |
| 两端不全在可见区 | `onScreen(from) && onScreen(to)` 失败 → `continue` | 同上，只闪 |
| 没有真实事件 | `events.length === 0` | 什么也不做 |

「可见区」= **最近的滚动祖先**（实际是 `.wt-panel-body`）与窗口视口的交集。
`.wt-corridor` 是内容高度（它自己不滚），拿它当视口会把每一张桌子都判成「可见」——
所以 `scrollParent()` 往上找 `overflow-y:auto|scroll` 的那一层，再和
`window.innerHeight` 取交集。`.wt-corridor` 上的 `overflow-y:auto` 已删：
将来谁给它一个高度，绝对定位的道路会瞬间缩成视口高。

**reduced motion 的循环动画也关**：`waiting` 的呼吸（`wt-pulse`）与交接的 `wt-dot-ping`
是持续闪烁，不是一次性反馈，全部 `animation:none`；一次性 `wt-flash` 留着。

**抢占**：新事件 `clearTimers()` 覆盖旧的那趟，一趟最长 4.46s；滚动途中不追着重新对齐
（不挂 scroll 监听，那会让每帧都算布局）。

---

## 4. 桌牌：名字 · 圆点 · 状态词，一行

```
[ 小前  ● 干活中 ]      ← 名字 flex:0 1 auto（唯一允许省略号）
                        圆点 6px，border-radius:50%，background:var(--wt-state)
                        状态词 flex:0 1 auto; max-width:70%，超出省略号
```

- **文字永远在**：状态词不是装饰，圆点 `aria-hidden="true"`，完整读法
  （名字 · 角色 · 状态）在桌位的 `aria-label` 上。
- **颜色不是唯一通道**：`provisioning` / `failed` / `data-wt-absent` 是**空心环**，
  空位是**无 hue 的空心环**；实心 = 在场且正常。
- **对比度**：`.wt-desk` 的 `--wt-state` 从 70/30 改为 **60/40**（idle 点 2.84:1 → 3.64:1，
  其余 ≥4.9:1；深色 ≥5.37:1）。只改桌位，行列表与名片的 70% 不动。
- **名字先让，状态词不缩**：状态词 `flex:0 0 auto`（shrink 0，永不收缩），名字
  `flex:0 1 auto`（只缩不涨）承担省略号；`max-width:70%` 兜超长状态词。名字不 grow，
  所以三段始终紧挨、整行左对齐——圆点紧跟名字，不会被推到桌牌右端。
- **交接 ping 不带 fill**：标记活 1600ms、ping 只跑 1200ms，而这 400ms 里发件人正
  `data-wt-absent`（空心点）。若给 ping 加 `both`，它的末帧（透明 5px 环）会盖掉空心点的
  inset 环 → 点直接消失。`wt-flash` 的 `both` 要留（它靠末帧收尾），`wt-dot-ping` 不留。

**取舍（需要知道）**：一行放不下「角色 · 任务」，所以桌牌第三段显示的是**状态词**；
`角色 · 任务` 移到 `title`，交接时 `title` 变成 `小前 → 小设`。这是 V5 的显式决定：
状态比任务名更该在一眼之内。

---

## 4.5 v5.1 状态点：为什么放弃单公式

用户反馈「颜色分不清」。根因不是某个色不好，而是**一条公式套所有状态**：

```css
/* v5.0（已删） */
.wt-desk { --wt-state: color-mix(in srgb, var(--wt-raw) 60%, var(--dsw-alias-label-primary)); }
```

- 40% 的近黑把所有色压进同一段 L*（≈48–61），彩度一起掉——六个状态在缩略尺寸下互相像；
- `idle` 的 raw token 本身是近白 `#d4d4d4`，套完只剩 **2.83:1**，等于没有点；
- `ready` 的 raw 是 `success 45% + label-secondary`，再套同一条公式 → 和 `done` 撞绿
  （ΔE 0.117，deutan 0.102）。

**改法：每个状态自己声明 `--wt-state`。** `--wt-raw` 那层不动（头像环、人物、行列表还在用它），
只把桌位圆点的配方下放到状态类：

```css
/* 浅色：每个状态一条 */
.wt-desk.wt-st-idle    { --wt-state: … }
.wt-desk.wt-st-working { --wt-state: … }
…
/* 深色：同一状态另一条（宿主把 data-ds-dark-theme 挂在 <body>，demo 挂 <html>） */
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-idle { --wt-state: … }
…
.wt-desk { --wt-state: var(--dsw-alias-label-secondary); } /* 只做兜底 */
```

**两层，不是一条**：浅色和深色各是独立配方（`label-primary` 在两侧一黑一白，同一条表达式
只能「顺便」自适应；有的状态需要不同比例才站得住）。深色选择器同时认宿主与 demo 两种挂法，
`:is()` 的特异性 (0,1,1)+(0,2,0) 稳赢浅色那条。

**为什么锁在 `.wt-desk`**：`.wt-row`、`.wt-avatar-wrap`、`.wt-person` 都在本文件更靠后的位置
各自声明了 `--wt-state`（70% 混合）。如果把配方写在裸 `.wt-st-*` 上，任何将来带状态类但没
自己声明的组件会被静默改色；`.wt-desk.wt-st-*` 只影响桌位。

**圆点 6 → 8px，环换性质。** 旧的 `0 0 0 1px color-mix(state 28%)` 是同色糊边，视觉上把点
的边缘又晕开一圈；现在 `0 0 0 1.5px var(--dsw-alias-bg-layer-1)` 是**表面色外环**——把点从
旁边的文字里「切」出来，而不是把自己的边界抹掉。

**保留不动**：形状通道（`provisioning`/`failed`/`absent` 空心环、空位无 hue 环）、
`waiting` 的透明度呼吸、`out` 的 ping（仍然不带 fill，见 §4）、`receive` 的 `wt-dot-take`。
它们都读 `--wt-state`，换配方不会丢动画底色。

**桌牌尺寸复测**（8px 点 + 5px gap）：380 面板桌牌 140、300 面板桌牌 105，两档
`plateNoOverflow` 均成立（`scrollWidth - clientWidth = 0`，状态词不裁）；长名字压到 38px 时
只有名字出省略号。

**当前值**（`node demos/office/tools/dot-audit.mjs --emit` 生成，与
`docs/office-ui-v5.1-dots.md` §6 逐字一致）：

| status | light | dark |
|---|---|---|
| idle | `label-secondary 60% + label-primary` | `label-secondary 54% + label-primary` |
| working | `business` | `business 83% + label-primary` |
| provisioning | `business` | `business` |
| waiting | `warn 56% + label-primary` | `warn` |
| done | `success 79% + label-primary` | `success 57% + label-primary` |
| error | `error 53% + label-primary` | `error` |
| failed | `error 68% + label-primary` | `error 87% + label-primary` |
| ready | `business 54% + error` | `business 51% + error` |

实测（`node demos/office/tools/dot-audit.mjs`，**26 项全 PASS，exit 0**）：

- 对比度：light 3.42–10.10，dark 4.77–12.41（阈值 3.2 / 4.5）；
- 实心两两最小 ΔE：light normal **0.155** / deutan **0.091** / protan **0.092**；
  dark normal **0.151** / deutan **0.109** / protan **0.097**（阈值 0.15 / 0.09）；
- `ready`↔`done` 色相间隔 **177°**（阈值 25°）——ready 改成 business+error 合成的紫红，
  ΔE 从 0.118 提到 0.303，deutan 0.159，彻底离开 done 的绿。

**代价（明说）**：8px 点之后，300 面板（桌牌 105、内容 89）英文 `Waiting for you` 会截到
约 71px 并出省略号；中文 `等你回复` 44px 两档都不截。这是 `max-width:70%` 的兜底在工作，
不是溢出——`plateNoOverflow` 两档仍为 0。

## 5. 道路：一条贯穿，没有接缝

```
.wt-corridor              内容高度，不滚动
└ .wt-road-track          position:relative; flex:none; gap:8px   ← 路的高度参照物
  ├ .wt-road              position:absolute; top:0; bottom:0; 车道宽
  ├ .wt-floor × N         桌网 1fr var(--wt-lane) 1fr
  └ .wt-walker            top / --wt-dy 由 JS 量出来
```

- **层间无断口**：道路是 track 的绝对定位子元素，`top:0;bottom:0` = 整条内容高，
  gap 也算在里面。道路不是每层各画一段，结构上不存在接缝。
- **中线跨层连续**：`background-size:1px 100%` + `repeating-linear-gradient`，
  整条路只有一张 1px 宽的图，没有相位可错。**不要改成 `1px 21px`**（那才会平铺）。
- **每桌一条支路**：`.wt-desk::before`，宽 `7px + 车道/2`，从桌沿压到车道中心形成路口；
  颜色 `--wt-road-stub`（24%）比路缘（18%）深一档，否则路口被路缘吃掉。
- **首尾端帽**：`.wt-road::before/::after` 两条 3px 横杠，距端 2px，6px 圆角内沿不会戳出。
- **滚动不错位**：路、桌、walker 全在同一个 track 坐标系里，滚动是整体平移；
  实测滚动 508px 后道路与 track 的 top/bottom 差值仍是 0。
- **灰度**：surface 5% / edge 18% / line 32% / cap 26% / stub 24%，全部是
  `label-primary` 的 `color-mix`，零 hex、零 rgb()。路不携带信息，所以中线压在 2.1:1，
  不跟 44px 的人物抢视线。

---

## 6. data-* 契约

| 元素 | 属性 | 值 | 生命周期 |
|---|---|---|---|
| `.wt-desk` | `data-wt-status` | 状态 id | 常驻 |
| `.wt-desk` | `data-wt-absent` | `"true"` | walk 开始 → `tEnd-180` |
| `.wt-desk` | `data-wt-receive` | `"true"` | `tNod` → `tEnd` |
| `.wt-desk` | `data-wt-handoff` | `out` / `in` | 标记寿命（1600 / 480ms） |
| `.wt-walker` | `data-phase` | `out` / `give` / `nod` / `back`（对话走 `chat`） | walk 期间 |
| `.wt-walker` | `data-kind` / `data-wt-walker` | `handoff` / `dialogue` | walk 期间 |
| `.wt-walker` | `data-to-side` | `left` / `right`（收件人坐在哪一侧） | walk 期间 |
| `.wt-walker` | `--wt-dy` / `--wt-walk-ms` / `--wt-back-ms` / `--wt-pick-ms` | px / ms | walk 期间（inline） |
| `.wt-walker-card` | — | 仅 `kind === 'handoff'` 挂载 | walk 期间 |
| `.wt-desk-gift` | — | 仅收件位挂载 | `tNod` → `tEnd` |

`data-wt-*` 只描述「现在正在发生什么」，不描述「谁是谁」；身份走
`data-wt-member` / `data-wt-empty`。

---

## 7. 自检（控制台可复现）

```js
// 1. 路是连续的
const road = document.querySelector('.wt-road'), track = document.querySelector('.wt-road-track');
Math.abs(road.getBoundingClientRect().height - track.getBoundingClientRect().height) < 0.5;

// 2. 每个座位都有圆点
[...document.querySelectorAll('.wt-desk')].every(d => getComputedStyle(d.querySelector('.wt-desk-dot')).borderRadius === '50%');

// 3. 状态词永远在
[...document.querySelectorAll('.wt-desk')].every(d => d.querySelector('.wt-desk-state')?.textContent.trim() !== '');

// 4. 静止时没有 walker
document.querySelector('.wt-walker') === null;
```

第 5、6 条（真实改派后按表走完；模拟 reduced motion 后只闪不走）需要一次真实的任务改派
或 DevTools 的 emulation，无法在静态页里断言——它们由 `test/office-v5.test.js` 的
source pin 与本文第 2、3 节的时间表共同锁定。

---

## 8. 测试

`test/office-v5.test.js`（18 条，`node --test`）：

- 没有 ambient：`client.js` 里 `ambient` 为 0、`Corridor` 里没有 `Math.random` / `setInterval`；
- walker 只由 `handoff` / `dialogue` 出现，`flashHandoff` 只有 1 个调用点，
  `flashDialogue` 只有定义（预留，不许伪造）；
- 键空间：`indexOf` 用 `member.name` / `role.id`，`taskFor(role.id)`；
- 纸：`wt-walker-card` 只挂给 handoff，give 相位有递交姿态，nod/back 时纸不在手上；
- 接收：`data-wt-receive`、gift 是桌牌的兄弟（不是子元素，桌牌裁剪 overflow）；
- 降级：reduced-motion 的 `return` 在任何 `runWalk` 之前、`onScreen` 判定在 `runWalk` 之前、
  走廊上没有 `overflow-y`；
- 桌牌：一行三段、圆点 `50%` + `--wt-state`、状态词有省略号与 70% 上限；
- 道路：单条 `.wt-road`、`top:0;bottom:0`、端帽、支路、`--wt-lane` 一处真值、灰度 token；
- 时间轴：`rows` 公式与三个 CSS 变量、`linear`、没有 `steps()`。
