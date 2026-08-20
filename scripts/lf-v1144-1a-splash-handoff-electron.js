'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-1a-splash-handoff', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-1a-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
let app = null;
let splash = null;
let main = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(fn, timeout = 60000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}

class CDP {
  constructor(url, label) { this.url = url; this.label = label; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(`${this.label}: ${detail.exception && detail.exception.description || detail.text || 'renderer exception'}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push(`${this.label}: ${(message.params.args || []).map(item => item.value || item.description || '').join(' ')}`);
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text);
    return result.result && result.result.value;
  }
  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const file = path.join(evidenceDir, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    screenshots.push(file);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function staticChecks() {
  const splashMain = fs.readFileSync(path.join(repo, 'desktop', 'lf-splash-main.js'), 'utf8');
  const splashPreload = fs.readFileSync(path.join(repo, 'desktop', 'lf-splash-preload.js'), 'utf8');
  const splashHtml = fs.readFileSync(path.join(repo, 'public', 'lf-splash.html'), 'utf8');
  const splashCss = fs.readFileSync(path.join(repo, 'public', 'lf-splash.css'), 'utf8');
  const splashJs = fs.readFileSync(path.join(repo, 'public', 'lf-splash.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(repo, 'desktop', 'main.js'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  pass('splash is present in Windows taskbar', /skipTaskbar:\s*false/.test(splashMain), true);
  pass('splash exposes exactly three native window actions', (splashHtml.match(/data-window-action=/g) || []).length === 3 && /lf-splash-window-action/.test(splashMain + splashPreload), true);
  pass('splash window can maximize and restore', /resizable:\s*true/.test(splashMain) && /win\.isMaximized\(\)[\s\S]*win\.unmaximize\(\)[\s\S]*win\.maximize\(\)/.test(splashMain), true);
  pass('first click freezes unfinished splash animation before IPC', /beginEntryExit\(\);[\s\S]*api\.enter\(\)/.test(splashJs) && /signature\.pause\(\)/.test(splashJs), true);
  pass('handoff primes transparent main surface before retiring splash', /mainWindow\.setOpacity\(0\)[\s\S]*showInactive\(\)[\s\S]*closing\.destroy\(\)[\s\S]*setOpacity\(1\)[\s\S]*revealMain/.test(splashMain), true);
  pass('main route is prepared before ready signal', /LumiFieldPrepareFirstReveal/.test(mainSource) && /window\.LumiFieldPrepareFirstReveal/.test(index), true);
  pass('window controls use reference dark rounded luminous treatment', /border-radius:13px/.test(splashCss) && /drop-shadow\(0 0 3px/.test(splashCss) && /\.desktop-window-btn\{width:44px;height:34px/.test(index), true);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      NODE_PATH: dependencyRoot,
      LF_MASTER_TEST: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    }),
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const splashTarget = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(target => target.type === 'page' && /lf-splash\.html/i.test(target.url));
  }, 45000, 120);
  splash = new CDP(splashTarget.webSocketDebuggerUrl, 'splash');
  await splash.connect();
  await waitFor(() => splash.evaluate('document.readyState==="complete" && !!window.__lfSplashDebug && !document.getElementById("lf-splash-enter").disabled'), 20000);
  return port;
}

async function exerciseSplash(port) {
  const initial = await splash.evaluate(`(async()=>({
    controls:[...document.querySelectorAll('[data-window-action]')].map(b=>({action:b.dataset.windowAction,rect:b.getBoundingClientRect().toJSON(),visible:getComputedStyle(b).visibility!=='hidden'})),
    debug:window.__lfSplashDebug(),
    main:await window.LumiFieldSplash.getMainDebug()
  }))()`);
  pass('three splash controls are visible and non-overlapping', initial.controls.length === 3 && initial.controls.every(item => item.visible && item.rect.width >= 40 && item.rect.height >= 31) && initial.controls[0].rect.right < initial.controls[1].rect.left && initial.controls[1].rect.right < initial.controls[2].rect.left, initial.controls);

  const maxRect = initial.controls.find(item => item.action === 'maximize').rect;
  await splash.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: maxRect.x + maxRect.width / 2, y: maxRect.y + maxRect.height / 2, button: 'left', clickCount: 1 });
  await splash.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: maxRect.x + maxRect.width / 2, y: maxRect.y + maxRect.height / 2, button: 'left', clickCount: 1 });
  const maximized = await waitFor(() => splash.evaluate(`(()=>{const b=document.querySelector('[data-window-action="maximize"]');return b&&b.getAttribute('aria-label')==='还原'&&b.querySelector('.icon-maximize').hidden&& !b.querySelector('.icon-restore').hidden;})()`), 8000);
  pass('maximize action changes to restore semantics', maximized === true, maximized);
  const restoreRect = await splash.evaluate(`document.querySelector('[data-window-action="maximize"]').getBoundingClientRect().toJSON()`);
  await splash.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: restoreRect.x + restoreRect.width / 2, y: restoreRect.y + restoreRect.height / 2, button: 'left', clickCount: 1 });
  await splash.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: restoreRect.x + restoreRect.width / 2, y: restoreRect.y + restoreRect.height / 2, button: 'left', clickCount: 1 });
  await waitFor(() => splash.evaluate(`document.querySelector('[data-window-action="maximize"]').getAttribute('aria-label')==='最大化'`), 8000);

  const enterRect = await splash.evaluate(`document.getElementById('lf-splash-enter').getBoundingClientRect().toJSON()`);
  const clickedAt = Date.now();
  await splash.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: enterRect.x + enterRect.width / 2, y: enterRect.y + enterRect.height / 2, button: 'left', clickCount: 1 });
  await splash.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: enterRect.x + enterRect.width / 2, y: enterRect.y + enterRect.height / 2, button: 'left', clickCount: 1 });
  const immediate = await waitFor(() => splash.evaluate(`(()=>{const d=window.__lfSplashDebug(),root=document.getElementById('lf-splash-root'),sig=document.getElementById('lf-splash-signature');return root.dataset.exiting==='true'&&d.button.clicks===1&&d.button.pending&&sig.paused?{elapsed:performance.now()-d.elapsedMs,debug:d,signatureOpacity:getComputedStyle(document.getElementById('lf-splash-signature-shell')).opacity}:null;})()`), 1200, 20);
  pass('first click locks one transition and immediately stops signature', immediate.debug.button.clicks === 1 && immediate.debug.performance.suspended === true, immediate);
  await delay(180);
  const exitSurface = await splash.evaluate(`(()=>({signatureOpacity:Number(getComputedStyle(document.getElementById('lf-splash-signature-shell')).opacity),status:getComputedStyle(document.getElementById('lf-splash-entry-status')).opacity,canvasCount:document.querySelectorAll('canvas').length,rootBg:getComputedStyle(document.getElementById('lf-splash-root')).backgroundColor}))()`);
  pass('pending handoff removes signature watermark but retains painted backdrop', exitSurface.signatureOpacity === 0 && Number(exitSurface.status) > 0.9 && exitSurface.canvasCount === 2 && exitSurface.rootBg !== 'rgb(0, 0, 0)', exitSurface);
  await splash.screenshot('01-first-click-exit-surface.png');

  const mainTarget = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/?(?:index\.html)?$/i.test(target.url));
  }, 90000, 150);
  main = new CDP(mainTarget.webSocketDebuggerUrl, 'main');
  await main.connect();
  const ready = await waitFor(() => main.evaluate(`(()=>{const state={
    complete:document.readyState==='complete',
    visible:document.visibilityState==='visible',
    home:document.body.classList.contains('empty-home-active'),
    homeRect:document.getElementById('empty-home')&&document.getElementById('empty-home').getBoundingClientRect().toJSON(),
    stageMode:document.getElementById('search-area')&&document.getElementById('search-area').classList.contains('stage-mode'),
    controls:document.querySelectorAll('.desktop-window-btn[data-window-action]').length
  };return state.complete&&state.visible&&state.home&&!state.stageMode&&state.homeRect&&state.homeRect.width>0&&state.controls===3?state:null;})()`), 30000, 100);
  pass('atomic handoff lands directly on visible main route', ready.complete && ready.visible && ready.home && !ready.stageMode && ready.homeRect && ready.homeRect.width > 0 && ready.controls === 3, ready);
  const splashGone = await waitFor(async () => !(await listTargets(port)).some(target => /lf-splash\.html/i.test(target.url)), 10000, 100);
  pass('splash BrowserWindow is fully retired before final state', splashGone === true, { elapsedMs: Date.now() - clickedAt });
  const mainDebug = await main.evaluate(`window.desktopWindow&&window.desktopWindow.getState?window.desktopWindow.getState():null`);
  pass('main native window state is available after handoff', !!mainDebug, mainDebug);
  await main.screenshot('02-main-route-after-handoff.png');
}

async function stopApp() {
  if (splash) splash.close();
  if (main) {
    try { await main.evaluate('window.close();true'); } catch (_) {}
    main.close();
  }
  if (app && app.pid && app.exitCode == null) await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  staticChecks();
  const port = await startApp();
  await exerciseSplash(port);
  pass('renderer errors are zero', rendererErrors.length === 0, rendererErrors);
  pass('console errors are zero', consoleErrors.length === 0, consoleErrors);
  const result = { ok: true, runId, evidenceDir, checks, screenshots, rendererErrors, consoleErrors };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, evidenceDir, checkCount: Object.keys(checks).length, screenshots: screenshots.length }, null, 2));
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('')); } catch (_) {}
  await stopApp();
});
