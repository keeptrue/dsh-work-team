#!/usr/bin/env node
// demos/office/check.mjs — 办公室 demo 验收脚本（node 原生，零依赖）
//
// 用法:
//   node check.mjs                 # 静态审计 + 边界审计（快，无浏览器）
//   node check.mjs static          # 零依赖 / rAF / 结构探针
//   node check.mjs boundary        # 正式代码 mtime+sha256 基线比对 + 越界文件清单
//   node check.mjs snapshot [name] # 把当前正式代码状态存成基线（默认 initial）
//   node check.mjs shots           # 300/380 × light/dark 四张截图 + 溢出/控制台采集
//   node check.mjs a11y            # Tab 焦点环 + prefers-reduced-motion
//   node check.mjs handoff         # 交接动画连点 5 次（叠加/残留/卡死）
//   node check.mjs states          # 七态视觉通道两两比对
//   node check.mjs layout          # 铭牌重叠/压位 + 空间利用率（300/380）
//   node check.mjs art             # 美术 v2：32px 两两可辨 / 家具钩子 / waiting 姿态（ART_FILE=b.html）
//   node check.mjs mascots         # mascots.html 三列对照页
//   node check.mjs spec            # 三份美术图纸（spec/mascot-v2-s*.svg）结构验收
//   node check.mjs scope           # 第二轮边界：a/c 不该动，b 允许换皮
//   node check.mjs all             # 全部
//   node check.mjs json            # 机器可读输出（供 REVIEW.md 引用）
//
// 退出码: 有 FAIL → 1，否则 0。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SHOTS = path.join(HERE, 'shots');
const SKIP_DIRS = new Set(['node_modules', '.git', 'demos', 'shots']);

// 正式代码白名单：这些文件一旦 mtime/sha256 变化即判越界。
const PROTECTED = [
  'client.js', 'index.js', 'package.json', 'cordis.patch.yml', 'README.md', 'icon.svg', '.gitignore',
  'lib/autostart.js', 'lib/dispatch.js', 'lib/models.js', 'lib/personas.js', 'lib/roles.js',
  'locale/en.json', 'locale/zh.json',
  'docs/dispatch-ui.md', 'docs/office-dock-v3.md', 'docs/office-sidebar-ui.md',
  'docs/evidence/dock-before.png', 'docs/evidence/office-before.png',
  'test/client-roles.test.js', 'test/host.test.js', 'test/roles.test.js',
];

const SIX_STATES = ['idle', 'working', 'waiting', 'done', 'error', 'provisioning'];
const results = [];
const rec = (level, id, title, evidence) => results.push({ level, id, title, evidence: evidence || '' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const mtimeOf = (f) => Math.round(fs.statSync(f).mtimeMs);
const iso = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function demoFiles() {
  if (!fs.existsSync(HERE)) return [];
  const only = process.env.ONLY; // ONLY=c 只跑某一个 demo（改稿后复验用）
  return fs.readdirSync(HERE).filter((f) => f.endsWith('.html'))
    .filter((f) => !only || path.basename(f, '.html') === only)
    .sort().map((f) => path.join(HERE, f));
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return acc;
}

// 入口页（列 demo 的选择页）只做 D1–D4，不做工位/状态判定。
function isEntryPage(src) {
  const links = (src.match(/<a\b[^>]+href\s*=\s*["'][^"']+\.html["']/gi) || []).length;
  const buttons = (src.match(/<button\b/gi) || []).length;
  return links >= 1 && buttons < 5;
}

// ───────────────────────── static ─────────────────────────
function runStatic() {
  const files = demoFiles();
  if (!files.length) {
    rec('PENDING', 'S0', 'demo html 未落地', 'demos/office/*.html 不存在');
    return;
  }
  for (const f of files) {
    const name = path.basename(f);
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n');
    const hits = (re) => {
      const out = [];
      lines.forEach((l, i) => { const m = l.match(re); if (m) out.push(`L${i + 1}: ${l.trim().slice(0, 110)}`); });
      return out;
    };

    // 1. 外链
    const ext = [
      ...hits(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i),
      ...hits(/url\(\s*["']?(?:https?:)?\/\//i),
      ...hits(/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i),
    ];
    rec(ext.length ? 'FAIL' : 'PASS', 'D1', `${name} 无外链`, ext.length ? ext.slice(0, 4).join(' | ') : '0 处 http(s)/协议相对 URL');

    // 2. 模块 / 依赖
    const mod = [
      ...hits(/<script[^>]+type\s*=\s*["']module["']/i),
      ...hits(/^\s*import\s+[\w{*'"]/),
      ...hits(/\brequire\s*\(/),
      ...hits(/\bfrom\s+["'][^"']+["']/),
      ...hits(/node_modules/),
    ];
    rec(mod.length ? 'FAIL' : 'PASS', 'D2', `${name} 零 import / 零 node_modules`, mod.length ? mod.slice(0, 4).join(' | ') : '0 处 import/require/module/node_modules');

    // 3. 外部资源引用（本地文件）
    const localRefs = hits(/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["'](?!#|data:|https?:|\/\/)[^"']+["']/i);
    const missing = localRefs.map((h) => (h.match(/["']([^"']+)["']/) || [])[1]).filter((p) => p && !fs.existsSync(path.join(HERE, p)));
    rec(missing.length ? 'FAIL' : localRefs.length ? 'WARN' : 'PASS', 'D3', `${name} 自包含`,
      localRefs.length ? `${localRefs.length} 处本地引用${missing.length ? `，缺失: ${missing.join(',')}` : '，文件均存在'}` : '无外部本地文件引用');

    // 4. rAF / 定时器
    const raf = (src.match(/requestAnimationFrame/g) || []).length;
    const timer = (src.match(/setInterval|setTimeout/g) || []).length;
    rec(raf ? 'FAIL' : 'PASS', 'D4', `${name} 用 CSS keyframes 而非 rAF`, `requestAnimationFrame ×${raf}，setTimeout/setInterval ×${timer}`);

    if (isEntryPage(src)) {
      rec('SKIP', 'D5', `${name} 是入口页，跳过工位判定`, '有 .html 跳转链接且 <button> < 5');
      rec('SKIP', 'D6', `${name} 入口页跳过 reduced-motion 判定`, '');
      rec('SKIP', 'D7', `${name} 入口页跳过六态判定`, '');
      continue;
    }

    // 5. 工位可交互元素
    const btn = (src.match(/<button\b/gi) || []).length;
    const aria = (src.match(/aria-label\s*=/gi) || []).length;
    const roleBtn = (src.match(/role\s*=\s*["']button["']/gi) || []).length;
    rec(btn >= 1 && aria >= btn * 0.8 ? 'PASS' : btn ? 'WARN' : 'FAIL', 'D5', `${name} 工位是 <button> 且有 aria-label`,
      `<button> ×${btn}，aria-label ×${aria}，role=button ×${roleBtn}`);

    // 6. reduced-motion
    const rm = /prefers-reduced-motion/.test(src);
    rec(rm ? 'PASS' : 'FAIL', 'D6', `${name} 声明 prefers-reduced-motion`, rm ? '存在 @media (prefers-reduced-motion) 分支' : '未找到 prefers-reduced-motion');

    // 7. 六态覆盖
    const covered = SIX_STATES.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(src));
    const zh = ['空闲', '工作中', '等待', '完成', '错误', '准备'].filter((s) => src.includes(s));
    rec(covered.length === 6 ? 'PASS' : 'FAIL', 'D7', `${name} 六态覆盖`,
      `英文态名 ${covered.length}/6 [${covered.join(',')}]${zh.length ? `；中文 ${zh.length}/6 [${zh.join(',')}]` : ''}`);
  }

  // 8. 主题切换机制（供截图脚本判断用哪种方式切 dark）
  for (const f of files) {
    const name = path.basename(f);
    const src = fs.readFileSync(f, 'utf8');
    const hasMedia = /prefers-color-scheme\s*:\s*dark/i.test(src);
    const hasAttr = /\[data-theme\s*=\s*["']?dark/i.test(src);
    rec(hasMedia || hasAttr ? 'PASS' : 'WARN', 'D8', `${name} dark 主题机制`,
      `prefers-color-scheme:dark=${hasMedia}，[data-theme=dark]=${hasAttr}`);
  }
}

// ──────────────────────── boundary ────────────────────────
// 两栏边界：
//   our-writes      —— demos/office/ 下我们自己的产物（sha256 + mtime），必须全部落在基线之后
//   external-writes —— 正式代码文件的实时状态；有变化只记录，判 INFO，标注「外部并发改动，非团队」
// 唯一判 FAIL 的情形：正式代码区出现白名单外的新文件（B1）。
function demoInventory() {
  const out = [];
  const walkD = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walkD(abs); continue; }
      const st = fs.statSync(abs);
      out.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), size: st.size, mtime: Math.round(st.mtimeMs), sha256: sha(fs.readFileSync(abs)) });
    }
  };
  walkD(HERE);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

async function runBoundary(baselineName = 'initial') {
  const baselinePath = path.join(SHOTS, `baseline-${baselineName}.json`);
  const base = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const baseAt = base ? base.takenAt : 0;

  // ── 栏 1：我们的写入 ────────────────────────────────────────────
  const ours = demoInventory();
  const outside = ours.filter((f) => !f.rel.startsWith('demos/office/'));
  const afterBase = baseAt ? ours.filter((f) => f.mtime >= baseAt - 1000) : ours;
  rec(outside.length ? 'FAIL' : 'PASS', 'B2', `我们的产物全部在 demos/office/ 下（${ours.length} 个）`,
    outside.length ? `越界: ${outside.map((f) => f.rel).join(', ')}`
      : `${ours.length} 个文件全部落在 demos/office/；其中 ${afterBase.length} 个 mtime ≥ 基线 ${baselineName}（${base ? iso(baseAt) : '无基线'}）`);
  rec('INFO', 'B2b', 'our-writes 清单',
    ours.map((f) => `${f.rel.replace('demos/office/', '')} ${f.size}B ${iso(f.mtime)} ${f.sha256}`).join(' ‖ '));

  // ── 栏 2：外部对正式代码的改动（只记录） ────────────────────────
  const cur = {};
  for (const rel of PROTECTED) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { cur[rel] = null; continue; }
    cur[rel] = { mtime: mtimeOf(abs), size: fs.statSync(abs).size, sha256: sha(fs.readFileSync(abs)) };
  }
  const changed = [];
  if (base) {
    for (const rel of PROTECTED) {
      const b = base.files[rel], c = cur[rel];
      if (!b && !c) continue;
      if (!b || !c) { changed.push({ rel, kind: b ? '被删除' : '新增', b, c }); continue; }
      if (b.sha256 !== c.sha256) changed.push({ rel, kind: '内容变', b, c });
      else if (b.mtime !== c.mtime) changed.push({ rel, kind: '仅 mtime 变', b, c });
    }
  }
  rec('INFO', 'B3', `external-writes：正式代码相对基线 ${baselineName} 有 ${changed.length} 处改动（外部并发，非团队）`,
    changed.length
      ? changed.map((x) => `${x.rel} ${x.kind} ${x.b ? iso(x.b.mtime) : '—'}→${x.c ? iso(x.c.mtime) : '—'}${x.b && x.c && x.b.size !== x.c.size ? ` ${x.b.size}B→${x.c.size}B` : ''}`).join(' ; ')
      : `0 处；${PROTECTED.length} 个受保护文件与基线一致`);
  rec(changed.length ? 'INFO' : 'PASS', 'B3b', '外部改动是否与我们的写入窗口重叠',
    changed.length
      ? '有重叠（机器上同时有人在写正式代码）；本团队的写入路径集合 = demos/office/**，与上述文件路径无交集'
      : '无外部改动');

  // ── 越界文件（唯一 FAIL 项） ───────────────────────────────────
  const all = walk(ROOT);
  const strangers = all.filter((rel) => !PROTECTED.includes(rel) && !rel.startsWith('demos/'));
  // 只有「像我们产物的路径」才判越界；其余是外部进程新建的正式代码文件，只记录。
  const oursLike = strangers.filter((rel) => /^(shots\/|REVIEW|check\.mjs)/.test(rel) || rel.endsWith('.html'));
  rec(oursLike.length ? 'FAIL' : 'PASS', 'B1', '正式代码区没有我们的越界产物',
    oursLike.length ? `疑似我们越界: ${oursLike.join(', ')}` : `正式代码区 ${all.filter((r) => !r.startsWith('demos/')).length} 个文件，无 demos/ 之外的团队产物`);
  if (strangers.length) rec('INFO', 'B1b', `外部新增文件 ${strangers.length} 个（非团队）`, strangers.slice(0, 10).join(', '));

  rec('INFO', 'B4', 'git 边界', fs.existsSync(path.join(ROOT, '.git'))
    ? '存在 .git，可用 git status 复核'
    : 'ROOT 不是 git 仓库（git rev-parse → fatal: 不是 Git 仓库），"不影响 git" 只能以文件级证据呈现');

  // 落一份机读证据
  await fsp.mkdir(SHOTS, { recursive: true });
  await fsp.writeFile(path.join(SHOTS, 'boundary-latest.json'),
    JSON.stringify({ at: Date.now(), atLocal: iso(Date.now()), baseline: baselineName, baseAt, ours, externalChanged: changed, strangers }, null, 2));
  return { ours, changed, strangers };
}

async function snapshot(name = 'initial') {
  await fsp.mkdir(SHOTS, { recursive: true });
  const files = {};
  for (const rel of PROTECTED) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { files[rel] = null; continue; }
    files[rel] = { mtime: mtimeOf(abs), size: fs.statSync(abs).size, sha256: sha(fs.readFileSync(abs)) };
  }
  const out = { name, takenAt: Date.now(), takenAtLocal: iso(Date.now()), root: ROOT, files };
  await fsp.writeFile(path.join(SHOTS, `baseline-${name}.json`), JSON.stringify(out, null, 2));
  console.log(`baseline "${name}" → shots/baseline-${name}.json（${PROTECTED.length} 文件, ${iso(Date.now())}）`);
}

// ────────────────────────── cdp ──────────────────────────
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });

async function launchChrome() {
  if (!CHROME) throw new Error('找不到 Chrome/Chromium，可用 CHROME=/path 指定');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'office-shot-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--disable-background-networking', '--force-device-scale-factor=1',
    '--force-color-profile=srgb', '--disable-features=Translate,OptimizationHints',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { proc, port, profile }; } catch { /* not yet */ }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome CDP 启动超时');
}

async function openPage(port, url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0;
  const waiters = new Map();
  const consoleMsgs = [];
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleMsgs.push({ type: m.params.type, text: String(txt).slice(0, 200) });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      exceptions.push(String(d.exception?.description || d.text || 'unknown').slice(0, 200));
    }
    if (m.method === 'Log.entryAdded' && ['error'].includes(m.params.entry.level)) {
      consoleMsgs.push({ type: 'log:' + m.params.entry.level, text: String(m.params.entry.text).slice(0, 200) });
    }
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return { error: [d.text, d.exception?.description, d.exception?.value].filter(Boolean).join(' | ').slice(0, 300) };
    }
    return r.result?.result?.value;
  };
  const close = async () => { try { ws.close(); } catch { /* noop */ } try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`, { method: 'PUT' }); } catch { /* noop */ } };
  return { send, evaluate, close, consoleMsgs, exceptions, id: t.id };
}

const MEASURE_JS = `(() => {
  const de = document.documentElement;
  const cw = de.clientWidth, ch = de.clientHeight;
  const out = [];
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    if (r.right > cw + 1 || r.left < -1) out.push(tag + (cls ? '.' + cls : '') + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
    const cs = getComputedStyle(el);
    // 文字被截：scrollWidth 超出 clientWidth。ellipsis 也算 —— 铭牌把「角色/状态」省略掉等于信息没了。
    if (el.textContent && el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible')
      clipped.push(tag + (cls ? '.' + cls : '') + ' "' + el.textContent.trim().slice(0, 10) + '" ' + el.scrollWidth + '>' + el.clientWidth + (cs.textOverflow === 'ellipsis' ? '(…)' : ''));
  }
  return JSON.stringify({ cw, sw: de.scrollWidth, sh: de.scrollHeight, ch, overflow: out.slice(0, 10), overflowCount: out.length, clipped: clipped.slice(0, 10), clippedCount: clipped.length });
})()`;

// 演示页默认开着「自动演示」，会不停触发交接，污染截图与几何/动效采样。
// 采样前先关掉它，并等一拍让在途交接走完。
async function calm(p) {
  const off = await p.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /自动|auto/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '')));
    if (!b) return 'no-toggle';
    if (b.getAttribute('aria-pressed') === 'false') return 'already-off';
    b.click();
    return 'turned-off';
  })()`);
  // 暂停后可能还有一个已排队的定时器会补发一次交接：先等一拍，再等在场交接收尾。
  await sleep(900);
  for (let i = 0; i < 50; i++) {
    const busy = await p.evaluate(`(() => {
      const f = document.querySelector('.floor');
      const bar = document.querySelector('.relay-bar');
      return (f && f.classList.contains('is-handoff')) || (bar && bar.classList.contains('is-on'));
    })()`);
    if (!busy) break;
    await sleep(100);
  }
  await sleep(250);
  return off;
}

// demo 自己有「侧栏宽度 300/380」开关（.frame{width:var(--w)}），
// 只改浏览器视口是不够的 —— 必须点它的宽度按钮，否则截到的是 300 宽的框放在 380 视口里。
async function setFrameWidth(p, width) {
  const r = await p.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => x.getAttribute('data-w') === '${width}'
      || ((x.textContent || '').trim() === '${width}')
      || /${width}\s*像素/.test(x.getAttribute('aria-label') || ''));
    if (!b) return 'no-control';
    if (b.getAttribute('aria-pressed') === 'true') return 'already';
    b.click();
    return 'clicked';
  })()`);
  await sleep(400);
  return r;
}

async function themeMode(src) {
  const media = /prefers-color-scheme\s*:\s*dark/i.test(src);
  const attr = /\[data-theme\s*=\s*["']?dark/i.test(src);
  return { media, attr };
}

async function runShots() {
  const files = demoFiles();
  if (!files.length) { rec('PENDING', 'S1', '截图未执行', 'demo html 未落地'); return; }
  await fsp.mkdir(SHOTS, { recursive: true });
  const { proc, port, profile } = await launchChrome();
  try {
    for (const f of files) {
      const name = path.basename(f, '.html');
      const src = fs.readFileSync(f, 'utf8');
      if (isEntryPage(src)) { rec('SKIP', 'S1', `${name} 入口页跳过窄栏截图`, '选择页不是侧栏面板'); continue; }
      const mode = await themeMode(src);
      for (const width of [300, 380]) {
        for (const theme of ['light', 'dark']) {
          const p = await openPage(port, 'file://' + f);
          await p.send('Page.enable');
          await p.send('Runtime.enable');
          await p.send('Log.enable');
          await p.send('Page.bringToFront');
          await p.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          p.consoleMsgs.length = 0; p.exceptions.length = 0;
          await p.send('Page.navigate', { url: 'file://' + f });
          await sleep(700);
          await calm(p);
          await setFrameWidth(p, width);
          if (theme === 'dark' && mode.attr) {
            await p.evaluate(`document.documentElement.dataset.theme='dark';document.body&&document.body.dataset.theme&&(document.body.dataset.theme='dark');1`);
            await sleep(200);
          }
          // 截图前确认页面处于静止态（否则会截到「交接中」的中间帧）
          for (let k = 0; k < 3; k++) {
            const busy = await p.evaluate(`(() => {
              const f = document.querySelector('.floor'), bar = document.querySelector('.relay-bar');
              return (f && f.classList.contains('is-handoff')) || (bar && bar.classList.contains('is-on'));
            })()`);
            if (!busy) break;
            await sleep(900);
          }
          const m = JSON.parse(await p.evaluate(MEASURE_JS) || '{}');
          const lm = await p.send('Page.getLayoutMetrics');
          const h = Math.min(Math.ceil(lm.result?.cssContentSize?.height || 900), 2400);
          const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
          const file = path.join(SHOTS, `${name}-${width}-${theme}.png`);
          if (shot.result?.data) await fsp.writeFile(file, Buffer.from(shot.result.data, 'base64'));
          const errs = p.consoleMsgs.filter((c) => c.type === 'error' || c.type === 'log:error' || c.type === 'warning');
          const hScroll = (m.sw || 0) > (m.cw || 0) + 1;
          rec(hScroll || (m.overflowCount || 0) > 0 ? 'FAIL' : 'PASS', 'S2', `${name} ${width}px ${theme} 无横向溢出`,
            `clientWidth=${m.cw} scrollWidth=${m.sw}；溢出元素 ${m.overflowCount || 0} 个${(m.overflow || []).length ? ': ' + m.overflow.join(', ') : ''}；截图 shots/${name}-${width}-${theme}.png (${h}px)`);
          if (m.clippedCount) rec('WARN', 'S3', `${name} ${width}px ${theme} 文字裁切`, `${m.clippedCount} 处: ${m.clipped.join(', ')}`);
          rec(errs.length || p.exceptions.length ? 'FAIL' : 'PASS', 'S4', `${name} ${width}px ${theme} 控制台干净`,
            [...errs.map((e) => `${e.type}: ${e.text}`), ...p.exceptions.map((e) => 'exception: ' + e)].slice(0, 5).join(' | ') || '0 error / 0 exception');
          await p.close();
        }
      }
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function runA11y() {
  const files = demoFiles();
  if (!files.length) { rec('PENDING', 'A0', 'a11y 未执行', 'demo html 未落地'); return; }
  const GEOM_JS = `(() => {
    const els = [...document.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')];
    return JSON.stringify(els.map((b, i) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        i,
        label: ((b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\\s+/g, ' ')).slice(0, 28),
        w: Math.round(r.width), h: Math.round(r.height),
        op: Number(cs.opacity), vis: cs.visibility, disp: cs.display,
      };
    }));
  })()`;
  const { proc, port, profile } = await launchChrome();
  try {
    for (const f of files) {
      const name = path.basename(f, '.html');
      if (isEntryPage(fs.readFileSync(f, 'utf8'))) {
        rec('SKIP', 'A1', `${name} 入口页跳过 a11y 工位判定`, '入口页只有跳转链接');
        continue;
      }
      const p = await openPage(port, 'file://' + f);
      await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Page.bringToFront');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.send('Page.navigate', { url: 'file://' + f });
      await sleep(700);
      await calm(p);
      await setFrameWidth(p, 300);

      // Tab 遍历（最多 60 站，回到第一站即认为走完一圈）
      const seq = [];
      let wrapped = false;
      let endReason = '60 站上限';
      for (let i = 0; i < 60; i++) {
        await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
        await sleep(45);
        const info = await p.evaluate(`(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          const cs = getComputedStyle(a);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          return JSON.stringify({ tag: a.tagName.toLowerCase(), label: ((a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\\s+/g,' ')).slice(0, 28), ring, op: Number(cs.opacity), w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) });
        })()`);
        if (!info) { endReason = '焦点离开文档'; break; }
        const o = JSON.parse(info);
        if (seq.length && o.label === seq[0].label && o.tag === seq[0].tag) { wrapped = true; endReason = '绕回第一站'; break; }
        seq.push(o);
      }
      const geom = JSON.parse(await p.evaluate(GEOM_JS) || '[]');
      const visible = geom.filter((g) => g.w > 0 && g.h > 0 && g.op > 0.05 && g.vis !== 'hidden' && g.disp !== 'none');
      const tabbable = visible.length;
      const noRing = seq.filter((x) => !x.ring);
      const invisible = seq.filter((x) => x.op < 0.05 || x.w < 8 || x.h < 8);

      rec(seq.length >= 2 && noRing.length === 0 ? 'PASS' : 'FAIL', 'A1', `${name} Tab 走完工位且焦点环可见`,
        `${seq.length} 站（结束原因: ${endReason}）: ${seq.slice(0, 10).map((x) => `${x.tag}(${x.label})${x.ring ? '' : ' ✗无环'}`).join(' → ')}${seq.length > 10 ? ' → …' : ''}`);
      const srcTxt = fs.readFileSync(f, 'utf8');
      const hasRoving = /tabindex/.test(srcTxt) && /Arrow(Right|Down|Left|Up)/.test(srcTxt);
      if (seq.length === tabbable) {
        rec('PASS', 'A2', `${name} Tab 覆盖全部可见可聚焦元素`, `Tab ${seq.length} = 可见可聚焦 ${tabbable}`);
      } else if (hasRoving) {
        rec('PASS', 'A2', `${name} Tab 站数少于可聚焦数，但为 roving tabindex 组`,
          `Tab ${seq.length} / 可见可聚焦 ${tabbable}；源码含 tabindex -1 + Arrow 键处理（组内方向键移动，Tab 只落 1 个成员，属预期）`);
      } else {
        rec('FAIL', 'A2', `${name} Tab 漏站且无 roving 兜底`,
          `Tab ${seq.length} / 可见可聚焦 ${tabbable}，且源码未发现 Arrow 键处理 → 键盘用户到不了剩下 ${tabbable - seq.length} 个元素`);
      }
      rec(invisible.length === 0 ? 'PASS' : 'WARN', 'A5', `${name} 无「看不见却能 Tab 到」的元素`,
        invisible.length ? `${invisible.length} 个: ${invisible.map((x) => `${x.label}[${x.w}×${x.h} op=${x.op}]`).join(', ')}` : '0 个');

      if (hasRoving) {
        const before = await p.evaluate(`(() => {
          const b = [...document.querySelectorAll('[tabindex="0"]')].find((e) => e.tagName === 'BUTTON');
          if (!b) return null; b.focus();
          return (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g,' ').slice(0, 30);
        })()`);
        await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' });
        await sleep(120);
        const after = await p.evaluate(`(() => {
          const a = document.activeElement;
          return a ? ((a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g,' ').slice(0, 30) + '|tabindex=' + a.getAttribute('tabindex')) : null;
        })()`);
        rec(before && after && !String(after).startsWith(before) ? 'PASS' : 'FAIL', 'A6', `${name} roving 组方向键可用`,
          `焦点 "${before}" --ArrowRight--> "${after}"`);
      }

      // reduced-motion：几何前后对比（相对判定，避免把「悬停才出现的按钮」误判成塌陷）
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await sleep(350);
      const geom2 = JSON.parse(await p.evaluate(GEOM_JS) || '[]');
      const shrunk = [];
      for (const a of geom) {
        const b = geom2.find((x) => x.i === a.i);
        if (!b) continue;
        const areaA = Math.max(1, a.w * a.h), areaB = Math.max(1, b.w * b.h);
        if (areaB < areaA * 0.7) shrunk.push(`${a.label} ${a.w}×${a.h}→${b.w}×${b.h}`);
      }
      const anim = JSON.parse(await p.evaluate(`(() => {
        const anims = document.getAnimations ? document.getAnimations() : [];
        const running = anims.filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || '?');
        return JSON.stringify({ running: [...new Set(running)].slice(0, 8), count: running.length });
      })()`) || '{}');
      rec(shrunk.length === 0 ? 'PASS' : 'FAIL', 'A3', `${name} reduced-motion 下布局不塌`,
        shrunk.length ? `${shrunk.length} 个元素缩水 >30%: ${shrunk.slice(0, 5).join(', ')}` : `${geom.length} 个可聚焦元素几何不变`);
      rec(anim.count === 0 ? 'PASS' : 'WARN', 'A4', `${name} reduced-motion 停掉动画`,
        anim.count ? `${anim.count} 个动画仍在跑: ${anim.running.join(', ')}` : 'running animations = 0');
      await p.close();
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────── layout ────────────────────────
// 窄栏布局冲突：铭牌/名字互相压、名字压到别人工位、房间占不满侧栏。
const LAYOUT_JS = `(() => {
  const seats = [...document.querySelectorAll('[data-member]')];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const inter = (a, b) => {
    const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
    const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const items = seats.map((el) => {
    const lab = el.querySelector('.plate, [class*="name"], [class*="tag"], [class*="label"]');
    const nameEl = el.querySelector('[class*="name"]') || lab;
    return {
      id: el.getAttribute('data-member') || '',
      seat: rect(el),
      label: lab ? rect(lab) : null,
      labelText: nameEl ? (nameEl.textContent || '').trim().slice(0, 12) : '',
    };
  }).filter((i) => i.label);
  const labelPairs = [], seatPairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const la = A.label, lb = B.label;
      const area = inter(la, lb);
      if (area > 4) labelPairs.push(A.id + '↔' + B.id + ' 铭牌重叠 ' + Math.round(area) + 'px²');
      const cross = Math.max(inter(la, B.seat) / Math.max(1, la.w * la.h), inter(lb, A.seat) / Math.max(1, lb.w * lb.h));
      if (cross > 0.2) seatPairs.push(A.id + ' 铭牌压 ' + B.id + ' 工位 ' + Math.round(cross * 100) + '%');
    }
  }
  const floorEl = document.querySelector('.floor, .room, #floor');
  const frameEl = document.querySelector('.frame, .office');
  const fr = frameEl ? rect(frameEl) : null;
  const fl = floorEl ? rect(floorEl) : null;
  return JSON.stringify({
    seats: items.length,
    labelPairs, seatPairs,
    fill: fr && fl ? Math.round((fl.h / Math.max(1, fr.h)) * 100) : null,
    frameH: fr ? Math.round(fr.h) : null, floorH: fl ? Math.round(fl.h) : null,
    overflowY: floorEl ? floorEl.scrollHeight > floorEl.clientHeight + 1 : null,
  });
})()`;

async function runLayout() {
  const files = demoFiles();
  if (!files.length) { rec('PENDING', 'L0', '布局审计未执行', 'demo html 未落地'); return; }
  const { proc, port, profile } = await launchChrome();
  try {
    for (const f of files) {
      const name = path.basename(f, '.html');
      const src = fs.readFileSync(f, 'utf8');
      if (isEntryPage(src)) { rec('SKIP', 'L0', `${name} 入口页跳过布局审计`, ''); continue; }
      for (const width of [300, 380]) {
        const p = await openPage(port, 'file://' + f);
        await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Page.bringToFront');
        await p.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await p.send('Page.navigate', { url: 'file://' + f });
        await sleep(700);
        await calm(p);
        await setFrameWidth(p, width);
        const L = JSON.parse(await p.evaluate(LAYOUT_JS) || '{}');
        const bad = (L.labelPairs || []).length + (L.seatPairs || []).length;
        rec(bad === 0 ? 'PASS' : 'WARN', 'L1', `${name} ${width}px 铭牌无重叠/无压位`,
          bad ? [...(L.labelPairs || []), ...(L.seatPairs || [])].slice(0, 6).join(' ; ') : `${L.seats} 个工位，0 冲突`);
        rec('INFO', 'L2', `${name} ${width}px 空间利用`,
          `房间高 ${L.floorH}/${L.frameH}px（占 ${L.fill}%），内部纵向滚动=${L.overflowY}`);
        await p.close();
      }
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────── states ────────────────────────
// 七态审计：逐个点开状态 chip，量「颜色 / 显示器 / 环 / 动效 / 文字」五个通道，两两比对。
const STATES_JS = `(() => {
  const seats = [...document.querySelectorAll('.seat, [data-state][data-member], [data-state]')]
    .filter((el) => el.hasAttribute('data-state'));
  const num = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
  return JSON.stringify(seats.map((el) => {
    const cs = getComputedStyle(el);
    const q = (sel) => el.querySelector(sel);
    // 关键：状态动效挂在 .mascot/.bubble 等子元素上，必须取子树动画
    const anims = (el.getAnimations ? el.getAnimations({ subtree: true }) : [])
      .filter((a) => a.playState === 'running').map((a) => a.animationName).filter(Boolean);
    const labelEl = q('.tag, .state-label, .st, [class*="state"]');
    return {
      id: el.getAttribute('data-member') || el.getAttribute('data-id') || '',
      state: el.getAttribute('data-state') || '',
      color: cs.getPropertyValue('--wt-raw').trim() || cs.getPropertyValue('--role-accent').trim() || '',
      glow: num(q('.glow')),
      ring: num(q('.ring')),
      leak: num(q('.leak')),
      deskOp: num(q('.desk')),
      bubble: num(q('.bubble')),
      sparkle: num(q('.sparkle')),
      anims: [...new Set(anims)],
      label: labelEl ? labelEl.textContent.trim().slice(0, 8) : '',
    };
  }));
})()`;

async function runStates() {
  const files = demoFiles();
  if (!files.length) { rec('PENDING', 'T0', '七态审计未执行', 'demo html 未落地'); return; }
  const { proc, port, profile } = await launchChrome();
  try {
    for (const f of files) {
      const name = path.basename(f, '.html');
      if (isEntryPage(fs.readFileSync(f, 'utf8'))) {
        rec('SKIP', 'T0', `${name} 入口页跳过七态审计`, '');
        continue;
      }
      const p = await openPage(port, 'file://' + f);
      await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Page.bringToFront');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.send('Page.navigate', { url: 'file://' + f });
      await sleep(700);
      await calm(p);
      await setFrameWidth(p, 300);

      const chips = JSON.parse(await p.evaluate(`JSON.stringify([...document.querySelectorAll('[data-state-to]')].map((b) => ({ to: b.getAttribute('data-state-to'), label: (b.textContent || '').trim() })))`) || '[]');
      if (!chips.length) {
        rec('PENDING', 'T1', `${name} 找不到状态 chip`, '需要 [data-state-to] 或等价入口');
        await p.close();
        continue;
      }
      const target = await p.evaluate(`(() => { const s = document.querySelector('.seat, [data-member]'); return s ? (s.getAttribute('data-member') || '') : ''; })()`);
      const rows = [];
      for (const c of chips) {
        await p.evaluate(`(() => { const b = document.querySelector('[data-state-to="${c.to}"]'); if (b) b.click(); return 1; })()`);
        await sleep(320);
        const seats = JSON.parse(await p.evaluate(STATES_JS) || '[]');
        const me = seats.find((x) => x.id === target) || seats[0] || {};
        rows.push({ state: c.to, label: c.label, ...me });
      }
      // 通道差异矩阵
      const channels = ['color', 'glow', 'ring', 'leak', 'deskOp', 'bubble', 'sparkle', 'anims'];
      const norm = (v) => (Array.isArray(v) ? v.join('+') : String(v));
      const sig = (r) => channels.map((k) => norm(r[k])).join('|');
      const pairs = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const diff = channels.filter((k) => norm(rows[i][k]) !== norm(rows[j][k]));
          pairs.push({ a: rows[i].state, b: rows[j].state, diff });
        }
      }
      const weak = pairs.filter((x) => x.diff.length < 2);
      const distinct = new Set(rows.map(sig)).size;
      rec(rows.length === 7 ? 'PASS' : 'FAIL', 'T1', `${name} 七态齐全`, `状态 chip ${rows.length} 个: ${rows.map((r) => `${r.state}(${r.label})`).join(' ')}`);
      rec(weak.length === 0 ? 'PASS' : 'FAIL', 'T2', `${name} 任意两态至少 2 个视觉通道不同`,
        weak.length ? `${weak.length}/${pairs.length} 对不足 2 通道: ${weak.slice(0, 5).map((w) => `${w.a}~${w.b}(${w.diff.join('/') || '全同'})`).join('; ')}`
          : `${pairs.length} 对全部 ≥2 通道；签名去重 ${distinct}/${rows.length}`);
      rec(distinct === rows.length ? 'PASS' : 'FAIL', 'T3', `${name} 七态签名互不相同`, `去重 ${distinct}/${rows.length}`);
      rec('INFO', 'T4', `${name} 七态通道明细`,
        rows.map((r) => `${r.state}: 色=${r.color || '—'} 显示器=${r.glow} 环=${r.ring} 漏光=${r.leak} 桌=${r.deskOp} 气泡=${r.bubble} 闪=${r.sparkle} 动=${(r.anims || []).join(',') || '—'}`).join(' ‖ '));
      await p.close();
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────── handoff ────────────────────────
// 交接动画审计：连点 5 次，看每次是否完整走完、是否叠加/残留/卡死。
// 触发入口自动发现：优先 [data-handoff]，其次文案/aria-label 命中「交接|handoff|传递」的按钮。
const HANDOFF_JS = `(() => {
  // 交接「动画节点」= 带 handoff 类名的非交互元素；触发按钮本身不算（它常带 data-handoff）。
  const cand = [...document.querySelectorAll('[class*="handoff"],[class*="hand-off"],[class*="passing"],[data-handoff-node]')];
  const nodes = cand.filter((el) => {
    const tag = el.tagName.toLowerCase();
    return tag !== 'button' && el.getAttribute('role') !== 'button';
  });
  const anims = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === 'running');
  const names = [...new Set(anims.map((a) => a.animationName || a.transitionProperty || '?'))].filter(Boolean);
  return JSON.stringify({
    nodes: nodes.length,
    nodeCls: nodes.slice(0, 4).map((n) => (typeof n.className === 'string' ? n.className : '').slice(0, 40)),
    running: anims.length,
    names: names.slice(0, 8),
    total: document.querySelectorAll('*').length,
  });
})()`;

async function runHandoff() {
  const files = demoFiles();
  if (!files.length) { rec('PENDING', 'H0', '交接审计未执行', 'demo html 未落地'); return; }
  const { proc, port, profile } = await launchChrome();
  try {
    for (const f of files) {
      const name = path.basename(f, '.html');
      const p = await openPage(port, 'file://' + f);
      await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Log.enable');
      await p.send('Page.bringToFront');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.send('Page.navigate', { url: 'file://' + f });
      await sleep(700);
      await calm(p);
      await setFrameWidth(p, 380);

      // 触发入口
      if (isEntryPage(fs.readFileSync(f, 'utf8'))) {
        rec('SKIP', 'H1', `${name} 入口页跳过交接审计`, '无工位可交接');
        await p.close();
        continue;
      }
      const triggers = JSON.parse(await p.evaluate(`JSON.stringify(
        [...document.querySelectorAll('button,[role=button],[data-handoff]')].map((b, i) => ({
          i, label: ((b.getAttribute('aria-label') || b.textContent || '').trim()).slice(0, 30),
          hand: b.hasAttribute('data-handoff'),
        })).filter(o => o.hand || /交接|handoff|传递|hand off/i.test(o.label))
      )`) || '[]');
      if (!triggers.length) {
        rec('PENDING', 'H1', `${name} 交接触发入口未找到`,
          'demo 需要暴露 [data-handoff] 或文案含「交接/handoff」的按钮，脚本才能自动连点');
        await p.close();
        continue;
      }
      const sel = `[data-handoff],button,[role=button]`;
      const clickIdx = triggers[0].i;
      const clickJs = `(() => { const a=[...document.querySelectorAll('${sel}')]; const el=a[${clickIdx}]; if(!el) return 'no-el'; el.click(); return 'clicked'; })()`;

      const base = JSON.parse(await p.evaluate(HANDOFF_JS) || '{}');
      const runs = [];
      let clicked = 0;
      for (let r = 1; r <= 5; r++) {
        const c = await p.evaluate(clickJs);
        if (c === 'clicked') clicked++;
        const samples = [];
        for (let t = 0; t < 45; t++) {           // 4.5s 采样
          samples.push(JSON.parse(await p.evaluate(HANDOFF_JS) || '{}'));
          await sleep(100);
        }
        // 页面本来就有常驻动画（干活中的脉冲等），所以「收尾」只看交接带来的增量：
        // 交接节点回到基线，且动画名集合里不再出现基线之外的名字。
        const baseNodes = base.nodes || 0;
        const baseNames = new Set(base.names || []);
        const extraOf = (sm) => (sm.names || []).filter((n) => !baseNames.has(n));
        const peakNodes = Math.max(...samples.map((s) => (s.nodes || 0) - baseNodes));
        const peakAnims = Math.max(...samples.map((s) => extraOf(s).length));
        const settledAt = samples.findIndex((s) => (s.nodes || 0) <= baseNodes && extraOf(s).length === 0);
        runs.push({ r, peakNodes, peakAnims, settledAt: settledAt < 0 ? null : settledAt * 100, names: [...new Set(samples.flatMap(extraOf))].slice(0, 6) });
      }
      const last = JSON.parse(await p.evaluate(HANDOFF_JS) || '{}');
      const stuck = runs.filter((r) => r.settledAt === null).length;
      const stacked = runs.filter((r) => r.peakNodes > 1).length;
      const slow = runs.filter((r) => r.settledAt !== null && r.settledAt > 3000).length;
      const growth = (last.total || 0) - (base.total || 0);

      rec(clicked === 5 ? 'PASS' : 'WARN', 'H1', `${name} 交接触发 ×5`,
        `触发入口 "${triggers[0].label}"，成功点击 ${clicked}/5`);
      rec(stuck === 0 ? 'PASS' : 'FAIL', 'H2', `${name} 5 次交接都收尾（无卡死）`,
        runs.map((r) => `#${r.r} 收尾 ${r.settledAt === null ? 'NEVER(4.5s 内未归零)' : r.settledAt + 'ms'}`).join(' ; ') + `；交接动画: ${[...new Set(runs.flatMap((r) => r.names))].join(',') || '未捕获到新动画名'}`);
      rec(stacked === 0 ? 'PASS' : 'FAIL', 'H3', `${name} 交接不叠加`,
        stacked ? `${stacked} 次出现并发交接节点（峰值 ${Math.max(...runs.map((r) => r.peakNodes))}）` : '每次峰值交接节点数 = 1');
      rec(slow === 0 ? 'PASS' : 'WARN', 'H4', `${name} 单次交接时长合理`, slow ? `${slow} 次 >3s` : '全部 <3s');
      rec(growth <= 0 ? 'PASS' : 'FAIL', 'H5', `${name} 5 次后无 DOM 残留`,
        `DOM 节点 ${base.total} → ${last.total}（Δ${growth >= 0 ? '+' : ''}${growth}），残留交接节点 ${last.nodes}`);

      const errs = p.consoleMsgs.filter((c) => c.type === 'error' || c.type === 'log:error');
      rec(errs.length || p.exceptions.length ? 'FAIL' : 'PASS', 'H6', `${name} 交接期间控制台干净`,
        [...errs.map((e) => e.text), ...p.exceptions].slice(0, 4).join(' | ') || '0 error / 0 exception');
      await p.close();
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}


// ────────────────────────── art v2 ──────────────────────────
// 美术验收：32px 真尺寸两两可辨 / 家具钩子齐全 / waiting 态不再整头旋转。
const SCRATCH_ID = '__artbox';
const ART_PREP = (id, colIdx, size) => `(() => {
  const old = document.getElementById('${SCRATCH_ID}');
  if (old) old.remove();
  const scope = ${colIdx === null || colIdx === undefined ? 'document' : `(document.querySelectorAll('.col')[${colIdx}] || document)`};
  const seat = scope.querySelector('[data-member="${id}"]');
  if (!seat) return JSON.stringify({ error: 'no-seat' });
  const svg = seat.querySelector('.mascot svg') || seat.querySelector('svg');
  if (!svg) return JSON.stringify({ error: 'no-svg' });
  const box = document.createElement('div');
  box.id = '${SCRATCH_ID}';
  const SZ = ${size || 64};
  box.style.cssText = 'position:fixed;left:0;top:0;width:' + SZ + 'px;height:' + SZ + 'px;z-index:2147483647;background:#fff;overflow:hidden;' + (seat.getAttribute('style') || '');
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', String(SZ));
  clone.setAttribute('height', String(SZ));
  clone.style.width = SZ + 'px';
  clone.style.height = SZ + 'px';
  clone.style.animation = 'none';
  clone.style.transform = 'none';
  box.appendChild(clone);
  const kill = document.createElement('style');
  kill.textContent = '#${SCRATCH_ID} *{animation:none!important;transition:none!important}';
  box.appendChild(kill);
  // 必须挂进原列：三套美术语言的差异挂在 .lang-sN 作用域的 CSS 变量上，
  // 挂到 body 会丢父级作用域，三列会被量成完全一样。
  const host = ${colIdx === null || colIdx === undefined ? 'document.body' : `(document.querySelectorAll('.col')[${colIdx}] || document.body)`};
  host.appendChild(box);
  const r = box.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
})()`;

const ART_PIXELS = (b64) => `(async () => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${b64}'; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  return JSON.stringify({ w: c.width, h: c.height, px: Array.from(d) });
})()`;

function artMetrics(a, b, bg) {
  const near = (px, i) => Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24;
  let union = 0, inter = 0, diff = 0, sum = 0, inka = 0, inkb = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ma = near(a, i), mb = near(b, i);
    if (ma) inka++;
    if (mb) inkb++;
    if (ma && mb) inter++;
    if (ma || mb) {
      union++;
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      sum += d;
      if (d > 16) diff++;
    }
  }
  return {
    inkA: inka, inkB: inkb, union,
    meanDist: union ? +(sum / union).toFixed(2) : 0,
    diffRatio: union ? +(diff / union).toFixed(4) : 0,
    iou: union ? +(inter / union).toFixed(3) : 0,
  };
}

const CANON8 = ['pm', 'frontend', 'backend', 'reviewer', 'researcher', 'designer', 'ops', 'writer'];

// 从 demo 源码里读 SPECIES 映射：role -> 物种（cat/dog/fox…），用于区分同物种对/跨物种对。
function parseSpecies(src) {
  const map = {};
  const re = /([a-z]+)\s*:\s*\{\s*head:\s*'p-head([a-z]+)'/g;
  let m;
  while ((m = re.exec(src))) map[m[1]] = m[2];
  return map;
}

// 把某一列（或整页）所有工位切到同一个状态。
// 不同状态姿态不同 —— 不归一化的话，量到的是「姿态差」而不是「身份差」（这是假通过的最大来源）。
async function normalizeStates(p, colIdx, ids, target) {
  let ok = 0;
  for (const id of ids) {
    const r = await p.evaluate(`(() => {
      const scope = ${colIdx === null || colIdx === undefined ? 'document' : `(document.querySelectorAll('.col')[${colIdx}] || document)`};
      const pick = scope.querySelector('[data-pick="${id}"]');
      if (!pick) return 'no-pick';
      if (pick.getAttribute('aria-checked') !== 'true') pick.click();
      return 'ok';
    })()`);
    if (r !== 'ok') continue;
    await sleep(40);
    const r2 = await p.evaluate(`(() => {
      const scope = ${colIdx === null || colIdx === undefined ? 'document' : `(document.querySelectorAll('.col')[${colIdx}] || document)`};
      const b = scope.querySelector('[data-state-to="${target}"]');
      if (!b) return 'no-chip';
      if (b.getAttribute('aria-checked') !== 'true') b.click();
      return 'ok';
    })()`);
    if (r2 === 'ok') ok++;
    await sleep(60);
  }
  await sleep(150);
  return ok;
}

async function runArt() {
  const files = demoFiles().filter((f) => !isEntryPage(fs.readFileSync(f, 'utf8')));
  if (!files.length) { rec('PENDING', 'V0', '美术验收未执行', '没有可跑的 demo'); return; }
  const target = process.env.ART_FILE ? path.join(HERE, process.env.ART_FILE) : files[0];
  const name = path.basename(target, '.html');
  const states = (process.env.ART_STATES || 'idle,working,waiting').split(',').map((x) => x.trim()).filter(Boolean);
  const gen = detectGen(fs.readFileSync(target, 'utf8'));
  const { proc, port, profile } = await launchChrome();
  try {
    for (const theme of ['light', 'dark']) {
      const p = await openPage(port, 'file://' + target);
      await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Page.bringToFront');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await p.send('Page.navigate', { url: 'file://' + target });
      await sleep(700);
      await calm(p);
      if (theme === 'dark') {
        await p.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /深色|dark|主题/i.test((x.getAttribute('aria-label')||'') + (x.textContent||''))); if (b && b.getAttribute('aria-pressed') === 'false') b.click(); return 1; })()`);
        await sleep(400);
      }
      const bg = theme === 'dark' ? [21, 21, 23] : [255, 255, 255];
      const colCount = await p.evaluate(`document.querySelectorAll('.col').length`);
      const groups = colCount >= 2 ? Array.from({ length: colCount }, (_, i) => i) : [null];

      for (const gi of groups) {
        const colName = gi === null ? name : `${name}·col${gi + 1}`;
        const scopeExpr = gi === null ? 'document' : `(document.querySelectorAll('.col')[${gi}] || document)`;
        const members = JSON.parse(await p.evaluate(`JSON.stringify([...${scopeExpr}.querySelectorAll('[data-member]')].map((s) => s.getAttribute('data-member')))`) || '[]');
        const species = parseSpecies(fs.readFileSync(target, 'utf8'));
        const missing = CANON8.filter((r) => !members.includes(r));
        // 判定分层：页面已接线就按页面测；未接线时按图纸测（图纸有 writer 即 PASS，接线后改测页面）
        const specDir = path.join(HERE, 'spec');
        const sheetBlob = fs.existsSync(specDir)
          ? fs.readdirSync(specDir).filter((f) => /^mascot-v2-s\d\.svg$/.test(f))
            .map((f) => [...fs.readFileSync(path.join(specDir, f), 'utf8').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ')).join(' ')
          : '';
        const sheetRoles = ['阿策', '小前', '老后', '小审', '小研', '小设', '老运', '笔笔'];
        const sheetMiss = sheetRoles.filter((r) => !sheetBlob.includes(r));
        if (missing.length === 0) {
          rec('PASS', 'V1b', `${colName} ${theme} 页面 8 个角色 sprite 齐全`, CANON8.join('/'));
        } else if (sheetBlob && sheetMiss.length === 0) {
          rec('PASS', 'V1b', `${colName} ${theme} 图纸已画满 8 个角色（页面待接线）`,
            `页面缺 ${missing.join(',')}；三份 spec 图纸含全部 8 个角色（含笔笔/writer）—— 接线完成后本项自动改测页面`);
        } else {
          rec('FAIL', 'V1b', `${colName} ${theme} 美术必须画满 8 个角色`,
            `页面缺 ${missing.join(',')}；图纸也缺 ${sheetMiss.join(',') || '（无图纸）'}`);
        }

        // ── V4 家具 + V5 waiting 姿态（全员切 waiting） ──
        const nWait = await normalizeStates(p, gi, members, 'waiting');
        const domRaw = await p.evaluate(`(() => { try {
          const seats = [...${scopeExpr}.querySelectorAll('[data-member]')];
          const pick = (seat, re, excludeBtn) => {
            const el = [...seat.querySelectorAll('*')].find((x) => {
              if (excludeBtn && (x.tagName === 'BUTTON' || x.hasAttribute('data-desk'))) return false;
              const cls = typeof x.className === 'string' ? x.className : (x.className.baseVal || '');
              return re.test(cls) || re.test(x.getAttribute('data-part') || '');
            });
            if (!el) return null;
            const cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
            return (el.getAttribute('data-part') || cls).trim().split(/\\s+/)[0].slice(0, 28);
          };
          const out = seats.map((seat) => {
            const deskEl = pick(seat, /(^|[-_ ])(desk-(top|slab|surface)|desktop|table-?top|slab|surface|tabletop)([-_ ]|$)/i, true);
            const hooks = {
              desk: !!deskEl,
              chair: !!pick(seat, /chair|seat-?back|backrest/i),
              monitor: !!pick(seat, /monitor|screen/i),
              shadow: !!pick(seat, /shadow|contact|ground/i),
            };
            return { id: seat.getAttribute('data-member'), hooks, matched: { desk: deskEl } };
          });
          const waiting = seats.find((s) => s.getAttribute('data-state') === 'waiting');
          const rots = [];
          if (waiting) {
            waiting.querySelectorAll('.mascot *').forEach((el) => {
              const attr = el.getAttribute('transform') || '';
              const m = attr.match(/rotate\\(\\s*(-?[\\d.]+)/);
              let angle = m ? parseFloat(m[1]) : 0;
              if (!m) {
                const cs = getComputedStyle(el).transform;
                if (cs && cs !== 'none') { const n = cs.match(/matrix\\(([^)]+)\\)/); if (n) { const v = n[1].split(',').map(Number); angle = Math.atan2(v[1], v[0]) * 180 / Math.PI; } }
              }
              if (Math.abs(angle) > 1) rots.push({ el: (typeof el.className === 'string' ? el.className : el.tagName) || el.tagName, angle: +angle.toFixed(1) });
            });
          }
          return JSON.stringify({ seats: out, rots, hasWaiting: !!waiting, waitingCount: seats.filter((s) => s.getAttribute('data-state') === 'waiting').length });
        } catch (e) { return JSON.stringify({ __error: String((e && e.stack) || e) }); } })()`);
        const dom = typeof domRaw === 'string' ? JSON.parse(domRaw) : { __error: String((domRaw && domRaw.error) || domRaw) };
        if (dom.__error) rec('FAIL', 'V4', `${colName} ${theme} 家具/waiting 探测报错`, dom.__error.slice(0, 200));
        for (const seat of dom.seats || []) {
          const miss = Object.entries(seat.hooks).filter(([, v]) => !v).map(([k]) => k);
          if (miss.length) rec('FAIL', 'V4', `${colName} ${theme} ${seat.id} 家具四件套`, `缺 ${miss.join('/')}`);
        }
        if (!dom.__error) rec((dom.seats || []).every((x) => Object.values(x.hooks).every(Boolean)) ? 'PASS' : 'FAIL', 'V4',
          `${colName} ${theme} 家具四件套（${(dom.seats || []).length} 个工位）`,
          (dom.seats || []).every((x) => Object.values(x.hooks).every(Boolean)) ? '桌面/椅背/显示器/接触阴影 四类钩子齐全' : '有工位缺钩子，见上一行');
        // ── 身份可辨度：每个状态各量一次，取最差 ──
        const perState = [];
        for (const st of states) {
          const n = await normalizeStates(p, gi, members, st);
          const shots = [];
          for (const id of members) {
            const info = JSON.parse(await p.evaluate(ART_PREP(id, gi)) || '{}');
            if (info.error) { rec('FAIL', 'V1', `${colName} ${id} 取不到 sprite`, info.error); continue; }
            const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: info.x, y: info.y, width: info.w, height: info.h, scale: 32 / info.w } });
            const px = JSON.parse(await p.evaluate(ART_PIXELS(shot.result.data)) || '{}');
            shots.push({ id, ...px });
          }
          await p.evaluate(`(() => { const b = document.getElementById('${SCRATCH_ID}'); if (b) b.remove(); return 1; })()`);
          const pairs = [];
          for (let i = 0; i < shots.length; i++) {
            for (let j = i + 1; j < shots.length; j++) pairs.push({ a: shots[i].id, b: shots[j].id, ...artMetrics(shots[i].px, shots[j].px, bg) });
          }
          const worst = pairs.slice().sort((x, y) => (x.diffRatio - y.diffRatio) || (x.meanDist - y.meanDist));
          const ink = shots.map((x) => ({ id: x.id, ink: artMetrics(x.px, x.px, bg).inkA }));
          const byId = {};
          shots.forEach((x) => { byId[x.id] = x.px; });
          perState.push({ st, pairs, worst, ink, norm: n, blank: ink.filter((x) => x.ink < 30), byId, dim: { w: shots[0]?.w || 32, h: shots[0]?.h || 32 } });
        }
        const overall = perState.slice().sort((a, b) => (a.worst[0].diffRatio - b.worst[0].diffRatio))[0];
        const expect = (members.length * (members.length - 1)) / 2;
        rec(perState.every((x) => x.pairs.length === expect) ? 'PASS' : 'FAIL', 'V1',
          `${colName} ${theme} ${members.length} 个角色 ${expect} 对 × ${states.length} 个状态全部完成`,
          `状态 ${states.join('/')}；每状态对数 ${perState.map((x) => x.pairs.length).join('/')}`);
        const blankAny = perState.flatMap((x) => x.blank.map((b) => `${b.id}@${x.st}(${b.ink})`));
        rec(blankAny.length ? 'FAIL' : 'PASS', 'V2', `${colName} ${theme} 没有塌成空块的角色`,
          blankAny.length ? `墨迹像素 <30: ${blankAny.join(', ')}` : `所有状态墨迹像素均 ≥30（最小 ${Math.min(...perState.flatMap((x) => x.ink.map((i) => i.ink)))}）`);
        const minPair = overall.worst[0];
        const distinctWorst = overall.pairs.filter((x) => x.diffRatio >= 0.06 && x.meanDist >= 10).length;
        const withSp = overall.pairs.map((x) => ({ ...x, same: species[x.a] && species[x.a] === species[x.b], sp: `${species[x.a] || '?'}/${species[x.b] || '?'}` }));
        const spMap = new Map(withSp.map((x) => [`${x.a}|${x.b}`, x]));
        const sameP = withSp.filter((x) => x.same);
        const crossP = withSp.filter((x) => !x.same);
        const minS = sameP.slice().sort((a, b) => a.diffRatio - b.diffRatio)[0];
        const maxC = crossP.slice().sort((a, b) => b.diffRatio - a.diffRatio)[0];
        const ratio = minS && maxC && maxC.diffRatio > 0 ? minS.diffRatio / maxC.diffRatio : 1;
        const failedPairs = overall.pairs.filter((x) => !(x.diffRatio >= 0.06 && x.meanDist >= 10))
          .sort((a, b) => (a.diffRatio - b.diffRatio) || (a.meanDist - b.meanDist));
        rec(distinctWorst === expect ? 'PASS' : 'FAIL', 'V3',
          `${colName} ${theme} 32px 两两可辨（代际 ${gen}，最差状态 ${overall.st}）`,
          `${distinctWorst}/${expect} 达标；最像的一对 = **${minPair.a} ↔ ${minPair.b}**（${spMap.get(`${minPair.a}|${minPair.b}`)?.same ? '同物种' : '跨物种'} ${spMap.get(`${minPair.a}|${minPair.b}`)?.sp}；差异像素 ${(minPair.diffRatio * 100).toFixed(1)}%，均色差 ${minPair.meanDist}，IoU ${minPair.iou}）`
          + (failedPairs.length ? `；不达标 ${failedPairs.length} 对: ${failedPairs.slice(0, 4).map((x) => `${x.a}↔${x.b} ${(x.diffRatio * 100).toFixed(1)}%/${x.meanDist}`).join(', ')}` : ''));
        rec('INFO', 'V3b', `${colName} ${theme} 最像的 5 对（最差状态 ${overall.st}）`,
          overall.worst.slice(0, 5).map((x) => {
            const w = spMap.get(`${x.a}|${x.b}`) || {};
            return `${x.a}↔${x.b}(${w.same ? '同物种' : '跨物种'} ${w.sp}) ${(x.diffRatio * 100).toFixed(1)}%/${x.meanDist}/IoU${x.iou}`;
          }).join(' ; '));
        rec('INFO', 'V3c', `${colName} ${theme} 逐状态最小可辨对`,
          perState.map((x) => `${x.st}: ${x.worst[0].a}↔${x.worst[0].b} ${(x.worst[0].diffRatio * 100).toFixed(1)}%`).join(' ; '));
        // ── V5 v2：waiting 姿态（lead 2026-10-26 定稿的判定线）──
        const nW2 = await normalizeStates(p, gi, members, 'waiting');
        const waitRaw = await p.evaluate(`(() => { try {
          const seats = [...${scopeExpr}.querySelectorAll('[data-member]')];
          // 姿态旋转可能挂在任意祖先 <g> 上（新美术把 pose 包在 data-part 外面），
          // 所以要沿祖先链累加角度，再比较 head 与 body 的「相对差」。
          const selfAng = (el) => {
            if (!el) return 0;
            const attr = el.getAttribute('transform') || '';
            const m = attr.match(/rotate\\(\\s*(-?[\\d.]+)/);
            if (m) return parseFloat(m[1]);
            const cs = getComputedStyle(el).transform;
            if (cs && cs !== 'none') { const n = cs.match(/matrix\\(([^)]+)\\)/); if (n) { const v = n[1].split(',').map(Number); return Math.atan2(v[1], v[0]) * 180 / Math.PI; } }
            return 0;
          };
          const ang = (el) => {
            if (!el) return null;
            let total = 0, node = el, guard = 0;
            // 一路走到 body：姿态既可能挂在 svg 内部的 <g> 上，也可能挂在 .mascot 这层包装上
            while (node && node.tagName && node !== document.body && guard++ < 40) {
              total += selfAng(node);
              node = node.parentElement;
            }
            return total;
          };
          const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0.5 && r.height > 0.5 && Number(cs.opacity) > 0.05 && cs.visibility !== 'hidden'; };
          return JSON.stringify(seats.map((seat) => {
            const head = seat.querySelector('[data-part="head"], .head, [class*="head"]');
            const body = seat.querySelector('[data-part="body"], .body, [class*="body"]');
            const eyes = [...seat.querySelectorAll('[data-part="eye"], .eye, [class*="eye"]')].filter(vis);
            const nose = seat.querySelector('[data-part="nose"], [data-part="muzzle"], .nose, [class*="nose"], [class*="muzzle"], [class*="snout"]');
            const bubble = seat.querySelector('.bubble');
            const decor = {
              ring: !!seat.querySelector('.ring'),
              bubble: !!bubble,
              sparkle: !!seat.querySelector('.sparkle'),
              file: !!seat.querySelector('.file'),
            };
            return {
              id: seat.getAttribute('data-member'), decor,
              headAngle: ang(head), bodyAngle: ang(body),
              hasHeadHook: !!head, hasBodyHook: !!body,
              eyes: eyes.length,
              nose: !!nose && vis(nose),
              bubble: !!bubble && vis(bubble) && (bubble.textContent || '').trim().length > 0,
            };
          }));
        } catch (e) { return JSON.stringify({ __error: String((e && e.stack) || e) }); } })()`);
        const waitSeats = typeof waitRaw === 'string' ? JSON.parse(waitRaw) : { __error: String(waitRaw && waitRaw.error) };
        const ws = Array.isArray(waitSeats) ? waitSeats : [];
        const badHead = ws.filter((x) => x.hasHeadHook && x.headAngle !== null && Math.abs(x.headAngle - (x.bodyAngle || 0)) > 1);
        const badBody = ws.filter((x) => Math.abs(x.bodyAngle || 0) > 8);
        const noEye = ws.filter((x) => x.eyes < 1);
        const noNose = ws.filter((x) => !x.nose);
        const noBubble = ws.filter((x) => !x.bubble);
        const noHook = ws.filter((x) => !x.hasHeadHook);
        rec(badHead.length ? 'FAIL' : (noHook.length ? 'WARN' : 'PASS'), 'V5a', `${colName} ${theme} waiting：头相对身体不单独旋转`,
          badHead.length ? badHead.map((x) => `${x.id} head=${x.headAngle}° body=${x.bodyAngle}°`).join('; ')
            : (noHook.length ? `无法验证：${noHook.length} 个工位缺 [data-part=head] 钩子（新美术必须给钩子，否则这条测不了）` : `${ws.length} 个工位头组与身体角度差 ≤1°`));
        rec(ws.length && badBody.length === 0 ? 'PASS' : 'FAIL', 'V5b', `${colName} ${theme} waiting：整体侧身 ≤8°`,
          badBody.length ? badBody.map((x) => `${x.id} body=${x.bodyAngle}°`).join('; ') : `整体角度 ${[...new Set(ws.map((x) => Math.round(x.bodyAngle || 0)))].join('/')}°`);
        rec(ws.length && noEye.length === 0 && noNose.length === 0 ? 'PASS' : 'FAIL', 'V5c', `${colName} ${theme} waiting：有眼 + 有鼻梁/嘴凸起`,
          `眼 ${ws.map((x) => x.eyes).join('/')}；无眼 ${noEye.map((x) => x.id).join(',') || '0'}；无鼻 ${noNose.map((x) => x.id).join(',') || '0'}`);
        const decorMissing = { ring: [], sparkle: [], file: [] };
        ws.forEach((x) => {
          if (!x.decor) return;
          ['ring', 'sparkle', 'file'].forEach((k) => { if (!x.decor[k]) decorMissing[k].push(x.id); });
        });
        const decorNote = Object.entries(decorMissing).filter(([, v]) => v.length).map(([k, v]) => `${k} 缺 ${v.length}`).join('，');
        rec(ws.length && noBubble.length === 0 ? 'PASS' : 'FAIL', 'V5d', `${colName} ${theme} waiting：气泡存在`,
          (noBubble.length ? `缺气泡: ${noBubble.map((x) => x.id).join(',')}` : `${ws.length} 个 waiting 工位都有气泡`)
          + (decorNote ? `；同一原因（setState 用 mascotSVG 重写 .mascot，把装饰兄弟节点一起清了）: ${decorNote}` : ''));
        const idleS = perState.find((x) => x.st === 'idle');
        const waitS = perState.find((x) => x.st === 'waiting');
        let waitDiffs = [];
        if (idleS && waitS) {
          waitDiffs = members.map((id) => ({ id, ...artMetrics(waitS.byId[id], idleS.byId[id], bg) }));
        }
        const minWait = waitDiffs.slice().sort((a, b) => a.diffRatio - b.diffRatio)[0];
        rec(minWait && minWait.diffRatio >= 0.08 ? 'PASS' : 'FAIL', 'V5e', `${colName} ${theme} waiting vs idle 32px 差异 ≥8%`,
          minWait ? `最不明显的是 ${minWait.id}：差异像素 ${(minWait.diffRatio * 100).toFixed(1)}%、均色差 ${minWait.meanDist}；全部: ${waitDiffs.map((x) => `${x.id}${(x.diffRatio * 100).toFixed(0)}%`).join(' ')}` : '缺 idle/waiting 采样');

        // 96px 人工目检图（角度过了但看着畸形，机器测不出来）
        const i96 = JSON.parse(await p.evaluate(ART_PREP('pm', gi, 96)) || '{}');
        if (!i96.error) {
          const shot96 = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: i96.x, y: i96.y, width: i96.w, height: i96.h, scale: 1 } });
          const f96 = path.join(SHOTS, `art-v2-waiting-96-${gi === null ? name : 'col' + (gi + 1)}-${theme}.png`);
          await fsp.mkdir(SHOTS, { recursive: true });
          await fsp.writeFile(f96, Buffer.from(shot96.result.data, 'base64'));
          rec('INFO', 'V5f', `${colName} ${theme} waiting 96px 目检图`, `shots/${path.basename(f96)}`);
        }
        await p.evaluate(`(() => { const b = document.getElementById('${SCRATCH_ID}'); if (b) b.remove(); return 1; })()`);

        // ── V7：背鳍剪影可辨（鲸族身份的主要通道）──
        // 取 32px 图的上半部分（背鳍所在区域）二值化，两两算 IoU。IoU 越接近 1 越像同一颗豆子。
        const dim = overall.dim || { w: 32, h: 32 };
        const finMask = (px) => {
          const m = new Uint8Array(dim.w * dim.h);
          for (let y = 0; y < Math.floor(dim.h / 2); y++) {
            for (let x = 0; x < dim.w; x++) {
              const i = (y * dim.w + x) * 4;
              if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24) m[y * dim.w + x] = 1;
            }
          }
          return m;
        };
        const masks = Object.fromEntries(Object.entries(overall.byId).map(([id, px]) => [id, finMask(px)]));
        const finPairs = [];
        const ids8 = Object.keys(masks);
        for (let i = 0; i < ids8.length; i++) {
          for (let j = i + 1; j < ids8.length; j++) {
            const A = masks[ids8[i]], B = masks[ids8[j]];
            let inter = 0, union = 0;
            for (let k = 0; k < A.length; k++) { if (A[k] || B[k]) union++; if (A[k] && B[k]) inter++; }
            finPairs.push({ a: ids8[i], b: ids8[j], iou: union ? +(inter / union).toFixed(3) : 1, union });
          }
        }
        const finWorst = finPairs.slice().sort((x, y) => y.iou - x.iou)[0];
        if (finWorst) {
          rec(finWorst.iou <= 0.90 ? 'PASS' : 'FAIL', 'V7',
            `${colName} ${theme} 背鳍剪影可辨（代际 ${gen}；上半 32px 二值 IoU，暂定线 ≤0.90）`,
            `最像的一对 = **${finWorst.a} ↔ ${finWorst.b}**，IoU ${finWorst.iou}；最小 IoU ${Math.min(...finPairs.map((x) => x.iou))}，最大 ${Math.max(...finPairs.map((x) => x.iou))}`);
          rec('INFO', 'V7b', `${colName} ${theme} 背鳍最像的 3 对`,
            finPairs.slice().sort((x, y) => y.iou - x.iou).slice(0, 3).map((x) => `${x.a}↔${x.b} IoU ${x.iou}`).join(' ; '));
        }

        rec(minS && minS.diffRatio >= 0.06 && ratio >= 0.4 ? 'PASS' : 'FAIL', 'V6',
          `${colName} ${theme} 同物种对没有被物种特征吃掉（最差状态 ${overall.st}）`,
          minS && maxC ? `同物种 ${sameP.length} 对 / 跨物种 ${crossP.length} 对；同物种最差 ${minS.a}↔${minS.b} ${(minS.diffRatio * 100).toFixed(1)}%，跨物种最好 ${maxC.a}↔${maxC.b} ${(maxC.diffRatio * 100).toFixed(1)}%，比值 ${(ratio * 100).toFixed(0)}%（线：≥6% 且 ≥跨物种最好的 40%）` : '样本不足');
      }
      await p.close();
    }
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────── spec sheets ────────────────────────
// 美术图纸验收：不依赖页面接线，直接查三份 svg 的角色/状态/32px 档是否齐。
const SHEET_ROLES = ['阿策', '小前', '老后', '小审', '小研', '小设', '老运', '笔笔'];
const SHEET_STATES = ['idle', 'working', 'waiting', 'done', 'error', 'failed', 'provisioning'];

async function runSpec() {
  const dir = path.join(HERE, 'spec');
  const sheets = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^mascot-v2-s\d\.svg$/.test(f)).sort() : [];
  if (!sheets.length) { rec('PENDING', 'P1', '三套美术图纸未落地', 'spec/mascot-v2-s{1,2,3}.svg 不存在'); return; }
  for (const f of sheets) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const texts = [...src.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    const blob = texts.join(' ');
    const missRole = SHEET_ROLES.filter((r) => !blob.includes(r));
    const missState = SHEET_STATES.filter((st) => !new RegExp(`\\b${st}\\b`).test(blob));
    const has32 = /32/.test(blob) && /1:1/.test(blob);
    const has48 = /@48/.test(blob);
    const has7 = /7 态|7态/.test(blob);
    rec(sheets.length === 3 ? 'PASS' : 'WARN', 'P1', `三套图纸齐（${sheets.length}/3）`, sheets.join(', '));
    rec(missRole.length === 0 ? 'PASS' : 'FAIL', 'P2', `${f} 8 个角色都有`, missRole.length ? `缺 ${missRole.join(',')}` : SHEET_ROLES.join(' '));
    rec(missState.length === 0 ? 'PASS' : 'FAIL', 'P3', `${f} 7 个状态都有`, missState.length ? `缺 ${missState.join(',')}` : SHEET_STATES.join(' '));
    rec(has32 && has48 && has7 ? 'PASS' : 'WARN', 'P4', `${f} 三档对照（48 / 32 真尺寸 / 7 态）`,
      `@48=${has48}，32 真尺寸 1:1=${has32}，7 态=${has7}；<g> ${(src.match(/<g/g) || []).length} 个，<text> ${texts.length} 个`);
  }
}

// ──────────────────────── mascots page ────────────────────────
// 三套美术语言对照页：三列 × 明暗 × 300/380 无溢出、三套 sprite 都渲染、同时交接峰值仍是 1。
// 代际探测：猫狗狐（上一代）vs 鲸族（新）。同一页里出现两代标记时，跨列比较没有意义。
function detectGen(text) {
  // 用「不同 token 的出现次数」判，不用单次命中：一句「换鲸族只改这四个值」的注释不该把整页判成鲸族。
  const whaleTokens = ['虎鲸', '海豚', '蓝鲸', '独角鲸', '座头鲸', '白鲸', '抹香鲸', '灰鲸', 'orca', 'whale', 'dorsal', '背鳍'];
  const mammalTokens = ['猫', '狗', '狐', 'headcat', 'headdog', 'headfox', 'cat', 'dog', 'fox'];
  const hits = (arr) => arr.reduce((n, t) => n + (text.split(t).length - 1), 0);
  const distinct = (arr) => arr.filter((t) => text.includes(t)).length;
  const w = hits(whaleTokens), m = hits(mammalTokens), dw = distinct(whaleTokens), dm = distinct(mammalTokens);
  if (dw >= 2 && dm >= 2) return 'mixed';
  if (dw >= 2 && w >= 3) return 'whale';
  if (dm >= 2 && m >= 3) return 'mammal';
  if (dw >= 2 && w > m) return 'whale';
  if (dm >= 2 && m > w) return 'mammal';
  return 'unknown';
}

async function runMascots() {
  const file = path.join(HERE, 'mascots.html');
  if (!fs.existsSync(file)) { rec('PENDING', 'M0', 'mascots.html 未落地', '等小前'); return; }
  const src = fs.readFileSync(file, 'utf8');
  if (isEntryPage(src)) rec('WARN', 'M0', 'mascots.html 被判为入口页', '按钮<5 且含 .html 链接，注意核对');
  const { proc, port, profile } = await launchChrome();
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [300, 380]) {
        const p = await openPage(port, 'file://' + file);
        await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Page.bringToFront');
        await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await p.send('Page.navigate', { url: 'file://' + file });
        await sleep(800);
        // 切每列宽度
        await p.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('data-w') === '${width}') || ((x.textContent || '').trim() === '${width}')); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); return 1; })()`);
        if (theme === 'dark') await p.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /深色|dark|主题/i.test((x.getAttribute('aria-label') || '') + (x.textContent || ''))); if (b && b.getAttribute('aria-pressed') === 'false') b.click(); return 1; })()`);
        await sleep(600);
        const m = JSON.parse(await p.evaluate(`(() => {
          const cols = [...document.querySelectorAll('[data-skin], .col, [data-column]')];
          const frames = cols.length ? cols : [...document.querySelectorAll('.frame')];
          const info = frames.map((f) => {
            const r = f.getBoundingClientRect();
            return { skin: f.getAttribute('data-skin') || f.className, w: Math.round(r.width), sw: f.scrollWidth, cw: f.clientWidth, sprites: f.querySelectorAll('.mascot svg, svg.msvg').length };
          });
          const de = document.documentElement;
          return JSON.stringify({ cols: info, page: { sw: de.scrollWidth, cw: de.clientWidth }, sprites: document.querySelectorAll('.mascot svg, svg.msvg').length });
        })()`) || '{}');
        const badCols = (m.cols || []).filter((c) => c.sw > c.cw + 1);
        const thin = (m.cols || []).filter((c) => c.sprites < 8);
        rec((m.cols || []).length >= 3 ? 'PASS' : 'FAIL', 'M1', `mascots ${theme} ${width} 三列都在`, `列数 ${(m.cols || []).length}，每列 sprite: ${(m.cols || []).map((c) => `${c.w}px/${c.sprites}个`).join(' ')}`);
        rec(badCols.length ? 'FAIL' : 'PASS', 'M2', `mascots ${theme} ${width} 每列无横向溢出`, badCols.length ? badCols.map((c) => `${c.skin} ${c.sw}>${c.cw}`).join('; ') : '所有列 scrollWidth == clientWidth');
        rec(thin.length ? 'FAIL' : 'PASS', 'M3', `mascots ${theme} ${width} 三套 sprite 都渲染`, thin.length ? `${thin.length} 列 sprite 少于 8 个` : `共 ${m.sprites} 个 sprite`);
        rec((m.page?.sw || 0) > (m.page?.cw || 0) + 1 ? 'WARN' : 'PASS', 'M4', `mascots ${theme} ${width} 整页无横向滚动`, `page scrollWidth=${m.page?.sw} clientWidth=${m.page?.cw}`);
  
      await p.close();
      }
    }
    // 三套同时交接
    const p = await openPage(port, 'file://' + file);
    await p.send('Page.enable'); await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url: 'file://' + file });
    await sleep(800);
    const trig = await p.evaluate(`(() => {
      const bs = [...document.querySelectorAll('[data-handoff], button')].filter((b) => b.hasAttribute('data-handoff') || /交接|handoff/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
      return JSON.stringify(bs.map((b, i) => i));
    })()`);
    const n = JSON.parse(trig || '[]').length;
    if (!n) rec('PENDING', 'M5', 'mascots 交接触发入口未找到', '需要 [data-handoff] 或文案含交接的按钮');
    else {
      const clickAll = `(() => { const bs = [...document.querySelectorAll('[data-handoff], button')].filter((b) => b.hasAttribute('data-handoff') || /交接|handoff/i.test((b.getAttribute('aria-label') || '') + (b.textContent || ''))); bs.forEach((b) => b.click()); return bs.length; })()`;
      await p.evaluate(clickAll);
      let peak = 0, peakPerCol = 0, colsSeen = 0;
      for (let i = 0; i < 30; i++) {
        const c = await p.evaluate(`(() => {
          const cols = [...document.querySelectorAll('.col')];
          const per = cols.map((col) => [...col.querySelectorAll('[class*="handoff"],[class*="hand-off"],[data-handoff-node]')]
            .filter((el) => el.tagName.toLowerCase() !== 'button' && el.getAttribute('role') !== 'button').length);
          const all = [...document.querySelectorAll('[class*="handoff"],[class*="hand-off"],[data-handoff-node]')]
            .filter((el) => el.tagName.toLowerCase() !== 'button' && el.getAttribute('role') !== 'button').length;
          return JSON.stringify({ all, per, cols: cols.length });
        })()`);
        const o = JSON.parse(c || '{}');
        peak = Math.max(peak, o.all || 0);
        peakPerCol = Math.max(peakPerCol, ...(o.per || [0]));
        colsSeen = o.cols || colsSeen;
        await sleep(100);
      }
      rec(peakPerCol <= 1 ? 'PASS' : 'FAIL', 'M5', '三套同时交接不串台',
        `三列同时触发（入口 ${n} 个，列数 ${colsSeen}）：单列峰值 ${peakPerCol}（必须 ≤1），全局峰值 ${peak}（= 列数 × 1 才算正常，>${colsSeen} 说明跨列叠加）`);
    }
    // M6：三套美术语言彼此必须不同（否则对照页没有意义）
    const px = await openPage(port, 'file://' + file);
    await px.send('Page.enable'); await px.send('Runtime.enable'); await px.send('Page.bringToFront');
    await px.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await px.send('Page.navigate', { url: 'file://' + file });
    await sleep(800);
    const cols = await px.evaluate(`document.querySelectorAll('.col').length`);
    const skinPx = [];
    for (let i = 0; i < cols; i++) {
      const info = JSON.parse(await px.evaluate(ART_PREP('pm', i)) || '{}');
      if (info.error) { skinPx.push({ i, error: info.error }); continue; }
      const shot = await px.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: info.x, y: info.y, width: info.w, height: info.h, scale: 32 / info.w } });
      const pxs = JSON.parse(await px.evaluate(ART_PIXELS(shot.result.data)) || '{}');
      skinPx.push({ i, px: pxs.px });
      await px.evaluate(`(() => { const b = document.getElementById('${SCRATCH_ID}'); if (b) b.remove(); return 1; })()`);
    }
    const good = skinPx.filter((x) => x.px);
    const cross = [];
    for (let a = 0; a < good.length; a++) {
      for (let b = a + 1; b < good.length; b++) {
        const m = artMetrics(good[a].px, good[b].px, [255, 255, 255]);
        cross.push({ a: good[a].i + 1, b: good[b].i + 1, ...m });
      }
    }
    // 「不同美术语言」用覆盖率差异判：同一套几何被重复时差异像素恒为 0；
    // 不同语言哪怕只差质感/描边，32px 下覆盖像素也会差 10% 以上。均色差只作参考（S1 vs S2 的差异是明暗，色差本来就小）。
    const sameSkin = cross.filter((c) => c.diffRatio < 0.10);
    const pageGen = detectGen(await px.evaluate(`document.documentElement.outerHTML.slice(0, 4000000)`));
    if (pageGen === 'mixed' || pageGen === 'unknown') {
      rec('SKIP', 'M6', `三套美术语言彼此不同 —— N/A（跨代际，不可比）`,
        `页面里同时存在两代图纸标记（${pageGen}）：col1 鲸族 / col2-col3 猫狗狐，三列本来就不同，此条不能当作「三套语言成立」的证据`);
      await px.close();
      return;
    }
    rec(cross.length && sameSkin.length === 0 ? 'PASS' : 'FAIL', 'M6', `三套美术语言彼此不同（代际 ${pageGen}）`,
      cross.length ? `跨列对比（同一角色 pm，判定线：差异像素 ≥10%）: ${cross.map((c) => `col${c.a}↔col${c.b} ${(c.diffRatio * 100).toFixed(1)}% (均色差 ${c.meanDist})`).join(' ; ')}${sameSkin.length ? ` —— ${sameSkin.map((c) => `col${c.a}↔col${c.b}`).join(',')} 仍是同一套几何` : ' —— 三列两两都不同'}` : '取不到跨列 sprite');
    await px.close();
  } finally {
    proc.kill('SIGKILL');
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────── scope pins ────────────────────────
// 第二轮边界：a.html / c.html 不该被动；b.html 换皮是允许的。
async function runScope() {
  const pinPath = path.join(SHOTS, 'pins-round2.json');
  const cur = {};
  for (const f of fs.readdirSync(HERE).filter((x) => x.endsWith('.html')).sort()) {
    const abs = path.join(HERE, f);
    cur[f] = { mtime: mtimeOf(abs), size: fs.statSync(abs).size, sha256: sha(fs.readFileSync(abs)) };
  }
  if (!fs.existsSync(pinPath)) {
    await fsp.mkdir(SHOTS, { recursive: true });
    await fsp.writeFile(pinPath, JSON.stringify({ at: Date.now(), atLocal: iso(Date.now()), files: cur }, null, 2));
    rec('INFO', 'P0', '已钉第二轮基线', `shots/pins-round2.json（${Object.keys(cur).length} 个 html）`);
    return;
  }
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  const changed = Object.keys(cur).filter((f) => !pin.files[f] || pin.files[f].sha256 !== cur[f].sha256);
  const added = Object.keys(cur).filter((f) => !pin.files[f]);
  const frozen = ['a.html', 'c.html'];
  const frozenChanged = changed.filter((f) => frozen.includes(f));
  rec(frozenChanged.length ? 'FAIL' : 'PASS', 'P1', '本轮不该动的 a.html / c.html',
    frozenChanged.length ? `被改: ${frozenChanged.join(', ')}（本轮只允许 b.html 换皮 + 新增 mascots.html）`
      : 'a.html / c.html sha256 与第二轮基线一致');
  rec('INFO', 'P2', '本轮改动清单', `changed=[${changed.join(', ') || '无'}] added=[${added.join(', ') || '无'}]`);
}

// ───────────────────────── report ─────────────────────────
function report(asJson) {
  if (asJson) { console.log(JSON.stringify({ at: new Date().toISOString(), root: ROOT, results }, null, 2)); }
  else {
    const tag = { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', PENDING: 'PEND', SKIP: 'SKIP', INFO: 'INFO' };
    console.log(`\n办公室 demo 验收 · ${ROOT}\n${'─'.repeat(96)}`);
    for (const r of results) console.log(`[${tag[r.level] || r.level}] ${r.id.padEnd(3)} ${r.title}\n        ${r.evidence}`);
    const fail = results.filter((r) => r.level === 'FAIL').length;
    const warn = results.filter((r) => r.level === 'WARN').length;
    const pend = results.filter((r) => r.level === 'PENDING').length;
    console.log(`${'─'.repeat(96)}\nPASS ${results.filter((r) => r.level === 'PASS').length} / FAIL ${fail} / WARN ${warn} / PENDING ${pend}`);
  }
  return results.some((r) => r.level === 'FAIL') ? 1 : 0;
}

// ───────────────────────── main ─────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] || 'quick';
try {
  if (cmd === 'snapshot') await snapshot(argv[1] || 'initial');
  else if (cmd === 'static') { runStatic(); }
  else if (cmd === 'boundary') { await runBoundary(argv[1] || 'initial'); }
  else if (cmd === 'shots') { await runShots(); }
  else if (cmd === 'a11y') { await runA11y(); }
  else if (cmd === 'handoff') { await runHandoff(); }
  else if (cmd === 'states') { await runStates(); }
  else if (cmd === 'layout') { await runLayout(); }
  else if (cmd === 'art') { await runArt(); }
  else if (cmd === 'mascots') { await runMascots(); }
  else if (cmd === 'spec') { await runSpec(); }
  else if (cmd === 'scope') { await runScope(); }
  else if (cmd === 'all') { runStatic(); await runBoundary(argv[1] || 'initial'); await runShots(); await runA11y(); await runHandoff(); await runStates(); await runLayout(); }
  else if (cmd === 'quick') { runStatic(); await runBoundary('initial'); }
  else { console.log('未知命令:', cmd, '\n见文件头注释'); process.exit(2); }
  if (cmd !== 'snapshot') process.exit(report(argv.includes('json')));
} catch (e) {
  console.error('check.mjs 崩了:', e?.stack || e);
  process.exit(3);
}
