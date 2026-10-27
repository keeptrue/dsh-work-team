#!/usr/bin/env node
// demos/office/chars/shot.mjs —— 角色 demo 截图 + 自检（零依赖，Chrome CDP）
// 用法: node shot.mjs [d1|d2 ...]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const BASE = process.env.BASE || 'http://127.0.0.1:4173/chars/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'chars-shot-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--disable-background-networking', '--force-device-scale-factor=1',
    '--force-color-profile=srgb', '--disable-features=Translate,OptimizationHints',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { proc, port, profile }; } catch { /* wait */ }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome CDP 启动超时');
}

async function open(port, url, w, h) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0;
  const waiters = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push(String(d.exception?.description || d.text || 'exception').slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(String(m.params.entry.text).slice(0, 300));
    }
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return { __error: [d.text, d.exception?.description].filter(Boolean).join(' | ').slice(0, 400) };
    }
    return r.result?.result?.value;
  };
  const close = async () => { try { ws.close(); } catch { /* noop */ } try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`, { method: 'PUT' }); } catch { /* noop */ } };
  return { send, evaluate, close, errors };
}

async function shot(p, file, clip) {
  const r = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
  await fsp.writeFile(path.join(SHOTS, file), Buffer.from(r.result.data, 'base64'));
}

async function scrollInfo(p) {
  return p.evaluate(`(() => {
    const de = document.documentElement;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        const cls = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
        bad.push(el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
      }
    }
    return { cw: de.clientWidth, sw: de.scrollWidth, sh: de.scrollHeight, overflow: de.scrollWidth > de.clientWidth + 1, bad: bad.slice(0, 8), badN: bad.length };
  })()`);
}

const SIL = `(async () => {
  const rows = [...document.querySelectorAll('.sb-row')];
  const bufs = [], names = [];
  for (const row of rows) {
    const svg = row.querySelector('svg').cloneNode(true);
    svg.querySelectorAll('.furn').forEach(n => n.remove());
    svg.setAttribute('width', '32'); svg.setAttribute('height', '32');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, 32, 32); ctx.drawImage(img, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    const a = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) a[i] = d[i * 4 + 3] > 26 ? 1 : 0;
    bufs.push(a); names.push(row.querySelector('.sb-name').textContent.trim());
  }
  const pairs = [];
  for (let i = 0; i < bufs.length; i++) for (let j = i + 1; j < bufs.length; j++) {
    let inter = 0, uni = 0;
    for (let k = 0; k < 1024; k++) { if (bufs[i][k] && bufs[j][k]) inter++; if (bufs[i][k] || bufs[j][k]) uni++; }
    const iou = uni ? inter / uni : 1;
    pairs.push({ a: names[i], b: names[j], diff: +(100 * (1 - iou)).toFixed(1) });
  }
  pairs.sort((x, y) => x.diff - y.diff);
  return { worst: pairs.slice(0, 5), best: pairs.slice(-2), n: names.length };
})()`;

async function upscale(srcFile, dstFile, factor) {
  const b64 = fs.readFileSync(path.join(SHOTS, srcFile)).toString('base64');
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'chars-up-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let seq = 0; const waiters = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const img = await new Promise((res) => {
      const q = `(() => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = 'data:image/png;base64,${b64}'; })()`;
      res(null);
    });
    // 先拿到尺寸：用 JS 解码
    const size = await (async () => {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{const i=new Image();i.src='data:image/png;base64,${b64}';await i.decode();return {w:i.naturalWidth,h:i.naturalHeight}})()`, awaitPromise: true, returnByValue: true });
      return r.result.result.value;
    })();
    const W = size.w * factor, H = size.h * factor;
    await send('Emulation.setDeviceMetricsOverride', { width: Math.min(W, 4000), height: Math.min(H, 4000), deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'data:text/html,' + encodeURIComponent(
      `<body style="margin:0;background:#fff"><img src="data:image/png;base64,${b64}" style="display:block;width:${W}px;height:${H}px;image-rendering:pixelated">`) });
    await sleep(600);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.min(W, 4000), height: Math.min(H, 4000), scale: 1 } });
    await fsp.writeFile(path.join(SHOTS, dstFile), Buffer.from(r.result.data, 'base64'));
    ws.close();
  } finally { proc.kill('SIGKILL'); }
}

const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ['d1', 'd2'];

(async () => {
  await fsp.mkdir(SHOTS, { recursive: true });
  const { proc, port } = await launch();
  const report = {};
  try {
    for (const slug of TARGETS) {
      const url = BASE + slug + '.html';
      const p = await open(port, url, 1200, 900);
      await sleep(1400);
      const out = { errors: [], checks: {} };
      out.errors = p.errors.slice();

      // 桌面亮色全页
      const h = await p.evaluate('document.documentElement.scrollHeight');
      await shot(p, `${slug}-desk-light.png`, { x: 0, y: 0, width: 1200, height: Math.min(h, 4000), scale: 1 });
      // 暗色
      await p.evaluate(`document.querySelector('button[data-theme="dark"]').click()`);
      await sleep(300);
      await shot(p, `${slug}-desk-dark.png`, { x: 0, y: 0, width: 1200, height: Math.min(h, 4000), scale: 1 });
      await p.evaluate(`document.querySelector('button[data-theme="light"]').click()`);
      await sleep(200);

      // 32px 侧栏：元素截图 1:1 + 8x 最近邻放大
      const box = await p.evaluate(`(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}; })()`);
      await p.evaluate('window.scrollTo(0,0)');
      await sleep(100);
      const box2 = await p.evaluate(`(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}; })()`);
      await shot(p, `${slug}-32.png`, { x: Math.round(box2.x), y: Math.round(box2.y), width: Math.round(box2.w), height: Math.round(box2.h), scale: 1 });
      await upscale(`${slug}-32.png`, `${slug}-32-8x.png`, 8);
      out.checks.silhouette = await p.evaluate(SIL);

      // 纯黑剪影（去掉家具）：32px 1:1 → 8x
      await p.evaluate(`(() => {
        const st=document.createElement('style'); st.id='sil-mode';
        st.textContent='.sidebar .furn{display:none}.sidebar svg *{fill:#000!important;stroke:#000!important}.sidebar svg [fill="none"]{fill:none!important}';
        document.head.appendChild(st);
      })()`);
      await sleep(150);
      const box3 = await p.evaluate(`(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}; })()`);
      await shot(p, `${slug}-sil.png`, { x: Math.round(box3.x), y: Math.round(box3.y), width: Math.round(box3.w), height: Math.round(box3.h), scale: 1 });
      await upscale(`${slug}-sil.png`, `${slug}-sil-8x.png`, 8);
      await p.evaluate(`document.getElementById('sil-mode').remove()`);

      // 300 / 380 溢出
      for (const w of [300, 380]) {
        await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
        await p.evaluate(`document.querySelector('button[data-w="${w}"]').click()`);
        await sleep(250);
        out.checks['w' + w] = await scrollInfo(p);
        const hh = await p.evaluate('document.documentElement.scrollHeight');
        await shot(p, `${slug}-${w}-light.png`, { x: 0, y: 0, width: w, height: Math.min(hh, 5000), scale: 1 });
      }
      // 300 暗色
      await p.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.evaluate(`document.querySelector('button[data-theme="dark"]').click()`);
      await sleep(300);
      const hh = await p.evaluate('document.documentElement.scrollHeight');
      await shot(p, `${slug}-300-dark.png`, { x: 0, y: 0, width: 300, height: Math.min(hh, 5000), scale: 1 });
      await p.evaluate(`document.querySelector('button[data-theme="light"]').click()`);

      // 微场景：0s / 6.4s（交接）/ 9s
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.evaluate(`document.querySelector('button[data-w="380"]').click()`);
      await sleep(200);
      const sb = await p.evaluate(`(() => { const r = document.getElementById('scene').getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}; })()`);
      for (const [ms, tag] of [[900, 'a'], [4700, 'e'], [5800, 'b'], [6600, 'c'], [9000, 'd']]) {
        await p.evaluate(`(() => { const s=document.getElementById('scene'); s.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${ms};}); })()`);
        await sleep(120);
        await shot(p, `${slug}-scene-${tag}.png`, { x: Math.round(sb.x), y: Math.round(sb.y), width: Math.round(sb.w), height: Math.round(sb.h), scale: 2 });
      }
      out.errors = p.errors.slice();
      report[slug] = out;
      await p.close();
    }
  } finally {
    proc.kill('SIGKILL');
  }
  await fsp.writeFile(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
