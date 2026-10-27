#!/usr/bin/env node
/**
 * dot-audit.mjs — 员工办公室状态点配色审计（v5.1）
 *
 * 一条命令跑出全部数字：每个状态的实测色 / OKLCH / 对比度 / 两两 ΔE / 色觉缺陷模拟，
 * 并按契约阈值给出 PASS/FAIL。零依赖、不启浏览器：把 client.js 里的 CSS 模板和
 * demos/office/index.html 里的 demo token 读进来，在 Node 里按 CSS 语义求值
 * （`color-mix(in srgb, …)` 是 sRGB 空间预乘插值，与浏览器结果一致）。
 *
 * 用法：
 *   node demos/office/tools/dot-audit.mjs              # 审计 client.js 里已落地的配方
 *   node demos/office/tools/dot-audit.mjs --proposal   # 审计本文件顶部的 PROPOSAL（未落盘时）
 *   node demos/office/tools/dot-audit.mjs --emit       # 打印可直接粘贴的 CSS 块
 *   node demos/office/tools/dot-audit.mjs --pairs      # 打印 8×8 全量 ΔE 矩阵
 *   node demos/office/tools/dot-audit.mjs --json       # 机器可读输出
 *
 * 退出码：0 = 全部达标；1 = 有未达标项（CI 可直接用）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 阈值（契约 §1） ───────────────────────────────────────────────────────
const THRESHOLDS = {
  contrastLight: 3.2,
  contrastDark: 4.5,
  dE: 0.15,
  dECvd: 0.09,
  hueGapReadyDone: 25, // 度；ready 必须离开 done 的绿区
  dotPx: 8,
};

// 实心点：颜色是唯一通道，必须两两拉开。
// 空心点（provisioning / failed）：形状已经是一条独立通道，与同族实心点共用色相是设计，
// 不是碰撞——审计把它们单列，不参与 ΔE 判罚。
const SOLID = ['idle', 'working', 'waiting', 'done', 'error', 'ready'];
const HOLLOW = ['provisioning', 'failed'];
const ORDER = ['idle', 'working', 'provisioning', 'waiting', 'done', 'error', 'failed', 'ready'];

/**
 * v5.1 配方（提案）。落地时由 client.js 的 `.wt-desk.wt-st-<status>` 覆盖。
 * 只用 --dsw-alias-* token + color-mix，与主题无关地自适应：label-primary 在浅色是近黑、
 * 深色是近白，所以同一条表达式在两侧分别起到「压深」和「提亮」的作用。
 */
const PROPOSAL = {
  light: {
    idle: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-primary))',
    working: 'var(--dsw-alias-state-business-primary)',
    provisioning: 'var(--dsw-alias-state-business-primary)',
    waiting: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 56%, var(--dsw-alias-label-primary))',
    done: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 79%, var(--dsw-alias-label-primary))',
    error: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 53%, var(--dsw-alias-label-primary))',
    failed: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-primary))',
    ready: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 54%, var(--dsw-alias-state-error-primary))',
  },
  dark: {
    idle: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 54%, var(--dsw-alias-label-primary))',
    working: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 83%, var(--dsw-alias-label-primary))',
    provisioning: 'var(--dsw-alias-state-business-primary)',
    waiting: 'var(--dsw-alias-state-warn-primary)',
    done: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 57%, var(--dsw-alias-label-primary))',
    error: 'var(--dsw-alias-state-error-primary)',
    failed: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 87%, var(--dsw-alias-label-primary))',
    ready: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 51%, var(--dsw-alias-state-error-primary))',
  },
};

// ── 路径 ─────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CLIENT = resolve(ROOT, 'client.js');
const DEMO = resolve(ROOT, 'demos/office/index.html');

// ── 读 CSS 模板 + demo token ─────────────────────────────────────────────
function readCss() {
  const src = readFileSync(CLIENT, 'utf8');
  const open = src.indexOf('const CSS = `');
  if (open < 0) throw new Error('client.js: 找不到 `const CSS = ` 模板');
  const start = open + 'const CSS = `'.length;
  const end = src.indexOf('`;', start);
  if (end < 0) throw new Error('client.js: CSS 模板没有闭合');
  return src.slice(start, end);
}

function parseTokens(block) {
  const map = new Map();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

function readTokens() {
  const html = readFileSync(DEMO, 'utf8');
  const light = html.match(/:root\{[\s\S]*?\n\}/);
  const dark = html.match(/html\[data-theme="dark"\]\{[\s\S]*?\n\}/);
  if (!light || !dark) throw new Error('demos/office/index.html: 找不到 :root / html[data-theme="dark"] token 块');
  return { light: parseTokens(light[0]), dark: parseTokens(dark[0]) };
}

/** 从 CSS 里抽 `.wt-desk.wt-st-<status> { --wt-state: … }`，按选择器分主题。
 *  dark 的判据是选择器里出现 `data-ds-dark-theme`（宿主）或 `data-theme="dark"`（demo）。 */
function readRecipes(css) {
  const out = new Map([
    ['light', new Map()],
    ['dark', new Map()],
  ]);
  const rule = /([^{}]*\.wt-desk\.wt-st-[a-z]+[^{}]*)\{\s*--wt-state\s*:\s*([^;}]+);/g;
  for (const m of css.matchAll(rule)) {
    const selector = m[1];
    const theme = /data-ds-dark-theme|data-theme="dark"/.test(selector) ? 'dark' : 'light';
    const expr = m[2].trim();
    for (const part of selector.split(',')) {
      const hit = /\.wt-desk\.wt-st-([a-z]+)/.exec(part);
      if (hit) out.get(theme).set(hit[1], expr);
    }
  }
  return out;
}

// ── 颜色：解析 + 求值 ────────────────────────────────────────────────────
const clamp255 = (v) => Math.max(0, Math.min(255, v));

function hexToRgba(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
  throw new Error(`无法解析颜色 ${hex}`);
}

/** 按顶层逗号切分（括号内的逗号不切）。 */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function resolveColor(expr, tokens, depth = 0) {
  if (depth > 12) throw new Error(`嵌套过深：${expr}`);
  const e = expr.trim();

  if (e === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (e.startsWith('#')) return hexToRgba(e);

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(e);
  if (varMatch) {
    const v = tokens.get(varMatch[1]);
    if (v !== undefined) return resolveColor(v, tokens, depth + 1);
    if (varMatch[2] !== undefined) return resolveColor(varMatch[2], tokens, depth + 1);
    throw new Error(`token 不存在：${varMatch[1]}`);
  }

  if (e.startsWith('color-mix(')) {
    const inner = e.slice('color-mix('.length, e.lastIndexOf(')'));
    const args = splitTop(inner);
    const space = args[0].replace(/^in\s+/, '').trim();
    if (space !== 'srgb') throw new Error(`只支持 color-mix(in srgb, …)，收到 in ${space}`);
    const parts = args.slice(1).map((arg) => {
      const pct = /([\d.]+)%\s*$/.exec(arg);
      const color = pct ? arg.slice(0, pct.index).trim() : arg;
      return { color, pct: pct ? Number(pct[1]) / 100 : null };
    });
    if (parts.length !== 2) throw new Error(`color-mix 需要两个颜色：${e}`);
    let [p1, p2] = [parts[0].pct, parts[1].pct];
    if (p1 === null && p2 === null) [p1, p2] = [0.5, 0.5];
    else if (p1 === null) p1 = 1 - p2;
    else if (p2 === null) p2 = 1 - p1;
    const sum = p1 + p2;
    [p1, p2] = [p1 / sum, p2 / sum];
    const c1 = resolveColor(parts[0].color, tokens, depth + 1);
    const c2 = resolveColor(parts[1].color, tokens, depth + 1);
    // CSS color-mix：预乘 alpha 后插值
    const a = c1.a * p1 + c2.a * p2;
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: clamp255((c1.r * c1.a * p1 + c2.r * c2.a * p2) / a),
      g: clamp255((c1.g * c1.a * p1 + c2.g * c2.a * p2) / a),
      b: clamp255((c1.b * c1.a * p1 + c2.b * c2.a * p2) / a),
      a,
    };
  }

  throw new Error(`无法求值：${e}`);
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

// ── 色彩科学 ─────────────────────────────────────────────────────────────
const toLinear = (v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const contrast = (x, y) => {
  const [a, b] = [luminance(x), luminance(y)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const oklab = ({ r, g, b }) => {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

const lch = (lab) => ({
  L: lab.L,
  C: Math.hypot(lab.a, lab.b),
  H: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360,
});

const dE = (A, B) => Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);

// Machado-style 线性 RGB 矩阵（与 /tmp/v5-harness/cvd.mjs 同一套，便于和 lead 的基线对齐）
const CVD = {
  normal: null,
  deutan: [[0.367, 0.861, -0.228], [0.280, 0.673, 0.047], [-0.012, 0.043, 0.969]],
  protan: [[0.152, 1.053, -0.205], [0.115, 0.786, 0.099], [-0.004, -0.048, 1.052]],
};

function simulate(rgb, kind) {
  const M = CVD[kind];
  if (!M) return rgb;
  const v = [toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b)];
  const out = M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  return { r: toSrgb(Math.min(1, Math.max(0, out[0]))), g: toSrgb(Math.min(1, Math.max(0, out[1]))), b: toSrgb(Math.min(1, Math.max(0, out[2]))), a: 1 };
}

// ── 输出工具 ─────────────────────────────────────────────────────────────
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

// ── 主流程 ───────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const useProposal = args.has('--proposal');
const tokens = readTokens();
const css = readCss();
const fromCss = readRecipes(css);

const recipesFor = (theme) => {
  const out = new Map();
  for (const s of ORDER) {
    const expr = (useProposal ? undefined : fromCss.get(theme)?.get(s)) ?? PROPOSAL[theme][s];
    if (!expr) throw new Error(`缺少配方：${theme}/${s}`);
    out.set(s, expr);
  }
  return out;
};
const usedFallback = !useProposal && fromCss.get('light').size === 0 && fromCss.get('dark').size === 0;

if (args.has('--emit')) {
  console.log('/* v5.1 · 每个状态一条点色配方（只动 .wt-desk，别升到全局） */');
  for (const s of ORDER) console.log(`.wt-desk.wt-st-${s} { --wt-state:${PROPOSAL.light[s]}; }`);
  console.log('\n/* dark：宿主用 body[data-ds-dark-theme]，demo 用 html[data-theme="dark"]，两个都认 */');
  for (const s of ORDER)
    console.log(`:is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-${s} { --wt-state:${PROPOSAL.dark[s]}; }`);
  process.exit(0);
}

const report = { thresholds: THRESHOLDS, themes: {}, checks: [] };
const worst = [];

for (const theme of ['light', 'dark']) {
  const tk = tokens[theme];
  const recipes = recipesFor(theme);
  const surface = resolveColor('var(--dsw-alias-bg-layer-1)', tk);
  const rows = ORDER.map((status) => {
    const raw = resolveColor(recipes.get(status), tk);
    const solid = over(raw, surface);
    const lab = oklab(solid);
    const c = lch(lab);
    return {
      status,
      hollow: HOLLOW.includes(status),
      expr: recipes.get(status),
      hex: hex(solid),
      alpha: raw.a,
      L: c.L,
      C: c.C,
      H: c.H,
      contrast: contrast(solid, surface),
    };
  });

  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const solidRows = rows.filter((r) => !r.hollow);

  const pairStats = (kind) => {
    const labs = new Map(rows.map((r) => [r.status, oklab(simulate(hexToRgba(r.hex), kind))]));
    const pairs = [];
    for (let i = 0; i < solidRows.length; i += 1) {
      for (let j = i + 1; j < solidRows.length; j += 1) {
        const a = solidRows[i].status, b = solidRows[j].status;
        pairs.push([`${a}↔${b}`, dE(labs.get(a), labs.get(b))]);
      }
    }
    pairs.sort((x, y) => x[1] - y[1]);
    return pairs;
  };

  const normal = pairStats('normal');
  const deutan = pairStats('deutan');
  const protan = pairStats('protan');

  // 8×8 全量（含空心点），仅用于报告
  const allPairs = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const A = oklab(hexToRgba(rows[i].hex));
      const B = oklab(hexToRgba(rows[j].hex));
      allPairs.push({ a: rows[i].status, b: rows[j].status, d: dE(A, B), bothSolid: !rows[i].hollow && !rows[j].hollow });
    }
  }
  allPairs.sort((x, y) => x.d - y.d);

  const hueGap = (() => {
    const a = byStatus.get('ready'), b = byStatus.get('done');
    const diff = Math.abs(a.H - b.H);
    return Math.min(diff, 360 - diff);
  })();

  report.themes[theme] = { surface: hex(surface), rows, normal, deutan, protan, allPairs, hueGap };

  // ── 打印 ──
  console.log(`\n=== ${theme}（底 ${hex(surface)}）===`);
  console.log(
    [pad('status', 13), pad('dot', 9), padL('L*', 5), padL('C', 7), padL('H', 6), padL('contrast', 10), 'shape'].join(' '),
  );
  for (const r of rows) {
    console.log(
      [
        pad(r.status, 13),
        pad(r.hex, 9),
        padL((r.L * 100).toFixed(0), 5),
        padL(f3(r.C), 7),
        padL(r.H.toFixed(0) + '°', 6),
        padL(f2(r.contrast) + ':1', 10),
        r.hollow ? 'hollow' : 'solid',
      ].join(' '),
    );
  }

  const minN = normal[0];
  const minD = deutan[0];
  const minP = protan[0];
  console.log(`  实心 ${solidRows.length} 个 · 最小 ΔE：normal ${f3(minN[1])}（${minN[0]}） · deutan ${f3(minD[1])}（${minD[0]}） · protan ${f3(minP[1])}（${minP[0]}）`);
  console.log(`  ready↔done 色相间隔：${hueGap.toFixed(0)}°`);
  if (args.has('--pairs')) {
    console.log('  全量 ΔE（升序）：');
    for (const p of allPairs) console.log(`    ${pad(p.a + '↔' + p.b, 26)} ${f3(p.d)}${p.bothSolid ? '' : '  (空心，形状通道)'}`);
  }

  // ── 判定 ──
  const floor = theme === 'light' ? THRESHOLDS.contrastLight : THRESHOLDS.contrastDark;
  for (const r of rows) {
    report.checks.push({ theme, name: `contrast ${r.status}`, ok: r.contrast >= floor, value: r.contrast, floor });
  }
  report.checks.push({ theme, name: 'ΔE normal（实心两两）', ok: minN[1] >= THRESHOLDS.dE, value: minN[1], floor: THRESHOLDS.dE, pair: minN[0] });
  report.checks.push({ theme, name: 'ΔE deutan（实心两两）', ok: minD[1] >= THRESHOLDS.dECvd, value: minD[1], floor: THRESHOLDS.dECvd, pair: minD[0] });
  report.checks.push({ theme, name: 'ΔE protan（实心两两）', ok: minP[1] >= THRESHOLDS.dECvd, value: minP[1], floor: THRESHOLDS.dECvd, pair: minP[0] });
  report.checks.push({ theme, name: 'ready↔done 色相', ok: hueGap >= THRESHOLDS.hueGapReadyDone, value: hueGap, floor: THRESHOLDS.hueGapReadyDone });

  worst.push({ theme, minN, minD, minP });
}

// ── 几何（直接查 CSS，防止配方对了但尺寸没落） ─────────────────────────
const dotRule = /\.wt-desk-dot\s*\{([^}]*)\}/.exec(css);
const dotCss = dotRule ? dotRule[1] : '';
const dotW = /width\s*:\s*(\d+)px/.exec(dotCss);
const ringOk = /box-shadow\s*:\s*0\s+0\s+0\s+[\d.]+px\s+var\(--dsw-alias-bg-layer-1\)/.test(dotCss);
report.checks.push({ theme: 'both', name: `.wt-desk-dot 宽 ${THRESHOLDS.dotPx}px`, ok: dotW !== null && Number(dotW[1]) === THRESHOLDS.dotPx, value: dotW ? Number(dotW[1]) : null, floor: THRESHOLDS.dotPx });
report.checks.push({ theme: 'both', name: '表面色外环（bg-layer-1）', ok: ringOk, value: ringOk, floor: true });

// ── 汇总 ─────────────────────────────────────────────────────────────────
const failed = report.checks.filter((c) => !c.ok);
console.log('\n=== 判定 ===');
for (const c of report.checks) {
  const label = `${c.theme}/${c.name}`;
  const detail = typeof c.value === 'number' ? `${f3(c.value)} ${c.ok ? '≥' : '<'} ${c.floor}${c.pair ? ` (${c.pair})` : ''}` : String(c.value);
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${pad(label, 42)} ${detail}`);
}
if (usedFallback) console.log('\n注：client.js 里还没有 `.wt-desk.wt-st-* { --wt-state }` 规则，本次审计的是 PROPOSAL。');

if (args.has('--json')) {
  console.log('\n' + JSON.stringify(report, (k, v) => (k === 'expr' ? v : v), 2));
}

console.log(`\n${failed.length === 0 ? '全部达标' : `${failed.length} 项未达标`}`);
process.exit(failed.length === 0 ? 0 : 1);
