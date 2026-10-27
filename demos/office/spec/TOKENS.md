# 员工办公室 · 状态与取值映射（TOKENS）

> 设计师（小设）· 2026-10-26
> 本文所有 `--dsw-alias-*` 都**真实存在于 `client.js` 的 CSS 里**，且 light/dark 取值是从主题包**实测解析**出来的，不是估的。
> 验证命令在 §6，任何人都能重跑。

---

## 0. 两条铁律

**① 身份色只上项圈，状态色只上「环 + 屏幕」。两个色系统永不共用同一个元素。**

这不是洁癖，是实测撞车：`state-warn-primary` 和 pm 的 `accent` 是同一个 `#f59e0b`；frontend `#2d7ff9` 和 business `#4176e6`、reviewer `#e04b4b` 和 error `#ec1313` 也各差一档。一旦身份色和状态色落在同一个像素上，用户就分不出「这是谁」和「他怎么了」。

**② 颜色永远不是唯一通道。** 七个状态只有五个状态色，所以每一态必须至少有两个非颜色通道（姿态 / 屏幕字形 / 轮廓虚实 / 位移）。理由同 `docs/office-sidebar-ui.md` §4.3：working 的蓝和 error 的红在红绿色盲下都是暗色块，done 的绿和 warn 的琥珀在黄绿色盲下接近。

---

## 1. 白名单：22 个 token

`client.js` 里出现过的全部 `--dsw-alias-*`，一个不多一个不少：

```
--dsw-alias-bg-base                --dsw-alias-label-caption
--dsw-alias-bg-layer-1             --dsw-alias-label-primary
--dsw-alias-bg-layer-2             --dsw-alias-label-primary-inverted
--dsw-alias-bg-layer-3             --dsw-alias-label-secondary
--dsw-alias-bg-overlay             --dsw-alias-label-tertiary
--dsw-alias-border-l1              --dsw-alias-state-business-primary
--dsw-alias-border-l2              --dsw-alias-state-error-primary
--dsw-alias-brand-primary          --dsw-alias-state-idle-primary
--dsw-alias-button-info-fill       --dsw-alias-state-success-primary
--dsw-alias-button-info-hover      --dsw-alias-state-warn-primary
--dsw-alias-interactive-bg-active  --dsw-alias-interactive-bg-hover
```

本 spec 只从这 22 个里取色。**新布局不引入任何新 token**，也不引入新色板。

---

## 2. 实测取值（light / dark）

来源：`@deepseek-ai/dsh-client-ui-theme/lib/client.js`，`body{…}` = 亮色，`body[data-ds-dark-theme]{…}` = 暗色；alias 解析到 `--dsw-static-*` 原语。

| token | light | dark | 本 spec 里用在哪 |
|---|---|---|---|
| `bg-base` | `#fff` | `#151517` | 面板底、场景地板 |
| `bg-layer-1` | `#fff` | `#232324` | 桌面（抬高面）、按钮底 |
| `bg-layer-2` | `#fff` | `#2c2c2e` | hover 底、`?` 气泡底 |
| `bg-layer-3` | `#fff` | `#353638` | 浮层底 |
| `bg-overlay` | `#e9ecf2` | `#61666b` | 设置抽屉 |
| `border-l1` | `#0000000a`（4% 黑） | `#ffffff0f`（6% 白） | 分隔线、椅背描边 |
| `border-l2` | `#0000001a`（10% 黑） | `#ffffff1f`（12% 白） | 桌沿描边、槽位虚线 |
| `brand-primary` | `#0f1115` | `#f9fafb` | **结构色**，只用于 focus 环与主按钮 |
| `button-info-fill` | `#4176e6` | `#7aaaff` | 发送键 |
| `button-info-hover` | `#7aaaff` | `#4176e6` | 发送键 hover |
| `interactive-bg-hover` | `#2631480f` | `#ffffff14` | 行 hover、走廊底 |
| `interactive-bg-active` | `#2631481a` | `#ffffff24` | 行按下、交接闪底 |
| `label-primary` | `#0f1115` | `#f9fafb` | 正文、家具叠加的基色 |
| `label-primary-inverted` | `#fff` | `#353638` | 反白字 |
| `label-secondary` | `#61666b` | `#cfd3d6` | 次行、状态文案、屏幕暗行 |
| `label-tertiary` | `#81858c` | `#adb2b8` | 图纸标注 |
| `label-caption` | `#adb2b8` | `#81858c` | placeholder |
| `state-business-primary` | `#4176e6` | `#7aaaff` | working / provisioning 环 + 光晕 |
| `state-warn-primary` | `#f59e0b` | `#f59e0b` | waiting 环 + 光晕 |
| `state-success-primary` | `#22c55e` | `#22c55e` | done 环 + ✓ |
| `state-error-primary` | `#ec1313` | `#f25a5a` | error / failed 环 + ✗ |
| `state-idle-primary` | `#d4d4d4` | `#545557` | idle 环 |

### 三条从这张表里读出来的陷阱

**陷阱 1：亮色下 `bg-layer-1/2/3` 全是 `#fff`。**
三档层次在亮色主题里**不存在**。所以场景的深度只能来自三样东西：`border-l1/l2` 的描边、`color-mix(label-primary N%, transparent)` 的墨色叠加、以及深色实物（显示器/吉祥物）本身。暗色下才有 `#232324 / #2c2c2e / #353638` 三档。
→ 落地规则：**任何"靠底色变深来分层"的画法，在亮色下都会塌。** `desk.svg` 因此把家具一律画成「描边 + 墨色实物」，不用层级底色。

**陷阱 2：`state-idle` 亮色是 `#d4d4d4`，在白底上几乎看不见。**
现有代码已经解决了：`--wt-state: color-mix(in srgb, var(--wt-raw) 70%, var(--dsw-alias-label-primary))`（`client.js:372`、`274`）。这条混色是必需的，不是可选的 —— 它把 idle 的浅灰压深到能看见。新结构必须沿用，不要直接用 `state-idle-primary` 画环或画点。

**陷阱 3：`brand-primary` 是结构色，不是状态色。**
亮色近黑、暗色近白。它可以用在 focus 环和主按钮上，**不能**用在状态上（`docs/office-sidebar-ui.md` §5 已列过五处误用）。本 spec 的状态一律走 `state-*`。

---

## 3. 七态 × 通道矩阵

「通道」列是**非颜色**通道 —— 少一个就不合格。

| 状态 | 姿态（几何） | 屏幕字形 | 环（颜色 + 动效） | 位置 / 位移 | 其他 |
|---|---|---|---|---|---|
| `idle` 待命 | 直立，基准姿态 | `#scr-idle` 两条暗线 | `state-idle` 混 70% label-primary，静 | 无 | 项圈满色；`wt-breathe 4.2s` 极轻 |
| `working` 干活 | 前倾：肩 −1.8、头 +1.6、双手在桌沿 | `#scr-working` 4 行 + 光标 | `state-business`，`wt-pulse 1.5s` | 无 | 光晕 `.16 → .95`；`wt-bob 1.15s` |
| `waiting` 等你回复 | **回头**：上身 −7°、头 −15°、露一只眼 + 鼻梁凸起 | `#scr-waiting` 一个大光标 | `state-warn`，`wt-pulse 1s` | 无 | `?` 气泡（描边式，见 §4）；`wt-wait 1.8s` |
| `done` 有新结果 | **站起来**：整体 −3.5、尾 +20° | `#scr-done` ✓ | `state-success`，实心不 pulse | 无 | ✦ `wt-sparkle 1.3s` 播一次 |
| `error` 异常结束 | 塌：头 +2、肩 +1.5、尾 −16° | `#scr-error` ✗ | `state-error`，`wt-shake .55s ×3` | 无 | 光晕降到 `.5` |
| `failed` 入职失败 | **空心头**（只描边）、无尾 | `#scr-failed` 空 + 红虚线框 | `state-error`，**虚线不转** | 无 | **无项圈**（身份没建立） |
| `provisioning` 入职中 | 虚线轮廓 + 30% 填充 | `#scr-provisioning` 骨架 + 虚线框 | `state-business`，**虚线转** `wt-spin 2.4s` | 无 | 项圈 55%；`wt-spin` 只播一次 |

**`failed` vs `provisioning` 的拆法**（最容易糊的一对）：

- failed = **空心头 + 没有项圈 + 虚线不转** → 「这个人从来没到」
- provisioning = **实心头 + 虚线描边 + 半亮项圈 + 虚线在转** → 「正在画出来」

两者共用 `#p-ghost`（虚线轮廓），但填充和项圈完全不同。灰度只出现在 failed 的项圈上 —— 项圈褪成灰 = 身份没建立，这是语义，不是滤镜。

---

## 4. 几何 token（本 spec 新增的本地变量，不依赖主题）

这些是**布局常量**，不是颜色。它们由组件自己定义，不读主题：

| 变量 | 值 | 含义 |
|---|---|---|
| `--wt-row-h` | `64px` | B 方向一行的高度（含场景 + 文字列） |
| `--wt-scene-w` | `116px` | 场景列宽（桌 + 人 + 椅） |
| `--wt-corridor-w` | `40px` | 走廊宽（32px 角色 + 4px 余量） |
| `--wt-text-w` | `124px` | 文字列（280 − 116 − 40） |
| `--wt-slot` | `32px` | 吉祥物槽位（28–32 自适应） |
| `--wt-mon-w` / `--wt-mon-h` | `78px` / `32px` | 显示器模块（屏幕内框 70×24） |
| `--wt-seat-dx` | `78px` / `−79px` | 左桌 / 右桌：工位中心 → 走廊中心的横向位移 |
| `--wt-ink` | `#171b22` | 吉祥物剪影（明暗两套同值） |
| `--wt-ink-2` | `#333d4b` | 耳内折、手（同上） |
| `--wt-ink-panel` | `#23262c` | 显示器外壳（同上） |
| `--wt-ink-screen` | `#0d1015` | 屏幕面（同上） |
| `--wt-paper` | `#f2f4f7` | 交接的纸（同上） |

**墨色家族是唯一允许的字面量。** 理由：屏幕在亮色主题里也是暗的，吉祥物剪影在暗色主题里也是暗的 —— 它们不能跟着主题反转，所以不能是 alias。

---

## 5. 动效词汇表

新增时长**全部落在既有网格上**，不引入新值。曲线只用既有的四种：`ease-out`、`ease-in`、`ease-in-out`、`linear`。

| 值 | 来源 | 用在哪 |
|---|---|---|
| `80ms` | 新增 | 信使出现/消失的淡入淡出（最轻的一档） |
| `120ms` | `wt-dispatch-in`、hover（`client.js:461`、`374`） | 行 hover |
| `160ms` | 新增 | 环切色（`border-color` / `--wt-state` 过渡） |
| `320ms` | `wt-hands` 半周期（`client.js:289`） | `→ 小前` 文字淡入（`wt-hand-in`） |
| `480ms` | `wt-flash`（`client.js:385`） | 交接行底闪底 |
| `1600ms` | `handoff` out 存活（`client.js:525`） | 交接总时长；`→ 小前` 文字停留 |
| `1300ms` | `wt-sparkle`（`client.js:447`） | done 的 ✦ |
| `1150 / 1800 / 2400 / 4200 / 5400ms` | `wt-bob` / `wt-wait` / `wt-spin` / `wt-breathe` / `wt-blink` | 各态呼吸 |
| `550ms` | `wt-shake`（`client.js:445`） | error 抖三下 |

**交接四段**（1600ms 内）：`0–200` 起身 / `200–900` 走 / `900–1150` 递交 / `1150–1600` 走回。分段依据与实现见 `DIRECTIONS.md` §4。

---

## 6. 怎么验证这份文档（可重跑）

```bash
# ① 22 个 token 是否都真的在 client.js 里
grep -o -- '--dsw-alias-[a-z0-9-]*' client.js | sort -u

# ② light/dark 真实取值（解析 alias → static 原语）
cd ~/.bun/install/global/node_modules/@deepseek-ai/dsh-client-ui-theme/lib
grep -o -- '--dsw-alias-state-business-primary:[^;]*' client.js
grep -o -- '--dsw-static-deepseek-\(400\|500\):[^;]*' client.js
# → light 走 body{...} 里的 deepseek-500=#4176e6，dark 走 body[data-ds-dark-theme]{...} 里的 deepseek-400=#7aaaff
# 只看块名：grep -o 'body[^{]*{--dsw-alias-bg-layer-1:' client.js

# ③ 状态集合与文案（回到仓库根目录再跑）
cd /home/inkedus/Code/github/dsh-work-team
grep -n "function deriveStatus" -A 8 client.js
grep -n "'status\." client.js | head -8

# ④ 交接时长
grep -n "function handoffDuration" -A 3 client.js
```

四条都能对上，才算这份 TOKENS 没有编造。**任何在 §1 名单之外的 `--dsw-alias-*` 都是伪造的**，看到就删。

---

## 7. 留给实现的三个硬约束

1. **不要用 `state-idle-primary` 直接画环或点** —— 亮色下是 `#d4d4d4`，必须混 70% `label-primary`（`client.js:372` 已有写法）。
2. **不要在亮色主题里靠 `bg-layer-*` 分层** —— 三档同值。深度只能来自描边、墨色叠加、深色实物。
3. **不要把 `brand-primary` 当状态色** —— 它是近黑/近白，和"在忙/出错"无关。
