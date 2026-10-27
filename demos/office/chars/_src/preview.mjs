#!/usr/bin/env node
// 生成 index.html 用的三张预览图（1200×720，从各页的角色区开始）
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const CHROME = '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGETS = [
  ['d1', '#gallery'],
  ['d2', '#gallery'],
  ['d3', '#showcase'],
];

const port = 9700 + Math.floor(Math.random() * 200);
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'chars-prev-'));
const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
  for (const [slug, sel] of TARGETS) {
    const url = `http://127.0.0.1:4173/chars/${slug}.html`;
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let seq = 0; const waiters = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(1400);
    const box = await send('Runtime.evaluate', {
      expression: `(() => { const e=document.querySelector('${sel}'); if(!e) return {top:0,h:700}; const r=e.getBoundingClientRect(); return {top: Math.max(0, r.top + window.scrollY - 62), h: 700}; })()`,
      returnByValue: true,
    });
    const { top, h } = box.result.result.value;
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: top, width: 1200, height: h, scale: 1 },
    });
    await fsp.writeFile(path.join(OUT, `preview-${slug}.png`), Buffer.from(shot.result.data, 'base64'));
    ws.close();
    console.log(slug, 'ok', Math.round(top));
  }
} finally { proc.kill('SIGKILL'); }
