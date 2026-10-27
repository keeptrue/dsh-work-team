#!/usr/bin/env node
// 通用页面自检：300/380 溢出 + 控制台错误 + 截图
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '../shots');
const CHROME = '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.argv[2] || 'http://127.0.0.1:4173/chars/index.html';
const slug = process.argv[3] || 'index';

const port = 9800 + Math.floor(Math.random() * 150);
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'chars-chk-'));
const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
const out = {};
try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0; const waiters = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 200));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(String(m.params.entry.text).slice(0, 200));
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  for (const w of [300, 380, 1200]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const d=document.documentElement; const bad=[]; for (const el of document.querySelectorAll('body *')) { const b=el.getBoundingClientRect(); if (b.width<1&&b.height<1) continue; if (b.right>d.clientWidth+1||b.left<-1) bad.push(el.tagName.toLowerCase()+'.'+String(el.className).split(' ')[0]+' '+Math.round(b.left)+'..'+Math.round(b.right)); } return {cw:d.clientWidth,sw:d.scrollWidth,sh:d.scrollHeight,bad:bad.slice(0,6)}; })()`,
      returnByValue: true,
    });
    out['w' + w] = r.result.result.value;
    if (w < 1200) {
      const h = r.result.result.value.sh;
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 5000), scale: 1 } });
      await fsp.writeFile(path.join(SHOTS, `${slug}-${w}.png`), Buffer.from(s.result.data, 'base64'));
    }
  }
  out.errors = errors;
  ws.close();
} finally { proc.kill('SIGKILL'); }
console.log(JSON.stringify(out, null, 2));
