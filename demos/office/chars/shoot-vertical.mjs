// 纵向走廊（d3-vertical.html）截图 / 自检
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'chars', 'shots');
const URL_BASE = process.env.BASE || 'http://127.0.0.1:4173';
const PAGE = '/chars/d3-vertical.html';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

async function launch() {
  const port = 9600 + Math.floor(Math.random() * 200);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'd3v-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--force-device-scale-factor=1', '--force-color-profile=srgb',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { proc, port, profile }; } catch {}
    await sleep(100);
  }
  proc.kill('SIGKILL'); throw new Error('Chrome 启动超时');
}

async function open(port, url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0; const waiters = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      errors.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown')
      errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { send, evaluate, errors, close: () => { try { ws.close(); } catch {} } };
}

async function shot(p, { clip, scale = 1, out }) {
  const params = { format: 'png', captureBeyondViewport: !!clip };
  if (clip) params.clip = { ...clip, scale };
  const r = await p.send('Page.captureScreenshot', params);
  const buf = Buffer.from(r.result.data, 'base64');
  await fsp.writeFile(path.join(SHOTS, out), buf);
  return { out, bytes: buf.length, sha: sha(buf) };
}

const rect = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};})()`;

const MEASURE = `(()=>{
  const de=document.documentElement;
  const panel=document.getElementById('panel');
  const pr=panel.getBoundingClientRect();
  const out={docScroll:de.scrollWidth,docClient:de.clientWidth,wide:[],clipped:[],seats:document.querySelectorAll('.seat').length,av:document.querySelectorAll('.crow .av svg').length};
  for(const el of panel.querySelectorAll('*')){
    const r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1) continue;
    if(r.right>pr.right+0.6||r.left<pr.left-0.6)
      out.wide.push((typeof el.className==='string'?el.className:el.tagName)+' ['+Math.round(r.left)+','+Math.round(r.right)+']');
    if(el.children.length===0&&el.textContent&&el.scrollWidth>el.clientWidth+1)
      out.clipped.push(el.textContent.trim().slice(0,10));
  }
  return out;
})()`;

const freezeAt = (t) => `(()=>{document.getAnimations().forEach(a=>{try{a.pause();a.currentTime=${Math.round(t*1000)};}catch(e){}});})()`;
const freeze = (t) => `(()=>{document.getAnimations().forEach(a=>{try{a.pause();a.currentTime=${Math.round(t*1000)};}catch(e){}});return document.getAnimations().length;})()`;
const thaw = `(()=>{document.getAnimations().forEach(a=>{try{a.play();}catch(e){}});})()`;

async function main() {
  await fsp.mkdir(SHOTS, { recursive: true });
  const { proc, port, profile } = await launch();
  const report = { at: new Date().toISOString(), errors: [], checks: [] };
  try {
    const p = await open(port, URL_BASE + PAGE);
    await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 2600, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url: URL_BASE + PAGE });
    await sleep(1400);

    report.boot = await p.evaluate(`({title:document.title,seats:document.querySelectorAll('.seat').length,av:document.querySelectorAll('.crow .av svg').length,sprites:document.querySelectorAll('svg.px').length})`);

    for (const w of [300, 380]) {
      for (const theme of ['light', 'dark']) {
        await p.evaluate(`(()=>{document.documentElement.setAttribute('data-theme','${theme}');
          document.getElementById('panel').setAttribute('data-w','${w}');})()`);
        await p.evaluate(freezeAt(0.6));
        await sleep(220);
        const m = await p.evaluate(MEASURE);
        report.checks.push({ kind: 'layout', width: w, theme, overflow: m.wide.length, clipped: m.clipped.length, seats: m.seats, avatars: m.av, doc: [m.docScroll, m.docClient], wide: m.wide.slice(0, 5) });
        const pr = await p.evaluate(rect('#panel'));
        await shot(p, { clip: { x: Math.max(0, pr.x - 20), y: Math.max(0, pr.y - 20), width: pr.width + 40, height: pr.height + 40 }, out: `d3v-${w}-${theme}.png` });
      }
    }

    // 回到 300 light
    await p.evaluate(`(()=>{document.documentElement.setAttribute('data-theme','light');
      document.getElementById('panel').setAttribute('data-w','300');})()`);
    await sleep(200);

    // 走路 4 帧（冻结在走动段）
    const aisleRect = await p.evaluate(`(()=>{const c=document.querySelector('.corridor').getBoundingClientRect();
      return {x:c.x+ (c.width-46)/2 - 8, y:c.y, width: 62, height: 270};})()`);
    const frames = [];
    for (const [t, name] of [[2.4, 'f1'], [2.9, 'f2'], [3.4, 'f3'], [3.9, 'f4']]) {
      await p.evaluate(freeze(t));
      await sleep(90);
      frames.push(await shot(p, { clip: aisleRect, scale: 3, out: `d3v-walk-${name}.png` }));
    }
    report.checks.push({ kind: 'walk-frames', hashes: frames.map((f) => f.sha), unique: new Set(frames.map((f) => f.sha)).size });

    // 交接 3 帧
    const hoRect = await p.evaluate(`(()=>{const c=document.querySelector('.corridor').getBoundingClientRect();
      return {x:c.x, y:c.y+150, width: c.width, height: 110};})()`);
    const hos = [];
    for (const [t, name] of [[6.1, 'give'], [6.7, 'fly'], [7.05, 'catch']]) {
      await p.evaluate(freeze(t));
      await sleep(90);
      hos.push(await shot(p, { clip: hoRect, scale: 3, out: `d3v-ho-${name}.png` }));
    }
    report.checks.push({ kind: 'handoff-frames', hashes: hos.map((f) => f.sha), unique: new Set(hos.map((f) => f.sha)).size });

    // 工位细节 3×（桌面 / 椅背 / 显示器）
    await p.evaluate(freeze(0.6));
    await sleep(90);
    const seatR = await p.evaluate(`(()=>{const e=document.querySelectorAll('.seat')[3];const b=e.getBoundingClientRect();
      return {x:b.x-2,y:b.y-2,width:b.width+4,height:b.height+4};})()`);
    await shot(p, { clip: seatR, scale: 3, out: 'd3v-desk-3x.png' });
    const seatR2 = await p.evaluate(`(()=>{const e=document.querySelectorAll('.seat')[0];const b=e.getBoundingClientRect();
      return {x:b.x-2,y:b.y-2,width:b.width+4,height:b.height+4};})()`);
    await shot(p, { clip: seatR2, scale: 3, out: 'd3v-desk1-3x.png' });

    // 状态环 4 态对照
    const ringsR = await p.evaluate(`(()=>{const e=document.getElementById('rings');const b=e.getBoundingClientRect();
      return {x:b.x,y:b.y,width:b.width,height:b.height};})()`);
    await shot(p, { clip: ringsR, scale: 2, out: 'd3v-rings.png' });

    // 生活感小动作
    for (const [t, name] of [[10.1, 'coffee'], [2.3, 'stretch']]) {
      await p.evaluate(freeze(t));
      await sleep(90);
      const r = await p.evaluate(rect('.corridor'));
      await shot(p, { clip: { x: r.x, y: r.y, width: r.width, height: r.height }, scale: 2, out: `d3v-action-${name}.png` });
    }

    // 动画确证
    const probe = await p.evaluate(`(()=>{
      const W=document.querySelector('.walker'), G=document.querySelector('.guest');
      const read=()=>({w:getComputedStyle(W).transform, g:getComputedStyle(G).opacity,
        give:getComputedStyle(document.querySelector('.walker .pose[data-p="give"]')).opacity,
        card:getComputedStyle(document.querySelector('.card-fly')).transform});
      document.getAnimations().forEach(a=>{try{a.pause();a.currentTime=1000;}catch(e){}}); const a=read();
      document.getAnimations().forEach(a=>{try{a.currentTime=2600;}catch(e){}}); const b=read();
      document.getAnimations().forEach(a=>{try{a.currentTime=6100;}catch(e){}}); const c=read();
      document.getAnimations().forEach(a=>{try{a.currentTime=7000;}catch(e){}}); const d=read();
      document.getAnimations().forEach(a=>{try{a.play();}catch(e){}});
      return {a,b,c,d};
    })()`);
    report.checks.push({ kind: 'anim-probe', ...probe });

    // 24px 头像两两可辨
    const sig = await p.evaluate(`(()=>[...document.querySelectorAll('.crow')].map(r=>({
      name:r.querySelector('b').textContent,
      sig:[...r.querySelectorAll('.av svg path')].map(p=>p.getAttribute('d')).join('|')})))()`);
    const uniq = new Set(sig.map((s) => sha(s.sig)));
    report.checks.push({ kind: 'avatars', total: sig.length, unique: uniq.size, names: sig.map((s) => s.name) });

    // reduced motion
    await p.evaluate(thaw);
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(220);
    const rm1 = await shot(p, { clip: await p.evaluate(rect('.corridor')), out: 'd3v-reduced.png' });
    await sleep(300);
    const rm2 = await shot(p, { clip: await p.evaluate(rect('.corridor')), out: 'd3v-reduced2.png' });
    report.checks.push({ kind: 'reduced-motion-static', same: rm1.sha === rm2.sha });
    await p.send('Emulation.setEmulatedMedia', { features: [] });

    // 选中态
    await p.evaluate(`document.querySelectorAll('.seat')[2].click()`);
    await sleep(120);
    const picked = await p.evaluate(`document.querySelectorAll('.seat')[2].getAttribute('data-picked')`);
    report.checks.push({ kind: 'picked', value: picked });
    await p.evaluate(`document.querySelectorAll('.seat')[2].click()`);

    report.errors = p.errors;
    await p.close();
  } finally {
    try { proc.kill('SIGKILL'); } catch {}
    try { await fsp.rm(profile, { recursive: true, force: true }); } catch {}
  }
  await fsp.writeFile(path.join(SHOTS, 'd3v-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
