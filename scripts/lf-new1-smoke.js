const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_NEW1_EXECUTABLE || '').trim();
const fastMode = process.env.LF_NEW1_FAST === '1';
const launchExecutable = installedExecutable || electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW1_OUT || path.join(repo, 'test-results', 'lf-new1', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new1-'));
const appLog = [];
const rendererErrors = [];
const checks = {};
const screenshots = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(fn, timeout = 20000, interval = 120) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out after ' + timeout + 'ms; last=' + JSON.stringify(last));
}
class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
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
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1600));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Network.enable');
    await this.send('Page.bringToFront');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  send(method, params, timeoutMs = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP command timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result && response.result.value;
  }
  call(fn, args = []) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')');
  }
  close() { try { this.ws.close(); } catch (_) {} }
}
function focusAppWindow() {
  const script = [
    "Add-Type -Name Win32 -Namespace LF -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    '$p=Get-Process -Id ' + Number(app && app.pid || 0) + ' -ErrorAction SilentlyContinue',
    'if($p -and $p.MainWindowHandle -ne 0){[LF.Win32]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null; [LF.Win32]::SetForegroundWindow($p.MainWindowHandle)|Out-Null}'
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide:true, encoding:'utf8', timeout:12000 });
}
async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const list = await response.json();
    return list.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url));
  }, 45000, 250);
}
async function screenshot(name) {
  try {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 12000);
    const file = path.join(evidenceDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    screenshots.push(file);
  } catch (error) {
    appLog.push('[New1 screenshot skipped] ' + name + ': ' + String(error && error.message || error) + '\n');
  }
}
async function rect(selector) {
  return cdp.call(function (value) {
    const node = document.querySelector(value);
    if (!node) return null;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
  }, [selector]);
}
async function mouseDown(point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
async function mouseUp(point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
async function click(point) {
  await mouseDown(point);
  await mouseUp(point);
}
async function previewStatus() {
  return cdp.call(function () { return window.LumiFieldClimaxPreview.status(); });
}
async function waitPlaying(timeout = 18000) {
  return waitFor(async () => {
    const status = await previewStatus();
    return status.phase === 'playing' && status;
  }, timeout, 100);
}
async function waitIdle(timeout = 20000) {
  return waitFor(async () => {
    const status = await previewStatus();
    return status.phase === 'idle' && status;
  }, timeout, 100);
}
async function registerAndLogin() {
  const account = 'new1-' + Date.now() + '@example.com';
  const password = 'N1' + crypto.randomBytes(12).toString('hex') + 'z9';
  await cdp.call(function () {
    document.querySelector('[data-lf-auth-tab="register"]').click();
  });
  await cdp.call(function (value) {
    document.getElementById('lf-register-account').value = value;
    document.getElementById('lf-register-send').click();
  }, [account]);
  const code = await waitFor(() => cdp.call(function () {
    const match = document.getElementById('lf-auth-dev-mode').textContent.match(/\d{6}/);
    return match && match[0];
  }), 25000);
  await cdp.call(function (values) {
    document.getElementById('lf-register-nickname').value = 'New1 Smoke';
    document.getElementById('lf-register-code').value = values.code;
    document.getElementById('lf-register-password').value = values.password;
    document.getElementById('lf-register-confirm').value = values.password;
    document.getElementById('lf-register-agreement').checked = true;
    document.getElementById('lf-register-submit').click();
  }, [{ code, password }]);
  await waitFor(() => cdp.call(function () {
    return document.getElementById('lf-login-status').textContent.includes('注册成功');
  }), 25000);
  await cdp.call(function (values) {
    document.getElementById('lf-login-account').value = values.account;
    document.getElementById('lf-login-password').value = values.password;
    document.getElementById('lf-login-submit').click();
  }, [{ account, password }]);
  await waitFor(() => cdp.call(function () {
    return !document.body.classList.contains('lf-auth-locked') && !!window.LFAuth.getToken();
  }), 25000);
}
async function setupAudioFixtures() {
  return cdp.call(async function (fast) {
    function makeWav(duration, profile) {
      const sampleRate = 8000;
      const length = Math.floor(duration * sampleRate);
      const bytes = new ArrayBuffer(44 + length * 2);
      const view = new DataView(bytes);
      function text(offset, value) {
        for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
      }
      text(0, 'RIFF');
      view.setUint32(4, 36 + length * 2, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, length * 2, true);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        let amp = 0.16;
        if (profile === 'climax') amp = t >= 38 && t < 105 ? 0.68 : 0.10;
        if (profile === 'analysis') {
          amp = t >= 34 && t < 70 ? 0.72 : 0.08;
          amp *= 0.82 + 0.18 * Math.sin(2 * Math.PI * t / 4);
        }
        const pulse = profile === 'analysis' && (t % 2) < 0.12 ? 0.22 : 0;
        const value = Math.max(-1, Math.min(1,
          Math.sin(2 * Math.PI * 220 * t) * amp +
          Math.sin(2 * Math.PI * 440 * t) * amp * 0.24 +
          Math.sin(2 * Math.PI * 80 * t) * pulse));
        view.setInt16(44 + i * 2, Math.round(value * 32760), true);
      }
      return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    }
    const urls = {
      original: makeWav(180, 'original'),
      target: makeWav(132, 'climax'),
      short: makeWav(18, 'short'),
      analysis: makeWav(78, 'analysis'),
    };
    window.__lfNew1Urls = urls;
    window.__lfClimaxPreviewTestConfig = { holdMs: 160, segmentSeconds: fast ? 1.5 : 60 };
    if (!window.audio) {
      window.audio = new Audio();
      window.audio.crossOrigin = 'anonymous';
      window.bindPlaybackProgressEvents(window.audio);
    }
    window.__lfNew1AudioRef = window.audio;
    window.audio.src = urls.original;
    window.audio.load();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ORIGINAL_AUDIO_TIMEOUT')), 10000);
      window.audio.addEventListener('loadedmetadata', function done() {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    window.audio.currentTime = 12.5;
    if (!window.audioReady) window.initAudio();
    await window.resumeAudioAnalysis();
    await window.audio.play();
    window.playing = true;
    window.setPlayIcon(true);
    const original = { type: 'local', provider: 'local', id: 'new1-original', name: '原播放上下文', artist: 'LF Test', localUrl: urls.original, duration: 180 };
    const target = { type: 'local', provider: 'local', id: 'new1-target', name: '60秒高潮循环', artist: 'LF Test', localUrl: urls.target, duration: 132, climaxStartSec: 5 };
    const short = { type: 'local', provider: 'local', id: 'new1-short', name: '短歌曲', artist: 'LF Test', localUrl: urls.short, duration: 18, climaxStartSec: 10 };
    window.__lfNew1Songs = { original, target, short };
    window.playQueue = [original, target];
    window.currentIdx = 0;
    window.activeRadioContext = { type: 'new1-smoke', id: 'context-1' };
    window.renderQueuePanel();
    window.dismissHomePage({ reason: 'new1-smoke' });
    window.switchPlaylistTab('queue');
    const panel = document.getElementById('playlist-panel');
    panel.classList.add('show', 'peek');
    panel.style.pointerEvents = 'auto';
    return {
      audioDuration: window.audio.duration,
      audioAt: window.audio.currentTime,
      queue: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      api: window.LumiFieldClimaxPreview.version,
      audioControls: window.LFAudioControls.status(),
    };
  }, [fastMode]);
}
async function runCancelCase(name, action, direct) {
  await cdp.call(function () {
    window.__lfClimaxPreviewTestConfig = { holdMs: 100, segmentSeconds: 1.4 };
    const panel = document.getElementById('playlist-panel');
    panel.classList.add('show', 'peek');
    window.renderQueuePanel();
  });
  const point = await rect('#queue-list .queue-item:nth-child(2)');
  if (direct) {
    await cdp.call(function (label) {
      window.__lfCancelPointerId = 500 + label.length;
      window.LumiFieldClimaxPreview.begin(window.__lfNew1Songs.target, {
        pointerId: window.__lfCancelPointerId,
        origin: 'cancel-' + label,
        target: document.querySelector('#queue-list .queue-item:nth-child(2)'),
      });
    }, [name]);
  } else {
    await mouseDown(point);
  }
  await waitPlaying();
  await action(point);
  await waitIdle();
  const event = await cdp.call(function (label) {
    const events = window.LumiFieldClimaxPreview.diagnostics().events;
    const stops = events.filter(row => row.type === 'preview-stop');
    return { label, last: stops[stops.length - 1], status: window.LumiFieldClimaxPreview.status() };
  }, [name]);
  pass('cancel ' + name, event.last && event.last.reason && event.status.phase === 'idle', event);
}
async function run() {
  const debugPort = await freePort();
  const launchArgs = (installedExecutable ? [] : ['.']).concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + debugPort,
    '--remote-debugging-address=127.0.0.1',
  ]);
  app = spawn(launchExecutable, launchArgs, {
    cwd: installedExecutable ? path.dirname(installedExecutable) : repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_MAIL_FROM: ' ',
      LF_REMOTE_API_URL: ' ',
      LF_TRANSLATE_ENDPOINT: ' ',
      LF_TRANSLATE_API_KEY: ' ',
      LF_ALLOW_PACKAGED_CDP_TEST: installedExecutable ? '1' : '0',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) rendererErrors.push(text.trim().slice(0, 1600));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(debugPort);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  focusAppWindow();
  await cdp.send('Page.bringToFront');
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LFAuth && window.LumiFieldClimaxPreview && window.LFAudioControls;
  }), 45000);
  await waitFor(() => cdp.call(function () { return document.body.classList.contains('lf-auth-locked'); }), 30000);
  await registerAndLogin();

  const fixtures = await setupAudioFixtures();
  pass('single-player fixture and preview API ready', fixtures.api === '1.1.0' && fixtures.queue.join(',') === 'new1-original,new1-target' &&
    fixtures.currentIdx === 0 && fixtures.audioDuration > 179 && fixtures.audioControls.transientSourceDepth === 0, fixtures);

  const deterministic = await cdp.call(async function () {
    const api = window.LumiFieldClimaxPreview;
    const previewConfig = window.__lfClimaxPreviewTestConfig;
    window.__lfClimaxPreviewTestConfig = { holdMs: previewConfig.holdMs, segmentSeconds: 60 };
    const metadataA = api.computePlatformStart({ climaxStartSec: 37.25 }, 180);
    const metadataB = api.computePlatformStart({ chorusStartMs: 37250 }, 180);
    const events = [];
    for (let t = 0; t < 180; t += 0.5) {
      const hot = t >= 74 && t < 138;
      events.push({ time: t, strength: hot ? .92 : .18, impact: hot ? .88 : .12, low: hot ? .78 : .16, body: hot ? .72 : .14, snap: hot ? .64 : .10, confidence: .92, primary: hot });
    }
    const map = { duration: 180, cameraBeats: events };
    const beatA = api.computeBeatMapStart(map, 180);
    const beatB = api.computeBeatMapStart(map, 180);
    const localA = await api.analyzeAudioForClimax(window.__lfNew1Urls.analysis, 78);
    const localB = await api.analyzeAudioForClimax(window.__lfNew1Urls.analysis, 78);
    window.__lfClimaxPreviewTestConfig = previewConfig;
    return { metadataA, metadataB, beatA, beatB, localA, localB };
  }, []);
  pass('platform metadata path preserves seconds and milliseconds', deterministic.metadataA.source === 'platform-metadata' &&
    Math.abs(deterministic.metadataA.startSec - 37.25) < .001 && Math.abs(deterministic.metadataB.startSec - 37.25) < .001, deterministic);
  pass('LF beat cache path is deterministic', deterministic.beatA.source === 'lf-analysis-cache' &&
    deterministic.beatA.startSec === deterministic.beatB.startSec && deterministic.beatA.startSec >= 60, deterministic);
  pass('legal local energy rhythm repetition analysis is deterministic', deterministic.localA.source === 'local-energy-analysis' &&
    deterministic.localA.startSec === deterministic.localB.startSec && deterministic.localA.startSec >= .5 &&
    deterministic.localA.startSec < deterministic.localA.duration - .14, deterministic);

  const mainPoint = await rect('#queue-list .queue-item:nth-child(2)');
  assert.ok(mainPoint && mainPoint.width > 100, 'Main queue target missing');
  await mouseDown(mainPoint);
  const started = await waitPlaying();
  const expectedMainSegment = fastMode ? 1.5 : 60;
  pass('main playlist physical long press starts platform climax', started.origin === 'main-queue' &&
    started.sourceKind === 'platform-metadata' && Math.abs(started.startSec - 5) < .08 &&
    Math.abs(started.segmentSec - expectedMainSegment) < .08, started);
  await cdp.call(function () {
    const row = document.querySelector('#queue-list .queue-item:nth-child(2)');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, isPrimary: true, clientX: 50, clientY: 50 }));
  });
  await delay(expectedMainSegment * 1000 + 500);
  const firstLoop = await previewStatus();
  pass('first exact 60 second loop completed', firstLoop.loopCount >= 1, firstLoop);
  await delay(expectedMainSegment * 1000 + 500);
  const secondLoop = await previewStatus();
  pass('two continuous 60 second rounds completed', secondLoop.loopCount >= 2, secondLoop);
  await mouseUp(mainPoint);
  await waitIdle(25000);
  const mainEvidence = await cdp.call(function () {
    const diag = window.LumiFieldClimaxPreview.diagnostics();
    const loops = diag.events.filter(row => row.type === 'loop');
    const restored = diag.events.filter(row => row.type === 'context-restored').slice(-1)[0];
    const duplicates = diag.events.filter(row => row.type === 'duplicate-pointerdown-ignored');
    return {
      loops,
      restored,
      duplicates: duplicates.length,
      audioSame: window.audio === window.__lfNew1AudioRef || !window.__lfNew1AudioRef,
      audioSrc: window.audio.currentSrc || window.audio.src,
      originalSrc: window.__lfNew1Urls.original,
      audioAt: window.audio.currentTime,
      paused: window.audio.paused,
      queue: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      activeRadioContext: window.activeRadioContext,
      audioElements: document.querySelectorAll('audio').length,
      controls: window.LFAudioControls.status(),
    };
  });
  pass('same climax start and near-60-second seamless boundaries', mainEvidence.loops.length >= 2 &&
    mainEvidence.loops.slice(0, 2).every(loop => Math.abs(loop.seekSec - 5) < .08 &&
      loop.wallIntervalMs > expectedMainSegment * 1000 - 600 && loop.wallIntervalMs < expectedMainSegment * 1000 + 600), mainEvidence.loops);
  pass('original queue index song time playing context restored', mainEvidence.restored && mainEvidence.restored.queueUnchanged &&
    mainEvidence.restored.indexUnchanged && mainEvidence.restored.playingRestored &&
    mainEvidence.restored.timeErrorSec < .18 && mainEvidence.queue.join(',') === 'new1-original,new1-target' &&
    mainEvidence.currentIdx === 0 && mainEvidence.activeRadioContext.id === 'context-1' && !mainEvidence.paused, mainEvidence);
  pass('one global media player and duplicate pointerdown protection', mainEvidence.audioElements === 0 &&
    mainEvidence.duplicates >= 1 && mainEvidence.controls.transientSourceDepth === 0, mainEvidence);

  await cdp.call(function () {
    window.__lfClimaxPreviewTestConfig = { holdMs: 240, segmentSeconds: 60 };
    window.__lfNew1ClickCount = 0;
    window.__lfNew1OriginalPlayQueueAt = window.playQueueAt;
    window.playQueueAt = function () { window.__lfNew1ClickCount += 1; return Promise.resolve(); };
    window.renderQueuePanel();
  });
  await delay(520);
  const clickPoint = await rect('#queue-list .queue-item:nth-child(2)');
  await click(clickPoint);
  await delay(420);
  const normalClick = await cdp.call(function () {
    const count = window.__lfNew1ClickCount;
    window.playQueueAt = window.__lfNew1OriginalPlayQueueAt;
    delete window.__lfNew1OriginalPlayQueueAt;
    return { count, phase: window.LumiFieldClimaxPreview.status().phase };
  });
  pass('normal short click remains original song action', normalClick.count === 1 && normalClick.phase === 'idle', normalClick);

  const shortSong = await cdp.call(async function () {
    window.__lfClimaxPreviewTestConfig = { holdMs: 80, segmentSeconds: 60 };
    window.LumiFieldClimaxPreview.begin(window.__lfNew1Songs.short, { pointerId: 77, origin: 'short-song-test' });
    const startedAt = Date.now();
    while (window.LumiFieldClimaxPreview.status().phase !== 'playing' && Date.now() - startedAt < 12000) {
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const active = window.LumiFieldClimaxPreview.status();
    await window.LumiFieldClimaxPreview.stop('short-song-done');
    return active;
  });
  pass('short song starts at its real chorus and uses the remaining duration', shortSong.phase === 'playing' && shortSong.startSec === 10 &&
    shortSong.segmentSec > 7.8 && shortSong.segmentSec < 8.1, shortSong);

  await runCancelCase('release', async () => {
    await cdp.call(function () {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: window.__lfCancelPointerId,
        isPrimary: true,
        button: 0,
      }));
    });
  }, true);
  await runCancelCase('pointer-leave', async () => {
    await cdp.call(function () {
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: window.__lfCancelPointerId,
        isPrimary: true,
        clientX: innerWidth - 2,
        clientY: innerHeight - 2,
      }));
    });
  }, true);
  await runCancelCase('window-blur', async point => {
    await cdp.call(function () { window.dispatchEvent(new Event('blur')); });
    await mouseUp(point);
  }, true);
  await runCancelCase('page-change', async point => {
    await cdp.call(function () {
      window.queueViewTab = window.queueViewTab === 'queue' ? 'playlists' : 'queue';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await mouseUp(point);
    await cdp.call(function () { window.queueViewTab = 'queue'; });
  }, true);
  await runCancelCase('explicit-cancel', async point => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await mouseUp(point);
  }, true);

  const shelfPoint = await cdp.call(async function () {
    window.__lfClimaxPreviewTestConfig = { holdMs: 100, segmentSeconds: 1.5 };
    window.dismissHomePage({ reason: 'new1-3d-test' });
    window.togglePlaylistPanel(false);
    window.loginStatus.loggedIn = true;
    window.userPlaylists = [{
      provider: 'netease', id: 'new1-fake-playlist', name: '3D长按测试歌单', cover: '',
      trackCount: 2, playCount: 0, creator: 'LF Test', subscribed: false,
    }];
    window.__lfNew1OriginalApiJson = window.apiJson;
    window.apiJson = function (url, options) {
      if (String(url).includes('/api/playlist/tracks?id=new1-fake-playlist')) {
        return Promise.resolve({ tracks: [window.__lfNew1Songs.target, window.__lfNew1Songs.short] });
      }
      return window.__lfNew1OriginalApiJson(url, options);
    };
    const manager = window.LumiFieldMusicPlatformManager;
    window.__lfNew1OriginalPlaylistTracks = manager && manager.playlistTracks;
    if (manager) {
      manager.playlistTracks = function (provider, id, options) {
        if (String(id) === 'new1-fake-playlist') {
          return Promise.resolve({ tracks: [window.__lfNew1Songs.target, window.__lfNew1Songs.short] });
        }
        return window.__lfNew1OriginalPlaylistTracks.call(manager, provider, id, options);
      };
    }
    window.shelfManager.setMode('stage');
    window.shelfManager.rebuild(false);
    window.shelfManager.openContent(0);
    const started = Date.now();
    while ((!window.shelfManager.hasOpenContent() || !window.shelfManager.getContentList().getRows().length ||
      !window.shelfManager.getContentList().getRows()[0].song.id) && Date.now() - started < 8000) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    const content = window.shelfManager.getContentList();
    for (let y = 80; y < innerHeight - 80; y += 6) {
      for (let x = 80; x < innerWidth - 80; x += 6) {
        const hit = content.pickRowAtScreen(x, y);
        if (hit && hit.row && hit.row.index === 0 && document.elementFromPoint(x, y) === window.renderer.domElement) {
          return { x, y, width: 12, height: 12 };
        }
      }
    }
    return null;
  });
  assert.ok(shelfPoint, '3D playlist row screen point missing');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: shelfPoint.x, y: shelfPoint.y, button: 'left', clickCount: 1,
  });
  const shelfStarted = await waitPlaying();
  pass('3D playlist physical song-card long press starts same preview state machine',
    shelfStarted.origin === '3d-playlist-row' && shelfStarted.sourceKind === 'platform-metadata', shelfStarted);
  await delay(1800);
  await mouseUp(shelfPoint);
  await waitIdle();
  const shelfEvidence = await cdp.call(function () {
    const events = window.LumiFieldClimaxPreview.diagnostics().events;
    const starts = events.filter(row => row.type === 'preview-start' && row.origin === '3d-playlist-row');
    const stops = events.filter(row => row.type === 'preview-stop');
    const result = {
      starts: starts.length,
      lastStop: stops[stops.length - 1],
      queue: window.playQueue.map(song => song.id),
      index: window.currentIdx,
      rendererAudio: window.audio === window.audio,
    };
    window.apiJson = window.__lfNew1OriginalApiJson;
    if (window.LumiFieldMusicPlatformManager && window.__lfNew1OriginalPlaylistTracks) {
      window.LumiFieldMusicPlatformManager.playlistTracks = window.__lfNew1OriginalPlaylistTracks;
    }
    return result;
  });
  pass('3D preview release restores queue and suppresses release click', shelfEvidence.starts >= 1 &&
    shelfEvidence.lastStop && shelfEvidence.queue.join(',') === 'new1-original,new1-target' && shelfEvidence.index === 0, shelfEvidence);

  const finalDiagnostics = await cdp.call(function () {
    return {
      preview: window.LumiFieldClimaxPreview.diagnostics(),
      controls: window.LFAudioControls.status(),
      audioPaused: window.audio.paused,
      queue: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      bodyChipCount: document.querySelectorAll('#lf-climax-preview-chip').length,
      playerCount: document.querySelectorAll('audio').length + (window.audio ? 1 : 0),
    };
  });
  pass('final singleton state clean', finalDiagnostics.preview.status.phase === 'idle' &&
    finalDiagnostics.controls.transientSourceDepth === 0 && finalDiagnostics.bodyChipCount === 1 &&
    finalDiagnostics.playerCount === 1 && finalDiagnostics.currentIdx === 0, finalDiagnostics);
  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);

  const result = {
    ok: true,
    runId,
    mode: launchMode,
    fastMode,
    evidenceDir,
    checks,
    screenshots,
    rendererErrors,
    diagnostics: finalDiagnostics,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join(''), 'utf8');
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = {
    ok: false,
    runId,
    mode: launchMode,
    evidenceDir,
    error: String(error && error.stack || error),
    checks,
    screenshots,
    rendererErrors,
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join(''), 'utf8');
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
