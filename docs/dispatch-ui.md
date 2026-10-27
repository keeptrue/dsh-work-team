# @ 派活浮层 · 工位条派活入口 — 视觉规格（V1.5）

> 承 `client.js` 现有语言：`.wt-dock`（12px 圆角 / `bg-layer-1` 外壳）、`.wt-card`（9px / `bg-layer-2` / 30px 头像）、`.wt-pill`、`.wt-dot`、`.wt-avatar-wrap` 状态环、`@keyframes wt-sparkle`。
> 新增的一切只做**加法**：不引入色板、不引入插画、不引入第二套圆角语汇。

---

## 0. 气质与三个方向的取舍

**要的东西**：像编辑器里的补全，不像一个对话框。密度高、边界克制、只有一层阴影加 0.5px 描边，出现时把注意力留在光标上，而不是拉走去看一个新窗口。

被否掉的两个方向，理由写在下面，免得后面反复：

| 方向 | 做法 | 为什么否掉 |
|---|---|---|
| **A（采用）上唇贴片** | 浮层挂在 composer 卡上沿，同宽受限、同左对齐文字起点，靠 8px 缝隙和一层浅阴影说明「从输入框长出来的」 | — |
| B 内联撑高官方卡 | 把 `conversation.input.overlay` 的列表塞进卡片流内，让卡变高 | 要和官方卡的滚动容器抢高度，敲 `@` 时整条输入框上下跳，还会挤压消息流；官方卡高度不归我们管 |
| C 光标锚定 | 浮层贴着 `@` 字符的实际坐标弹出 | 需要文本测量，中文名在 <280px 宽时被截断，多行输入时定位不稳，代价远大于收益 |

---

## 1. 位置与边界（先钉死，其它都从这个盒子里长）

`conversation.input.overlay` 的锚点已核实：`.uV2eYG_overlayAnchor{height:0; position:absolute; inset:0 0 auto}` —— **零高度、贴卡片上沿、横跨整卡**。所以浮层只能向上长，向下会盖住用户正在打的字。

| 属性 | 值 | 说明 |
|---|---|---|
| `position` | `absolute` | 不参与文档流，composer 高度纹丝不动 |
| 水平 | `left:14px`；`width:min(calc(100% - 28px), 560px)` | 14px = 官方编辑器 `padding-left`，浮层左沿与用户输入的第一个字对齐 |
| 垂直 | `bottom:8px` | 相对零高度锚点，即浮层下沿离卡片上沿 8px |
| 最大宽 | 560px | 卡片最宽 952px（`--dsh-composer-card-max-width`），浮层永远不超过它，桌面上也不会变成一条长横幅 |
| 圆角 | `12px` | 与 `.wt-dock` 同 |
| 底色 | `var(--dsw-alias-bg-layer-3)` | 已核实：composer 卡底是 `--dsw-specific-input-major`（亮 `neutral-bluish-00` / 暗 `-850`），`bg-layer-3` 在暗色是 `-800`，正好高一层；亮色两者同为 `-00`，靠 0.5px 描边 + 阴影分离 |
| 描边 | `0.5px solid var(--dsw-alias-border-l2)` | 官方 composer 卡的描边色 |
| 阴影 | `0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent)` | 只有一层，比 `.wt-modal`（28%）轻得多——它不是模态 |
| `z-index` | **`120`** | 压过官方 `@` 菜单的 100，两者同锚点时看到的是我们的（见第 6 节）；`.wt-overlay` 也是 120，但它在自己的 fixed 层里，互不影响 |
| 内边距 | `6px` | 列表/输入行自己不再加外距，避免双层留白 |

```
        ┌──────────────────────────────────────────────┐  ← 桌面 560px，窄屏=卡宽-28px
        │  候选行 40px  ×最多 8                              │
        │  …                                                │
        ├──────────────────────────────────────────────┤ 0.5px border-l1
        │  任务输入行 44px                                    │
        └──────────────────────────────────────────────┘
                 ↓ 8px 缝
        ╭──────────────────────────────────────────────╮
        │  官方 composer 卡（28px 圆角，气泡由官方负责）        │
        ╰──────────────────────────────────────────────╯
```

**为什么是 8px 而不是 0**：贴死会被误读成卡片的一部分，用户会以为发送按钮属于 composer；8px 缝 + 阴影刚好说清「这是临时浮上来的」。也**不做小三角箭头**——官方卡圆角 28px，箭头在弧形上对不齐。

---

## 2. 候选列表

| 项目 | 值 | token |
|---|---|---|
| 行高 | **40px**（`height:40px; padding:0 8px`，内容垂直居中） | — |
| 头像 | **28px**，复用 `RoleAvatar`，`--wt-accent` 由角色 palette 给 | 状态环沿用 `.wt-avatar-wrap::after` |
| 行圆角 / 行间距 | `8px` / `1px` | — |
| 列表内边距 | `4px`（上/下），行本身无外距 | — |
| 列表最大高 | **328px** = 8 行 × 40 + 上下 4×2，再多就滚；另加 `min(…, 45vh)` 兜短屏 | — |
| 滚动条 | 与 `.wt-dock-cards` 同款：4px、`border-l2` | `scrollbar-width:thin` |

**行内层级**（三件套，顺序不可换）：

| 元素 | 字号/字重/行高 | 颜色 | 约束 |
|---|---|---|---|
| 中文名 | `12px / 600 / 16px` | `var(--dsw-alias-label-primary)` | 单行 ellipsis |
| 角色名 | `10.5px / 400 / 14px`，紧贴中文名下方 1px | `var(--dsw-alias-label-secondary)` | 单行 ellipsis；与中文名左对齐，不缩进 |
| 右侧状态 | `10px` + 5px `.wt-dot`（复用现有 status class） | `var(--dsw-alias-label-secondary)` | `margin-left:auto`，不收缩；告知「谁在忙」，但**不禁止**选中 |

头像与文字间距 `8px`（沿用 `.wt-card` 的 8px）。

**选中 / hover / 键盘**：

| 态 | 表现 |
|---|---|
| hover | 行底 `var(--dsw-alias-interactive-bg-hover)` |
| 键盘活动行（active） | 行底 `var(--dsw-alias-interactive-bg-active)` + 左侧 2px 竖条 `var(--dsw-alias-brand-primary)`（`left:2px`，高 24px，圆角 2px），并让该行 `scrollIntoView({block:'nearest'})` |
| 按下 | `var(--dsw-alias-interactive-bg-hover)`，无位移、无缩放 |

**排序**：已入职成员在前（顺序与工位条一致，用户看到的就是他记的顺序）→ 未入职角色在后。

---

## 3. 任务输入行（选中候选人之后）

整块高 **44px**，`padding:0 6px`，`gap:8px`，`align-items:center`。这一行是浮层唯一的「操作区」，所以它比候选行高 4px，视觉上收尾。

| 部件 | 规格 |
|---|---|
| 目标徽标 | `RoleAvatar` **20px** + 8px + 中文名 `12px/600`，`label-primary`；整块 `flex:none` |
| 输入框 | `flex:1`，高 **30px**，`padding:0 8px`，`border-radius:7px`，底色 `var(--dsw-alias-bg-layer-2)`，描边 `0.5px solid var(--dsw-alias-border-l1)`；聚焦时 `box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent)` |
| 占位文案 | 「给 {名字} 派个活…」`12px`，`var(--dsw-alias-label-caption)` |
| 发送按钮 | **28×28，圆角 999，位于本行最右端**，与输入框间距 6px，垂直居中；右内距 6px（= 行 padding） |
| 按钮配色 | 底 `var(--dsw-alias-button-info-fill)`，hover `var(--dsw-alias-button-info-hover)`，图标/文字 `var(--dsw-alias-label-primary-inverted)` —— 就是官方 compose 提交键缩小一号 |
| 禁用态 | 输入为空/全空白：`opacity:.4`，`cursor:default`（与官方 `.primary:disabled{opacity:.4}` 同值）；不禁用整行 |
| 键盘 | `Enter` 提交，`Shift+Enter` 换行（单行输入时忽略）；`Esc` 退回候选列表 |

选中候选人后**候选列表整块收起**，浮层只剩这一行 —— 总高 56px（44 + 上下 6），不再占半屏。

---

## 4. 状态：文案落在哪（成功 / 失败 / 未入职）

| 状态 | 位置 | 文案 | 颜色/尺寸 | 时长与收起 |
|---|---|---|---|---|
| **成功**「已派给 小前」 | 原地替换任务输入行的左半（20px 头像改 `st-done` 环 + 文案），发送按钮同时隐藏 | `已派给 {名字}` / `Sent to {Name}` | `12px`，`var(--dsw-alias-state-success-primary)` | 停留 **1600ms**，随后浮层 120ms 收起；期间 `Esc`/点击别处/继续打字**立即**收起。同时工位条上该成员卡触发一次现有 `wt-sparkle` |
| **失败**（派发） | 任务输入行**下方新增一行**，高 18px，`padding:0 8px`，`margin-top:4px` | `没派出去：{原因}`，单行 ellipsis，`title` 带全文 | `10.5px`，`var(--dsw-alias-state-error-primary)`（沿用 `.wt-error` 排版） | 不自动消失。浮层总高变 78px。输入内容**原样保留**，焦点回到输入框末尾、光标在最后；发送按钮恢复可用 |
| **未入职**（角色存在但没招） | 就在候选行里，不另开状态 | 右侧 `.wt-pill` 显示 `未入职` / `Not hired` | 头像加 `.wt-avatar-dim`，名字 `label-secondary`，整行 `opacity:.7`、`cursor:default` | 不入 ↑↓ 序列、不可提交；点一下 → 右侧 pill 2000ms 换成 `说「招」`（沿用现有 `empty.hint` 语义） |

> **「没有匹配」不是状态，是「不出现」**：候选列表只在**至少命中一个角色**时才开（`entries.length === 0` 即不渲染浮层，也不渲染空态）。所以这一侧不存在「浮层开着但一条候选都没有」的画面 —— 没命中就交给官方 `@` 菜单，见第 6 节。

无障碍：失败用 `role="alert"`；成功用 `aria-live="polite"`；候选列表 `role="listbox"`，行 `role="option"` + `aria-selected`，浮层容器 `aria-label="选一个同事"`。

---

## 5. 键盘与焦点约定

| 键 | 候选态 | 任务输入态 |
|---|---|---|
| `↑` / `↓` | 移动 active 行，**到头即停不循环**（可预测优于省一次按键） | 交还给输入框（正常光标移动） |
| `Enter` | 选中 active 行 → 进入任务输入态，焦点跳进输入框 | 提交 |
| `Esc` | 关闭浮层：文本**原样保留**在 composer 里，焦点回编辑器、caret 落在末尾 | **退回候选态**（不关闭），active 行回到上次选中的那位；再按一次 `Esc` 才关闭 |
| `Tab` | 关闭浮层并把焦点交给 composer 的下一个控件（不吞 Tab） | 同左 |
| 点击浮层外 | 关闭，文本保留 | 关闭，已输入的任务草稿丢弃（重敲 `@` 从头来） |

- 列表开着时，编辑器里的 `↑`/`↓`/`Enter` 由浮层接管；`Esc` 只作用于浮层，不触发官方「中断生成」。
- **拦键的前置条件是焦点**：只有 `document.activeElement` 落在 composer 编辑器内（`closest('[data-composer-input]') !== null`）才拦这四个键。办公室搜索框、任务板输入框里的方向键与 Enter 归页面自己，浮层不抢 —— 否则「列表还开着，人已经去搜别的」时会吞掉别处的按键。
- `Tab` 只关闭浮层，不 `preventDefault`：焦点照常流向 composer 的下一个控件。
- 中文输入法优先：`event.isComposing === true`（或 `keyCode === 229`）期间，`↑`/`↓`/`Enter`/`Esc` **一律不处理**，避免选词时被吃掉。这条是硬要求，不是优化项。
- 高亮行变化用 `aria-activedescendant` 同步，读屏不弹焦点。

---

## 6. 与官方 @ 菜单的共存规则

已有的客观事实（都核对过源码，不是设想）：`dsh-client-ui-input-trigger` 在**同一个** `conversation.input.overlay` 锚点上挂了官方的 `@` 触发菜单，它的盒子是 `position:absolute; left:0; right:0; bottom:calc(100% + 4px); z-index:100; max-height:400px; padding:4px`。也就是说：同锚点、同方向、只差 4px 缝，而且是**通栏**（`left/right:0`）。两个列表会争同一个位置，所以这条规则必须写死，回归测试照着判。

| 用户敲的 | 我们的列表 | 官方菜单 | 用户看到什么 |
|---|---|---|---|
| 裸 `@`、`@` 后面跟路径 / 文件名 / 目录片段 | 不开 | 开 | 只有官方菜单 |
| `@小前`、`@阿`、`@front`（命中中文名 / 角色名 / 英文名） | 开 | 可能也开 | 我们的列表在最上层，Enter 选的是角色 |
| `@backend` 这种既是角色名、又像文件名的 | 开 | 可能也开 | 同上：角色列表压在上面，**所见即所得**，不用猜回车会选哪个 |

- **层级定死 120 > 100**：命中角色时永远是我们盖住官方，不做「先让官方、再让我们的」的交接动画 —— 两张列表此起彼伏会让人以为界面在抖。
- **同时出现时，官方菜单的左右两翼会露出**：它通栏、我们只有 560px。这是预期，不是 bug —— 我们的 8px 底缝阴影能压住它的上沿，但遮不住两侧。如果哪天两侧露边看着脏，正确做法是命中角色时不渲染官方菜单，而不是把我们的浮层拉成通栏。
- **没有「两边都不开」的中间态**：要么命中角色（我们开），要么不命中（官方接管）。我们这侧不渲染空态。
- **键位归属跟着层级走**：我们的列表在显示，`↑↓/Enter/Esc` 就归我们；它不在显示，我们一个键都不碰（见第 5 节的焦点前置条件）。
- 回归判据四行：裸 `@` 不出角色行；`@backend` 出角色行且在最上；同时出现时允许官方两翼露出；焦点离开 composer 编辑器后，方向键不再被浮层接管。

---

## 7. 工位条卡片内联派活

### 7.1 触发（hover 出现，但不许抖）

- 「派活」为 **24×24** 图标按钮，位于成员卡**右侧垂直居中**（`right:4px; top:50%; translateY(-50%)`），圆角 6px，图标用文字 `派` 或 `↗`，`aria-label="派活"`。
- 按钮底色 **= 卡片底色** `var(--dsw-alias-bg-layer-2)`，所以它压在已被 ellipsis 截断的文字上不会糊；只在 hover 时才加 `0.5px solid var(--dsw-alias-brand-primary)` 描边。
- 常态 `opacity:0`、`pointer-events:none`；卡片 `:hover` 或 `:focus-within` 时 `opacity:1`、`pointer-events:auto`。`@media (hover:none)` 下**常驻显示**（触屏没有 hover）。
- 关键：按钮用**同色不透明底**覆盖，而不是给文字让位 —— 文字宽度不变，hover 时不会左右跳一下。

### 7.2 展开（点开之后）

| 项目 | 值 |
|---|---|
| 卡片宽度 | 展开态固定 **220px**（`min-width / max-width` 都收到 220，桌窄屏一样，靠工位条横向滚动容纳）；未展开仍是 `136–168px` |
| 卡片高度 | **不变**，用 `min-height:54px` 兜住：工位条高度恒定，消息流不会跟着上下弹 |
| 内容 | 24px 头像 + 30px 单行输入 + 24px 发送，`gap:6px`，`padding:6px 8px` |
| 动效 | **瞬时替换，不做宽度过渡、不做淡入**（实现已落地）：`overflow` 容器里做宽度动画会被裁切，瞬变反而干净。展开后 `scrollIntoView({inline:'nearest'})` 保证不被横向滚动裁掉 |
| 失败 | 卡片内换行一块 `flex:1 0 100%` 的单行错误：`10.5px` / 16px 行高、`var(--dsw-alias-state-error-primary)`，ellipsis + `title` 全文；卡片描边切 `state-error-primary`，2400ms 后回到输入态（**文本保留**） |
| 成功 | 输入行原地换成 `已派给 {名字}` `11px`、`var(--dsw-alias-state-success-primary)`，1600ms 后收起回状态行 |

### 7.3 和 `.wt-dock-cards` 横向滚动的关系

- 展开变宽只会把右边的卡推出去，容器自己滚 —— 沿用现有 `overflow-x:auto`，不新开浮层、不弹 popover。
- 注意 `overflow-x:auto` 会把 `overflow-y` 也变成 `auto`，横向滚动条出现时会吃掉 4px 垂直空间。所以展开态卡片用 `min-height:54px` 而不是固定高度，且容器保持现有 `padding-bottom:1px`、新增 `scroll-padding-inline:8px`。
- 同一时刻只允许一张卡处于展开态；展开第二张时第一张无提示收起。

### 7.4 空位卡

工位条只渲染 `members`（已入职），**空位/未入职角色不进 dock** —— 现状如此，V1.5 保持：空位卡不出现在工位条，因此没有「空的派活入口」这种反例。未入职角色的派活提示只出现在办公室面板的 `EmptyDesk` 上（`说「招」`）。

### 7.5 一个必须先解决的实现前提（设计已核对过结构）

现有 compact 卡根节点是 `<button class="wt-card">`，**button 里不能嵌 input，也不能嵌第二个 button**。所以展开态要求：

- 卡根节点改为 `<div class="wt-card" role="button" tabindex="0">`，键盘 `Enter`/`Space` 仍等于「看对话」；
- 展开后的输入面是 `<div class="wt-card wt-seat-open">`（**不是 `<form>`**，实现已按 div 落地），内部才是真正的 `<button>` / `<input>`，并进入 Tab 序列（先卡、再派活按钮、再输入、再发送）。

这条不改视觉，但不改就落不了地。

---

## 8. reduced-motion 降级

现有 `@media (prefers-reduced-motion: reduce)` 只覆盖 `.wt-avatar-svg / .wt-eyes / .wt-avatar-wrap::after / .wt-dot / .wt-bubble / .wt-sparkle`，新增选择器必须并进去（`animation:none !important; transition:none !important`）：

| 元素 | 正常 | reduced-motion |
|---|---|---|
| 浮层出现/收起 | `translateY(4px)` + `opacity` 120ms / 90ms | 直接出现/消失，**无位移无淡入** |
| 活动行跟随滚动 | `smooth` | 瞬时（`behavior:auto`） |
| 工位条展开/收起 | 瞬时替换（本来就没有宽度或淡入过渡） | 同左，这一项无需降级 |
| 成功态 `wt-sparkle` | 播放一次 1.3s | 不渲染（保留 1600ms 的 `已派给` 文案，状态靠文字表达） |
| 成功/失败停留时长 | 1600 / 2400ms | **不变**（时长不是动效，缩短反而让人看不到） |

---

## 9. 文案表（中文为主，英文并排）

| key | zh | en |
|---|---|---|
| `dispatch.label` | 派活 | Dispatch |
| `dispatch.candidates` | 选一个同事 | Pick a teammate |
| `dispatch.placeholder` | 给 {名字} 派个活… | Give {Name} a task… |
| `dispatch.send` | 发送 | Send |
| `dispatch.sent` | 已派给 {名字} | Sent to {Name} |
| `dispatch.failed` | 没派出去：{原因} | Not dispatched: {reason} |
| `dispatch.notHired` | 未入职 | Not hired |
| `dispatch.hireHint` | 说「招」 | Say “招” |

> 无匹配不出现浮层，因此**没有「没找到同事」的文案 key**（`dispatch.empty` / `dispatch.emptyHint` 已随实现一并删除，别再加回来）。

---

## 10. 实现检查清单

1. 浮层 `left:14px / bottom:8px / width:min(calc(100%-28px),560px)`、`z-index:120`（压过官方 `@` 菜单 100），不参与文档流，composer 高度不变；**没命中的 `@` 不渲染浮层**。
2. 只出现 `var(--dsw-alias-*)`；文件内任何地方没有 hex、没有新色板（含阴影，用 `color-mix` + `label-primary`）。
3. 候选行 `40px`、头像 `28px`、列表最大 `328px`（8 行）+ `min(…,45vh)`，超出滚 4px 细条。
4. 任务输入行 `44px`，发送键 `28×28` 圆角 999 贴最右，空输入时 `opacity:.4`。
5. 两种收尾都有明确落点：成功替换左半段 1600ms；失败在输入行下方 18px 一行，焦点回输入框末尾、文本保留（composer 里同时留一份 `@名字 正文` 兜底）。
6. 键盘：`↑↓` 不循环、`Enter` 提交、`Esc` 两级回退（输入态→候选态→关闭）、`Tab` 不吞、`isComposing` 期间全不拦，且**拦键前先确认焦点在 composer 编辑器内**。
7. 工位条：`24×24` 派活按钮同色底盖文字、hover/`:focus-within`/`hover:none` 三种可见性；展开固定 220px、高度不变、单卡独占、`scrollIntoView({inline:'nearest'})`。
8. `prefers-reduced-motion` 覆盖新增选择器，成功/失败停留时长保持不变。

---

**一句话交代设计意图**：浮层是 composer 卡的「上唇」—— 同宽、同左对齐、靠 8px 缝和一层浅阴影交代它是从输入框长出来的临时层，不是第二个窗口。
