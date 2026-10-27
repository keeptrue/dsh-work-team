// RoleAvatar 验证台截图：浅色 / 暗色 / 三个真实场景
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SHOTS = '/home/inkedus/Code/github/dsh-work-team/demos/office/chars/shots';
const URL = process.env.HARNESS || 'http://127.0.0.1:4180/demos/office/chars/avatar-harness.html';
const CHROME = '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9700 + Math.floor(Math.random() * 200);
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'av-'));
const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-color-profile=srgb',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
  await sleep(100);
}
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const waiters = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value).join(' '));
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 1200, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(2500);

const ready = await ev('window.__harnessReady === true');
const info = await ev(`(() => {
  const v = document.getElementById('verify');
  return { ready: window.__harnessReady === true,
           rows: v ? [...v.querySelectorAll('.mono')].map(e => e.textContent) : [],
           avatars: document.querySelectorAll('.wt-avatar-wrap').length,
           svgs: document.querySelectorAll('svg.wt-avatar-svg').length,
           eyes: document.querySelectorAll('.wt-eyes').length,
           hands: document.querySelectorAll('.wt-hands').length,
           docH: document.documentElement.scrollHeight };
})()`);
console.log(JSON.stringify({ ready, info, errors }, null, 2));

async function shot(name, clip) {
  const params = { format: 'png', captureBeyondViewport: true };
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await send('Page.captureScreenshot', params);
  await fsp.writeFile(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
}

const rect = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};})()`;

// 浅色全页
await shot('av-harness-light.png', { x: 0, y: 0, width: 1240, height: info.docH });
// 暗色全页
await ev(`document.body.setAttribute('data-ds-dark-theme','')`);
await sleep(400);
await shot('av-harness-dark.png', { x: 0, y: 0, width: 1240, height: info.docH });
await ev(`document.body.removeAttribute('data-ds-dark-theme')`);
await sleep(300);

// 场景特写
const sc = await ev(rect('.scenes'));
if (sc) await shot('av-scenes.png', { x: sc.x - 2, y: sc.y - 2, width: sc.width + 4, height: sc.height + 4 });

// hair 剪影对照（8/8）
const hairCard = await ev(`(()=>{const e=document.getElementById('hairs').closest('.card');const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};})()`);
if (hairCard) await shot('av-hair-32.png', { x: hairCard.x, y: hairCard.y, width: hairCard.width, height: hairCard.height });

// fan 28 档 4×
const fanCard = await ev(`(()=>{const e=document.getElementById('fanBig').closest('.card');const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};})()`);
if (fanCard) await shot('av-fan-28.png', { x: fanCard.x, y: fanCard.y, width: fanCard.width, height: fanCard.height });

// 48px 矩阵放大（浅色）
const big = await ev(`(()=>{const e=[...document.querySelectorAll('.sz')].find(s=>s.textContent.startsWith('48px'));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};})()`);
if (big) await shot('av-48px.png', { x: big.x, y: big.y, width: big.width, height: big.height });

proc.kill('SIGKILL');
