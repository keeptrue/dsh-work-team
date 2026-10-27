# 状态点 V5.1 · 配色可分性契约

> 只出配方与数字，**未改 `client.js`**（机制与落盘是小前的）。审计脚本：`demos/office/tools/dot-audit.mjs`。
> 本文所有色值都是脚本从 `client.js` 的 CSS + `demos/office/index.html` 的 token 现算出来的，
> 一条命令可复现：`node demos/office/tools/dot-audit.mjs --proposal`。
> 色值一律 `--dsw-alias-*` + `color-mix`，**零 hex / 零 rgb() 字面量**（配方里出现的 hex 只在本文的实测列，不在 CSS 里）。

---

## 0. 结论

用户说的「颜色不好区分，是不是太深了」，**深只是表象**。三条原因分开修：

| 原因 | 修法 | 结果 |
|---|---|---|
| 一条 60/40 公式套所有状态，近黑把每个色压到 L\*≈48–61、同时掉彩度 | 每个状态一条独立配方，**L 变成第五条通道**（不再是同一个亮度） | light 的 L\* 从 38 铺到 62，dark 从 67 铺到 92 |
| `ready` 和 `done` 挤在同一个绿里（normal ΔE 0.118 / deutan 0.103） | `ready` 换到**紫红**（business + error 合成），离开绿区 177° | normal **0.303**、deutan 0.159、protan 0.245 |
| 6px 太小，1px 同色 28% 环把边缘糊掉 | 8px + **1.5px 表面色外环**（`bg-layer-1`） | 边缘对比靠"挖空"而不是靠晕开 |

**实心 6 个状态两两 ΔE（normal）最低 0.155，CVD 最低 0.091，全部过线。**

---

## 1. 基线复核（有一处要更正）

任务描述里的现状表（`working #3258a7` / `waiting #b0740e` / `done #1c8f48` / `idle #999a9b` / `error #aa1214`）
是**统一 70/30 公式**下的值——我复算过：`#3258a7` 正是 `business 70% + label-primary 30%`。
那张表来自 `/tmp/v5-harness/index.html`（生成于 07:08），而 `client.js` 在 07:18 已改成 60/40、
07:55 又改成了每状态一条（provisional）。所以「idle 2.83:1」在当前代码里已经不成立。

当前落地的 provisional 值（脚本读 `client.js` 实测）：

| 状态 | light | L\* | 对比度 |
|---|---|---|---|
| idle | `#414549` | 39 | 9.68 |
| working | `#30549f` | 46 | 7.28 |
| waiting | `#be7c0d` | 64 | 3.45 |
| done | `#1b7f42` | 53 | 5.06 |
| error | `#bb1313` | 50 | 6.52 |
| ready | `#956ba6` | 59 | 4.28 |

`node …dot-audit.mjs`（不加参数）跑这套：**5 项未达标** —— normal 0.140、deutan 0.054、protan 0.066，
`ready` 仍在绿区（色相 316° vs done 151°，但 C 只有 0.100）。所以问题不是「太深」，是**L 挤在 39–64 的中段、
彩度不够、且 ready 和 done 同族**。

---

## 2. 度量与阈值

- **对比度**：WCAG 相对亮度，light 对 `#ffffff` ≥ **3.2:1**，dark 对 `#232324` ≥ **4.5:1**。
- **可分性**：OKLab 欧氏距离（`ΔE = √(ΔL² + Δa² + Δb²)`）。阈值 normal ≥ **0.15**，deutan / protan ≥ **0.09**。
- **CVD 模拟**：线性 RGB 上的 deutan / protan 矩阵（与 `/tmp/v5-harness/cvd.mjs` 同一套），
  模拟后再算 OKLab 距离——**不是**在原色上算完打个折。
- **色相间隔**：`ready` 与 `done` 的 OKLCH 色相间隔 ≥ 25°（结构检查，防止再次撞色）。

为什么 ΔE 而不是「看着不一样」：这是唯一能在 CI 里守住的判据。0.15 大致对应「8px 圆点并排能一眼分开」，
0.09 是 CVD 下的退让线。

---

## 3. 配方表（8 状态 × 2 主题）

**light**（底 `#ffffff`）

| 状态 | 配方 | 实测 | L\* | C | H | 对比度 |
|---|---|---|---|---|---|---|
| idle | `color-mix(in srgb, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-primary))` | `#404449` | 38 | 0.009 | 253° | 9.81 |
| working | `var(--dsw-alias-state-business-primary)` | `#4176e6` | 59 | 0.179 | 263° | 4.23 |
| provisioning | `var(--dsw-alias-state-business-primary)`（空心） | `#4176e6` | 59 | 0.179 | 263° | 4.23 |
| waiting | `color-mix(in srgb, var(--dsw-alias-state-warn-primary) 56%, var(--dsw-alias-label-primary))` | `#90600f` | 53 | 0.107 | 73° | 5.44 |
| done | `color-mix(in srgb, var(--dsw-alias-state-success-primary) 79%, var(--dsw-alias-label-primary))` | `#1e9f4f` | 62 | 0.159 | 150° | 3.42 |
| error | `color-mix(in srgb, var(--dsw-alias-state-error-primary) 53%, var(--dsw-alias-label-primary))` | `#841214` | 40 | 0.148 | 27° | 10.10 |
| failed | `color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-primary))`（空心） | `#a51214` | 46 | 0.178 | 28° | 7.76 |
| ready | `color-mix(in srgb, var(--dsw-alias-state-business-primary) 54%, var(--dsw-alias-state-error-primary))` | `#904885` | 51 | 0.124 | 333° | 6.07 |

**dark**（底 `#232324`）

| 状态 | 配方 | 实测 | L\* | C | H | 对比度 |
|---|---|---|---|---|---|---|
| idle | `color-mix(in srgb, var(--dsw-alias-label-secondary) 54%, var(--dsw-alias-label-primary))` | `#e2e5e7` | 92 | 0.004 | 241° | 12.41 |
| working | `color-mix(in srgb, var(--dsw-alias-state-business-primary) 83%, var(--dsw-alias-label-primary))` | `#90b8fe` | 78 | 0.111 | 261° | 7.80 |
| provisioning | `var(--dsw-alias-state-business-primary)`（空心） | `#7aaaff` | 74 | 0.134 | 261° | 6.75 |
| waiting | `var(--dsw-alias-state-warn-primary)` | `#f59e0b` | 77 | 0.165 | 70° | 7.31 |
| done | `color-mix(in srgb, var(--dsw-alias-state-success-primary) 57%, var(--dsw-alias-label-primary))` | `#7edca2` | 82 | 0.122 | 155° | 9.44 |
| error | `var(--dsw-alias-state-error-primary)` | `#f25a5a` | 67 | 0.187 | 24° | 4.77 |
| failed | `color-mix(in srgb, var(--dsw-alias-state-error-primary) 87%, var(--dsw-alias-label-primary))`（空心） | `#f36f6f` | 70 | 0.163 | 22° | 5.46 |
| ready | `color-mix(in srgb, var(--dsw-alias-state-business-primary) 51%, var(--dsw-alias-state-error-primary))` | `#b583ae` | 67 | 0.085 | 331° | 5.09 |

读法：
- **light 的 100% 就是 token 原值**（business 原值在浅底上 4.23:1，够用，不需要压深）；
  其余都要往 `label-primary`（近黑）里压，压的比例就是「这一档要多深」。
- **dark 的锚点方向相反**：`label-primary` 在深色是近白，所以同一个"往 ink 里混"的动作在深色是**提亮**。
  `waiting` / `error` / `provisioning` 直接用原值，是因为它们本身已经在 4.5 以上。
- `ready` 两侧都是 business + error 的合成，比例不同（54/46 与 51/49），因为两个主题的蓝红亮度关系不同。

---

## 4. 可分性矩阵

**实心 6 个**（idle / working / waiting / done / error / ready）两两 ΔE：

| | light normal | light deutan | light protan | dark normal | dark deutan | dark protan |
|---|---|---|---|---|---|---|
| 最小 | **0.155** | **0.091** | **0.092** | **0.151** | **0.109** | **0.097** |
| 最小对 | idle↔error | idle↔error | idle↔error | error↔ready | idle↔done | idle↔done |
| 阈值 | 0.15 ✓ | 0.09 ✓ | 0.09 ✓ | 0.15 ✓ | 0.09 ✓ | 0.09 ✓ |

关键三对（用户投诉的正是这三对）：

| 对 | 旧（70% 公式）normal / deutan / protan | 新 light | 新 dark |
|---|---|---|---|
| ready↔done | 0.118 / 0.103 / 0.117 | **0.303** / 0.159 / 0.245 | 0.254 / 0.168 / 0.233 |
| waiting↔done | 0.176 / **0.075** / **0.048** | 0.193 / **0.091** / 0.156 | 0.204 / 0.123 / 0.158 |
| error↔ready | 0.238 / **0.076** / 0.131 | 0.171 / 0.163 / 0.202 | 0.151 / 0.126 / 0.124 |

**空心 2 个**（provisioning / failed）不进矩阵，但把数字摊开：

| 对 | light | dark | 说明 |
|---|---|---|---|
| working↔provisioning | 0.000 | 0.048 | 同色相，**形状**是唯一通道（实心 vs 空心） |
| error↔failed | 0.072 | 0.041 | 同上 |
| failed↔ready | 0.155 | 0.131 | 不同状态，靠明度差 |
| provisioning↔ready | 0.196 | 0.148 | |

这不是「漏掉的碰撞」，是**有意的分工**：`provisioning` 是「同一个 working，但还没落地」，
`failed` 是「同一个 error，但人没进来」。色相表示"哪一类事"，形状表示"落地了没有"。
两者都另有状态词在场，所以三通道（色相 / 形状 / 文字）不会同时失效。

---

## 5. 三个结构性决定

### 5.1 `ready` 必须换色相：紫红，不是绿

`ready`（已就位）原本是 `success 45% + label-secondary` —— 一个去饱和的绿，
和 `done`（有新结果，绿）在 normal 下只有 0.118。**同一个色相里放两个状态，靠明度救不回来**：
浅色主题的对比度地板把 L 压到 0.40–0.64，这么窄的带子里，两个绿最多拉开 ~0.08。

换成 business + error 的合成色（H≈333°，紫红）：

- 离 `done` 的绿 **177°**，normal ΔE 0.303（2.6 倍）；
- 在 deutan / protan 下落在**蓝紫**一侧，与黄化的 error / waiting / done 分属两个家族，
  deutan 0.159 / protan 0.245；
- 与 `error`（红，H 27°）仍隔 54°，normal 0.171 / deutan 0.163。

为什么不选靛（H≈285）：靛离 working 的蓝只有 22°，两个都是"蓝"，CVD 下几乎重合；
紫红离蓝 70°、离红 54°，是唯一同时躲开两边的位置。

### 5.2 `idle` 用「中性色的 L 极值」

`idle` 的 token 是近白（`#d4d4d4`），它是唯一一个**没有色相可用**的状态。
硬把它塞进彩色带（L 0.45–0.62）会立刻和某个彩色撞上——因为中性色的距离只能靠明度买。

所以让它占**明度极值**：light 是近黑（L\* 38，9.81:1），dark 是近白（L\* 92，12.41:1）。
一个不亮的指示灯。这样它离每一档彩色都 ≥0.155，且是唯一的中性色，类别上就不会混。

**代价（要知道）**：浅色下 idle 是全场最深的点，深色下是最亮的点——它在"重量"上不低调。
可选的替代是把它做成空心环（那它就不进 ΔE 矩阵），但 v5 的形状语义是「空心 = 还没落地/不在」，
而 idle 的人是坐在那儿的。**我选保留实心**，用极值换可分性。

### 5.3 8px + 表面色外环

- **6 → 8px**：8px 是"还能看见里面颜色"和"能被扫到"的平衡点；7px 省不下什么，10px 会挤状态词。
  桌牌仍是 28px 单行：名字（≤24px 两字）+ 5px + 点 8px + 5px + 状态词（最坏 75px）= **117px**。
  380 面板桌牌 140（内容 124）→ 117 放得下；300 面板桌牌 105（内容 89）→ 名字先让位，
  英文最长状态词 `Waiting for you` ≈75px + 18px 点距 = 93 > 89，会截到 ~71px（`Waiting for y…`）。
  这是 8px 点换来的代价，可接受：中文状态词（最长 `等你回复` ≈44px）在两档都不截。
- **环**：`box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-layer-1)` —— 一圈**表面色**，
  把点和背后的东西（桌牌闪、交接色、桌面噪点）隔开。
  原来的 `0 0 0 1px color-mix(--wt-state 28%)` 是**同色半透明**，只是把边缘晕开，边界反而更糊。
- **不变式**：这圈环必须等于桌牌背后的底色。现在桌牌没有自己的填充，背后就是 `bg-layer-1`；
  哪天桌牌加了底色，环要跟着换成那个色，否则会看到一圈"白边"。
- 空心状态（provisioning / failed / absent）继续用 `inset 0 0 0 1.5px var(--wt-state)`，**外环照留**。

---

## 6. 落盘契约

```css
/* 浅色：只动 .wt-desk，别升到全局 —— .wt-row / .wt-avatar-wrap / .wt-person 各自声明了 --wt-state */
.wt-desk.wt-st-idle { --wt-state: color-mix(in srgb, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-primary)); }
.wt-desk.wt-st-working { --wt-state: var(--dsw-alias-state-business-primary); }
.wt-desk.wt-st-provisioning { --wt-state: var(--dsw-alias-state-business-primary); }
.wt-desk.wt-st-waiting { --wt-state: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 56%, var(--dsw-alias-label-primary)); }
.wt-desk.wt-st-done { --wt-state: color-mix(in srgb, var(--dsw-alias-state-success-primary) 79%, var(--dsw-alias-label-primary)); }
.wt-desk.wt-st-error { --wt-state: color-mix(in srgb, var(--dsw-alias-state-error-primary) 53%, var(--dsw-alias-label-primary)); }
.wt-desk.wt-st-failed { --wt-state: color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-primary)); }
.wt-desk.wt-st-ready { --wt-state: color-mix(in srgb, var(--dsw-alias-state-business-primary) 54%, var(--dsw-alias-state-error-primary)); }

/* 深色：宿主是 body[data-ds-dark-theme]，demo 是 html[data-theme="dark"]，两个都认 */
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-idle { --wt-state: color-mix(in srgb, var(--dsw-alias-label-secondary) 54%, var(--dsw-alias-label-primary)); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-working { --wt-state: color-mix(in srgb, var(--dsw-alias-state-business-primary) 83%, var(--dsw-alias-label-primary)); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-provisioning { --wt-state: var(--dsw-alias-state-business-primary); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-waiting { --wt-state: var(--dsw-alias-state-warn-primary); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-done { --wt-state: color-mix(in srgb, var(--dsw-alias-state-success-primary) 57%, var(--dsw-alias-label-primary)); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-error { --wt-state: var(--dsw-alias-state-error-primary); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-failed { --wt-state: color-mix(in srgb, var(--dsw-alias-state-error-primary) 87%, var(--dsw-alias-label-primary)); }
:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-ready { --wt-state: color-mix(in srgb, var(--dsw-alias-state-business-primary) 51%, var(--dsw-alias-state-error-primary)); }
```

规则：

1. **每条都必须落在 `.wt-desk.wt-st-<status>` 上**（作用域锁死），不能写成 `.wt-st-*`。
2. 深色块必须带 `:is(body[data-ds-dark-theme], html[data-theme="dark"])` 前缀，否则 demo 和真机只亮一半。
3. 形状通道不动：`provisioning` / `failed` / `absent` 空心，`idle` 保持实心。
4. `waiting` 呼吸、交接 `out` ping、`receive` dot-take 全部保留；ping 不带 fill。

---

## 7. 审计脚本

```bash
node demos/office/tools/dot-audit.mjs              # 审计 client.js 里已落地的值（CI 用，未达标 exit 1）
node demos/office/tools/dot-audit.mjs --proposal   # 审计本文的配方（落盘前的对照）
node demos/office/tools/dot-audit.mjs --pairs      # 打印 8×8 全量 ΔE
node demos/office/tools/dot-audit.mjs --emit       # 打印可粘贴的两段 CSS
```

- 零依赖、不启浏览器：读 `client.js` 的 CSS 模板 + `demos/office/index.html` 的两套 token，
  在 Node 里按 CSS 语义求值 `color-mix`（sRGB 预乘插值，与浏览器一致）。
- 解析的是**真实选择器**：带 `data-ds-dark-theme` / `data-theme="dark"` 的规则归 dark，其余归 light。
- 同时检查几何：`.wt-desk-dot` 是否 8px、外环是否 `bg-layer-1` —— 配方对了但尺寸没落也会红。
- 当前输出：**26 项全 PASS，exit 0**。

---

## 8. 残余风险

1. **`waiting` 在 light 是深琥珀（L\* 53）**，不是亮黄。这是 CVD 三角（error / waiting / done 在
   protan 下都黄化）必须让出明度阶梯的结果：三者被排在 40 / 53 / 62。想更亮就得牺牲其中一对的可分性。
2. **`done` 在 light 只有 3.42:1**，贴着 3.2 的地板。它已经在带子最亮的一端，再亮就过不了对比度。
3. **空心对（working↔provisioning、error↔failed）的 ΔE 是 0.00–0.07**，靠形状和状态词。
   若将来给它们换成实心，必须重新跑审计。
4. **CVD 是模拟**（矩阵法），不是真人测试。它比"看截图"可靠，但替代不了色觉用户的实测；
  所以状态词永远是兜底，这条不许在后续版本里被省掉。
