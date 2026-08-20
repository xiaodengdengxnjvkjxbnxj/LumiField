'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const materialRoot = 'D:\\HuaweiMoveData\\Users\\35992\\Desktop\\文件13\\LF需新增的内容';
const tiltSource = path.join(materialRoot, '倾斜卡', '倾斜卡.完整源码以及原组件页面链接.txt');
const spotlightSource = path.join(materialRoot, '卡片聚光灯', '卡片聚光灯.原组件页面链接以及完整源码.txt');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-20-weather-tilt-spotlight', new Date().toISOString().replace(/[:.]/g, '-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
async function waitFor(fn, timeout = 30000, interval = 70) {
  const started = Date.now(); let last = null;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

function sourceChecks() {
  const source = fs.readFileSync(path.join(repo, 'public', 'lf-weather-tilt-spotlight.js'), 'utf8');
  const css = fs.readFileSync(path.join(repo, 'public', 'lf-weather-tilt-spotlight.css'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const tiltRecord = fs.readFileSync(path.join(repo, 'docs', 'licenses', '21st', 'tilt-card', 'SOURCE_AND_LICENSE.md'), 'utf8');
  const spotlightRecord = fs.readFileSync(path.join(repo, 'docs', 'licenses', '21st', 'spotlight-card', 'SOURCE_AND_LICENSE.md'), 'utf8');
  pass('fixed complete-source hashes match the supplied Tilt and Spotlight files', sha256File(tiltSource) === 'B25404B04AFD4348C464D24A2F68C8CA1BF88E2BD94150BEDFCEE61AE00616BB' && sha256File(spotlightSource) === '6389B777EB96E0EB2BE49632B452BAFD5BA53FCD5B6B0CBAC8CFE89836F38E6E', true);
  pass('the product loads exactly one weather effect script and stylesheet', (index.match(/\/lf-weather-tilt-spotlight\.js/g) || []).length === 1 && (index.match(/\/lf-weather-tilt-spotlight\.css/g) || []).length === 1, true);
  pass('Tilt source defaults and evade pointer formula are retained', /TILT_LIMIT = 15/.test(source) && /HOVER_SCALE = 1\.05/.test(source) && /PERSPECTIVE = 1200/.test(source) && /EFFECT = 'evade'/.test(source) && /\(py - 0\.5\) \* \(TILT_LIMIT \* 2\)/.test(source) && /\(px - 0\.5\) \* -\(TILT_LIMIT \* 2\)/.test(source), true);
  pass('Tilt spotlight retains source size gradient and transition', /width: 200%/.test(css) && /height: 200%/.test(css) && /rgba\(255,255,255,\.15\) 0%,transparent 40%/.test(css) && /transition: opacity \.3s/.test(css) && /transition: transform \.2s ease-out/.test(css), true);
  pass('Card Spotlight retains source blue hue spread size border and fixed-background layers', /GLOW_BASE = 220/.test(source) && /GLOW_SPREAD = 200/.test(source) && /GLOW_SIZE = 200/.test(source) && /GLOW_BORDER = 3/.test(source) && (css.match(/background-attachment: fixed/g) || []).length >= 2 && /filter: brightness\(2\)/.test(css) && /\* \.75/.test(css) && /\* \.5/.test(css), true);
  pass('weather integration owns no pointer listener RAF or interval', !/addEventListener\(['"]pointer/.test(source) && !/requestAnimationFrame|setInterval/.test(source) && /addPointerConsumer\(updateFromSharedPointer\)/.test(source), true);
  pass('only the whole weather shell is targeted and the auto-rotating song region has no nested layer', /#empty-home \.lf-weather-shell/.test(source) && /:scope > \.lf-hot-comment-card/.test(source) && !/lf-hot-comment-card[^\n]+appendChild/.test(source), true);
  pass('source and rights records preserve the precise component-specific license boundaries', /MIT_PASS_WITH_NOTICE/.test(tiltRecord) && /Spell UI/.test(tiltRecord) && /LICENSE_BLOCKED_PENDING_AUTHOR_AUTHORIZATION/.test(spotlightRecord) && /Jhey Tompkins/.test(spotlightRecord), true);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'renderer exception'));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable'); await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression, timeout = 30000) {
    const value = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true }, timeout);
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text);
    return value.result && value.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

let app = null;
let cdp = null;
let debugPort = 0;
let runtimeUserData = '';
async function targets() { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); }

async function move(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y, buttons:0, pointerType:'mouse' });
  await delay(120);
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  runtimeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-p20-'));
  fs.mkdirSync(path.join(runtimeUserData, 'migrations'), { recursive:true });
  fs.writeFileSync(path.join(runtimeUserData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({ version:2, validated:true, testIsolation:true, results:[] }), { mode:0o600 });
  debugPort = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${runtimeUserData}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:Object.assign({}, process.env, { NODE_PATH:dependencyRoot, LF_MASTER_TEST:'1', LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' }),
  });
  const collect = chunk => appLog.push(String(chunk)); app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const list = await targets();
    return list.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldWeatherTiltSpotlight&&!!window.LumiFieldLiquidGlass`), 60000);
  await cdp.evaluate(`(()=>{let style=document.getElementById('lf-p20-clean');if(!style){style=document.createElement('style');style.id='lf-p20-clean';style.textContent='#lf-auth-root,#visual-guide,.visual-guide-scrim,#drop-overlay,.modal-mask{display:none!important;visibility:hidden!important;pointer-events:none!important}';document.head.appendChild(style);}document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep','render-background-eco','immersive-mode','controls-visible');document.body.classList.add('empty-home-active');LumiFieldLiquidGlass.setTestMode({reducedMotion:false,eco:false,supported:true});LumiFieldWeatherTiltSpotlight.refresh();return true;})()`);
  await waitFor(async () => {
    const value = await cdp.evaluate(`(()=>{const d=LumiFieldWeatherTiltSpotlight.getDebug(),r=document.querySelector('#empty-home .lf-weather-shell')?.getBoundingClientRect();return d.initialized&&d.targetCount===1&&d.tiltLayerCount===1&&d.glowLayerCount===1&&r&&r.width>200&&r.height>150&&d;})()`);
    return value;
  });
}

async function runtimeChecks() {
  await move(1, 1);
  const baseline = await cdp.evaluate(`(()=>{const root=document.querySelector('#empty-home .lf-weather-shell'),hot=root.querySelector(':scope > .lf-hot-comment-card'),input=document.getElementById('lf-weather-city-input'),r=root.getBoundingClientRect();return{rect:{left:r.left,top:r.top,width:r.width,height:r.height},offset:{w:root.offsetWidth,h:root.offsetHeight},hot:hot?{w:hot.offsetWidth,h:hot.offsetHeight,left:hot.offsetLeft,top:hot.offsetTop}:null,input:{w:input.offsetWidth,h:input.offsetHeight},layers:[...root.children].filter(n=>/lf-weather-(?:tilt|card)-spotlight/.test(n.className)).map(n=>({className:n.className,pointer:getComputedStyle(n).pointerEvents,aria:n.getAttribute('aria-hidden')})),debug:LumiFieldWeatherTiltSpotlight.getDebug()};})()`);
  pass('runtime creates one pointer-transparent Tilt layer and one Card Spotlight layer', baseline.layers.length === 2 && baseline.layers.every(item => item.pointer === 'none' && item.aria === 'true') && baseline.debug.targetCount === 1, baseline);
  pass('the automatic song hot-comment subregion has no nested transform or effect layer', baseline.hot && baseline.debug.nestedEffectCount === 0, { hot:baseline.hot, nestedEffectCount:baseline.debug.nestedEffectCount });

  const x = baseline.rect.left + baseline.rect.width * .2;
  const y = baseline.rect.top + baseline.rect.height * .25;
  await move(x, y);
  await delay(360);
  const active = await waitFor(async () => {
    const value = await cdp.evaluate(`(()=>{const root=document.querySelector('#empty-home .lf-weather-shell'),hot=root.querySelector(':scope > .lf-hot-comment-card'),input=document.getElementById('lf-weather-city-input'),d=LumiFieldWeatherTiltSpotlight.getDebug();return{debug:d,offset:{w:root.offsetWidth,h:root.offsetHeight},hot:hot?{w:hot.offsetWidth,h:hot.offsetHeight,left:hot.offsetLeft,top:hot.offsetTop}:null,input:{w:input.offsetWidth,h:input.offsetHeight},transform:getComputedStyle(root).transform,tiltOpacity:getComputedStyle(root.querySelector(':scope > .lf-weather-tilt-spotlight-layer')).opacity,glowOpacity:getComputedStyle(root.querySelector(':scope > .lf-weather-card-spotlight-layer')).opacity};})()`);
    return value.debug.hovered && value;
  });
  const expectedRotateX = (active.debug.tilt.py - .5) * 30 * -1;
  const expectedRotateY = (active.debug.tilt.px - .5) * -30 * -1;
  pass('evade pointer math produces the source two-axis result', Math.abs(active.debug.tilt.rotateX - expectedRotateX) <= .02 && Math.abs(active.debug.tilt.rotateY - expectedRotateY) <= .02 && active.debug.tilt.rotateX > 4 && active.debug.tilt.rotateY < -4 && active.debug.tilt.effect === 'evade' && active.debug.tilt.limit === 15 && active.debug.tilt.scale === 1.05 && active.debug.tilt.perspective === 1200, { ...active.debug.tilt, expectedRotateX, expectedRotateY });
  pass('both source spotlight surfaces become visible without changing layout dimensions', Number(active.tiltOpacity) > .95 && Number(active.glowOpacity) > .95 && active.offset.w === baseline.offset.w && active.offset.h === baseline.offset.h && JSON.stringify(active.hot) === JSON.stringify(baseline.hot) && active.input.w === baseline.input.w && active.input.h === baseline.input.h, { baseline, active });
  pass('Card Spotlight uses global hue progression and exact source constants', active.debug.spotlight.base === 220 && active.debug.spotlight.spread === 200 && active.debug.spotlight.size === 200 && active.debug.spotlight.border === 3 && Math.abs(active.debug.spotlight.hue - (220 + active.debug.spotlight.xp * 200)) < .2, active.debug.spotlight);

  const inputRect = await cdp.evaluate(`(()=>{const r=document.getElementById('lf-weather-city-input').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:inputRect.x, y:inputRect.y, button:'left', buttons:1, clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:inputRect.x, y:inputRect.y, button:'left', buttons:0, clickCount:1 });
  const hit = await cdp.evaluate(`(()=>{const input=document.getElementById('lf-weather-city-input'),r=input.getBoundingClientRect(),node=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{focused:document.activeElement===input,hitId:node&&node.id,inside:node===input||input.contains(node)};})()`);
  pass('weather text and controls remain physically clickable through every effect layer', hit.focused && hit.inside, hit);

  const shotRect = await cdp.evaluate(`(()=>{const r=document.querySelector('.home-hero').getBoundingClientRect();return{x:Math.max(0,r.left),y:Math.max(0,r.top),width:Math.min(innerWidth-Math.max(0,r.left),r.width),height:Math.min(innerHeight-Math.max(0,r.top),r.height)};})()`);
  const shot = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false, clip:{ ...shotRect, scale:1 } });
  const shotFile = path.join(evidenceDir, 'weather-tilt-spotlight.png');
  fs.writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
  screenshots.push({ file:path.basename(shotFile), bytes:fs.statSync(shotFile).size, sha256:sha256File(shotFile), rect:shotRect });

  await move(1, 1);
  const reset = await waitFor(async () => {
    const value = await cdp.evaluate(`LumiFieldWeatherTiltSpotlight.getDebug()`);
    return !value.hovered && value.tilt.rotateX === 0 && value.tilt.rotateY === 0 && value;
  });
  pass('pointer leave returns the whole panel to one neutral transform', !reset.hovered && reset.tilt.rotateX === 0 && reset.tilt.rotateY === 0, reset);

  await cdp.send('Emulation.setEmulatedMedia', { media:'screen', features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
  await cdp.evaluate(`LumiFieldLiquidGlass.setTestMode({reducedMotion:true,eco:false,supported:true});LumiFieldLiquidGlass.refresh('p20-reduced',true)`);
  await move(baseline.rect.left + baseline.rect.width / 2, baseline.rect.top + baseline.rect.height / 2);
  const reduced = await cdp.evaluate(`(()=>{const root=document.querySelector('#empty-home .lf-weather-shell'),d=LumiFieldWeatherTiltSpotlight.getDebug();return{debug:d,transform:getComputedStyle(root).transform,tiltOpacity:getComputedStyle(root.querySelector(':scope > .lf-weather-tilt-spotlight-layer')).opacity,glowOpacity:getComputedStyle(root.querySelector(':scope > .lf-weather-card-spotlight-layer')).opacity};})()`);
  pass('reduced motion disables Tilt and both moving spotlight effects', !reduced.debug.hovered && reduced.debug.tilt.rotateX === 0 && reduced.debug.tilt.rotateY === 0 && Number(reduced.tiltOpacity) === 0 && Number(reduced.glowOpacity) === 0, reduced);

  await cdp.send('Emulation.setEmulatedMedia', { media:'screen', features:[{ name:'prefers-reduced-motion', value:'no-preference' }] });
  await cdp.evaluate(`document.body.classList.remove('empty-home-active');LumiFieldLiquidGlass.setTestMode({reducedMotion:false,eco:false,supported:true});LumiFieldLiquidGlass.refresh('p20-non-home',true)`);
  await move(baseline.rect.left + baseline.rect.width / 2, baseline.rect.top + baseline.rect.height / 2);
  const nonHome = await cdp.evaluate(`LumiFieldWeatherTiltSpotlight.getDebug()`);
  pass('leaving Home immediately clears the complete weather effect', nonHome.homeActive === false && nonHome.hovered === false && nonHome.tilt.rotateX === 0 && nonHome.tilt.rotateY === 0, nonHome);
  pass('the effect reuses one shared pointer consumer with zero private RAF timer or pointer listener', baseline.debug.resources.sharedPointerConsumer === 1 && baseline.debug.ownPointerListenerCount === 0 && baseline.debug.ownRafCount === 0 && baseline.debug.ownIntervalCount === 0 && baseline.debug.sharedScheduler.pointerConsumerErrors === 0, baseline.debug);
  pass('runtime renderer and console errors remain zero', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
}

async function stopApp() {
  if (cdp) { cdp.close(); cdp = null; }
  if (app && !app.killed) { app.kill(); await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]); }
  app = null;
  if (runtimeUserData) { try { fs.rmSync(runtimeUserData, { recursive:true, force:true }); } catch (_) {} }
}

(async () => {
  let error = null;
  try {
    sourceChecks();
    if (process.env.LF_V1144_P20_STATIC_ONLY !== '1') { await startApp(); await runtimeChecks(); }
  } catch (caught) {
    error = caught; process.exitCode = 1;
  } finally {
    await stopApp();
    const result = { task:'v1.1.44-problem-20-weather-tilt-spotlight', mode:process.env.LF_V1144_P20_STATIC_ONLY === '1' ? 'STATIC_ONLY' : 'SOURCE_ELECTRON_TARGETED', status:error ? 'FAIL' : 'PASS', checkCount:Object.keys(checks).length, checks, screenshots, rendererErrors, consoleErrors, appLog, error:error ? String(error.stack || error) : null };
    const resultPath = path.join(evidenceDir, 'result.json'); fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ status:result.status, mode:result.mode, checkCount:result.checkCount, evidenceDir, resultSha256:sha256File(resultPath) }, null, 2)}\n`);
  }
})();
