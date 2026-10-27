# 员工办公室 V5 · 视觉契约（连续道路 / 状态点 / 交接分镜）

> 只出规格，**未改 `client.js`**。小前已经落了第一版 V5，所以这份文档的形状是
> **「已落地 ✅ / 必修 ❌ / 调参 ⚠️」的验收契约**，不是从零方案——已经对的东西不要再动。
> 核对快照：`client.js` 5136 行（07:07）。行号会漂，**一律按选择器找**。
>
> **07:18 更新**：§1–§4 的必修与调参项已全部落地，验收结论、逐条对应和两处偏差记在
> **§6 实现记录**；正文保留原始判定与推导，作为「为什么是这些数」的存档。
> 色值全部走 `--dsw-alias-*` 与 `color-mix`，**零 hex、零 rgb()**；尺寸全部给 px，没有「适当」「略」。
> 对比度数字按 WCAG 相对亮度公式实算，底稿是宿主 token 表
> `@deepseek-ai/dsh-client-ui-theme/lib/client.js`（`design_platform_css_default`，第 1413 行那一条）。

---

## 0. 一句话主张

**路是墨，人是彩。**

道路、桌牌、虚线全部只用 `label-primary` 的 5%–32% 混合，读起来像一张建筑平面图；
颜色只留给两件事——状态点和那张正在传递的纸。所以：**路不许有颜色，点不许只有颜色。**

三条用户需求对应三个验收对象，逐条对齐：

| 用户说的 | 代码里的对象 | 现状 |
|---|---|---|
| 员工不许乱走，只有真交接才动，动的时候要看见文件 | `.wt-walker` + `handoffs` / `dialogues` | **❌ 走不起来（见 §1.1）**，但乱走已经删干净 ✅ |
| 名字后面要状态文字 + 彩色小圆点 | `.wt-desk-plate` 一行三段 | ✅ 版式对了，⚠️ 窄桌硬切、❌ 缺形状语义 |
| 路不能断，要丝滑连起来 | `.wt-road` 一条贯穿 | ✅ 方案对，⚠️ 对比度太低，浅色主题几乎是白纸 |

---

## 1. 必修（三条，前两条是功能级）

### 1.1 ❌ 交接永远走不起来：`indexOf` 的键空间 + 方向反了

这是本次最重要的一条。**现在走廊是完全静止的**：ambient 已经删了，而真实交接又解析不出座位。

**根因（两处叠加）：**

1. **键空间不一致。** `handoffs` / `dialogues` 的 map key 是 `member.name`（角色 id，如 `designer`）；
   而 `indexOf` 用的是显示名（`roleOrFallback(item.member).zh.name`，如 `小设`）。
   `indexOf.get('designer')` 恒为 `undefined` → `continue` → 一个 walker 都不会生成。

   键空间的真值链（已核实，不要「顺手修成」别的）：
   `memberByName.get(role.id)` 取座位 → **`member.name === role.id`**；
   宿主 projection 的 `ownerName = members.find(id).name`（`dsh-experimental-agent-team/lib/index.js:367`）
   → **`task.ownerName === member.name`**；`roleOrFallback(member).zh.name` 才是显示名。

2. **方向反了。** `flashHandoff` 写的是「对方」：
   ```js
   handoffs.set(fromName, { from: toLabel ?? toName, kind: 'out', at });  // from 字段 = 收件人
   handoffs.set(toName,   { from: fromLabel ?? fromName, kind: 'in',  at }); // from 字段 = 发件人
   ```
   而 Corridor 里写的是 `events.push({ from: mark.from, to: name })`
   —— 把「收件人」当成了发件人，方向正好相反。

**改法（四处，共 8 行）：**

```js
// A. flashHandoff（820–821 行）：额外存一个 raw name，显示用的 from 不动
handoffs.set(fromName, { from: toLabel ?? toName,     peer: toName,   kind: 'out', at });
handoffs.set(toName,   { from: fromLabel ?? fromName, peer: fromName, kind: 'in',  at });
```
```js
// B. Corridor 事件（2701 行）：from = 发件人（map key），to = peer
if (mark.kind === 'out') {
  events.push({ kind: 'handoff', from: name, to: mark.peer, at: mark.at });
}
```
```js
// C. Corridor 索引（2713 行）：一个座位只留一个键，键 = member.name / role.id
items.forEach((item, i) => {
  indexOf.set(item.member === null ? item.role.id : item.member.name, i);
});
```
```js
// D. 顺带（3970 行）：内置座位的 task 也拿错了键，桌牌 title 永远没有任务
task: taskFor(role.id),        // 原来写的是 role.zh.name
```

`handoffLine`（`→ ${handoff.from}`）继续用显示名，不受影响。
`dialogues` 那条分支方向本来就是对的（`{to: toName}` 存的是 raw name），改完 C 就会一起活过来。

> 自检：改完在控制台 `document.querySelector('.wt-walker')`，一次真实改派后必须出现；
> 60 秒不派活必须一直是 `null`。

### 1.2 ❌ 那张纸在浅色主题上是幽灵

`.wt-walker-card` / `.wt-desk-gift` 现在是 `background: var(--dsw-alias-bg-layer-1)` +
`inset 0 0 0 1px var(--dsw-alias-border-l2)`。但浅色主题下 `bg-layer-1 = #fff`（token 表里
`--dsw-alias-bg-layer-1: neutral-bluish-00`），`border-l2 = #0000001a` → 卡片 = **白底 + 1.27:1 的描边**。
14×18 的纸在这个对比度下等于不存在，而它是需求 1 的主角。

```css
.wt-walker-card, .wt-desk-gift {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 36%, transparent),
    0 2px 5px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
}
/* 两道横线同理：border-l1 在浅色是 4% 黑，等于没画 */
.wt-walker-card::before, .wt-walker-card::after,
.wt-desk-gift::before,   .wt-desk-gift::after {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
}
```

实测：描边 36% → 浅色 `#a9a9ab`（对白底 2.35:1）、深色 `#707071`（对 `#232324` 3.17:1）；
描边对纸面（5% 填充）还有 2.11:1，所以边缘两边都咬得住。同一套值两个主题都成立，不需要分支。

### 1.3 ⚠️ 桌牌状态文字在窄桌被硬切

`.wt-desk-state` 现在是 `flex:none; white-space:nowrap;` 且**没有 overflow**：
桌牌 `overflow:hidden` 会把它直接切掉——**没有省略号**，读起来像文字被削掉一半。

算最坏情况（名字恒为 `roleInfo.zh.name`，内置角色都是 2 个汉字 ≈ **24px**；
英文最长状态词 `Waiting for you` 在 11px 下 ≈ **75px**；圆点 6 + 两个 5px 间距）：

| 桌牌宽 | 内容宽 | 24 + 16 + 75 = 115 | 结果 |
|---|---|---|---|
| 150（标准） | 134 | 115 ≤ 134 | ✅ 放得下 |
| 125（面板 340） | 109 | 115 > 109 | 名字被压 6px（设计上允许） |
| 120（面板 320） | 104 | 115 > 104 | 名字压到只剩一个字 |
| 自定义成员 | — | `display` 退化成原始 name（如 `researcher` ≈ 68px） | **状态词自己被裁，无省略号** |

前两行是「名字让位」，符合设计；最后一行是「没有兜底」。加下面四行把它堵住。

```css
.wt-desk-state {
  flex: 0 1 auto; min-width: 0; max-width: 70%;
  overflow: hidden; text-overflow: ellipsis;
}
```
优先级写死：**名字先让位，状态后让位，但状态有 70% 上限**（70% × 134 = 94px，
`等你回复` ≈44px / `Waiting for you` ≈75px 都放得下，正常情况下轮不到它截断）。

---

## 2. A · 连续道路

### 2.1 选型：✅ 已选对，不要回头

`gap:0 + 层内 padding` 那条路（每层各画一段）被否决是对的，理由有数：

| 维度 | gap:0 + 层内 padding | ✅ 单条绝对定位道路层（现方案） |
|---|---|---|
| 断口 | 靠 0 间隙消掉，谁加回 `gap` 就断 | 结构上不存在 |
| 虚线相位 | 层高必须是虚线周期整数倍，改 94 就错位 | 一个渐变贯穿，**无相位** |
| 端帽 | 每层各画，首尾要额外选择器 | 一个元素两个圆角 |
| 滚动延伸 | 自动 | 需要「内容高度的参照物」= `.wt-road-track`，已有 |
| 代价 | 0 个新节点 | +1 个 wrapper，−8 个 `.wt-aisle` |

`.wt-road-track` 必须保住 **`flex:none`**：它是 `.wt-corridor` 的 flex 子项，一旦允许收缩，
走廊内容溢出时会被压扁，路和桌子一起缩水。这一行是这套方案唯一的地基。

### 2.2 ✅ 虚线为什么不需要相位计算

```css
background-image: repeating-linear-gradient(to bottom, var(--wt-road-line) 0 6px, transparent 6px 15px);
background-size: 1px 100%;
background-position: center;
background-repeat: no-repeat;
```
`background-size: 1px 100%` 把渐变铺成**一张 1px 宽、整条路高的图**，`repeating-` 在这张图内部
按 21px 周期自己重复。所以：整条路只有一条渐变，跨层、跨 gap、跨滚动都不存在接缝。
（这条别改成 `background-size: 1px 21px` —— 那才会变成平铺，层高一变就要算相位。）

### 2.3 ⚠️ 唯一要改的：三层灰度太低，浅色主题上几乎是白纸

| 用途 | token | 现在 | 浅色实测 | 改成 | 浅色实测 |
|---|---|---|---|---|---|
| 路面 `--wt-road-surface` | `label-primary` | 5% | `#f3f3f3` / 1.11:1 | **5%**（不动） | 1.11:1 |
| 路缘 `--wt-road-edge` | `label-primary` | 10% | `#e7e7e8` / 1.24:1 | **18%** | `#d4d4d5` / 1.48:1 |
| 中线 `--wt-road-line` | `label-primary` | 12% | `#e2e2e3` / 1.29:1 | **32%** | `#b2b3b4` / 2.10:1 |
| 端帽 `--wt-road-cap` | `label-primary` | 18% | — | **26%** | `#c1c1c2` / 1.80:1 |
| 支路 `--wt-road-stub` | 复用 edge | 10% | — | **24%**（单独 token） | `#c5c6c7` / 1.71:1 |

为什么中线只到 2.1:1 而不是 3:1：路是**基础设施，不携带状态**，3:1 是「有信息的图形」的门槛。
32% 已经让它在白底上稳定可见，再深就会跟 44px 的人物抢视线。**人物必须是画面里最响的东西。**
深色主题同理：32% 的 `#f9fafb` 叠在 `#232324` 上 = `#676869`（2.81:1），成立。

```css
.wt-corridor {
  --wt-road-surface: color-mix(in srgb, var(--dsw-alias-label-primary) 5%,  transparent);
  --wt-road-edge:    color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  --wt-road-line:    color-mix(in srgb, var(--dsw-alias-label-primary) 32%, transparent);
  --wt-road-cap:     color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent);
  --wt-road-stub:    color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
}
```

### 2.4 ✅ 支路接主路：接到车道中心，不是接到路缘——这是对的选择

```css
.wt-desk::before { top:calc(50% - 1px); width:calc(7px + var(--wt-lane) / 2); height:2px;
  background:var(--wt-road-stub); }
.wt-desk[data-side="left"]::before  { left:calc(100% - 1px); }
.wt-desk[data-side="right"]::before { right:calc(100% - 1px); }
```
7px 是桌子到车道的固定留白（`margin-right/left:7px`，不随车道变），再走半个车道正好压到中线。
八条支路在中线上形成八个「路口」，比只画 8px 小舌头更像一条真的街——**别改短**。
`left/right: calc(100% - 1px)` 让支路往桌内压 1px，视觉上焊住。

支路颜色必须**比路缘深一档**（24% > 18%），否则路口会被路缘吃掉。

### 2.5 ✅ 空位桌接路，强度不变

空位桌照常画支路（`.wt-desk-empty` 不加 opacity）。路是办公室的，不是某个人的；
留一个断口会让整条街读起来像缺牙。空位只用桌牌表达：名字 `label-secondary` + 空心点（§3.4）。

### 2.6 ✅ 端帽、滚动延伸、几何

- 端帽：`::before/::after` 各一条 `left:3px right:3px height:3px` 的横杠，距两端 2px。
  6px 圆角在 y=2 处的内沿 x≈1.53px < 3px，所以横杠**不会戳出圆角**（算过了，不用改）。
- 滚动：真正滚的是 `.wt-panel-body`（`overflow-y:auto`），`.wt-corridor` 是内容高度，
  所以 `top:0;bottom:0` 天然等于内容高。**`.wt-corridor` 上那行 `overflow-y:auto` 是死规则**
  （永不滚动），建议删掉：将来谁给它加一个高度，绝对定位的路就会瞬间缩成视口高。
  **落地版已经删了**，并且连带修了一个更深的坑：原来的「两端都在视口内」判定拿 `.wt-corridor`
  自己的 rect 当视口——而它是内容高度，所以**永远判定为可见**，那道护栏从来没生效过。
  现在用 `scrollParent(desk)` 找最近的滚动祖先（= `.wt-panel-body`），与 `window` 取交集：

  ```js
  const panel = scrollParent(fromNode);
  const panelBox = panel === null ? null : panel.getBoundingClientRect();
  const view = {
    top: Math.max(0, panelBox === null ? 0 : panelBox.top),
    bottom: Math.min(window.innerHeight, panelBox === null ? window.innerHeight : panelBox.bottom),
  };
  ```
  这条改动把「看不见就不走」从一句注释变成了真行为：现在滚出视口的交接只会闪，不会白走一趟。
- 车道宽只有一处真值：`.wt-corridor { --wt-lane:46px }` + `@container (min-width:340px)` 改 56px，
  桌网、道路、支路、walker 全部读它。✅ 不要再出现第二个 46/56。

| 面板宽 | 走廊内容宽 | 车道 | 桌宽 | 桌到车道 | 桌外侧留白 |
|---|---|---|---|---|---|
| 380 | 380 | 56 | 150 | 7 | 5 |
| 340 | 320 | 56 | 125 | 7 | 0 |
| 320 | 300 | 46 | 120 | 7 | 0 |

（340px 断点是**面板**宽，容器是 `.wt-panel`，不是走廊。走廊永远比面板少 20px 内边距。）

---

## 3. B · 状态圆点 + 文字

### 3.1 ✅ 版式已定，理由要记住

`.wt-desk-plate` 一行三段：**名字 → 圆点 → 状态词**（`flex-direction:row; gap:5px`）。
名字 `flex:0 1 auto` 是唯一允许省略号的部分；状态词永远在场。

被否决的方案：两行堆叠（名字一行、`● 状态` 一行）。它其实更利于扫读——八个状态词能对齐成一列，
而一行版里状态词的 x 位置会随名字长度漂移。但用户明确要「名字后面」，且最坏的状态词
`Waiting for you` 约 75px、加上 2 汉字名字和 16px 间距一共 115px，标准桌牌 134px 放得下，所以**一行版成立，保留**。
哪天状态词变长到放不下，翻案顺序是：先改两行，再砍文案，最后才砍点。

### 3.2 尺寸与截断（可直接抄）

| 项 | 值 | 说明 |
|---|---|---|
| 桌牌 | 150×28，`padding:0 8px`，内容宽 **134** | 面板窄时桌牌最窄 120，内容宽 **104** |
| 名字 | 12px / 600 / `line-height:1` | 134px 约容 **11 个汉字 / 20 个半角**；产品上建议名字 ≤6 汉字，别让省略号出现 |
| 圆点 | **6px** 直径，`border-radius:50%`，外加 `0 0 0 1px` 28% 光晕 → 视觉 8px | 原来 5px 方块已改圆 ✅ |
| 点与字 | `gap:5px` | 与 `.wt-row-state` / `.wt-dispatch-state` 同一节奏 |
| 状态词 | **11px / 400 / `line-height:1`**，`label-secondary` | 11px 是这套 UI 的次级正文号，别降到 10.5 |
| 行高 | 单行 12px 落在 28px 里，上下各 8px | 空气感来自桌牌高度，不来自字号 |

### 3.3 状态 → token 映射（含形状语义）

**形状是一条独立于颜色的通道：实心 = 在场且正常，空心 = 未就位 / 离座 / 未完成。**

| status | 文案（zh / en） | `--wt-raw` | 点形状 | 动效 |
|---|---|---|---|---|
| `idle` | 待命 / Idle | `state-idle-primary` | 实心 | 无（人物 breathe） |
| `working` | 干活中 / Working | `state-business-primary` | 实心 | 无（人物 bob 已经够了，点不要跟着动） |
| `provisioning` | 入职中 / Joining | `state-business-primary` | **空心 1.5px** | 无 |
| `waiting` | 等你回复 / Waiting for you | `state-warn-primary` | 实心 | `wt-pulse` 1.6s 呼吸（透明度，不缩放） |
| `done` | 有新结果 / New result | `state-success-primary` | 实心 | 无 |
| `ready` | 已就位 / Ready | success 45% + `label-secondary` | 实心 | 无 |
| `error` | 异常结束 / Ended abnormally | `state-error-primary` | 实心 | 无（人物 shake） |
| `failed` | 入职失败 / Join failed | `state-error-primary` | **空心 1.5px** | 无 |
| `absent`（离座，不是 status） | — | 沿用原 status | **空心 1.5px** | 无 |
| 交接 `out` | 标题里 `小设 → 小前` | `state-business-primary` | 实心 | `wt-dot-ping` 1.2s 一次 |
| 交接 `in`（到达） | 同上 | `state-business-primary` | 实心 | `wt-dot-take`（已有 ✅） |

> `absent` 是 `data-wt-absent`（人物在走路），**不要给它造新 token**；点只换形状不换色，
> 否则会和「正在交接」的蓝色打架。

```css
/* 形状通道 */
.wt-desk[data-wt-status="provisioning"] .wt-desk-dot,
.wt-desk[data-wt-status="failed"] .wt-desk-dot,
.wt-desk[data-wt-absent="true"] .wt-desk-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--wt-state);
}
/* 空位：无 hue 的空心环 */
.wt-desk-empty .wt-desk-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, transparent);
}
/* 呼吸：只动透明度，不动 scale（scale 会和 wt-dot-take 抢 transform） */
.wt-desk[data-wt-status="waiting"] .wt-desk-dot { animation: wt-pulse 1.6s ease-in-out infinite; }
/* 发出交接：一次 ping，不是循环 */
.wt-desk[data-wt-handoff="out"] .wt-desk-dot { animation: wt-dot-ping 1.2s var(--wt-ease-out) 1 both; }
@keyframes wt-dot-ping {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--wt-state) 55%, transparent); }
  100% { box-shadow: 0 0 0 5px transparent; }
}
```
注意顺序：`ping` 必须写在 `pulse` 之后（同一元素两条 `animation` 声明，后者胜），
`wt-dot-take` 写在最后——「接收」比「等待」更该被看见。

> **已被 v5.1 取代**：本节推导的 60/40 单一公式、以及「点 6px + 同色 28% 环」都换掉了。
> 现行配方（8 状态 × 2 主题、8px + 表面色外环）见 `docs/office-ui-v5.1-dots.md`，
> 由 `demos/office/tools/dot-audit.mjs` 守着。本节保留为「为什么当初是 60/40」的存档。

### 3.4 ⚠️ 对比度：70% 混合的 idle 点在白底只有 2.84:1

点色 = `color-mix(raw 70%, label-primary 30%)`（`.wt-desk` 第 574 行）。实算（浅色底 `#fff`）：

| 状态 | 70% 混合 | 对比度 | 60% 混合 | 对比度 |
|---|---|---|---|---|
| idle | `#99999b` | **2.84:1** ✗ | `#858688` | **3.64:1** ✓ |
| business | `#3258a7` | 6.8:1 ✓ | `#2d4e92` | 8.0:1 ✓ |
| warn | `#b0740e` | 3.9:1 ✓ | `#99660f` | 4.9:1 ✓ |
| success | `#1c8f48` | 4.1:1 ✓ | `#1a7d41` | 5.2:1 ✓ |
| error | `#aa1214` | 7.5:1 ✓ | `#941213` | 8.9:1 ✓ |

深色底 `#232324` 上 60% 混合全部 ≥5.3:1（idle 5.37 / business 9.45 / warn 9.70 / success 9.21 / error 7.46），同样成立。
结论：**`.wt-desk` 的混合比从 70/30 改成 60/40**，一行改动，只影响桌牌（`.wt-desk` 自带
`--wt-state`，行/名片的 70% 不动，不要顺手全局改）。

```css
.wt-desk { --wt-state: color-mix(in srgb, var(--wt-raw, var(--dsw-alias-state-idle-primary)) 60%, var(--dsw-alias-label-primary)); }
```

### 3.5 ✅ 语义不靠颜色

现状已经对了，守住三条：
1. 状态词永远在（`.wt-desk-state` 不可 `display:none`，容器查询里也不许藏）。
2. 圆点 `aria-hidden="true"`，状态由 desk 的 `aria-label`（含 `statusText`）承载 ✅。
3. **文字永远不降 opacity。** 降级只发生在图形上（`failed` 的人物 `.55`、空位桌的环）。
   文字要降级就换 token（`label-secondary`），不要叠透明度——`label-caption` 在白底只有
   **2.14:1**，11px 下读不了，永远不要拿它当状态文字。

---

## 4. C · 交接分镜

### 4.1 ✅ 触发白名单（已经是对的，别放开）

- 唯一入口：`handoffs` 的 `out` 标记（任务在 `in_progress` 期间换了负责人）。
- 预留入口：`dialogues`（宿主还没投影员工↔员工消息，`flashDialogue` 无调用点）。
- **禁止 ambient 随机漫步。** 现在 `rg "ambient|Math.random" client.js` 为空 ✅，这条不许回潮：
  一个没有事件的位移，就是在骗人说「有人过去了」。代码里那句注释
  「No timer may stand in for one」请保留。
- 三重合流：两端都在视口内 + 没开 reduced motion + 有真实事件，缺一条就只闪不走路 ✅。

### 4.2 ❌ 时间轴：固定 5.4s 与距离无关

现在 1 排要 2.4s（像慢动作），7 排也是 2.4s（像瞬移）。改成**按排数算**，
`rows = |toIdx - fromIdx|`（用测量出来的 `dy` 反推也行）：

```js
const pick     = 420;                                  // 起立 120 + 取件 300
const walkMs   = Math.min(2400, 160 + rows * 240);     // 1→400 … 7→1840
const backMs   = Math.min(1600, rows * 200);           // 1→200 … 7→1400
const tGive    = pick + walkMs;                        // 到达，纸递出去
const tNod     = tGive + 140;                          // 纸落进桌牌（setReceive）
const tBack    = tNod + 480;                           // 转身
const tEnd     = tBack + backMs + 180;                 // 落座，walker 消失
```

| rows | 走路 ms | give | nod | back | end |
|---|---|---|---|---|---|
| 1 | 400 | 820 | 960 | 1440 | 1820 |
| 2 | 640 | 1060 | 1200 | 1680 | 2260 |
| 3 | 880 | 1300 | 1440 | 1920 | 2700 |
| 4 | 1120 | 1540 | 1680 | 2160 | 3140 |
| 5 | 1360 | 1780 | 1920 | 2400 | 3580 |
| 6 | 1600 | 2020 | 2160 | 2640 | 4020 |
| 7 | 1840 | 2260 | 2400 | 2880 | 4460 |

速度：240ms/排 = 425px/s（一个 44px 高的人走一格），回程 200ms/排 略快——「办完事往回走」的直觉。
**`steps(24, end)` / `steps(18, end)` 换成 `linear`**：7 排时一步跨 30px，44px 的人物看起来像瞬移；
`linear` 是滑行，配下面 2px 的踏步感就够了。

```css
/* 时长由 JS 算好塞进变量；delay 就是「起立 + 取件」那 420ms */
.wt-walker[data-phase="out"]  { animation: wt-walk-out  var(--wt-walk-ms, 400ms) linear var(--wt-pick-ms, 420ms) forwards; }
.wt-walker[data-phase="back"] { animation: wt-walk-back var(--wt-back-ms, 200ms) linear forwards; }
```
`forwards` 保住终点；`arrive/give/nod` 三个相位继续用静态
`transform:translateY(var(--wt-dy))`（现状 ✅），不重启动画。

### 4.3 分镜（七段，每段都有数）

| 段 | 起点 | 时长 | 缓动 | 画面 |
|---|---|---|---|---|
| ① 起立 | 0 | 120ms | `cubic-bezier(.2,.9,.25,1)` | walker 从 `translateY(2px) scale(.96)` 站直 |
| ② 取件 | 120 | 300ms | `cubic-bezier(.34,1.2,.64,1)` | 纸从桌牌里升起来（`translateY(34px)→0`），带 -8° 倾斜 |
| ③ 沿路 | 420 | `walkMs` | `linear` | 人+纸整体 `translateY(0→dy)`；纸随手摆，不再单独动 |
| ④ 到达 | `tGive` | 140ms | `cubic-bezier(.2,.9,.25,1)` | 停在收件人那一排，纸停在手边（已有 `data-phase="give"`） |
| ⑤ 接收 | `tNod` | 480ms | 见下 | 纸脱手落下 + 桌牌闪 + 点脉冲 + 人物侧身接（`wt-plate-take` / `wt-dot-take` / `wt-fig-take` / `wt-gift-drop`，四个都是已有 ✅） |
| ⑥ 回座 | `tBack` | `backMs` | `linear` | `translateY(dy→0)`，纸已经不在手上 |
| ⑦ 落座 | `tEnd-180` | 180ms | `ease-out` | walker 淡出 180ms，同时 giver 的人物淡入（`absent` 在这一刻清掉，交叉淡入） |

新增的两个 micro-moment（现在缺）：

```css
.wt-walker[data-phase="out"] .wt-fig { animation: wt-stand 120ms var(--wt-ease-out) both; }
@keyframes wt-stand { from{transform:translateY(2px) scale(.96)} to{transform:translateY(0) scale(1)} }

.wt-walker[data-phase="out"] .wt-walker-card {
  animation: wt-card-pick 300ms cubic-bezier(.34,1.2,.64,1) 120ms both;
}
@keyframes wt-card-pick {
  from { opacity:0; transform: translateY(34px) rotate(0deg) scale(.82); }
  to   { opacity:1; transform: translateY(0)    rotate(-8deg) scale(1); }
}
```
`translateY(34px)` 让纸的起点落在桌牌里面（walker 底边 = 桌底，纸 `bottom:17px`，34px 正好下到桌牌区），
所以「取件」读起来是从桌上拿的，不是凭空出现的。

**⚠️ `--wt-ease-out` 现在取不到。** 它只声明在 `.wt-dock, .wt-fan, .wt-person, .wt-person-scrim`
（第 345–349 行），`.wt-corridor` 不在里面——在桌牌/走路上写 `var(--wt-ease-out)` 会整条失效
（computed-value 时间变 invalid）。把两条曲线补到 `.wt-corridor`：

```css
.wt-corridor { --wt-ease-out: cubic-bezier(.2,.9,.25,1); --wt-ease-in: cubic-bezier(.5,0,.9,.4); }
```

### 4.4 ✅ 纸的精灵与「落入桌牌」

现有值都对，保留：14×18px、`border-radius:2px`、持件时 `rotate(-8deg)`、两道 1px 横线（`top:5px` / `top:9px`）。
只补两个数：

1. 纸的配色按 §1.2 换（这是「看得见」的前提）。
2. `wt-gift-drop` 的起点加一点横向偏移，让它像从 walker 手上过来，而不是从天花板掉下来。

   **这里我原来写错了一个号**：固定 `-6px` 只在右桌成立（车道在左），左桌的车道在右边，
   固定负值会让纸朝**远离车道**的一侧飘。落地版改成了按边取号，这个改法是对的：

   ```css
   .wt-desk-gift { --wt-gift-dx:-6px; }                     /* 右桌：车道在左，从左侧来 */
   .wt-desk[data-side="left"] .wt-desk-gift { --wt-gift-dx:6px; }  /* 左桌：车道在右 */

   @keyframes wt-gift-drop {
     0%   { opacity:0; transform: translate(var(--wt-gift-dx,-6px),-36px) rotate(-10deg) scale(.9); }
     20%  { opacity:1; }
     70%  { opacity:1; transform: translate(calc(var(--wt-gift-dx,-6px) / 6),-2px) rotate(0) scale(1); }
     100% { opacity:0; transform: translate(0,0) scale(.96); }
   }
   ```
   不用量 walker 和桌牌的横向距离——纸只有 14px 宽，眼睛跟的是桌牌闪，不是落点，
   FLIP 测量换不来对应的观感。`70%` 那一帧的 ±1px 是回弹余量，符号也得跟着边取号：
   落地版用 `--wt-gift-dx-near`（右桌 -1 / 左桌 +1），比用 `calc()` 拆变量更直白。

**锚点也要分侧**：`.wt-desk-gift` 原本固定在 `right:8px`，而桌牌两端里
**只有左桌的右端挨着车道**；右桌的纸会落在桌牌外侧端，离 walker 的手约 60px。
落地版补了镜像：

```css
.wt-desk[data-side="right"] .wt-desk-gift { right:auto; left:8px; }
```
锚点挪到车道侧之后，`--wt-gift-dx` 的符号不用动（右桌 -6px 依旧指向车道）。

**关于 t=0 那次 `in` 闪（刻意保留，不是漏改）**：`data-wt-handoff` 是**事件**（t=0），
`data-wt-receive` 是**到达**（tNod），两个时钟各说各的事。t=0 两端同时闪，
是给远处那个收件座位一个「目的地预告」——否则 7 排外的桌子在走路开始前毫无提示；
到达时再用桌牌上色 + 纸 + 点脉冲给一次更重的确认。如果要严格「到达才闪」，
把 `receive` 提前到 t=0 并给三条接收动画加 `animation-delay:var(--wt-arrive-ms)`，
但我不建议：那样开场就只剩一个发件座位在闪，观众不知道人往哪走。

### 4.5 data-* 契约（一个属性只干一件事）

| 元素 | 属性 | 值 | 生命周期 | 谁写 |
|---|---|---|---|---|
| `.wt-desk` | `data-wt-status` | `idle/working/waiting/done/error/failed/provisioning/ready` | 常驻 | projection |
| `.wt-desk` | `data-wt-absent` | `"true"` | walk 开始 → 落座 | Corridor |
| `.wt-desk` | `data-wt-receive` | `"true"` | `tNod` → `tEnd` | Corridor |
| `.wt-desk` | `data-wt-handoff` | `out` / `in` | 标记寿命（1600/480ms） | flashHandoff |
| `.wt-walker` | `data-phase` | `out` / `give` / `nod` / `back` | walk 期间 | Corridor |
| `.wt-walker` | `data-kind` / `data-wt-walker` | `handoff` / `dialogue` | walk 期间 | Corridor |
| `.wt-walker` | `--wt-dy` / `--wt-walk-ms` / `--wt-back-ms` / `--wt-pick-ms` | px / ms | walk 期间（inline style） | Corridor |
| `.wt-walker-card` | — | 仅 `kind === 'handoff'` 时挂载 | walk 期间 | Corridor |
| `.wt-desk-gift` | — | 仅 `receive === i` 时挂载 | `tNod` → `tEnd` | Corridor |

约定：**`data-wt-*` 只描述「现在正在发生什么」，不描述「谁是谁」**；人和座位的身份走 `data-wt-member` / `data-wt-empty`。

### 4.6 ✅ prefers-reduced-motion（现有降级是对的，补两条）

已经对的部分：walker 与 gift 都 `display:none`，receive 三个 one-shot 全关，
`wt-flash` 保留（纯透明度，不移动，是降级后的唯一反馈）。补：

```css
@media (prefers-reduced-motion: reduce) {
  .wt-desk[data-wt-status="waiting"] .wt-desk-dot,
  .wt-desk[data-wt-handoff="out"] .wt-desk-dot { animation: none !important; }
}
```
理由：`wt-pulse` / `wt-dot-ping` 是透明度与阴影的循环，属于「持续闪烁」，不是一次性反馈，
对前庭敏感和注意力障碍都不友好。一次性 `wt-flash` 留，循环全关。

### 4.7 抢占与边界

- 一次只有一个 walker：新事件 `clearTimers()` + 覆盖，旧的那趟直接消失（现状 ✅）。
- 两端必须都在视口内，否则只闪不走（现状 ✅）。
- 走路途中用户滚动：`top/dy` 是起点测量的，滚动后不会重新对齐——可接受（一趟 ≤4.5s），
  **但不要加滚动监听去追**，那会让每一帧都在算布局。
- 一次交接最长 4460ms，期间再来一次改派会打断。这是对的：真事件优先于把上一趟演完。

---

## 5. 落地顺序（已执行）

当时的优先级，留档用（前三条是功能，后三条是观感）：

1. §1.1 键空间 + 方向（不修，后面所有动画都是死代码）。
2. §1.2 纸的配色（不修，交接「看见了」这件事不成立）。
3. §1.3 状态文字省略号。
4. §2.3 道路三层灰度 + §3.4 点的 60/40。
5. §3.3 形状通道 + waiting 呼吸 + out ping。
6. §4.2 时间轴表 + §4.3 起立/取件 + `--wt-ease-out` 补声明。

验收断言统一收在 **§6.3**，不在这里重复。

---

## 6. 实现记录（07:18 落地，核对快照 5230 行）

逐条对账。行号是 07:18 的 `client.js`，会漂，按选择器找。

| 契约条目 | 状态 | 证据（07:18） |
|---|---|---|
| §1.1 键空间 + 方向 | ✅ | `flashHandoff` 加 `peer`（867–868）；事件 `{from: name, to: mark.peer}`（2764）；`indexOf` 键改 `item.member.name / item.role.id`（2779） |
| §1.1-D `taskFor` 键 | ✅ | 内置座位改 `taskFor(role.id)` |
| §1.2 纸的配色 | ✅ | 5% 填充 + 36% 描边 + 22% 投影（637、676）；横线 16%（641、677） |
| §1.3 状态词兜底 | ✅ | `flex:0 1 auto; min-width:0; max-width:70%; ellipsis`（610） |
| §2.3 道路灰度 | ✅ | 18 / 32 / 26 / 24，surface 5%（568） |
| §2.6 corridor 不再滚动 | ✅ | `overflow` 删除并留注释（565–568）；可见性改 `scrollParent()` ∩ window（2672–2680、2797–2807） |
| §3.3 形状通道 | ✅ | provisioning / failed / absent 空心 + 空位灰环（617–620） |
| §3.3 waiting 呼吸 + out ping | ✅ | 622–626，源序 pulse → ping → take 正确 |
| §3.4 点 60/40 | ✅ | `.wt-desk` 的 `--wt-state`（575） |
| §4.2 时间轴 | ✅ | 1 排 1820ms … 7 排 4460ms，与表逐行相同（2819–2826） |
| §4.3 起立 / 取件 / linear | ✅ | `wt-stand` 120ms、`wt-card-pick` 300ms@120ms、`linear`（667、681–692） |
| §4.4 gift 漂移按边取号 | ✅（修正了我的错） | `--wt-gift-dx` 右桌 -6 / 左桌 +6（637–640、648） |
| §4.6 循环关闭 | ✅ | waiting / out ping 在 reduced motion 下 `animation:none`（807–810） |
| 禁止 ambient | ✅ | 全文件无 `ambient` / `Math.random` |

### 6.1 三处 P2：已收（07:2x）

| # | 问题 | 落地 |
|---|---|---|
| 1 | 纸固定落在桌牌右端，右桌因此落在远离手的一侧 | ✅ `.wt-desk[data-side="right"] .wt-desk-gift { right:auto; left:8px; }` |
| 2 | `70%` 帧固定 `-1px`，左桌 2px 逆差 | ✅ 改走 `--wt-gift-dx-near`（右桌 -1 / 左桌 +1） |
| 3 | `wt-dot-ping` 的 `both` 让发件座位空心点在 400ms 里消失 | ✅ 去掉 `both`（`wt-flash` 的 `both` 保留）；已加测试 pin：ping 规则出现 `both` 就红 |

第 3 条值得留一句记录，因为它是「声明层叠」而不是「动效」的问题：
标记活 1600ms、ping 只跑 1200ms，而这 400ms 里发件人正 `data-wt-absent`（空心点）。
`animation-fill-mode: both` 会把末帧（透明 5px 环）一直压在元素上，
`box-shadow` 是单一属性，inset 环被整条替换 → 点只剩 `background:transparent`，等于消失。
**规则：一次性的「扩散」动画不要留 fill；靠末帧收尾的（`wt-flash` 的 `opacity:0`）才留。**

### 6.1.1 文档分工

- 本文 = **视觉契约**：为什么是这些数（对比度、几何、时间表、取舍）。
- `docs/office-ui-v5.md`（小前）= **实现与降级**：机制、store、测试 pin。
- 两边有冲突时：**数值以本文为准，机制以那篇为准**（那篇开头也这么写的）。

### 6.2 两处我判「保留」而不是「修」

- **t=0 的 `in` 闪**：事件时钟与到达时钟分离，t=0 两端同闪 = 目的地预告，到达再给重确认。
  理由写在 §4.4 末尾。
- **支路压到车道中心**：八条支路在中线形成八个路口，是「街道」而不是「条纹」。§2.4。

### 6.3 验收断言（贴控制台）

```js
// 路连续
const road = document.querySelector('.wt-road'), track = document.querySelector('.wt-road-track');
Math.abs(road.getBoundingClientRect().height - track.getBoundingClientRect().height) < 0.5;

// 点：圆的、每座都有
[...document.querySelectorAll('.wt-desk')].every(d => {
  const dot = d.querySelector('.wt-desk-dot');
  return dot && getComputedStyle(dot).borderRadius === '50%';
});

// 状态词永远在
[...document.querySelectorAll('.wt-desk')].every(d => d.querySelector('.wt-desk-state')?.textContent.trim() !== '');

// 静止无 walker（ambient 死了）
document.querySelector('.wt-walker') === null;

// 一次真实改派后：data-phase 依次 out → give → nod → back，总时长对 §4.2 的表
// （rows=1 应约 1820ms，rows=7 约 4460ms；±150ms 是 React 批处理余量）

// reduced motion：walker 永不 mount，但 [data-wt-handoff] 的闪仍在
```
