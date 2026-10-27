# 工位条 V4 · 头像堆「往两边展开」+ 员工名片 — 设计规格

> 只出规格，未改 `client.js`。承 V3（`docs/office-dock-v3.md`），只动「展开层」和「名片」两件新东西。
> 每条判断后面带核实来源：`client.js:行号`，或宿主包实测（`@deepseek-ai/dsh-client-ui-theme` / `dsh-client-ui-conversation`）。
> 色值全部走 `--dsw-alias-*`，**零 hex、零 rgb()**；尺寸全部给到 px，没有「适当」「略」。
> 两条新曲线、三档视口、五个状态机时刻，就是这份文档的全部内容。

---

## 0. 一句话主张

**盒子不伸缩，人展开。**

点开头像堆时，32px 的轨道**一个像素都不变**（不加宽、不增高、不推挤输入框）；一块 70px 高的浮层在它上方淡入并上浮 4px，8 个 32px 头像**从 facepile 中心同时向两侧飞出去**，按离中心的距离错峰 14ms。再点头像，弹「员工名片」。

```
collapsed（现状，32px，不动）
┌──────────────────────────────────────────────────────────┐
│  ⬤⬤⬤⬤⬤ +3          干活中 2 · 等你回复 1              › │
└──────────────────────────────────────────────────────────┘

expanded（浮层，70px，centered on facepile，z 1100）
              ┌───────────────────────────────────────┐
              │  ⬤   ⬤   ⬤   ⬤   ⬤   ⬤   ⬤   ⬤   │  32px 头像
              │ 小前 老后 小审 小设 阿策 小研 小运 小文 │  11px 名字
              └───────────────────────────────────────┘
                        ↑ 6px 间隙，中心对齐 facepile 中心
┌──────────────────────────────────────────────────────────┐
│  ⬤⬤⬤⬤⬤ +3      （chips .2 / 摘要 .35，仍在原位）      › │
└──────────────────────────────────────────────────────────┘

card（名片，360×~290，z 1300/1301，遮罩 bg-mask-1）
        ┌─────────────────────────────────┐
        │ ⬤48  小前                   ×  │
        │       前端工程师                │
        │  ● 干活中                       │
        │                                 │
        │ 当前任务                        │
        │ 工位条 V4 展开层与名片规格      │
        │ ─────────────────────────────── │
        │ 模型   deepseek / v3.2 / high   │
        │ 用量   12.4k tokens             │
        │ ─────────────────────────────── │
        │ [ 打开会话 ]  [ 派活 ]  [ 暂停 ]│
        └─────────────────────────────────┘
```

---

## 1. 形态裁定：浮层，不是「整条 dock 变宽」

**结论：从 facepile 中心向两侧展开成浮层（选项 b）。**

三条否决 (a)「dock 变宽」的理由，全部有数：

| # | 问题 | 数字 | 后果 |
|---|---|---|---|
| 1 | 8 人横排需要 400px（§2.2 档 L） | 轨道在 S 档只有 **319px** 宽（border-box），内容盒 291 | 变宽就必须改掉 `.wt-dock` 的 `width:min(calc(100% - 32px), var(--dsh-composer-card-max-width))`，而这条公式是 V3 §5.4 的对齐契约：任何列宽下「轨道内容左沿 ≡ 输入框正文左沿」，实测 Δ = 0。改宽度 = 放弃这条契约 |
| 2 | `width` 是布局属性 | 8 个座位 + chips + 摘要同排 | 动画期间每帧 reflow，60fps 下 8 个 20px 头像和 3 段文字逐帧重排；这不是「快、轻」，是抖 |
| 3 | 浮层高 70px，轨道高 32px | 32 < 70 | 就算横向加宽，纵向还是得溢出轨道 —— 它本来就是浮层，加宽只是多付一次布局代价 |

**为什么中心对齐 facepile，不是对齐 dock 中心**：触发物和展开物必须在同一条竖线上（点击的位置 = 长出来的位置）。有 chip 时 dock 中心比 facepile 中心右移约 200px，对齐 dock 中心会让浮层从「不是你点的那个地方」长出来。

**为什么没有小尖角（caret）**：`--dsw-elevation-prominent` + 6px 间隙已经足够建立归属（宿主菜单全部不用尖角，见 `dsh-client-ui-input-trigger` 的 `_3e4sSG_menu`：`bottom:calc(100% + 4px)`、`box-shadow:var(--dsw-elevation-prominent)`）。尖角在夹紧（§2.2 末）时会偏离锚点，反而撒谎。

**为什么不用 clip-path 做横向擦除**：浮层的阴影 `--dsw-elevation-prominent` 画在 border-box 之外，`clip-path` 会把它整条裁掉，浮层会变成一张没有厚度的纸片。展开感由「人从中心飞出去」承担，不由盒子承担。

---

## 2. 三态几何

### 2.1 collapsed（现状，不改一行）

| 项 | 值 | 依据 |
|---|---|---|
| 轨道高 | 32px | `client.js:253` |
| 轨道宽 | `min(calc(100% - 32px), var(--dsh-composer-card-max-width))` | 同上 |
| 轨道内距 | `0 14px` | 同上 |
| facepile 头像 | 20px，重叠 −6px（步进 14px），5 枚 = 76px | `client.js:306-307` |
| `+N` | 高 20px，`margin-left:2px`，字号 10.5px | `client.js:319` |
| 容器查询断点 | 643 / 451 / 291（内容盒） | `client.js:362-365` |

展开态对以上**零改动**：`getBoundingClientRect().height` 仍是 32，`width` 不变，输入框不位移。

### 2.2 expanded（fan）

浮层是 `position:fixed` + portal 到 `document.body`（§8.1 给理由），尺寸由**视口**决定，不由容器的 643/451/291 决定 —— 理由见 §2.2.1。

三档（`--wt-fan-*` 变量集，一条公式算宽）：

| 档 | 视口 | 头像 | 列宽 col | gap | 名字 | 内距 x / y | 高 | 8 人总宽 | 可用宽（100vw−32） |
|---|---|---|---|---|---|---|---|---|---|
| **L** | ≥ 481px | 32px | 40px | 8px | 11 / 14 | 12 / 10 | **70px** | **400px** | ≥ 449px ✅ |
| **M** | 361–480px | 30px | 32px | 6px | 10.5 / 13 | 10 / 10 | **67px** | **318px** | ≥ 329px ✅ |
| **S** | ≤ 360px | 28px | 30px | 4px | 无 | 8 / 10 | **48px** | **284px** | ≥ 288px ✅ |

宽度公式（三档共用一条）：

```
--wt-fan-w = n × col + (n − 1) × gap + 2 × pad-x
L: 8×40 + 7×8 + 24 = 400      M: 8×32 + 7×6 + 20 = 318      S: 8×30 + 7×4 + 16 = 284
```

高：`pad-y × 2 + 头像 + 4（名字间距）+ 名字行高` → L 70 / M 67；S 无名字 → 48。

| 项 | 值 |
|---|---|
| 圆角 | `var(--dsw-radius-md)` = 12px |
| 底色 | `var(--dsw-alias-bg-layer-3)` |
| 阴影 | `var(--dsw-elevation-prominent)`，并把 `--dsw-elevation-stroke-color` 覆成 `var(--dsw-alias-border-l2)` |
| `transform-origin` | `50% 100%`（贴着轨道那条边生长） |
| 距轨道上沿 | **6px**（`bottom = window.innerHeight − dockRect.top + 6`） |
| 水平定位 | `left: clamp(w/2 + 16, facepile 中心 x, 100vw − w/2 − 16)` + `translate:-50% 0` |
| 状态环 | `inset:-2px`、`1.5px`（同 `.wt-row` 的 `client.js:284`）；S 档关闭（28+7=35 > 步进 34，会压到邻座） |
| 状态点 | 6px，`right:-1px; bottom:-1px`，`box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-3)`（切在浮层底色上，不是页面底色） |
| 「等你回复」气泡 | 复用 `.wt-bubble`（20px 头像上是 15px；fan 里不放大，见 §7） |

**宽度永远够，夹紧只可能来自锚点贴边**：

| 档 | 该档最窄视口 | 可用宽 | fan 宽 | 余量 |
|---|---|---|---|---|
| L | 481 | 449 | 400 | 49 |
| M | 361 | 329 | 318 | 11 |
| S | 320 | 288 | 284 | 4 |

左右安全边距取 **16px**（与名片 `calc(100vw − 32px)` 同值），所以上表第三列是 `100vw − 32`。

**夹紧只可能因为「锚点贴边」，不可能因为「太宽」** —— 上表每一档的余量都 ≥ 4px，fan 在任何 ≥ 320px 的视口里都放得下。但锚点（facepile 中心）本身可能太靠边：320px 视口下 dock 左沿 16、正文左沿 30、5 枚头像 = 76 → 锚点 ≈ **68**，而 284px 的 fan 想居中就需要 158 —— 夹紧生效，fan 贴到左边 16px。

夹紧时展开中心就不再等于 facepile 中心（320 视口下差 **90px**：158 − 68）。**接受这个偏差**：此时 fan 贴左 16px，与输入框共用同一条左沿（dock 的左沿也是 16），它和触发器的关系靠「同一竖线」+ 6px 间隙 + dock 的按压底色维持，而不是靠水平对中。要去掉这个偏差，就得把 `clamp` 的结果再喂回 JS 逐席算 `--wt-dx` —— 同一套夹紧算术写两遍，是更糟的取舍。

#### 2.2.1 为什么 fan 用视口断点，不用容器的 643/451/291

1. fan 是 `position:fixed` + portal，它的包含块是视口，不是 `.wt-dock`。用容器查询量它，等于用「它不在里面」的那个盒子给它定尺寸。
2. 容器宽和视口宽**不是函数关系**：右侧边栏拉宽时，视口不变而会话列变窄 —— 同一个 1280px 视口，dock 内容盒可能落在 L 档，也可能落在 S 档。而 fan 能不能放下只取决于视口。
3. 所以分工是干净的：**在流内的东西（dock / chips / 摘要）继续用 `@container` 643/451/291，视口级浮层（fan / 名片）用 `@media` 480/360**。两套尺子各管各的，不互相翻译。

> 反过来说：如果哪天要把 fan 改成绝对定位塞回 dock，这三档必须整体换成容器查询 —— 但那会重新撞上 §1 的第 1 条。

### 2.3 card（员工名片）

同一份内容，两种形态，**只有一条断点**（360px）：

| 形态 | 视口 | 宽度 | 圆角 | 位置 | 最大高 |
|---|---|---|---|---|---|
| 居中对话框 | ≥ 361px | `min(360px, calc(100vw − 32px))` | `var(--dsw-radius-lg)` = 16px | `left:50%; top:50%; translate:-50% -50%` | `calc(100vh − 48px)` |
| 底部 sheet | ≤ 360px | `100%` | `16px 16px 0 0` | `left:0; right:0; bottom:0; top:auto` | `calc(100vh − 24px)` |

| 项 | 值 |
|---|---|
| 内距 | 16px（sheet 下沿 `max(16px, env(safe-area-inset-bottom))`） |
| 底色 | `var(--dsw-alias-bg-layer-3)` |
| 阴影 | `var(--dsw-elevation-prominent)`，`--dsw-elevation-stroke-color: var(--dsw-alias-border-l2)` |
| `transform-origin` | 对话框 `50% 50%`；sheet `50% 100%` |
| 遮罩 | `background: var(--dsw-alias-bg-mask-1)`（亮 `#0000003d` 24% / 暗 `#00000080` 50%）+ `backdrop-filter: var(--dsw-mask-blur)`（当前值 `none`） |
| z-index | 遮罩 **1300**，卡片 **1301**；fan **1100** |

**为什么模糊值用 `var(--dsw-mask-blur)` 而不是自己写 `blur(3px)`**：`--dsw-mask-blur` 就是宿主给「遮罩模糊」留的旋钮（实测默认 `none`，换肤时会被改）。自己写一个 px 值等于在主题之外造第二个真相，换肤时会打架。遮罩的层次由 `bg-mask-1` 的 24%/50% 黑承担，已经够压住底下的对话。

**为什么名片 z-index 是 1300，不是 1100**：宿主最高层是 1100（`JYBKaa_portal`、`_7KE1Ra_menu` 实测），但 `dsh-experimental-session-inspector` 已经占了 **1200 / 1250**（取色掩膜）。名片要盖住所有宿主浮层，又要避开别人的号段 → 1300/1301。

**为什么窄屏变 sheet（≤360px）**：不是宽度不够（284px 的 fan 都放得下），是**高度和拇指区**。320px 宽时居中对齐的卡片只有 288px 宽，6 行内容 + 3 个按钮会挤成一个纵向滚动的方块，且正中间那一块是单手最难够到的地方。sheet 给满宽、贴底、留 safe-area。

**在 643 / 451 / 291 三个容器档下的实际长相**（这三档对应的大致视口，按 `dock 宽 = min(列宽 − 32, 卡宽)` 反推）：

| dock 内容盒 | 反推视口 | 名片形态 | 卡片宽 |
|---|---|---|---|
| 643 | ≈ 704px | 居中对话框 | 360px |
| 451 | ≈ 512px | 居中对话框 | 360px |
| 291 | ≈ 352px | **底部 sheet** | 满宽 |

> 注意：右栏展开时同一视口可能落在更窄的 dock 档，名片**不跟着变**（它量的是视口）。这是刻意的 —— 名片是视口级浮层，跟着列宽变会让「同一个按钮在同一个屏幕上忽大忽小」。

---

## 3. 动效表

### 3.1 两条曲线，只有两条

```css
--wt-ease-out: cubic-bezier(.2,.9,.25,1);   /* 进：起步快、收尾长 —— 东西「落」下来 */
--wt-ease-in:  cubic-bezier(.5,0,.9,.4);    /* 出：起步慢、收尾快 —— 东西「抽」走 */
```

**这两个变量必须定义在 portal 根节点上**（`.wt-fan` / `.wt-person` / `.wt-person-scrim`），不能只定义在 `.wt-dock`：portal 出去的节点不是 `.wt-dock` 的后代，自定义属性不跨 portal 继承。

曲线值取的是 easeOutQuint / easeInQuad 的近似：`.2,.9` 在 20% 处已经走完 90% 的位移，视觉上是「瞬间到位 + 一段很短的收尾」，没有回弹（三阶贝塞尔只要 y 控制点 ≤ 1 就不会过冲）。

### 3.2 T1 · dock → fan（展开）

| # | 元素 | 属性 | from → to | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|---|---|
| 1 | `.wt-fan` | `opacity` | 0 → 1 | 120ms | out | 0 |
| 2 | `.wt-fan` | `transform: translateY` | 4px → 0 | 200ms | out | 0 |
| 3 | `.wt-fan-seat` | `opacity` | 0 → 1 | 110ms | out | `k × 14ms` |
| 4 | `.wt-fan-seat` | `transform` | `translateX(−dx) scale(.86)` → `translateX(0) scale(1)` | 170ms | out | `k × 14ms` |
| 5 | `.wt-dock` | `background-color` | transparent → `bg-layer-1` | 120ms | linear | 0 |
| 6 | `.wt-chips` | `opacity` | 1 → .2 | 120ms | out | 0 |
| 7 | `.wt-dock-sum` | `opacity` | 1 → .35 | 120ms | out | 0 |
| 8 | `.wt-more` | `opacity` | 1 → .2 | 120ms | out | 0 |

其中（`--wt-i` 座位序号、`--wt-c = (n−1)/2`、`--wt-k = |i − c|`，全部由 JS 写成字符串塞进 inline style）：

```
--wt-dx = (i − c) × (col + gap)        L 档 8 人：±168 / ±120 / ±72 / ±24px
--wt-k  = |i − c|                      L 档 8 人：3.5 / 2.5 / 1.5 / 0.5
延迟                                    L 档 8 人：49 / 35 / 21 / 7ms
```

**总时长 = 49 + 170 = 219ms**（n=8 最坏情况；n=2 时 7 + 170 = 177ms）。落在 180–240ms 区间内。

**为什么盒子不缩放、只上浮 4px**：盒子的 `box-shadow` 会跟着 `scale()` 一起缩，浮层会看起来「先小一号再长大」，那是廉价弹窗的手感。位移交给 8 个人，盒子只负责「出现」。

**为什么按距离错峰，不按序号**：按序号错峰会让左边先飞、右边后飞（单向波浪），读起来是「从左往右扫过」；按距离错峰两边对称，读起来才是**往两边展开**。

**为什么 `--wt-k` 可以是 0.5**：偶数人数时中心落在两人之间，`c` 是半整数。0.5 × 14 = 7ms，不是问题。

### 3.3 T2 · fan → dock（收起，更快）

| # | 元素 | 属性 | from → to | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|---|---|
| 9 | `.wt-fan` | `opacity` | 1 → 0 | 90ms | in | 0 |
| 10 | `.wt-fan` | `transform: translateY` | 0 → 4px | 120ms | in | 0 |
| 11 | `.wt-fan-seat` | `opacity` | 1 → 0 | 70ms | in | 0 |
| 12 | `.wt-fan-seat` | `transform` | `translateX(0) scale(1)` → `translateX(dx × −.35) scale(.94)` | 90ms | in | 0 |
| 13 | `.wt-dock` | `background-color` | `bg-layer-1` → transparent | 120ms | linear | 0 |
| 14 | chips / 摘要 / `+N` | `opacity` | .2/.35 → 1 | 120ms | out | 60ms |

**收起 120ms vs 展开 219ms，比例 1 : 1.8。** 收起不排队（没有 stagger）：退场排队会读成「犹豫」。座位只回撤 35%（不是 100%）—— 全撤回中心会变成「重播展开」，35% 只是给一个方向暗示。

**卸载时机**：`opacity` 结束后 **10ms** 才卸载（`FAN_EXIT_MS = 130`）。React 卸载会直接杀掉过渡，节点必须在 `data-state="closing"` 里活满 130ms。

### 3.4 T3 / T4 · fan → card（名片）

| # | 元素 | 属性 | from → to | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|---|---|
| 15 | `.wt-person-scrim` | `opacity` | 0 → 1 | 140ms | out | 0 |
| 16 | `.wt-person` | `opacity` | 0 → 1 | 120ms | out | 0 |
| 17 | `.wt-person` | `transform` | `scale(.96) translateY(4px)` → `scale(1) translateY(0)` | 180ms | out | 0 |
| 18 | `.wt-person` | `opacity` | 1 → 0 | 90ms | in | 0 |
| 19 | `.wt-person` | `transform` | `scale(1)` → `scale(.98)` | 100ms | in | 0 |
| 20 | `.wt-person-scrim` | `opacity` | 1 → 0 | 120ms | in | 0 |

展开名片时 **fan 不动**：它是「你从哪张脸点进来的」的证据。名片关掉后焦点回到那一席（§5.4）。
`CARD_EXIT_MS = 130`（对话框）/ `SHEET_EXIT_MS = 170`（sheet，因为 160ms 位移 + 10ms）。

### 3.5 T5 · sheet（≤360px）

| 元素 | 属性 | from → to | 时长 | 曲线 |
|---|---|---|---|---|
| `.wt-person` | `transform: translateY` | 100% → 0 | 220ms | out |
| `.wt-person` | `opacity` | 0 → 1 | 120ms | out |
| `.wt-person` | `transform: translateY` | 0 → 100% | 160ms | in |

220ms 仍在区间内；位移 300px 用 220ms 与 fan 的 219ms 同速，两个面不会打架。

### 3.6 `will-change` 与合成

```css
.wt-fan[data-state="opening"], .wt-fan[data-state="closing"],
.wt-person[data-state="opening"], .wt-person[data-state="closing"] { will-change:transform, opacity; }
```

只在过渡期挂，**不许常驻**：8 个座位 + 浮层 + 卡片常驻 `will-change` 会造出 10 个合成层，滚动对话时白吃显存。收起后由 `data-state` 自然摘掉。

---

## 4. 员工名片内容规格

内容宽度 = 卡片宽 − 32（内距 16×2）：L 档 360 → **328**；sheet 320 视口 → **288**。

| # | 层 | 元素 | 字号 / 行高 | 颜色 | 尺寸 / 间距 |
|---|---|---|---|---|---|
| 1 | 头 | `.wt-person-av` | — | — | `RoleAvatar size={48}`，状态环 `inset:-3px` / `2px`（默认几何） |
| 2 | 头 | `.wt-person-name` | 16 / 22 / 600 | `label-primary` | 单行省略 |
| 3 | 头 | `.wt-person-role` | 12 / 16 | `label-secondary` | 距名字 **2px** |
| 4 | 头 | `.wt-person-x` | 13 / 1 | `label-tertiary` | **24×24**，圆角 6，hover `bg-layer-2` + `label-primary` |
| 5 | 头 | 头像 ↔ 文字 | — | — | **12px** |
| 6 | 状态 | `.wt-person-pill` | 11 / 1 / 600 | `--wt-state` | 高 **22**，`padding:0 8px`，圆角 999，距头 **10px** |
| 7 | 状态 | `.wt-person-pill` 底 / 边 | — | `color-mix(--wt-state 14%, transparent)` / `color-mix(--wt-state 40%, transparent)` | 0.5px 边框 |
| 8 | 状态 | 胶囊内点 | — | `--wt-state` | **6px**，gap 5 |
| 9 | 任务 | `.wt-person-key` | 11 / 16 | `label-tertiary` | 距胶囊 **14px** |
| 10 | 任务 | `.wt-person-task` | 12 / 18 | `label-primary` | 距 key **4px**，**最多 2 行**（`-webkit-line-clamp:2`） |
| 11 | 分隔 | `.wt-person-rule` | — | `border-l1` | 高 **0.5px**，上下 **14px** |
| 12 | 事实 | `.wt-person-facts` | 12 / 18 | — | `grid-template-columns:56px minmax(0,1fr)`，行 gap **6**，列 gap **8** |
| 13 | 事实 | key（模型 / 用量） | 11 / 18 | `label-tertiary` | 固定 56px |
| 14 | 事实 | value | 12 / 18 | `label-primary` | `tabular-nums`，单行省略 |
| 15 | 动作 | `.wt-person-acts` | — | — | 距分隔 **16px**，gap **8px** |
| 16 | 动作 | `.wt-person-act` | 11 / 1 / 600 | — | 高 **28**，`padding:0 12px`，圆角 **7**，0.5px 边框 |

### 4.1 三个动作

| 动作 | 类 | 外观 | 可用条件 | 点击 |
|---|---|---|---|---|
| **打开会话** | `data-kind="primary"` | 底 `button-info-fill`，字 `label-primary-inverted`，`flex:1 1 auto`，无边框 | `phase !== 'failed'` | `props.openMember(sessionId, id)` |
| **派活** | 默认 | 底 `bg-layer-2`，边 `border-l2`，字 `label-primary` | `phase !== 'failed'` | 关名片 → `expand(id)` 进派单态（复用 `client.js:1765` 的 `DockSeat`） |
| **暂停** | `data-kind="stop"` | 底透明，边 `border-l1`，字 `state-error-primary` | **`status === 'working' \|\| status === 'waiting'`** | `props.stopMember(id)`（同 `client.js:2798`） |

**暂停为什么也允许 `waiting`（与老板原话「只在干活中」有一处差异）**：`stoppable` 在办公室列表里就是 `working || waiting`（`client.js:1671`），而 `waiting` = 有一个回合卡在等你回复 —— 那正是最该能停下的时刻。只放 `working` 会让名片和列表两套真相，同一个员工在列表里能停、在名片里不能停。**若老板坚持只放 `working`，改 `client.js:1671` 与名片同一处判断即可，其余规格不变。**

禁用态：`opacity:.45`、`cursor:default`、边框回到 `border-l1`、字 `label-tertiary`、`disabled` 属性。

### 4.2 `failed` 成员的名片

`failed` 没有会话（`phase === 'failed'` 时 `openMember` 必失败），所以**不摆三个灰按钮**：动作行整行换成一行提示

```
入职失败，这个座位还没有会话        （11 / 16，state-error-primary，距分隔 14px）
```

「派活」「暂停」直接不渲染。理由：三个禁用按钮不解释原因，等于把「为什么不能点」丢给用户猜。

### 4.3 事实行的数据来源（真实，不编）

| 行 | 取值 | 依据 |
|---|---|---|
| 模型 | `modelValue(sel.next).split('::').join(' / ')` → `deepseek / v3.2 / high` | `client.js:2369` 已有 `modelValue`；`sel` 来自 `projectionOf(state, member.id, 'modelSelection')` |
| 用量 | `formatTokens(sumTokens(projectionOf(state, member.id, 'tokenUsage')))` → `12.4k` | `client.js:596` / `:606` / `:2721`（团队合计已在用同一对函数） |

**模型来源需要小前实测一次，不要假设**：现有轮询（`client.js:1098`）拿到的 `payload.values` 是整包投影值，代码只读了 `subagentTiming`。先打一行 `console.log(Object.keys(payload.values))` 确认里面有 `modelSelection`：
- 有 → 顺手存进 `memberRuntime`（`runtime.set` 里加一个 `model` 字段），名片读它；
- 没有 → 模型行显示 `t('settings.followMain')`（「跟随主对话」），**不要编一个模型名**；
- 两者都拿不到 → 整行不渲染（不要留一个空值）。

用量没有这个问题：`tokenUsage` 已经被 `client.js:2721` 证明可读。

---

## 5. 交互

### 5.1 点击语义（这里有一处行为变更，必须说清）

| 位置 | 现在 | V4 |
|---|---|---|
| facepile 任一头像 | 打开该员工会话 | **展开 fan**（不打开会话） |
| fan 任一席位 | — | **打开该员工的员工名片** |
| 名片「打开会话」 | — | 打开该员工会话 |
| `+N` | 打开办公室 tab | 不变 |
| 摘要 / `›` | 打开办公室 tab | 不变 |
| chip | 打开该员工会话 | 不变（chips 不参与展开） |

**代价**：从轨道打开会话从 1 次点击变成 2 次（展开 → 名片 → 打开会话 = 实际 2 次）。这是老板原话的直接后果（「展开后再点击头像就弹出 modal」），接受它，并给两个补偿：
1. 名片的「打开会话」是**最大、最亮、`flex:1`** 的那个按钮，第二次点击不用瞄准；
2. 右侧办公室 tab 的行列表仍然是 1 次点击开会话（`client.js:1689` 的 `.wt-row-hit`）。

**点开 fan 时带着目标进去**：从哪一席点开的，fan 里那一席就拿到焦点（`focus()`），键盘用户不用再找。若用键盘在 facepile 上按 Enter（没有具体目标），焦点落在第 1 席。

**一次只开一个临时面**：打开 fan 会收起派单态（`setExpandedId(null)`），反之亦然。两个浮层叠着没有任何场景需要。

### 5.2 外部点击

现有监听器（`client.js:3044` 附近，`document` 捕获阶段 `pointerdown`）加两行判断：

```js
if (event.target.closest('[data-wt-fan], [data-wt-person], [data-wt-person-scrim]')) return;
```

不加这一条，点 fan 里的座位会先被捕获阶段关掉 fan，然后 React 的 `onClick` 才发现自己被卸载了 —— 名片永远弹不出来。

点遮罩 = 关名片（只关名片，fan 留着）。

### 5.3 Esc 阶梯

Esc 一层一层退，一次只关一个面：

```
名片打开 → Esc 关名片（焦点回 fan 里那一席）
fan 打开  → Esc 关 fan（焦点回 facepile 首枚）
都关着    → Esc 不处理，交给平台（不 preventDefault）
```

键盘监听挂在 `document` 的 `keydown`（捕获），只在有面打开时挂；`event.preventDefault()` 只在真正关掉了某一层时才调用。

### 5.4 焦点

| 时刻 | 焦点去哪 | 实现 |
|---|---|---|
| fan 打开 | 目标席 `.wt-fan-seat`（键盘打开则第 1 席） | 打开后 `requestAnimationFrame` 里 `focus()`（等 `data-state="open"` 落上，否则 `:focus-visible` 环会被过渡吃掉） |
| fan 里方向键 | 上一席 / 下一席 / 首 / 尾 | `ArrowLeft` / `ArrowRight` / `Home` / `End` |
| fan 关闭 | `.wt-facepile` 首枚 `.wt-seat-hit` | 见 §5.5 |
| 名片打开 | 卡片容器（`tabIndex="-1"`） | 读屏先念「对话框，小前 的名片」 |
| 名片内 Tab | 关闭 → 打开会话 → 派活 → 暂停 → 回关闭（4 站循环） | 焦点陷阱只在这 4 个节点间循环 |
| 名片关闭 | 打开它的那一席（fan 若已关则回 facepile） | 记 `lastSeat` |

**焦点陷阱的可聚焦节点不是恒定的 4 个**：`failed` 成员的名片只有一个关闭按钮（§4.2），暂停在非 `working`/`waiting` 时是 `disabled`（不进 Tab 序）。陷阱必须按「当前实际可聚焦的节点」建圈，不要写死 4。只剩 1 个节点时，Tab 停在它上面不动（不要循环到卡片容器上）。

**fan 的 Tab 序**：展开态下 8 席**全部 `tabIndex=0`**。理由：fan 是用户主动打开、最多 8 席、随时可 Esc 关掉的临时面，8 个站可以接受；换成 roving tabindex 要多一个状态机，而收益只是少按 7 次 Tab。收起态则相反 —— facepile **只有第 1 枚 `tabIndex=0`**，其余 `-1`（V3 的取舍保留：不能让 8 个座位把输入框推远）。

### 5.5 收起后的回焦

V3 已有的 `lastSeat` 回焦（`client.js:3052`）现在只覆盖派单态。V4 把「回焦目标」统一成一条规则：

```
fan 关闭 → 若首枚 .wt-seat-hit 存在且可见 → focus 它
          → 否则 focus .wt-dock-sum（V3 已有的兜底）
```

`.wt-seat-hit` 的可见性判断沿用现有写法（`control.offsetParent !== null`），因为 451px 以下 chips 会 `display:none`，回焦可能落到不存在的节点上。

### 5.6 触屏

| 事实 | 处理 |
|---|---|
| 触屏没有 hover | fan 由 tap 打开，不依赖任何 hover 状态；`.wt-seat-tip`（hover 浮层）在 fan 打开时 `display:none`（§7.4） |
| 触点尺寸 | L 席 40×70、M 席 32×67、S 席 30×48 —— 命中区 = 整列，不做 `::after` 外扩（相邻席位会重叠误触） |
| S 档 30px 宽 < 44px 触点上界 | 物理上无解：360px 视口下 8 × 44 = 352 > 可用 328（= 360 − 32）。S 档靠「点开名片只有一步」补偿，且名片是满宽 sheet |
| 双击缩放 | `.wt-fan` 与 `.wt-person` 加 `touch-action:manipulation` |
| 安全区 | sheet 下沿 `max(16px, env(safe-area-inset-bottom))` |

---

## 6. 无障碍与降级

### 6.1 `prefers-reduced-motion`

**只保留 opacity，砍掉所有位移与缩放**（前庭触发来自 translate/scale，不来自透明度）。追加到 `client.js:511` 已有的 `@media (prefers-reduced-motion: reduce)` 块**内部**，但**不要**加进 513 行那条 `transition:none !important` 列表 —— 那条会连淡入一起杀掉。

```css
@media (prefers-reduced-motion: reduce) {
  .wt-fan, .wt-fan-seat, .wt-person, .wt-person-scrim {
    transition-property:opacity !important;
    transition-duration:120ms !important;
    transition-delay:0s !important;
    transform:none !important;
    animation:none !important;
  }
  .wt-fan[data-state="open"] .wt-fan-seat,
  .wt-fan[data-state="closing"] .wt-fan-seat,
  .wt-person, .wt-person[data-state="open"], .wt-person[data-state="closing"] { transform:none !important; }
}
```

JS 侧：`FAN_EXIT_MS` / `CARD_EXIT_MS` / `SHEET_EXIT_MS` 在 reduced-motion 下都取 **0**（读一次 `matchMedia('(prefers-reduced-motion: reduce)').matches`，与 `client.js:2963` 的 `touch` 同一个写法）。否则会白等 130ms 才卸载。

### 6.2 aria

| 元素 | 属性 | zh 文案 / locale 键 |
|---|---|---|
| facepile 首枚 `.wt-seat-hit` | `aria-expanded` / `aria-controls="wt-fan"` / `aria-label` | `员工办公室，{count} 人`（新键 `dock.fanAria`） |
| `.wt-fan` | `role="group"` / `id="wt-fan"` / `aria-label` | 同上 |
| `.wt-fan-seat` | `aria-label` | `{name}，{status}`（复用 `dock.chipAria`） |
| `.wt-person` | `role="dialog"` / `aria-modal="true"` / `aria-labelledby="wt-person-name"` / `tabIndex="-1"` | — |
| `.wt-person-x` | `aria-label` | `关闭名片`（新键 `dock.closeCard`） |
| `.wt-person-scrim` | `aria-hidden="true"` | — |
| 状态胶囊 | 无独立 aria | 文本即状态；点 `aria-hidden="true"` |
| 状态点 / 气泡 / ✦ | 无文本 | 已在 `RoleAvatar` 的 `aria-hidden` 子树里（`client.js:1480`） |

**fan 打开时不给 `.wt-person` 加 `aria-live`**：名片是用户点出来的，不是被动通知；加 `aria-live` 会让读屏在每次点开时打断当前朗读。

### 6.3 新增 locale 键（6 个，zh / en 各一份，加在 `client.js:84` 与 `:166`）

| 键 | zh | en |
|---|---|---|
| `dock.fanAria` | `员工办公室，{count} 人` | `Work team, {count} people` |
| `dock.cardAria` | `{name} 的名片` | `{name}'s card` |
| `dock.closeCard` | `关闭名片` | `Close card` |
| `dock.cardTask` | `当前任务` | `Current task` |
| `dock.cardModel` | `模型` | `Model` |
| `dock.cardUsage` | `用量` | `Usage` |

复用已有的：`row.open`（打开会话）、`dock.dispatchTo`（派活）、`card.stop`（暂停）、`settings.followMain`（跟随主对话）、`status.*`（八态文案）。

---

## 7. 状态覆盖

### 7.1 人数极值

| 成员数 | collapsed | 点开之后 |
|---|---|---|
| **1** | facepile 只有 1 枚 20px 头像 | **不展开**：直接打开这唯一一张名片（一个只有 1 行的「列表」是撒谎；而且 `--wt-k = 0`、`--wt-dx = 0`，动画退化成纯淡入） |
| **2** | 2 枚（28px 步进） | fan 2 席，宽 112px（L 档：2×40 + 8 + 24），两席同时出发（`k = 0.5`，延迟 7ms） |
| **3–7** | 3–5 枚 + `+N` | fan 3–7 席，中心落在中间那个人身上（奇数）或两人之间（偶数） |
| **8** | 5 枚 + `+3` | fan 8 席，400 / 318 / 284px（§2.2），最宽的一档 |
| **>8**（防御，`MAX_TEAM_SIZE = 8` 下不会出现） | 5 枚 + `+N` | fan 显示**前 7 席 + `+N`**，`+N` 打开办公室 tab；宽度仍按 8 席算（`--wt-fan-n:8`），公式不破 |

### 7.2 特殊状态

| 情况 | fan 席位 | 名片 |
|---|---|---|
| `failed` | 空心 + 红虚线（`wt-st-failed`，TOKENS §3），无状态环 | 动作行换成失败提示（§4.2） |
| `waiting`（等你回复） | 带 `?` 气泡（`RoleAvatar bubble={status === 'waiting'}`，`client.js:1514`）+ 6px 点 | 胶囊「等你回复」；**暂停可用**（§4.1） |
| `provisioning` | 虚线环在转（`wt-spin 2.4s`，已有） | 胶囊「入职中」；暂停不可用 |
| `done`（有新结果） | `✦` 播一次（`wt-sparkle 1.3s`，已有） | 胶囊「有新结果」 |
| `ready` / `idle` | 环降到 `.34` / 常规 | 胶囊「已就位」/「待命」 |

### 7.3 排序冻结（一个必须写死的规则）

fan 的席位顺序 = **打开那一刻**的 `ranked` 快照（按 `STATUS_RANK`，`client.js:2940`）。打开期间成员状态变化只更新**单个席位的环 / 点 / 气泡**，**不重排**。

理由：状态一变就重排，正在飞出去的 8 个座位会中途换位 —— 动画会看起来像坏了，而用户正在瞄准其中一张脸。重新打开时才按新顺序排。

### 7.4 fan 打开时，dock 上的其他东西

| 元素 | 处理 | 数值 |
|---|---|---|
| `.wt-facepile` | 保持 100%，仍是触发器 | `opacity:1` |
| `.wt-chips` | 压暗且不可点（它是第二套名单，此刻是噪声） | `opacity:.2; pointer-events:none` |
| `.wt-dock-sum` | 压暗但**仍可点**（点它 = 开办公室 tab，同时 fan 收起） | `opacity:.35` |
| `.wt-more` | 同 chips（fan 里已经全员在列，`+N` 此刻是重复信息） | `opacity:.2; pointer-events:none` |
| `.wt-seat-tip`（hover 浮层） | 全部隐藏 | `display:none` |
| `.wt-dock` 底色 | 锁成 hover 态（「这个控件正被按住」） | `background: bg-layer-1` |

**不隐藏 chips、只压暗**：`display:none` 会让摘要横向跳一段，而这条 32px 的轨道就在浮层正下方 —— 底下的行一动，浮层看起来在晃。

---

## 8. 落地映射

### 8.1 新增 class / 属性

| class | 挂在哪 | 职责 |
|---|---|---|
| `.wt-fan` | portal 根（`body` 下） | 浮层盒：定位、底色、阴影、曲线变量、`--wt-fan-w` |
| `.wt-fan-seat` | fan 内每席（`button`） | 席位：列宽、`--wt-dx`、进出场过渡、焦点环 |
| `.wt-fan-name` | 席位内 | 名字（S 档隐藏） |
| `.wt-person-scrim` | portal 根（`body` 下） | 遮罩：`bg-mask-1` + `mask-blur` |
| `.wt-person` | portal 根（`body` 下） | 名片盒 |
| `.wt-person-*` | 名片内 | head / av / name / role / x / pill / dot / sec / key / task / rule / facts / fact-k / fact-v / acts / act / note |

| 属性 | 值 | 用途 |
|---|---|---|
| `data-wt-fan` | 空 | 外部点击判断（§5.2） |
| `data-wt-person` | 空 | 同上 |
| `data-wt-person-scrim` | 空 | 同上 |
| `data-state` | `open` / `closing` | 进出场过渡的开关（§3） |
| `data-wt-seat` | 成员 id | 回焦（沿用 V3） |
| `data-fan` | `true` | `.wt-dock` 上，压暗 chips / 摘要（§7.4） |
| `data-kind` | `primary` / `stop` | 名片按钮三态（§4.1） |
| inline vars | `--wt-i` / `--wt-c` / `--wt-k` / `--wt-fan-n` / `--wt-fan-anchor-x` / `--wt-fan-bottom` | 全部写成**带单位的字符串**（`'312px'`、`'48'`）。React 对自定义属性不做 px 补全，写成数字会让 `calc()` 整条失效 |

### 8.2 CSS 块（可直接粘）

**插入位置：`client.js:319`（`.wt-more` 那三行）之后、`:321`（`.wt-chips`）之前**，作为新的 `/* ── V4 展开层 ── */` 段；三条 `@media` 放在段内末尾（视口断点，与 `@container` 互不影响）。

```css
/* ── V4 展开层：曲线 ──────────────────────────────────────────────────
   两处都要写：.wt-dock 给「chips/摘要/`+N` 的压暗」用；三个 portal 根给浮层用。
   portal 出去的节点不是 .wt-dock 的后代，自定义属性不跨 portal 继承 ——
   只写在 .wt-dock 上，下面那三条 transition 会因 var() 无效而整条失效。 */
.wt-dock, .wt-fan, .wt-person, .wt-person-scrim {
  --wt-ease-out: cubic-bezier(.2,.9,.25,1);
  --wt-ease-in: cubic-bezier(.5,0,.9,.4);
}

/* ── V4 展开层：fan ───────────────────────────────────────────────── */
.wt-fan { position:fixed; z-index:1100; box-sizing:border-box; display:flex; align-items:flex-start; gap:var(--wt-fan-gap); touch-action:manipulation;
  --wt-fan-col:40px; --wt-fan-gap:8px; --wt-fan-pad-x:12px; --wt-fan-pad-y:10px; --wt-fan-av:32px; --wt-fan-name-size:11px; --wt-fan-name-lh:14px;
  --wt-fan-w:calc(var(--wt-fan-n,1) * var(--wt-fan-col) + (var(--wt-fan-n,1) - 1) * var(--wt-fan-gap) + 2 * var(--wt-fan-pad-x));
  padding:var(--wt-fan-pad-y) var(--wt-fan-pad-x); border:0; border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-3); --dsw-elevation-stroke-color:var(--dsw-alias-border-l2); box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary);
  width:var(--wt-fan-w);
  left:clamp(calc(var(--wt-fan-w) / 2 + 16px), var(--wt-fan-anchor-x, 50vw), calc(100vw - var(--wt-fan-w) / 2 - 16px));
  bottom:var(--wt-fan-bottom, 0px); translate:-50% 0;
  transform-origin:50% 100%; opacity:0; transform:translateY(4px);
  transition:opacity 120ms var(--wt-ease-out), transform 200ms var(--wt-ease-out); }
.wt-fan[data-state="open"] { opacity:1; transform:translateY(0); }
.wt-fan[data-state="closing"] { opacity:0; transform:translateY(4px); transition:opacity 90ms var(--wt-ease-in), transform 120ms var(--wt-ease-in); }

.wt-fan-seat { position:relative; box-sizing:border-box; flex:0 0 var(--wt-fan-col); width:var(--wt-fan-col); display:flex; flex-direction:column; align-items:center; gap:4px;
  padding:0; border:0; border-radius:8px; background:transparent; color:inherit; font:inherit; cursor:pointer;
  --wt-dx:calc((var(--wt-i,0) - var(--wt-c,0)) * (var(--wt-fan-col) + var(--wt-fan-gap)));
  transform-origin:50% 50%; opacity:0; transform:translateX(calc(var(--wt-dx) * -1)) scale(.86);
  transition:opacity 110ms var(--wt-ease-out) calc(var(--wt-k,0) * 14ms), transform 170ms var(--wt-ease-out) calc(var(--wt-k,0) * 14ms); }
.wt-fan[data-state="open"] .wt-fan-seat { opacity:1; transform:translateX(0) scale(1); }
.wt-fan[data-state="closing"] .wt-fan-seat { opacity:0; transform:translateX(calc(var(--wt-dx) * -.35)) scale(.94); transition:opacity 70ms var(--wt-ease-in), transform 90ms var(--wt-ease-in); }
.wt-fan-seat:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
/* RoleAvatar 的尺寸是 inline style（client.js:1470），只有 !important 能覆盖。
   全篇唯一一处 !important：不覆盖就得把三档断点复制进 JS，两套真相更糟。 */
.wt-fan-seat .wt-avatar-wrap { width:var(--wt-fan-av) !important; height:var(--wt-fan-av) !important; }
.wt-fan-seat .wt-avatar-svg { width:var(--wt-fan-av); height:var(--wt-fan-av); }
.wt-fan-seat .wt-avatar-wrap::after { inset:-2px; border-width:1.5px; }
.wt-fan-name { max-width:var(--wt-fan-col); font-size:var(--wt-fan-name-size); line-height:var(--wt-fan-name-lh); font-weight:600; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* ── V4 展开层：名片 ─────────────────────────────────────────────── */
.wt-person-scrim { position:fixed; inset:0; z-index:1300; background:var(--dsw-alias-bg-mask-1); backdrop-filter:var(--dsw-mask-blur); opacity:0; transition:opacity 140ms var(--wt-ease-out); }
.wt-person-scrim[data-state="open"] { opacity:1; }
.wt-person-scrim[data-state="closing"] { opacity:0; transition:opacity 120ms var(--wt-ease-in); }

.wt-person { position:fixed; z-index:1301; box-sizing:border-box; display:flex; flex-direction:column; touch-action:manipulation;
  /* 名片根节点要挂 wt-st-<status>（给 --wt-raw），再由这一行推出 --wt-state。
     不能直接用 --dsw-alias-state-idle-primary：亮色下 #d4d4d4 在白底上看不见，
     必须混 70% label-primary（TOKENS §2 陷阱 2，client.js:282 同一写法）。 */
  --wt-state:color-mix(in srgb, var(--wt-raw, var(--dsw-alias-state-idle-primary)) 70%, var(--dsw-alias-label-primary));
  width:min(360px, calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; padding:16px;
  border:0; border-radius:var(--dsw-radius-lg); background:var(--dsw-alias-bg-layer-3); --dsw-elevation-stroke-color:var(--dsw-alias-border-l2); box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary); left:50%; top:50%; translate:-50% -50%;
  transform-origin:50% 50%; opacity:0; transform:scale(.96) translateY(4px);
  transition:opacity 120ms var(--wt-ease-out), transform 180ms var(--wt-ease-out); }
.wt-person[data-state="open"] { opacity:1; transform:scale(1) translateY(0); }
.wt-person[data-state="closing"] { opacity:0; transform:scale(.98); transition:opacity 90ms var(--wt-ease-in), transform 100ms var(--wt-ease-in); }
.wt-person:focus-visible { outline:none; }

.wt-person-head { display:flex; align-items:flex-start; gap:12px; }
.wt-person-av { flex:none; }
.wt-person-id { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.wt-person-name { font-size:16px; font-weight:600; line-height:22px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wt-person-role { font-size:12px; line-height:16px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wt-person-x { flex:none; width:24px; height:24px; display:inline-grid; place-items:center; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-tertiary); font:inherit; font-size:13px; line-height:1; cursor:pointer; }
.wt-person-x:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.wt-person-x:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

.wt-person-pill { align-self:flex-start; display:inline-flex; align-items:center; gap:5px; height:22px; margin-top:10px; padding:0 8px; border-radius:999px; font-size:11px; font-weight:600; line-height:1; white-space:nowrap;
  border:0.5px solid color-mix(in srgb, var(--wt-state) 40%, transparent); background:color-mix(in srgb, var(--wt-state) 14%, transparent); color:var(--wt-state); }
.wt-person-dot { flex:none; width:6px; height:6px; border-radius:50%; background:var(--wt-state); }

.wt-person-sec { display:flex; flex-direction:column; gap:4px; margin-top:14px; }
.wt-person-key { font-size:11px; line-height:16px; color:var(--dsw-alias-label-tertiary); }
.wt-person-task { font-size:12px; line-height:18px; color:var(--dsw-alias-label-primary); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.wt-person-task[data-empty="true"] { color:var(--dsw-alias-label-tertiary); }

.wt-person-rule { flex:none; height:0.5px; margin:14px 0; background:var(--dsw-alias-border-l1); }
.wt-person-facts { display:grid; grid-template-columns:56px minmax(0,1fr); gap:6px 8px; }
.wt-person-fact-k { font-size:11px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.wt-person-fact-v { min-width:0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-primary); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.wt-person-acts { display:flex; align-items:center; gap:8px; margin-top:16px; }
.wt-person-act { height:28px; padding:0 12px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; font-weight:600; line-height:1; cursor:pointer; }
.wt-person-act:hover { border-color:var(--dsw-alias-brand-primary); }
.wt-person-act:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.wt-person-act[data-kind="primary"] { flex:1 1 auto; border-color:transparent; background:var(--dsw-alias-button-info-fill); color:var(--dsw-alias-label-primary-inverted); }
.wt-person-act[data-kind="primary"]:hover { border-color:transparent; background:var(--dsw-alias-button-info-hover); }
.wt-person-act[data-kind="stop"] { border-color:var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-state-error-primary); }
.wt-person-act[data-kind="stop"]:hover { border-color:var(--dsw-alias-state-error-primary); }
.wt-person-act:disabled { opacity:.45; cursor:default; border-color:var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-tertiary); }
.wt-person-note { margin-top:14px; font-size:11px; line-height:16px; color:var(--dsw-alias-state-error-primary); }

/* ── V4 展开层：dock 的展开态（压暗，不隐藏） ─────────────────────── */
.wt-dock[data-fan="true"] { background:var(--dsw-alias-bg-layer-1); }
.wt-dock[data-fan="true"] .wt-facepile { opacity:1; }
.wt-dock[data-fan="true"] .wt-chips, .wt-dock[data-fan="true"] .wt-more { opacity:.2; pointer-events:none; }
.wt-dock[data-fan="true"] .wt-dock-sum { opacity:.35; }
.wt-dock[data-fan="true"] .wt-seat-tip { display:none; }
.wt-chips, .wt-more, .wt-dock-sum { transition:opacity 120ms var(--wt-ease-out); }

/* ── V4 展开层：视口三档（fan 是 fixed，量视口；dock 的 @container 不动）── */
@media (max-width: 480px) {
  .wt-fan { --wt-fan-col:32px; --wt-fan-gap:6px; --wt-fan-pad-x:10px; --wt-fan-av:30px; --wt-fan-name-size:10.5px; --wt-fan-name-lh:13px; }
}
@media (max-width: 360px) {
  .wt-fan { --wt-fan-col:30px; --wt-fan-gap:4px; --wt-fan-pad-x:8px; --wt-fan-av:28px; }
  .wt-fan-name { display:none; }
  .wt-fan-seat { gap:0; }
  .wt-fan-seat .wt-avatar-wrap::after { display:none; }
  .wt-person { left:0; right:0; bottom:0; top:auto; width:100%; max-width:none; max-height:calc(100vh - 24px);
    translate:0 0; border-radius:var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0;
    padding-bottom:max(16px, env(safe-area-inset-bottom)); transform-origin:50% 100%; transform:translateY(100%);
    transition:opacity 120ms var(--wt-ease-out), transform 220ms var(--wt-ease-out); }
  .wt-person[data-state="open"] { transform:translateY(0); }
  .wt-person[data-state="closing"] { transform:translateY(100%); transition:opacity 90ms var(--wt-ease-in), transform 160ms var(--wt-ease-in); }
}
```

**reduced-motion 块追加到 `client.js:511`** 那个 `@media` 内部（内容见 §6.1），**不要**并入 513 行那条 `transition:none !important` 列表。

### 8.3 JS 改动清单（`client.js`）

| # | 位置 | 改什么 |
|---|---|---|
| 1 | `client.js:4` 后 | `const ReactDOM = require('react-dom');`（宿主包普遍这么引，实测 `dsh-client-ui-chat` 等 8 个包都在用 `createPortal`） |
| 2 | `client.js:84` / `:166` | 加 §6.3 的 6 个 locale 键，zh/en 同步 |
| 3 | `client.js:2946` `Dock` | 加 `fan` / `card` 两个 state（`{open, closing, order, anchorX, bottom}` / `{id, closing}`）+ `openFan` / `closeFan` / `openCard` / `closeCard` |
| 4 | `client.js:2946` `Dock` | 量锚点：`facepile.getBoundingClientRect()` → `--wt-fan-anchor-x = (left + width/2) + 'px'`；`--wt-fan-bottom = (innerHeight − dockRect.top + 6) + 'px'`。`resize` + `ResizeObserver(dock)` 重算 |
| 5 | `client.js:3044` 外点监听 | 加 `closest('[data-wt-fan], [data-wt-person], [data-wt-person-scrim]')` 提前 return（§5.2） |
| 6 | `client.js:1561` `DockFace` | `onClick` 从 `onOpen(id)` 改成 `onExpandFan(id)`；只有**第 1 枚**给 `tabIndex=0`，其余 `-1`（§5.4） |
| 7 | `client.js:2946` `Dock` render | `data-fan` 属性；`members.length === 1` 时点开直接 `openCard`（§7.1） |
| 8 | 新增 `DockFan` | `createPortal(h('div', {className:'wt-fan', 'data-wt-fan':'', 'data-state':…, style:{'--wt-fan-n':String(n), …}}, seats), document.body)`；席位内联 `--wt-i/--wt-c/--wt-k`（字符串） |
| 9 | 新增 `PersonCard` | `createPortal([scrim, card], document.body)`；`role="dialog"` + `aria-modal` + `aria-labelledby`；4 站焦点陷阱；Esc 关 |
| 10 | 新增 `useEscLadder` | `document` `keydown` 捕获，只在有面打开时挂；先关名片再关 fan（§5.3） |
| 11 | 新增 `measure` | `prefers-reduced-motion` 读一次，`FAN_EXIT_MS` / `CARD_EXIT_MS` / `SHEET_EXIT_MS` 取 130 / 130 / 170 或 0 |
| 12 | `client.js:1098` 轮询 | 顺手把 `payload.values.modelSelection` 存进 `memberRuntime`（**先 `console.log(Object.keys(payload.values))` 确认存在**，见 §4.3） |

### 8.4 新引入的宿主令牌（全部实测，不是猜的）

| 令牌 | 值 | 来源 |
|---|---|---|
| `--dsw-radius-md` | `12px` | `dsh-client-ui-theme/lib/client.js` |
| `--dsw-radius-lg` | `16px` | 同上 |
| `--dsw-elevation-prominent` | `var(--dsw-elevation-stroke), 0 3px 8px #0000000a, 0 0 20px #0000000d` | 同上 |
| `--dsw-alias-bg-mask-1` | 亮 `#0000003d`（24%）/ 暗 `#00000080`（50%） | 同上 |
| `--dsw-mask-blur` | `none`（换肤旋钮） | 同上 |
| `--dsw-alias-label-primary-inverted` | 亮 `#fff` / 暗 `#353638` | TOKENS §2 已在名单内 |

复用的既有：`bg-layer-1/2/3`、`border-l1/l2`、`brand-primary`、`button-info-fill/hover`、`label-primary/secondary/tertiary`、`state-*`。

---

## 9. 验收自查

### 9.1 实测（不是推演）

把 §8.2 的 CSS 原样抽出，配 **宿主真实主题 CSS**（`dsh-client-ui-theme` 的 `body{}` 与 `body[data-ds-dark-theme]{}` 原块），在 headless Chrome 里跑三个视口（窄视口用 iframe 绕开 Chrome 500px 的最小窗口宽）。测量的是 `getBoundingClientRect()` 与 `getComputedStyle()`：

锚点（`--wt-fan-anchor-x`）按真实布局算：dock 内容左沿 = dockLeft + 14，facepile 5 枚 = 76 → 锚点 = dockLeft + 52。窄视口下 dockLeft = 16 → 锚点 = **68**；1200 视口下 dock 宽 800、居中 → dockLeft = 200 → 锚点 = **252**。

| 视口 | 锚点 | fan 宽 × 高 | fan 左沿 / 右沿 | 座位步进 | 头像 | 名片宽 | 名片形态 |
|---|---|---|---|---|---|---|---|
| 1200 | 252 | **400 × 70** | 52 / 748 | 48 | 32 | 360 | 居中（fan 中心 = 252 = 锚点 ✅ 完全对中） |
| 481 | 68 | **400 × 70** | **16** / 65 | 48 | 32 | 360 | 居中 |
| 361 | 68 | **318 × 67** | **16** / 27 | 38 | 30 | 329（= 361 − 32） | 居中 |
| 320 | 68 | **284 × 48** | **16** / 20 | 34 | 28 | 320（满宽） | sheet，`translate:0 0` |

→ **精确对中的条件**是 `dockLeft ≥ w/2 − 28`（L 档 172px / M 档 131px / S 档 114px）；dockLeft 小于它，fan 就贴左 16px。这不是妥协，是几何上的唯一解 —— 400px 的 fan 要对中一个距左沿 68px 的触发器，左边必然伸到 −132px（§2.2）。

其余实测值：

```
.wt-fan        border-radius: 12px     box-shadow: rgba(0,0,0,.1) 0 0 0 .5px, …
.wt-person     border-radius: 16px     translate: -50% -50%（sheet 下为 0px）
遮罩           background: rgba(0,0,0,0.24)   backdrop-filter: none
胶囊           color: color(srgb .599 .601 .606)  ← --wt-state 混色已生效（不是裸 idle 灰）
座位 transition-delay: 0.049s, 0.049s        duration: 0.11s, 0.17s
关态座位       transform: matrix(.86,0,0,.86,168,0)  opacity: 0     ← from 值正确
关态浮层       transform: matrix(1,0,0,1,0,4)        opacity: 0
开态座位       transform: matrix(1,0,0,1,0,0)
dock 内 chips  opacity: .2            摘要 opacity: .35
```

结论：§2.2 的三档宽高、§3 的延迟/时长、§2.3 的圆角与遮罩、§7.4 的压暗值，全部与文档一致。**测量用的临时页在 `/tmp`，没有进仓库**（写作用域只有本文件）。

### 9.2 逐条对照

| 验收项 | 结果 | 依据 |
|---|---|---|
| 每个数字可直接抄进 CSS | ✅ | §2 / §3 / §4 全是表；§8.2 是整块可粘贴 CSS |
| 无「适当」「略」类词 | ✅ | 全文只有 px / ms / 百分比 / 曲线控制点 |
| 零 hex、零 rgb() | ✅ | 只有 `--dsw-*` 与 `color-mix(in srgb, var(--wt-state) N%, transparent)` |
| dock 高仍 32px | ✅ | fan 是 `position:fixed` portal，不占流（§2.1） |
| 643/451/291 三档不受影响 | ✅ | §8.2 的 `@media` 与 `client.js:362-365` 的 `@container` 互不重叠 |
| 不推挤输入框 | ✅ | §1 第 2 条 + §2.2 的 fixed 定位 |
| 展开手感 180–240ms | ✅ | 219ms（n=8 最坏）/ 177ms（n=2） |
| 收起更快 | ✅ | 120ms，比例 1 : 1.8 |
| 平台 z-index 号段 | ✅ | fan 1100（宿主 portal 层）；名片 1300/1301（避开 inspector 的 1200/1250） |
| 团队上限 8 | ✅ | `client.js:80` `MAX_TEAM_SIZE = 8`；§7.1 给了 >8 的防御 |
| 1 人 / 8 人两种极值 | ✅ | §7.1 |
| reduced-motion | ✅ | §6.1，只留 opacity，退出计时归 0 |
| 键盘可达 | ✅ | §5.4（facepile 1 站 → fan 8 站 → 名片 4 站） |
| 触屏无 hover 依赖 | ✅ | §5.6 |
| 不引入新依赖 / 不改宿主 | ✅ | 只加 `require('react-dom')`（宿主已装） |

**可重跑验证**：

```bash
# ① 新增的宿主令牌是否真的存在
cd ~/.bun/install/global/node_modules/@deepseek-ai/dsh-client-ui-theme/lib
grep -o -- '--dsw-radius-\(md\|lg\):[^;}]*' client.js
grep -o -- '--dsw-elevation-prominent:[^;}]*' client.js
grep -o -- '--dsw-alias-bg-mask-1:[^;}]*' client.js
grep -o -- '--dsw-mask-blur:[^;}]*' client.js

# ② z-index 号段是否真的没人占 1300
cd ~/.bun/install/global/node_modules/@deepseek-ai
grep -rho 'z-index:[0-9]\{4\}' --include=client.js . | sort -u

# ③ 规格落地后：不该出现 hex / 不该动 dock 高度
cd /home/inkedus/Code/github/dsh-work-team
grep -n 'wt-fan\|wt-person' client.js | grep -i '#[0-9a-f]\{3,6\}' || echo 'no hex ✅'
grep -n '^      \.wt-dock {' client.js   # 仍应是 height:32px
```

---

## 10. 给小前的实现索引

按顺序做，每步都能单独验收：

| 步 | 做什么 | 对应 |
|---|---|---|
| **1** | 加 §8.2 整块 CSS（此时还没有 JS，页面无变化 —— 正常） | §8.2 |
| **2** | `require('react-dom')` + 6 个 locale 键 | §8.3 #1 #2 |
| **3** | `Dock` 加 `fan` 状态 + 量锚点 + `data-fan`；`DockFace` 点击改成展开 | §8.3 #3 #4 #6 #7 |
| **4** | 新增 `DockFan`（portal + 8 席 + `--wt-i/--wt-c/--wt-k`）→ 此时**「往两边展开」已经能看**，先验这一层 | §3.2 §3.3 §2.2 |
| **5** | 外点关闭 + Esc + 回焦（fan 单独能开能关） | §5.2 §5.3 §5.5 |
| **6** | 新增 `PersonCard`（先只放头像 / 名字 / 角色 / 胶囊 / 3 个动作） | §4 §2.3 |
| **7** | 补「当前任务 / 模型 / 用量」三行（模型先按 §4.3 实测确认数据源） | §4.3 §8.3 #12 |
| **8** | 窄屏 sheet（`@media 360`）+ 三档变量核对 | §2.3 §3.5 §8.2 |
| **9** | reduced-motion + 退出计时归 0 | §6.1 §8.3 #11 |
| **10** | 手工验收：1 人 / 2 人 / 8 人 / failed / waiting / 视口 704-512-352-320 / 键盘全程 / 触屏 | §7 §9 |

**最容易踩的四个坑**（提前说，省一轮返工）：

1. **`data-state` 必须在挂载后下一帧才切成 `open`**。同一帧里从 `opacity:0` 直接渲染成 `opacity:1`，浏览器会合并两次样式计算，过渡根本不跑，浮层会「啪」地出现。
2. **自定义属性不跨 portal**：曲线变量写在 `.wt-fan` / `.wt-person` 上，不要只写在 `.wt-dock` 上。
3. **`--wt-k` 写成数字会静默失效**：`calc(var(--wt-k) * 14ms)` 里如果 `--wt-k` 是 React 传的 number（不是字符串），自定义属性整条作废、延迟回落到 0 —— 症状是 8 席**同时**出现而不是错峰。看到「一起飞」，先查这里。
4. **卸载要等过渡结束**：`FAN_EXIT_MS = 130`、`CARD_EXIT_MS = 130`、`SHEET_EXIT_MS = 170`，reduced-motion 下全部取 0。用 `setTimeout` 而不是 `transitionend`（多属性过渡时 `transitionend` 会触发多次，且被 `display:none` 打断时不触发）。
