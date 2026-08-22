'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const fallbackDependencies = path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT ||
  (fs.existsSync(path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'))
    ? path.join(repo, 'node_modules')
    : fallbackDependencies);
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-25-wallpaper-renderer', new Date().toISOString().replace(/[:.]/g, '-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-25-wallpaper-'));
const checks = {};
const rendererErrors = [];
const appLog = [];
let app = null;
let mainCdp = null;
let wallpaperCdp = null;
let lyricsCdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive: true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({ version:2, validated:true, testIsolation:true, results:[] }));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
}
async function waitFor(fn, timeout = 45000, interval = 80) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
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

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'renderer exception'));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function listTargets(port) {
  return (await fetch(`http://127.0.0.1:${port}/json/list`, { signal:AbortSignal.timeout(2500) })).json();
}
async function sampleDrawRate(cdp, durationMs) {
  const before = await cdp.evaluate(`window.__lfWallpaperPerfDebug()`);
  const started = Date.now();
  await delay(durationMs);
  const after = await cdp.evaluate(`window.__lfWallpaperPerfDebug()`);
  const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
  return { before, after, fps:(after.drawFrames - before.drawFrames) / elapsed };
}

async function run() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const mainSource = fs.readFileSync(path.join(repo, 'desktop', 'main.js'), 'utf8');
  pass('large update packages are hashed by stream instead of a synchronous full-file allocation',
    /function sha256LFUpdateFile\(filePath\)[\s\S]*?fs\.createReadStream\(filePath\)/.test(mainSource) &&
      !/createHash\('sha256'\)\.update\(fs\.readFileSync\(filePath\)\)/.test(mainSource));
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo,
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
    env:{ ...process.env, LF_MASTER_TEST:'1', LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' }
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const mainTarget = await waitFor(async () => (await listTargets(port)).find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url)), 60000);
  mainCdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await mainCdp.connect();
  await waitFor(() => mainCdp.evaluate(`document.readyState==='complete' && !!window.desktopWindow && typeof desktopWindow.setWallpaperMode==='function'`), 60000);
  const opened = await mainCdp.evaluate(`desktopWindow.setWallpaperMode(true,{playing:false,opacity:1,cover:'',colors:{primary:'#d6f8ff',secondary:'#9cffdf',highlight:'#fff0b8',glow:'#9cffdf'}})`);
  pass('wallpaper window opens through the production IPC', opened && opened.ok === true, opened);

  const wallpaperTarget = await waitFor(async () => (await listTargets(port)).find(item => item.type === 'page' && /\/wallpaper\.html(?:$|[?#])/i.test(item.url)), 30000);
  wallpaperCdp = new CDP(wallpaperTarget.webSocketDebuggerUrl);
  await wallpaperCdp.connect();
  await wallpaperCdp.send('Page.bringToFront').catch(() => {});
  const initial = await waitFor(() => wallpaperCdp.evaluate(`typeof window.__lfWallpaperPerfDebug==='function' && window.__lfWallpaperPerfDebug()`), 30000);
  pass('wallpaper canvas uses a bounded backing store and initialized caches', initial.backingPixels > 0 && initial.backingPixels <= 9000000 && initial.particleCount >= 420 && initial.particleCount <= 760, initial);

  const paused = await sampleDrawRate(wallpaperCdp, 2400);
  pass('paused visible wallpaper is capped near 5 FPS', paused.after.targetFps === 5 && paused.fps >= 3 && paused.fps <= 7.5, paused);
  const playingUpdate = await mainCdp.evaluate(`desktopWindow.updateWallpaperMode({enabled:true,playing:true})`);
  pass('playing state reaches the existing wallpaper window', playingUpdate && playingUpdate.ok === true, playingUpdate);
  await waitFor(() => wallpaperCdp.evaluate(`window.__lfWallpaperPerfDebug().targetFps===30`), 5000);
  const playing = await sampleDrawRate(wallpaperCdp, 2400);
  pass('playing wallpaper is capped near 30 FPS without falling back to full refresh', playing.after.targetFps === 30 && playing.fps >= 20 && playing.fps <= 36, playing);
  pass('frame gate skips excess display refresh callbacks', playing.after.skippedFrames > playing.before.skippedFrames, playing);

  const closed = await mainCdp.evaluate(`desktopWindow.setWallpaperMode(false,{})`);
  pass('wallpaper window closes through the production IPC', closed && closed.ok === true, closed);
  await waitFor(async () => !(await listTargets(port)).some(item => item.type === 'page' && /\/wallpaper\.html(?:$|[?#])/i.test(item.url)), 10000);

  const lyricsOpened = await mainCdp.evaluate(`desktopWindow.setDesktopLyricsEnabled(true,{enabled:true,playing:false,text:'LumiField overlay performance',frameRate:60})`);
  pass('desktop lyrics overlay opens through the production IPC', lyricsOpened && lyricsOpened.ok === true, lyricsOpened);
  const lyricsTarget = await waitFor(async () => (await listTargets(port)).find(item => item.type === 'page' && /\/desktop-lyrics\.html(?:$|[?#])/i.test(item.url)), 30000);
  lyricsCdp = new CDP(lyricsTarget.webSocketDebuggerUrl);
  await lyricsCdp.connect();
  const pausedInterval = await waitFor(() => lyricsCdp.evaluate(`typeof frameIntervalMs==='function' && frameIntervalMs()`), 30000);
  pass('paused desktop lyrics reduce continuous animation to 8 FPS', Math.abs(pausedInterval - 125) < 0.1, pausedInterval);
  const playingInterval = await lyricsCdp.evaluate(`window.__lumifieldDesktopLyricsApplyState({enabled:true,playing:true,frameRate:60});frameIntervalMs()`);
  pass('playing desktop lyrics retain the configured 60 FPS path', playingInterval >= 16 && playingInterval <= 17.2, playingInterval);
  const lyricsClosed = await mainCdp.evaluate(`desktopWindow.setDesktopLyricsEnabled(false,{})`);
  pass('desktop lyrics overlay closes through the production IPC', lyricsClosed && lyricsClosed.ok === true, lyricsClosed);
  await waitFor(async () => !(await listTargets(port)).some(item => item.type === 'page' && /\/desktop-lyrics\.html(?:$|[?#])/i.test(item.url)), 10000);
  pass('overlay runtimes emit no renderer exception', rendererErrors.length === 0, rendererErrors);
}

async function stop() {
  if (lyricsCdp) lyricsCdp.close();
  if (wallpaperCdp) wallpaperCdp.close();
  if (mainCdp) {
    try { await mainCdp.send('Browser.close', {}, 4000); } catch (_) {}
    mainCdp.close();
  }
  if (app && app.exitCode == null) await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  if (app && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

(async () => {
  let error = null;
  try { await run(); } catch (caught) { error = caught; process.exitCode = 1; }
  finally {
    await stop();
    const result = { task:'v1.1.44-problem-25-wallpaper-renderer', status:error ? 'FAIL' : 'PASS', checkCount:Object.keys(checks).length, checks, rendererErrors, appLog:appLog.join('').slice(-12000), error:error && String(error.stack || error) };
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status:result.status, checkCount:result.checkCount, evidenceDir, error:result.error || null }, null, 2));
  }
})();
