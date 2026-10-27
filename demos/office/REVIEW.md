# 员工办公室 demo · 验收报告（终版）

| | |
|---|---|
| 任务 | task-3（边界 / 零依赖 / 窄栏 / 状态 / 交接 / 可访问性 / 控制台） |
| 验收人 | 小审（reviewer） |
| 复跑 | `node demos/office/check.mjs all` · `... boundary review` · `ONLY=c ... all` 只跑单个 demo |
| 边界基线 | `shots/baseline-initial.json`（01:35:18）· `shots/baseline-review.json`（01:44:11） |
| 终版数字 | `node demos/office/check.mjs all review` → **PASS 106 / FAIL 0 / WARN 0 / PENDING 0** |

**被验收的版本（sha256 前 16 位，改一个字就得重跑）**

| 文件 | size | mtime | sha256 |
|---|---|---|---|
| `a.html` | 53,304 | 01:58:10 | `b37389010bd9fed4` |
| `b.html` | 52,093 | 01:58:10 | `a2ca5afbd3497af6` |
| `c.html` | 52,710 | 02:03:13 | `e8487953b4fbfc8d` |
| `index.html` | 10,728 | 01:53:01 | `75a04c7039615e7e` |

---

## 0. 结论

| # | 检查项 | a | b | c | 证据 |
|---|---|---|---|---|---|
| 1 | 边界（没碰正式代码） | PASS | PASS | PASS | §1 |
| 2 | 零依赖（自包含单文件） | PASS | PASS | PASS | §2 |
| 3 | 窄栏 300 / 380 × light/dark | PASS | PASS | PASS | §3，12 张图 |
| 4 | 七态视觉差异 | PASS | PASS | PASS | §4 |
| 5 | 交接 ×5 次 | PASS | PASS | PASS | §5 |
| 6 | 可访问性 | PASS | PASS | PASS | §6 |
| 7 | 控制台零报错 | PASS | PASS | PASS | §7 |

> 中途出现过 2 类 WARN（c 在 380px 铭牌省略号截断 12 处、c 铭牌压相邻工位 21–33%），**已在 c.html 02:03:13 版本修掉**，复验：`ONLY=c node demos/office/check.mjs all` → PASS 35 / FAIL 0 / WARN 0，L1 在 300/380 均 0 冲突、S3 无截断。

---

## 1. 边界审计

### 一句话结论（可直接引用）

> **本次交付团队对正式代码的写入 = 0**：25 个产物全部落在 `demos/office/` 下，其中 23 个的 mtime 晚于基线（01:44:11）；正式代码区 22 个受保护文件里没有任何一个出现在我们的写入路径集合中（我们的路径集合 = `demos/office/**`，与 `client.js` / `index.js` / `lib/` / `locale/` / `docs/` / `package.json` / `test/` / `cordis.patch.yml` 无交集）。

### 事实前提

本目录**不是 git 仓库**：`git rev-parse --is-inside-work-tree` → `fatal: 不是 Git 仓库（或者任何父目录）：.git`，只有 `.gitignore`。所以「不影响 git」无法用 `git status` 证明，改用**文件级两栏基线**。

### 栏 1 · our-writes（我们的产物，25 个）

```
[PASS] B2  我们的产物全部在 demos/office/ 下（25 个）
        25 个文件全部落在 demos/office/；其中 23 个 mtime ≥ 基线 review（2026-10-26 01:44:11）
```

清单（`node demos/office/check.mjs boundary review` 实时打印，含 sha256）：
`REVIEW.md` `a.html` `b.html` `c.html` `check.mjs` `index.html`、`shots/` 下 12 张 PNG + 3 份基线/证据 JSON、`spec/` 下 4 份设计稿。

### 栏 2 · external-writes（正式代码，只记录不判 FAIL）

```
[INFO] B3  external-writes：正式代码相对基线 review 有 5 处改动（外部并发，非团队）
        client.js          133,098B → 149,433B   01:25:54 → 02:00:50
        index.js            53,428B →  53,589B   01:39:45 → 01:49:07
        README.md           33,403B →  34,563B   01:36:33 → 01:50:08
        test/client-roles.test.js  14,156B → 14,978B  01:25:00 → 01:49:12
        test/host.test.js   34,845B →  36,697B   01:37:05 → 01:50:34
[INFO] B3b 外部改动是否与我们的写入窗口重叠
        有重叠（机器上同时有人在写正式代码）；本团队的写入路径集合 = demos/office/**，与上述文件路径无交集
```

**如实记一行**：外部并发改动仍在进行（`client.js` 在 02:00:50 还在长，+16KB），**非本团队**；本机只有 1 个 `dsh web` 进程，判断来自老板自己的另一个会话/进程。

### 越界判定（唯一 FAIL 项）

```
[PASS] B1  正式代码区无白名单外新文件
        正式代码区 22 个文件，全部在白名单内
```

---

## 2. 零依赖审计

| 检查 | a | b | c | index |
|---|---|---|---|---|
| D1 无 `http(s)://` / 协议相对 URL | PASS | PASS | PASS | PASS |
| D2 无 `import` / `require` / `type=module` / `node_modules` | PASS | PASS | PASS | PASS |
| D3 无缺失的本地引用 | PASS | PASS | PASS | PASS |
| D4 无 `requestAnimationFrame`（CSS keyframes） | PASS（rAF×0） | PASS（rAF×0） | PASS（rAF×0） | PASS |
| D5 工位是 `<button>` + `aria-label` | PASS | PASS | PASS | SKIP（入口页） |
| D6 `prefers-reduced-motion` 分支 | PASS | PASS | PASS | SKIP |
| D7 六态覆盖 | PASS 6/6 | PASS 6/6 | PASS 6/6 | SKIP |
| D8 dark 机制 | `[data-theme=dark]` | `[data-theme=dark]` | `[data-theme=dark]` | `[data-theme=dark]` |

> `index.html` 是选择页（链到 a/b/c，1 个主题按钮），按入口页处理：只做 D1–D4，跳过工位/状态/交接判定。

---

## 3. 窄栏审计（12 张图）

`shots/<demo>-<width>-<theme>.png`，宽度**通过 demo 自己的 300/380 开关切换**（`.frame{width:var(--w)}`），不是只改浏览器视口 —— 早期版本只改视口会截到「300 宽框放在 380 视口里」，已修正。

| demo | 300 light | 300 dark | 380 light | 380 dark | 横向溢出 | 文字裁切 |
|---|---|---|---|---|---|---|
| a | ✅ | ✅ | ✅ | ✅ | `scrollWidth == clientWidth`（300/300、380/380），越界元素 0 | 0 |
| b | ✅ | ✅ | ✅ | ✅ | 同上 | 0 |
| c | ✅ | ✅ | ✅ | ✅ | 同上 | 0（02:03 版本已修，此前 380 下 12 处省略号截断） |

- 检查方式：`documentElement.scrollWidth <= clientWidth+1`，且遍历 `body *` 找 `right > clientWidth+1` 的元素（列出前 10 个），再找 `scrollWidth > clientWidth` 的文字节点（含 `text-overflow: ellipsis` —— 省略号把「角色/状态」吃掉等于信息缺失，同样算裁切）。
- 主题切换由脚本自动判定：三份 demo 都是 `[data-theme=dark]` 属性，脚本设属性后重截。

---

## 4. 状态审计（七态）

三份 demo 都是 **7 个状态 chip**：`idle 待命 / working 干活中 / waiting 等你回复 / done 有新结果 / error 异常结束 / failed 入职失败 / provisioning 入职中` —— 与真实 `client.js:628-636` 的 `deriveStatus` 七态一一对应。

自动判定结果（a/b/c 一致）：

```
[PASS] T1  七态齐全
[PASS] T2  任意两态至少 2 个视觉通道不同 —— 21 对全部 ≥2 通道；签名去重 7/7
[PASS] T3  七态签名互不相同 —— 去重 7/7
```

a 的通道明细（实测值，`--wt-raw` / `.glow` / `.ring` / `.leak` / `.desk` / `.bubble` / `.sparkle` / 子树动画名）：

| 态 | 色 | 显示器 | 环 | 漏光 | 桌 | 气泡 | 闪 | 动效 |
|---|---|---|---|---|---|---|---|---|
| idle | `#d4d4d4` | 0.22 | 0 | 0 | 1 | 0 | 0 | — |
| working | `#4176e6` | 0.95 | 0 | 0.9 | 1 | 0 | 0 | `wt-bob` |
| waiting | `#f59e0b` | 0.6 | 0 | 0 | 1 | 1 | 0 | `wt-wait`,`wt-bubble` |
| done | `#22c55e` | 0.75 | 0 | 0 | 1 | 0 | 0.84 | `wt-sparkle` |
| error | `#ec1313` | 0.5 | 0 | 0 | 1 | 0 | 0 | `wt-shake` |
| failed | `#ec1313` | 0 | 0 | 0 | 0.55 | 0 | 0 | — |
| provisioning | `#4176e6` | 0.15 | 1 | 0 | 1 | 0 | 0 | `wt-spin` |

`error` 与 `failed` 同为红色，但靠「显示器 0.5 vs 0」「桌面透明度 1 vs 0.55」「动效 shake vs 静止」三点区分 —— 达标。

---

## 5. 交接审计

```
[PASS] H1  a/b/c 交接触发 ×5 —— 触发入口「触发一次交接演示：阿策把文件交给老后」，成功点击 5/5
[PASS] H2  5 次都收尾 —— #1..#5 全部 1600ms
        a 动画: of-away, of-lit, of-land, of-walk, of-step, of-lift
        b/c 动画: of-away, of-lit, of-walk, of-step, of-lift, of-paper
[PASS] H3  不叠加 —— 每次峰值并发交接节点 = 1
[PASS] H4  单次 <3s
[PASS] H5  无 DOM 残留 —— 节点数 5 次后 Δ0，残留交接节点 0
[PASS] H6  交接期间控制台 0 error / 0 exception
```

- 全部是 CSS `@keyframes`，`requestAnimationFrame ×0`（D4 静态 + 运行时双重确认）。
- 判定用**增量法**：页面本来就有常驻动画（干活中的脉冲），只把「基线之外新出现的动画名」算作交接；早期版本按「running=0」判会误报卡死，已修正。
- 脚本自身双向验证过：正例（1.2s 自删节点）全 PASS；反例（每次点击塞 2 个永不删除的节点）H2/H3/H5 全 FAIL。

---

## 6. 可访问性

| 检查 | 结果 |
|---|---|
| A1 Tab 走完工位且每站焦点环可见 | PASS，a/b/c 各 22 站（含演示控制条），0 站无环 |
| A2 Tab 站数 vs 可见可聚焦元素 | PASS —— 少掉的站点是 roving tabindex 组（`tabindex=-1` + Arrow 键），属预期 |
| A5 无「看不见却能 Tab 到」的元素 | PASS，0 个 |
| A6 roving 组方向键实测可用 | PASS —— `焦点「选择 阿策」 --ArrowRight--> 「选择 小前 \| tabindex=0」` |
| A3 reduced-motion 下布局不塌 | PASS —— 36 个可聚焦元素几何零缩水（相对判定，容忍 hover 才出现的按钮） |
| A4 reduced-motion 停掉动画 | PASS —— running animations = 0 |

> 注：hover 才出现的「暂停 X」按钮仍在 Tab 序内（A1 里能看到）。不影响判定（它有焦点环、也有作用），但移植到真侧栏时建议与 `client.js:1042` 一致——把纯 hover 操作移出 Tab 序。

---

## 7. 控制台

3 个 demo × 2 宽度 × 2 主题 = 12 次加载，`Runtime.exceptionThrown` + `console.error/warn` + `Log.entryAdded(error)` 全部为 0。

> 中途抓到过一次 `ReferenceError: seatHTML is not defined`（a.html:726）——那是小前编辑过程中的**中间态文件**，不是终版缺陷；终版 12 次加载 0 报错。

---

## 8. 移植到 client.js 的风险点

| # | 风险 | 证据（现有代码） | 移植时要做什么 |
|---|---|---|---|
| R1 | 窄栏适配写成视口 `@media` | `.wt-panel` 已是 `container-type:inline-size`（`client.js:357`），断点 291/340/451/520/560/643（`353-356`、`488-497`） | demo 里按「侧栏宽度开关」做的分支，必须改成 `@container`，新断点不得与 340/520 打架 |
| R2 | 新动画没登记进 reduced-motion 白名单 | `client.js:502-508` 是选择器白名单式 `animation:none !important` | 交付时必须附「要追加的选择器清单」（demo 里的 `wt-*`、`of-*` 全套） |
| R3 | 状态机 7 态必须全对 | `deriveStatus`（`client.js:628-636`）产出 `failed/provisioning/waiting/working/done/error/idle` | demo 七态已对齐；移植时别把 `failed` 并进 `error` |
| R4 | `working` 态上线后可能永不点亮 | `client.js:620-627` 明确记录 KNOWN PLATFORM GAP：client 收不到 subagent running 信号 | 交付说明里必须写这条，否则老板验收时会以为坏了；真修需要 Host 端 liveness 接口 |
| R5 | 卸载残留 | `OfficeTab` 随 tab 切换 unmount（`client.js:2152-2157`） | demo 用了 `setTimeout`（D4 报 4 处）做交接收尾；移植时定时器必须在 effect cleanup 里清 |
| R6 | 假设固定栏宽 | `client.js` 无硬编码侧栏宽度，由 `dsh-client-ui-sidebar-right` 决定 | 用 `width:100%` + 容器查询，禁止写死 300/380 |
| R7 | 硬编码颜色 | 现有实现全用 `--dsw-alias-*`（`client.js:251`、`269`） | demo 已走 token，移植时逐个核对映射表，别留 hex |
| R8 | 自动演示默认开启 | 三份 demo 的「自动」按钮初始 `aria-pressed=true`，会持续触发交接 | 移植版**不能**自带自动演示；验收截图/自动化前必须先关（`check.mjs` 的 `calm()` 就是干这个的） |
| R9 | 侧栏框固定高度 | demo `.frame` 固定 740/756px 高、`overflow:hidden`，a/b 内部纵向滚动 = true | 真侧栏高度由容器决定，需改成 `height:100%` + 内部滚动，否则最后一行 chip 会被裁 |
| R10 | 380px 铭牌信息密度 | c 的 380 版曾把 `plate-role/plate-state` 省略号截断（42>36、32>27 等 12 处） | 移植时铭牌宽度必须由容器查询控制，宁可少显示字段也不要省略号截断 |

---

## 9. 复跑手册

```bash
cd /home/inkedus/Code/github/dsh-work-team

node demos/office/check.mjs snapshot review   # 重钉基线（正式代码停手时做）
node demos/office/check.mjs                   # 静态 + 边界（秒级）
node demos/office/check.mjs shots             # 12 张截图 + 溢出 + 控制台
node demos/office/check.mjs a11y              # Tab / 焦点环 / 方向键 / reduced-motion
node demos/office/check.mjs handoff           # 交接连点 5 次
node demos/office/check.mjs states            # 七态通道两两比对
node demos/office/check.mjs layout            # 铭牌重叠/压位 + 空间利用率
node demos/office/check.mjs all review        # 全量
ONLY=c node demos/office/check.mjs all        # 只复验某一个 demo
```

- 浏览器：`/usr/bin/google-chrome`（Chrome 154）headless + 原生 CDP；node 26 自带 `WebSocket`。**本机没有 playwright / puppeteer**（node 与 python 均 `require.resolve` MISS），所以零依赖实现。
- 截图前会自动：① 关掉「自动演示」；② 等在场交接收尾；③ 点 demo 自己的 300/380 宽度开关 —— 否则会截到中间帧或错的框宽。
- 脚本自身已验证会 FAIL（反例夹具：叠加 + 永不删除的交接节点 → H2/H3/H5 全红），不是只会打勾的摆设。

---

# 美术 v2（第二轮：角色美术重画）

> 本轮背景：老板定了 B，但否掉角色美术（「人物样式太丑，需要打磨重写」）。布局 / 动画 / 七态 / 走廊结构不动。
> 上一轮的终版结论（§0–§9）保持不变，本节只覆盖美术。

## 10. 验收口径（可测的六条）

| 编号 | 检查 | 判定线 | 命令 |
|---|---|---|---|
| V1–V3 | 32px 真尺寸下角色两两可辨 | 把每个角色的 sprite 单独放进 64×64 透明容器、按 32px 栅格化，两两比对：**差异像素占比 ≥ 6% 且均通道色差 ≥ 10** 才算可辨；任一对不达标 → FAIL | `ART_FILE=b.html node demos/office/check.mjs art` |
| V2 | 不塌成空块 | 每个 sprite 在 32×32 里「墨迹像素」（与背景色差 > 24）≥ 30 | 同上 |
| V4 | 家具四件套 | 每个工位必须能查到 桌面 / 椅背 / 显示器 / 接触阴影 四类钩子（`data-part` 或 class），缺一个 FAIL | 同上 |
| V1b | 美术画满 8 个角色 | pm/frontend/backend/reviewer/researcher/designer/ops/writer 缺一即 FAIL | 同上 |
| V6 | 同物种对没被物种特征吃掉 | 同物种最差 ≥6% 且 ≥跨物种最好的 40% | 同上 |
| V5 | waiting 不再整头旋转 | waiting 工位的 `.mascot` 子树里，`transform`/`rotate` 角度绝对值 > 1° 即记录；有 → FAIL | 同上 |
| M1–M5 | 三套对照页 | 三列 × 明暗 × 300/380：每列无横向溢出、三套 sprite 都渲染、整页无横向滚动；三列同时交接时**单列峰值必须 = 1** | `node demos/office/check.mjs mascots` |

实现细节：sprite 用「克隆到 64×64 隔离容器 + CDP clip 按 0.5 缩放截图 + canvas 取像素」拿到真渲染结果，**不走 SVG 序列化**（原图依赖 `var(--wt-ink)` 与 `<use href="#p-…">`，序列化成 `<img>` 会丢样式和 defs，测出来的差异是假的）。

## 11. 当前实测（换皮进行中，数字带版本号）

> **重要：美术是边改边测的，任何数字必须带 b.html 的 sha 前 16 位。**
> `pm↔frontend 0.0%` 这个锚点属于 **02:58 版**（sha `91789bbe34086d0d`，55086B）；**03:04 版**（sha `697ca474deb92c30`，56581B）换皮后，同一对已变成 **27.3%（light）/ 14.7%（dark）**。老板若引用「0.0%」，必须注明是旧版，否则和现在的截图对不上。

### 11.1 角色清单（美术按 8 个跑，工位按 7 个跑）

- **sprite 表必须 8 个**：`pm / frontend / backend / reviewer / researcher / designer / ops / writer`（writer=笔笔，`lib/roles.js:180`；现在没招聘，编制提高就会出现，缺一个即回归）。
- **工位断言仍是 7 个**：办公室永远只显示 7 个（lead 不进办公室；writer 未入职）。§3/§4 的「7 工位 / 0 冲突」不变。
- 当前：`[FAIL] V1b 缺 writer`（预期内，美术还没画第 8 个）。

### 11.2 32px 两两可辨（b.html @ `697ca474`，3 个状态各量一遍取最差）

| 主题 | 最差状态 | 达标 | 最小可辨对 | 不达标对 |
|---|---|---|---|---|
| light | working | **20/21** | `pm ↔ researcher` 跨物种 cat/fox，13.1% / 均色差 10.54 / IoU 0.94 | `frontend↔designer`（同物种 cat/cat）19.7% 差异但均色差仅 9.25 |
| dark | working | **19/21** | `pm ↔ researcher` 跨物种 cat/fox，6.8% / 5.49 / IoU 0.988 | `pm↔researcher` 6.8%/5.49、`frontend↔designer` 10.5%/4.93 |

逐状态最小对：`idle: pm↔researcher 14.2% ; working: pm↔researcher 13.1% ; waiting: pm↔researcher 15.2%`（light）

**读法**：light 下唯一不达标的是 `frontend↔designer`（同为 cat），差异像素 19.7% 够、但均色差 9.25 差一点 —— 说明它们靠「小面积色块」区分，面积够、颜色差不够。dark 下退化更明显：`pm↔researcher` 掉到 6.8%/5.49，**深色主题把项圈色带的对比度吃掉了**，这是本轮最该盯的点。

### 11.3 同物种 vs 跨物种（判定线：同物种最差 ≥6% 且 ≥跨物种最好的 40%）

| 主题 | 同物种最差 | 跨物种最好 | 比值 | 结论 |
|---|---|---|---|---|
| light | `frontend↔designer` 19.7% | `frontend↔ops` 45.4% | 43% | PASS |
| dark | `frontend↔designer` 10.5% | `frontend↔ops` 26.0% | 40% | PASS（压线） |

物种分布：cat = pm / frontend / designer，dog = backend / reviewer / ops，fox = researcher —— **8 个角色里 6 个挤在两个物种、每个物种 3 只**，同物种辨识是主战场。

### 11.4 其余

```
[PASS] V2  没有塌成空块的角色（所有状态墨迹像素 ≥30，最小 412）
[PASS] V4  家具四件套齐全（desk=surface chair=chair monitor=monitor shadow=ground）
[FAIL] V5  waiting 态仍有 2 处非零旋转（use=-16°，g=-3°）→ 旧的「整头 rotate 露单眼」还在
[FAIL] M6  三列 col1/col2/col3 逐位相同（0.0%/0）→ 三套美术语言还没进去
```

### 11.5 测量口径（为什么必须归一化状态）

同一套 sprite 在不同状态姿态不同。**不先把全员切到同一状态再拍，量到的是「姿态差」而不是「身份差」** —— 早期版本没归一化时，`pm↔frontend` 量出 0.0%，归一化后同状态再量是 27.3%，两次结论完全相反。现在 `art` 会先点 `[data-pick]` + `[data-state-to]` 把全员切到 `idle / working / waiting` 各量一遍，取最差状态。

## 12. 三套美术语言（spec 已落地，页面未接）

### 12.1 小设的三份图纸（03:09 落地）

| 文件 | 大小 | 结构 |
|---|---|---|
| `spec/mascot-v2-s1.svg` | 174,984B | 图纸 424×726，907 个 `<g>`，40 个 `<text>` 标签 |
| `spec/mascot-v2-s2.svg` | 189,176B | 982 个 `<g>`，40 个 `<text>` |
| `spec/mascot-v2-s3.svg` | 180,185B | 907 个 `<g>`，40 个 `<text>` |
| `spec/furniture-v2.svg` | 17,303B | 家具 v2 |

每份都自带三档对照：**8 角色 @48 · 8 角色 @32（真 32px 栅格 1:1）· 8 角色 × 7 态 @40**，角色名单里 **含 `笔笔 / writer`** —— 8 个角色齐了，V1b 的缺件问题在图纸层面已解决（页面还没接）。

三套的语言差异（图纸自述）：
- **S1 平面剪影 + 屏幕光**：一种墨色 + 单侧轮廓光 + 屏幕色渐变，没有第二档灰，32px 最稳。
- **S2 软陶质感**：三档同色系渐变 + 高光点 + 更大的头身比，最可爱，但暗色主题要单独压高光。
- **S3 线描淡彩**：1px 墨线勾边 + 角色色淡彩，最有性格，**32px 下细线会糊成灰边**（图纸自己标了这条风险）。

### 12.2 页面还是占位（M6 FAIL）

```
[FAIL] M6  三套美术语言彼此不同
        跨列对比（同一角色 pm）: col1↔col2 0.0%/0 ; col1↔col3 0.0%/10.82 ; col2↔col3 0.0%/10.82
```

- col1 与 col2 **完全一致**；col3 只有极小面积的颜色差（差异像素 0.0%，均色差 10.82）。
- `mascots.html` 列头仍写着「占位几何：等 spec/mascot-v2-s1|s2|s3.svg 到位后逐列替换」——**SVG 03:09 已到位，页面 03:04 还没接**。

其余对照页指标（03:04 版）：

```
[PASS] M1  三列 × 明暗 × 300/380：列数 3，每列 28 个 sprite（共 84）
[PASS] M2  每列无横向溢出（scrollWidth == clientWidth）
[PASS] M3  三套 sprite 都渲染
[PASS] M4  整页无横向滚动（1280/1280）
[PASS] M5  三列同时交接：单列峰值 1，全局峰值 3（不串台）
```

### 12.3 ⚠️ 提前预警：新图纸的 waiting 姿态仍会踩线

三份图纸对 waiting 的定义完全一致：

> **「回头 = 整体 −6° + 单眼 + 鼻梁凸起 + 远耳消失」**

按本轮验收线（waiting 子树里 `transform` 角度 > 1° 即 FAIL），**接上去 V5 仍然 FAIL**：它虽然从「整头 rotate」改成了「整体 −6°」，但单眼还在、非零角度还在。

这条需要 lead 定：是把判定线改成「允许整体小幅侧身（≤8°），但禁止整头单独 rotate + 单眼」，还是让美术再改。**我不自行放宽判定线。**

## 13. 新美术落地后的复跑清单

```bash
cd /home/inkedus/Code/github/dsh-work-team

node demos/office/check.mjs scope                    # a.html / c.html 不该被动
node demos/office/check.mjs spec                     # 三份美术图纸结构（8 角色 / 7 态 / 32px 真尺寸档）
ART_FILE=mascots.html node demos/office/check.mjs art # 三列 × 明暗 × 3 状态的身份可辨度
ART_FILE=b.html       node demos/office/check.mjs art # 换皮后的 b（V1b/V3/V5a-f/V6）
ART_STATES=idle,working,waiting,done,error node demos/office/check.mjs art   # 全状态扫
node demos/office/check.mjs mascots                  # 三列对照页 M1–M6
node demos/office/check.mjs all review               # 布局/状态/交接/a11y 回归（上一轮 8 个模式没动）
```

**这一轮的红线**：`a.html` / `c.html` 的 sha256 必须与 `shots/pins-round2.json`（02:57:44 钉的）一致；`b.html` 换皮允许改；新增 `mascots.html` 允许。任何其他 html 变化都要报。

---

## 14. waiting 姿态判定线 v2（lead 2026-10-26 定稿，替代旧 V5）

旧线「waiting 子树内零旋转」被否：否掉的不是旋转本身，而是**整头单独旋转导致五官错位**。新线把「读得出在看你」拆成 5 条可测项：

| 编号 | 判定 | 判定线 |
|---|---|---|
| V5a | 头组**不得**相对身体独立旋转 | `[data-part="head"]` 与 `[data-part="body"]` 角度差 > 1° 即 FAIL；缺钩子记 WARN（无法验证，不许静默通过） |
| V5b | 整体侧身 ≤ 8° | body/root 角度绝对值 > 8° 即 FAIL（−6° 在允许范围内） |
| V5c | 必须同时有「可见眼 ≥1」+「鼻尖/嘴凸起」 | 缺任一项即 FAIL（有眼没鼻=侧脸贴纸；有鼻没眼=后脑勺） |
| V5d | 气泡（?）必须存在且可见 | 缺即 FAIL |
| V5e | waiting vs idle 在 32px 下差异 ≥ 8% | 否则「回头」等于没画出来 |
| V5f | 96px 人工目检图 | `shots/art-v2-waiting-96-*.png`，机器测不出「角度对了但看着畸形」 |

**新美术必须暴露的钩子（否则 V5a/V5c/V5d 无法判定）**

```
[data-part="head"]   [data-part="body"]   [data-part="eye"]   [data-part="nose"|"muzzle"]   .bubble
```

**当前 b.html（03:04 版，旧美术）实测**

```
[WARN] V5a  7 个工位缺 [data-part=head]，无法验证
[PASS] V5b  整体角度 0°
[FAIL] V5c  眼 0/0/0/0/0/0/0；无鼻 7 个工位
[FAIL] V5d  7 个工位都缺气泡
[PASS] V5e  waiting vs idle 差异 31.7%–35%（最不明显 frontend 31.7%）
[INFO] V5f  shots/art-v2-waiting-96-b-light.png（96px）
```

**96px 目检图说明问题**：`art-v2-waiting-96-b-light.png` 里是一个没有五官的黑色后脑勺 —— 角度指标 0°（旧线会判 PASS），但肉眼一看就知道「读不出在看你」。这就是为什么必须加 V5c/V5d/V5f，光靠角度判会把「后脑勺」放过。

---

## 15. 接线验收（上一代美术 · 猫狗狐 S1，终值存档）

> 本节数字属于**上一代美术（猫狗狐）**，已被 §16 的鲸族方向取代，保留作对照基线。

### 15.1 M6 三套美术语言：PASS

```
[PASS] M6  三套美术语言彼此不同（判定线：差异像素 ≥10%）
        col1↔col2 21.0%（均色差 9.56）; col1↔col3 69.7%（110.61）; col2↔col3 70.3%（117.87）
```

三列两两都不同 —— 图纸确实接进去了。

**M6 口径变更记录（2026-10-26，lead 批准）**：判定线由「差异像素 ≥6% **且** 均色差 ≥10」改为**单通道**「差异像素 ≥10%」。
原因不是放宽，是原口径对「明暗类差异」失效：S1（平面剪影+屏幕光）与 S2（软陶三档渐变）的语言差异体现在**明暗层次**，32px 下逐像素平均色差只有 9.56，AND 逻辑会把两套明显不同的美术判成「相同」；而同一套几何被重复时，差异像素恒为 0，单看覆盖率就能干净区分（本次实测 col1↔col2 21.0%、col1↔col3 69.7%、col2↔col3 70.3%，旧版三列同为 0.0%）。均色差保留在输出里作参考，不再参与判定。

### 15.2 三套的身份可辨度（32px，3 状态取最差）

| 列 | 主题 | 达标 | 最小可辨对 | 同物种最差 / 跨物种最好 |
|---|---|---|---|---|
| **S1 (col1)** | light | **21/21** | `pm↔ops` 跨物种 cat/dog 24.9% / 23.83 | 36.7% / 52.9% = 69% |
| **S1 (col1)** | dark | **21/21** | `pm↔ops` 跨物种 cat/dog **12.3% / 11.8** | 18.5% / 27.5% = 67% |
| S2 (col2) | light | 21/21 | `pm↔frontend` 同物种 cat/cat 36.1% | 36.1% / 65.0% = 56% |
| S3 (col3) | light | 21/21 | `backend↔ops` 同物种 dog/dog 38.6% | 38.6% / 91.0% = 42% |
| S3 (col3) | dark | 21/21 | `backend↔ops` 同物种 dog/dog 19.9% | — |

**S1 对 dark 的改善成立**：同一指标下，旧美术 dark 最差是 `pm↔researcher` **6.8% / 5.49**，S1 是 `pm↔ops` **12.3% / 11.8** —— 差异像素接近翻倍、均色差翻倍。lead 关于「S1 只有光、暗色更省事」的判断在数据上成立。

### 15.3 b.html 还没接 S1

```
b.html  57,287B  sha cc79a51afb96c125  03:24   ← 无 s1 资产引用
（03:21 曾出现 192,403B 的 S1 内联版本，03:24 被回退）
mascots.html  616,593B  03:19  ← 三套已内联
```

所以 b.html 当前数字仍是旧美术：light 20/21（`frontend↔designer` 19.7%/9.25 不达标）、dark 19/21（`pm↔researcher` 6.8%/5.49、`frontend↔designer` 10.5%/4.93）。**b 的 dark 结论要等它接上 S1 才有意义。**

### 15.4 V5 六条（b.html，旧美术 + 新钩子）

```
[PASS] V5a  7 个工位头组与身体角度差 ≤1°（钩子已就位，角度沿祖先链累加后判定）
[PASS] V5b  整体角度 0°（新 pose 已不含旋转，比 ≤8° 的要求更保守）
[PASS] V5c  眼 2/2/2/2/2/2/2；无鼻 0
[FAIL] V5d  7 个工位都缺气泡 —— 根因已定位（见 15.4.1）
[PASS] V5e  waiting vs idle 差异 31.2%–36%（light）/ 16.8%–20%（dark）
[INFO] V5f  shots/art-v2-waiting-96-b-light.png
```

- 测量口径修正：姿态旋转可能挂在 `data-part` 之外的祖先 `<g>` 或 `.mascot` 包装上，现在沿祖先链累加到 `<body>` 为止；用注入 `rotate(-5deg)` 验证过能测出 −5.0，0° 是真值不是漏测。
- mascots.html 三列**没有暴露 `data-part` 钩子**，所以那里 V5a 记 WARN、V5c 记 FAIL —— 对照页可以没有钩子，但**产品页（b.html）必须有**，这条要在接线时保留。

### 15.4.1 气泡丢失的根因（已修，03:30 复验通过）

不是「新美术删了气泡」，而是**状态切换时把装饰节点一起清掉了**：

```js
// 修复前（b.html 03:24 版，第 941 行）
seat.querySelector('.mascot').innerHTML = mascotSVG(m.id, state);
// ↑ 用 SVG 字符串重写整个 .mascot，.ring / .bubble / .sparkle / .file 四个兄弟节点一起没了

// 修复后（03:30 版，第 942-943 行）
var oldSvg = seat.querySelector('.mascot .msvg');
if (oldSvg) oldSvg.outerHTML = mascotSVG(m.id, state);
// ↑ 只替换 SVG 本体，装饰节点保留
```

实测证据：页面刚加载时 `.bubble` 7 个、`.ring` 7 个；点一次状态 chip 后变成 6 / 6（每次切换少一个工位的装饰）。修复后 7 个 waiting 工位全部保留气泡，V5d 转 PASS。

> 这条也解释了为什么「刚打开有气泡、点一下就没了」——如果只看首屏截图会漏掉。**状态切换后的 DOM 才是真实状态**，这也是 `art` 模式必须先 `normalizeStates` 再采样的原因之一。

### 15.5 结论

**还不能给老板看**，两个硬条件未满足：
1. `b.html` 未接 S1（57KB 版无 s1 资产），老板打开看到的是旧美术；
2. `V5d` 气泡在新 art 里丢失（lead 判定线第 5 条）。

S1 本身的数据已经够好（light 21/21、dark 21/21、同物种最差 18.5–36.7%），接上就能交付。

---

## 16. 鲸族方向（第三代美术 · 进行中）

### 16.1 口径变更（2026-10-26，lead 定）

老板改参考 **DeepSeek 虎鲸**（`dsh-whale-widget/assets/DSniang1.png`）：navy `#080808` + 蓝族 `#485898/#5868A8/#6878B8/#7888C8` + 暖白 `#F8E8E8`。
猫狗狐线停，**S1 重做为 8 只鲸**（虎鲸/海豚/蓝鲸/独角鲸/座头鲸/白鲸/抹香鲸/灰鲸），**S2/S3 冻结**。

对验收的三条影响：

1. **M6 加代际标记**：`detectGen()` 按 token 计数判代际（whale / mammal / mixed）。三列跨代际时输出 `SKIP：N/A（跨代际，不可比）`，不给 PASS 假象 —— 鲸 vs 猫狗狐当然不同，但那不证明「三套语言成立」。
2. **新增 V7 背鳍剪影可辨**（鲸族身份的主通道）：取 32px 图**上半部分**（背鳍所在区域）二值化，两两算 IoU，报最小 IoU 与最像的一对。暂定线 **IoU ≤ 0.90**（等 lead 确认；线以上的意思是「两只鲸的背鳍轮廓基本是同一颗豆子」）。
3. **旧数字不覆盖**：§15 的 S1 猫狗狐 light 21/21、dark 21/21 已标为「上一代美术终值」，本节另起。

### 16.2 V7 基线（鲸族图纸未到，先量猫狗狐，证明指标能区分）

```
[FAIL] V7  mascots·col1 light 背鳍剪影可辨（代际 mammal）—— 最像 backend↔designer IoU 0.956，最小 0.669
[FAIL] V7  mascots·col2 light —— backend↔ops 0.910
[FAIL] V7  mascots·col3 light —— backend↔ops 0.927
```

猫狗狐没有背鳍，上半区其实是头/耳，IoU 0.91–0.96 属正常（FAIL 是因为这条线本来是给鲸族定的）。**指标本身是有效的**：同批数据最小 IoU 0.669、最大 0.956，跨度足够区分「像」与「不像」。鲸族图纸到了直接看这条。

### 16.3 当前 b.html（8ace5185，03:40，328KB，S1 已内联）

```
[PASS] V3   light 21/21，最小 pm↔ops 跨物种 cat/dog 35.9% / 35.98
[PASS] V3   dark  21/21（同批）
[PASS] V5b  整体侧身 -4°（≤8° 合规）
[PASS] V5c  眼 1/1/1/1/1/1/1（单眼，符合「回头」定义）+ 鼻 7/7
[PASS] V5d  气泡 7/7
[PASS] V5e  waiting vs idle 23.4%–34%
[PASS] V6   同物种最差 backend↔ops 40.7% vs 跨物种最好 56.4% = 72%
[FAIL] V5a  waiting：head=-12° / body=-4° → 头相对身体独立旋转 **8°**
```

**V5a 是这轮唯一的功能性阻塞**：接线引入的 waiting pose 把「整头旋转」又加回来了 ——

```js
<g data-part="head" transform="rotate(-12 32 44)">   // 头 -12°
<g data-part="body" transform="rotate(-4 32 64)">    // 身体 -4°
// 相对差 8° > 1°  → 违反 lead 规则 1（禁止整头单独旋转，旧版畸形的真正来源）
```

这是**接线层**的问题（pose 表），不是图纸问题 —— 小设的图纸写的是「整体 −6° + 单眼」，没有头独立旋转。修法：把 head 的 -12° 去掉或与 body 同步。

### 16.4 鲸族落地后的复跑顺序

```bash
ART_FILE=mascots.html node demos/office/check.mjs art   # 三列（col1 鲸 / col2-3 冻结）→ M6 应输出 N/A
ART_FILE=b.html node demos/office/check.mjs art         # V3 / V5a-f / V6 / V7
node demos/office/check.mjs mascots                     # M1-M6
node demos/office/check.mjs all review                  # 回归
```
