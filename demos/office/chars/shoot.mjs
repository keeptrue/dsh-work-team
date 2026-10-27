// 方向三（像素小人）截图 / 自检脚本
// 用法: node demos/office/chars/shoot.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'chars', 'shots');
const URL_BASE = process.env.BASE || 'http://127.0.0.1:4173';
const PAGE = process.env.PAGE || '/chars/d3.html';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

async function launch() {
  const port = 9500 + Math.floor(Math.random() * 300);
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'd3-shot-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--force-device-scale-factor=1', '--force-color-profile=srgb',
    '--disable-features=Translate', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { proc, port, profile }; } catch {}
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome 启动超时');
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
      errors.push('log: ' + m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
    return r.result?.result?.value;
  };
  return { send, evaluate, errors, id: t.id, close: () => { try { ws.close(); } catch {} } };
}

async function shot(p, { clip, scale = 1, out }) {
  const params = { format: 'png', captureBeyondViewport: !!clip };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale };
  const r = await p.send('Page.captureScreenshot', params);
  const buf = Buffer.from(r.result.data, 'base64');
  await fsp.writeFile(path.join(SHOTS, out), buf);
  return { out, bytes: buf.length, sha: sha(buf) };
}

const rect = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};})()`;

const MEASURE = `(()=>{
  const de=document.documentElement;
  const out={docScroll:de.scrollWidth, docClient:de.clientWidth, bodyScroll:document.body.scrollWidth, wide:[], clipped:[]};
  const panel=document.getElementById('panel');
  const pr=panel.getBoundingClientRect();
  for(const el of panel.querySelectorAll('*')){
    const r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1) continue;
    if(r.right>pr.right+0.6||r.left<pr.left-0.6){
      out.wide.push((el.className&&typeof el.className==='string'?el.className:el.tagName)+' ['+Math.round(r.left)+','+Math.round(r.right)+']');
    }
    if(el.children.length===0&&el.textContent&&el.scrollWidth>el.clientWidth+1)
      out.clipped.push(el.textContent.trim().slice(0,10));
  }
  return out;
})()`;

async function main() {
  await fsp.mkdir(SHOTS, { recursive: true });
  const { proc, port, profile } = await launch();
  const report = { at: new Date().toISOString(), errors: [], checks: [] };
  try {
    const p = await open(port, URL_BASE + PAGE);
    await p.send('Runtime.enable');
    await p.send('Log.enable');
    await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 3200, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url: URL_BASE + PAGE });
    await sleep(1400);

    const boot = await p.evaluate(`({title:document.title, sprites:document.querySelectorAll('svg.px').length, rows:document.querySelectorAll('.row').length, cells:document.querySelectorAll('.mx-cells .cell').length})`);
    report.boot = boot;

    // ── 4 张整页（300/380 × light/dark）──
    for (const w of [300, 380]) {
      for (const theme of ['light', 'dark']) {
        await p.evaluate(`(()=>{document.documentElement.setAttribute('data-theme','${theme}');
          document.getElementById('panel').setAttribute('data-w','${w}');})()`);
        await sleep(220);
        const r = await p.evaluate(MEASURE);
        report.checks.push({ kind: 'layout', width: w, theme, docScroll: r.docScroll, docClient: r.docClient, overflow: r.wide.length, clipped: r.clipped.length, wide: r.wide.slice(0, 6) });
        const pr = await p.evaluate(rect('#panel'));
        await shot(p, { clip: { x: Math.max(0, pr.x - 24), y: Math.max(0, pr.y - 24), width: pr.width + 48, height: pr.height + 48 }, out: `d3-${w}-${theme}.png` });
      }
    }

    // ── 32px 真实尺寸特写（3× 放大看像素）──
    for (const theme of ['light', 'dark']) {
      await p.evaluate(`(()=>{document.documentElement.setAttribute('data-theme','${theme}');
        document.getElementById('panel').setAttribute('data-w','300');})()`);
      await sleep(200);
      const m = await p.evaluate(rect('#mock'));
      await shot(p, { clip: { x: m.x - 2, y: m.y - 2, width: m.width + 4, height: m.height + 4 }, scale: 3, out: `d3-32-${theme}.png` });
    }

    // ── 走路 4 帧 / 交接 3 帧 ──
    await p.evaluate(`document.documentElement.setAttribute('data-theme','light')`);
    const fr = await p.evaluate(rect('#frames'));
    await shot(p, { clip: { x: fr.x - 2, y: fr.y - 2, width: fr.width + 4, height: fr.height + 4 }, scale: 3, out: 'd3-walk-4f.png' });
    const fr3 = await p.evaluate(rect('#frames3'));
    await shot(p, { clip: { x: fr3.x - 2, y: fr3.y - 2, width: fr3.width + 4, height: fr3.height + 4 }, scale: 3, out: 'd3-handoff-3k.png' });

    // ── 动画确实在跑：同区域两次截图 hash 不同 ──
    const scRect = await p.evaluate(rect('.scene-wrap'));
    const clip = { x: scRect.x, y: scRect.y, width: scRect.width, height: scRect.height };
    const a = await shot(p, { clip, out: 'd3-scene-live-a.png' });
    await sleep(340);
    const b = await shot(p, { clip, out: 'd3-scene-live-b.png' });
    const move = await p.evaluate(`(()=>{
      const list=document.getAnimations();
      const probe=()=>{const el=document.querySelector('.actor-a');const p=document.querySelector('.actor-a .pose[data-p="walkR"]');
        return getComputedStyle(el).transform+' / op='+getComputedStyle(p).opacity;};
      list.forEach(a=>{try{a.pause();a.currentTime=1500;}catch(e){}});
      const s1=probe();
      list.forEach(a=>{try{a.currentTime=3000;}catch(e){}});
      const s2=probe();
      list.forEach(a=>{try{a.currentTime=4000;}catch(e){}});
      const s3=probe();
      list.forEach(a=>{try{a.play();}catch(e){}});
      return {s1,s2,s3, moved:s1!==s2&&s2!==s3};
    })()`);
    report.checks.push({ kind: 'anim-live', shotDiffer: a.sha !== b.sha, ...move });

    // ── 场景：冻结在 3 个时刻（递出 / 飞行 / 接住），用 WAAPI 精确定位 ──
    for (const [t, name] of [[3.9, 'give'], [4.5, 'fly'], [5.1, 'take']]) {
      const got = await p.evaluate(`(()=>{
        const list=document.getAnimations();
        list.forEach(a=>{ try{ a.pause(); a.currentTime=${Math.round(t * 1000)}; }catch(e){} });
        return list.length;
      })()`);
      await sleep(120);
      const s2 = await p.evaluate(rect('.scene-wrap'));
      await shot(p, { clip: { x: s2.x - 2, y: s2.y - 2, width: s2.width + 4, height: s2.height + 4 }, scale: 3, out: `d3-scene-${name}.png` });
      if (name === 'give') report.checks.push({ kind: 'waapi', animations: got });
    }

    // 走路精灵同区域两次
    const wk = await p.evaluate(rect('#frames'));
    const wa = await shot(p, { clip: { x: wk.x, y: wk.y, width: wk.width, height: wk.height }, out: 'd3-walk-live-a.png' });
    await sleep(200);
    const wb = await shot(p, { clip: { x: wk.x, y: wk.y, width: wk.width, height: wk.height }, out: 'd3-walk-live-b.png' });
    report.checks.push({ kind: 'walk-static-expected-same', a: wa.sha, b: wb.sha });

    // ── reduced motion ──
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(200);
    const rmShot = await shot(p, { clip, out: 'd3-scene-reduced.png' });
    await sleep(260);
    const rmShot2 = await shot(p, { clip, out: 'd3-scene-reduced2.png' });
    report.checks.push({ kind: 'reduced-motion-static', same: rmShot.sha === rmShot2.sha });
    await p.send('Emulation.setEmulatedMedia', { features: [] });

    // ── 8 人 32px 两两可辨：像素签名不同 ──
    const sig = await p.evaluate(`(()=>{
      const rows=[...document.querySelectorAll('#mock .row')];
      return rows.map(r=>{
        const svg=r.querySelector('svg.px');
        const d=[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('|');
        return {name:r.querySelector('b').textContent, sig:d};
      });
    })()`);
    const uniq = new Set(sig.map((s) => sha(s.sig)));
    report.checks.push({ kind: 'distinct-32px', total: sig.length, unique: uniq.size, names: sig.map((s) => s.name) });

    report.errors = p.errors;
    await p.close();
  } finally {
    try { proc.kill('SIGKILL'); } catch {}
    try { await fsp.rm(profile, { recursive: true, force: true }); } catch {}
  }
  await fsp.writeFile(path.join(SHOTS, 'd3-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
