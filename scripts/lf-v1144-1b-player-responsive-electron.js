'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-1b-player-responsive', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-1b-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const screenshots = [];
const appLog = [];
let app;
let cdp;

fs.mkdirSync(evidenceDir, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); }); }
async function waitFor(fn, timeout = 60000, interval = 120) { const start = Date.now(); let last; while (Date.now() - start < timeout) { try { last = await fn(); if (last) return last; } catch (e) { last = String(e && e.message || e); } await delay(interval); } throw new Error(`Timeout: ${JSON.stringify(last)}`); }

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const m = JSON.parse(String(event.data));
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer); return m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params && m.params.exceptionDetails || {}; rendererErrors.push(String(d.exception && d.exception.description || d.text || 'renderer exception')); }
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(x => x.value || x.description || '').join(' '));
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable'); await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) { const id = ++this.id; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, timeout); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return r.result && r.result.value; }
  async screenshot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); const file = path.join(evidenceDir, name); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); screenshots.push(file); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function start() {
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_PATH: dependencyRoot, LF_MASTER_TEST: '1', LUMIFIELD_SKIP_SPLASH: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }),
  });
  const collect = data => appLog.push(String(data)); app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await waitFor(async () => { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return list.find(x => x.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(x.url)); }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.eval('document.readyState==="complete" && !!document.getElementById("bottom-bar") && !!window.desktopWindow'), 40000);
}

async function prepare() {
  await cdp.eval(`(()=>{
    document.body.classList.remove('lf-auth-locked','home-controls-locked','immersive-mode','splash-active');
    document.querySelectorAll('#lf-auth-root,#visual-guide,.modal-mask').forEach(n=>{n.classList.remove('show');n.style.setProperty('display','none','important');n.style.setProperty('pointer-events','none','important');});
    const bar=document.getElementById('bottom-bar');bar.classList.add('visible');bar.classList.remove('soft-hidden');bar.style.pointerEvents='auto';
    document.body.classList.add('controls-visible');
    const title=document.querySelector('.control-title');const artist=document.querySelector('.control-artist');if(title)title.textContent='LumiField 响应式播放器测试曲目';if(artist)artist.textContent='LumiField QA';
    return true;
  })()`);
}

async function measure(profile, mode) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, mobile: false, screenWidth: profile.width, screenHeight: profile.height });
  await cdp.eval(`(()=>{const b=document.getElementById('bottom-bar');b.classList.toggle('stage-mode',${JSON.stringify(mode === 'stage')});window.dispatchEvent(new Event('resize'));return true;})()`);
  await delay(450);
  return cdp.eval(`(()=>{
    const rect=n=>n&&n.getBoundingClientRect().toJSON();
    const style=n=>n&&getComputedStyle(n);
    const bar=document.getElementById('bottom-bar'),controls=document.getElementById('controls'),progress=document.getElementById('progress-bar');
    const clusters=[...document.querySelectorAll('.control-cluster')];
    const buttons=[...bar.querySelectorAll('button')].filter(n=>style(n).display!=='none'&&style(n).visibility!=='hidden');
    const br=rect(bar),cr=rect(controls),pr=rect(progress);
    const inside=r=>r&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
    return {
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},mode:${JSON.stringify(mode)},bar:br,controls:cr,progress:pr,
      inside:inside(br)&&inside(cr)&&inside(pr),
      clusters:clusters.map(n=>({name:n.className,rect:rect(n),inside:inside(rect(n))})),
      buttons:buttons.map(n=>({id:n.id||n.getAttribute('aria-label')||'',rect:rect(n),font:parseFloat(style(n).fontSize)||0})),
      cover:rect(document.querySelector('.control-cover')),titleFont:parseFloat(style(document.querySelector('.control-title')).fontSize)||0,
      play:rect(document.getElementById('play-btn')),time:rect(document.getElementById('time-display')),
      overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight
    };
  })()`);
}

async function runProfiles() {
  const profiles = [
    { name: '1440x900-dpr1', width: 1440, height: 900, dpr: 1 },
    { name: '1280x720-dpr125', width: 1280, height: 720, dpr: 1.25 },
    { name: '960x540-dpr150', width: 960, height: 540, dpr: 1.5 },
    { name: '960x540-dpr200', width: 960, height: 540, dpr: 2 },
  ];
  const results = [];
  for (const mode of ['home', 'stage']) {
    for (const profile of profiles) {
      const state = await measure(profile, mode);
      results.push({ profile, state });
      pass(`${mode} ${profile.name} player stays inside viewport`, state.inside && state.clusters.every(x => x.inside) && state.overflowX <= 1 && state.overflowY <= 1, state);
      pass(`${mode} ${profile.name} controls remain usable`, state.buttons.every(x => x.rect.width >= 24 && x.rect.height >= 24) && state.play.width >= 46 && state.progress.width >= 300, { buttons: state.buttons, play: state.play, progress: state.progress });
      await cdp.screenshot(`${mode}-${profile.name}.png`);
    }
  }
  for (const mode of ['home', 'stage']) {
    const group = results.filter(x => x.state.mode === mode);
    const baseline = group[0].state;
    group.slice(1).forEach(({ profile, state }) => {
      pass(`${mode} ${profile.name} does not enlarge player controls`, state.play.width <= baseline.play.width + 0.5 && state.play.height <= baseline.play.height + 0.5 && state.cover.width <= baseline.cover.width + 0.5 && state.titleFont <= baseline.titleFont + 0.1 && Math.max(...state.buttons.map(x => x.rect.width)) <= Math.max(...baseline.buttons.map(x => x.rect.width)) + 0.5, { baseline: { play: baseline.play, cover: baseline.cover, titleFont: baseline.titleFont }, current: { play: state.play, cover: state.cover, titleFont: state.titleFont } });
    });
  }
  return results;
}

async function stop() {
  if (cdp) { try { await cdp.eval('window.close();true'); } catch (_) {} cdp.close(); }
  if (app && app.pid && app.exitCode == null) await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  await start(); await prepare(); const profiles = await runProfiles();
  pass('renderer errors are zero', rendererErrors.length === 0, rendererErrors);
  pass('console errors are zero', consoleErrors.length === 0, consoleErrors);
  const result = { ok: true, runId, evidenceDir, checks, screenshots, rendererErrors, consoleErrors, profiles };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, evidenceDir, checkCount: Object.keys(checks).length, screenshots: screenshots.length }, null, 2));
}

run().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; }).finally(async () => { try { fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('')); } catch (_) {} await stop(); });
