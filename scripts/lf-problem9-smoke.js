const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedAsar = String(process.env.LF_TEST_APP_ASAR || '').trim();
let extractedInstalledApp = '';
if (installedAsar) {
  extractedInstalledApp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem9-installed-'));
  require('@electron/asar').extractAll(path.resolve(installedAsar), extractedInstalledApp);
}
const testExecutable = String(process.env.LF_TEST_APP_EXE || '').trim() || electron;
const installedMode = !!installedAsar || testExecutable !== electron;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM9_OUT || path.join(repo, 'test-results', 'lf-problem9-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem9-'));
const rendererErrors = [];
const appLog = [];
const screenshots = [];
const checks = {};
const soakMs = process.argv.includes('--soak') ? 10 * 60 * 1000 : Math.max(0, Number(process.env.LF_PROBLEM9_SOAK_MS) || 0);
let app = null;
let cdp = null;
let origin = '';

fs.mkdirSync(evidenceDir, { recursive: true });

function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
  return details;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        const exception = detail.exception || {};
        rendererErrors.push(String(exception.description || detail.text || 'Renderer exception').slice(0, 1600));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Page.bringToFront');
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    return response.result ? response.result.value : undefined;
  }

  call(fn, args) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')');
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitFor(fn, timeout = 30000, interval = 120) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out after ' + timeout + ' ms; last=' + JSON.stringify(last));
}

async function pageWait(fn, args, timeout) {
  return waitFor(() => cdp.call(fn, args).then(Boolean), timeout || 30000, 120);
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(target.url)) || null;
  }, 45000, 250);
}

async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return { file, data: response.data };
}

function toneWavDataUri(durationSeconds = 2, sampleRate = 44100) {
  const samples = Math.floor(durationSeconds * sampleRate);
  const bytes = 44 + samples * 2;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(bytes - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.min(1, index / 300) * Math.min(1, (samples - index) / 300);
    const pulse = 0.48 + 0.52 * Math.pow(Math.max(0, Math.sin(Math.PI * 4 * time)), 8);
    const value = envelope * pulse * (
      0.42 * Math.sin(Math.PI * 2 * 74 * time) +
      0.24 * Math.sin(Math.PI * 2 * 233 * time) +
      0.16 * Math.sin(Math.PI * 2 * 811 * time) +
      0.10 * Math.sin(Math.PI * 2 * 2701 * time)
    );
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), 44 + index * 2);
  }
  return 'data:audio/wav;base64,' + buffer.toString('base64');
}

async function setSpectrumValue(key, value) {
  const result = await cdp.call(function (values) {
    const selector = '[data-lf-scope="spectrum"][data-lf-key="' + values.key + '"]';
    const input = document.querySelector(selector);
    if (!input) return { ok: false, selector };
    if (input.type === 'checkbox') input.checked = !!values.value;
    else input.value = String(values.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selector, value: input.type === 'checkbox' ? input.checked : input.value };
  }, [{ key, value }]);
  pass('spectrum control exists: ' + key, result && result.ok, result);
  await delay(180);
  return result;
}

async function setSpectrumMode(mode) {
  const result = await cdp.call(function (value) {
    const button = document.querySelector('[data-lf-spectrum-mode="' + value + '"], [data-lf-spectrum-shape="' + (value === 1 ? 'one' : 'three') + '"]');
    if (!button) return { ok: false };
    button.click();
    return { ok: true, text: button.textContent.trim(), value: button.dataset.lfSpectrumMode || button.dataset.lfSpectrumShape };
  }, [mode]);
  pass('spectrum mode control exists: ' + mode, result && result.ok, result);
  await delay(220);
  return result;
}

async function spectrumDiagnostics() {
  return cdp.call(function () {
    const api = window.LumiFieldTask13;
    if (!api) return null;
    const state = api.getState && api.getState().spectrum;
    const raw = typeof api.getSpectrumDebug === 'function' ? api.getSpectrumDebug() :
      (typeof api.getSpectrumDiagnostics === 'function' ? api.getSpectrumDiagnostics() : null);
    return { state, debug: raw };
  });
}

async function screenshotPixels(base64) {
  return cdp.call(async function (png) {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const y0 = Math.floor(canvas.height * 0.24);
    const y1 = Math.floor(canvas.height * 0.76);
    const x0 = Math.floor(canvas.width * 0.12);
    const x1 = Math.floor(canvas.width * 0.88);
    const values = [];
    for (let y = y0; y < y1; y += 5) {
      for (let x = x0; x < x1; x += 5) {
        const data = context.getImageData(x, y, 1, 1).data;
        values.push(data[0], data[1], data[2]);
      }
    }
    return { width: canvas.width, height: canvas.height, values };
  }, [base64]);
}

function pixelDifference(before, after) {
  assert.ok(before && after && before.values.length === after.values.length, 'Comparable screenshot samples required');
  let changed = 0;
  let absolute = 0;
  for (let index = 0; index < before.values.length; index += 1) {
    const delta = Math.abs(before.values[index] - after.values[index]);
    absolute += delta;
    if (delta >= 5) changed += 1;
  }
  return {
    samples: before.values.length,
    changed,
    changedRatio: changed / before.values.length,
    meanAbsoluteDifference: absolute / before.values.length,
  };
}

async function recordLiveProblem9Evidence() {
  return cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const sourceCanvas = window.renderer && window.renderer.domElement;
    if (!api || !sourceCanvas || typeof MediaRecorder !== 'function') throw new Error('Live MediaRecorder prerequisites unavailable');
    window.toggleFxPanel(false);
    window.togglePlaylistPanel(false);
    window.dismissHomePage({ reason: 'problem9-live-evidence' });
    const width = Math.max(640, Math.round(sourceCanvas.clientWidth || innerWidth));
    const height = Math.max(360, Math.round(sourceCanvas.clientHeight || innerHeight));
    const capture = document.createElement('canvas');
    capture.width = width;
    capture.height = height;
    const context = capture.getContext('2d', { alpha: false, desynchronized: true });
    const stream = capture.captureStream(30);
    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = mimeCandidates.find(value => MediaRecorder.isTypeSupported(value)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 3500000 } : { videoBitsPerSecond: 3500000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
    });
    const originalState = Object.assign({}, api.getState().spectrum);
    const originalRotation = window.particles.rotation.toArray();
    const originalRadius = window.orbit.userRadius;
    const parameterLog = [];
    const started = performance.now();
    let label = '形态一 · 中部舞台';
    let composing = true;
    let raf = 0;
    function compactDebug() {
      const value = api.getSpectrumDebug();
      return {
        mode: value.mode,
        requestedBandCount: value.requestedBandCount,
        renderedBandCount: value.renderedBandCount,
        horizontalGap: value.state.horizontalGap,
        actualHorizontalGap: value.actualHorizontalGap,
        heightScale: value.heightScale,
        materialType: value.materialType,
        liquidGlassEnabled: value.liquidGlassEnabled,
        transmission: value.transmission,
        mount: value.mount,
        stageAnchorName: value.stageAnchorName,
        projectedSignature: value.projectedSignature,
        topCount: value.topCount,
        bottomCount: value.bottomCount,
        ghostLayers: value.ghostLayers,
        maxEnergy: value.maxEnergy,
      };
    }
    function mark(nextLabel) {
      label = nextLabel;
      parameterLog.push({ atMs: Math.round(performance.now() - started), label, state: Object.assign({}, api.getState().spectrum), debug: compactDebug() });
    }
    function compose() {
      if (!composing) return;
      context.fillStyle = '#020812';
      context.fillRect(0, 0, width, height);
      try { context.drawImage(sourceCanvas, 0, 0, width, height); } catch (_) {}
      const debug = api.getSpectrumDebug();
      if (debug.mode === 3) {
        const edge = document.getElementById(debug.mount === 'main' ? 'lf-t13-spectrum-main' : 'lf-t13-spectrum');
        if (edge) { try { context.drawImage(edge, 0, 0, width, height); } catch (_) {} }
      }
      context.save();
      context.fillStyle = 'rgba(3,8,16,.72)';
      context.fillRect(18, 18, Math.min(560, width - 36), 58);
      context.strokeStyle = 'rgba(120,229,255,.55)';
      context.strokeRect(18.5, 18.5, Math.min(560, width - 36) - 1, 57);
      context.fillStyle = '#eafcff';
      context.font = '600 18px sans-serif';
      context.fillText('LumiField 问题9 · 真实运行录像', 34, 43);
      context.fillStyle = '#8feaff';
      context.font = '14px sans-serif';
      context.fillText(label + '  |  bands=' + debug.renderedBandCount + '  gap=' + debug.state.horizontalGap + '  height=' + Number(debug.heightScale).toFixed(2), 34, 65);
      context.restore();
      raf = requestAnimationFrame(compose);
    }
    function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    async function actualStageDrag() {
      const rect = sourceCanvas.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.48;
      const startY = rect.top + rect.height * 0.43;
      sourceCanvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY, button: 0, buttons: 1 }));
      for (let index = 1; index <= 10; index += 1) {
        const x = startX + index * 8;
        const y = startY + Math.sin(index / 10 * Math.PI) * 34;
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, movementX: 8, movementY: index === 1 ? 11 : 0 }));
        await wait(65);
      }
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + 80, clientY: startY, button: 0, buttons: 0 }));
    }
    try {
      api.setSpectrumState({ enabled: true, mode: 1, bandCount: 142, horizontalGap: 10, heightScale: 1.25, liquidGlassEnabled: true });
      recorder.start(400);
      compose();
      mark('形态一 · 中部舞台');
      await wait(1100);
      mark('形态一 · 真实鼠标拖动');
      await actualStageDrag();
      mark('形态一 · 拖动完成');
      await wait(650);
      api.setSpectrumState({ mode: 3, bandCount: 142, horizontalGap: 16, heightScale: 1.25, liquidGlassEnabled: true });
      mark('形态三 · 上下边缘');
      await wait(1600);
      api.setSpectrumState({ liquidGlassEnabled: false });
      mark('形态三 · 液态玻璃关闭');
      await wait(1000);
      api.setSpectrumState({ liquidGlassEnabled: true });
      mark('形态三 · 液态玻璃开启');
      await wait(1200);
      recorder.stop();
      await stopped;
    } finally {
      composing = false;
      if (raf) cancelAnimationFrame(raf);
      stream.getTracks().forEach(track => track.stop());
      api.setSpectrumState(originalState);
      window.particles.rotation.fromArray(originalRotation);
      if (window.particleSpin) { window.particleSpin.vx = 0; window.particleSpin.vy = 0; }
      window.orbit.userRadius = originalRadius;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Video encoding read failed'));
      reader.readAsDataURL(blob);
    });
    return {
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mimeType: blob.type,
      bytes: blob.size,
      durationMs: Math.round(performance.now() - started),
      width,
      height,
      fps: 30,
      captureSource: 'live requestAnimationFrame composition of renderer.domElement and active spectrum mount',
      syntheticFrames: false,
      parameterLog,
    };
  });
}

async function run() {
  const source = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  pass('task13 spectrum reuses project analyser statically', !/createAnalyser\s*\(/.test(source), {
    createAnalyserCalls: (source.match(/createAnalyser\s*\(/g) || []).length,
  });

  const debugPort = await freePort();
  const appEntryArgs = extractedInstalledApp ? [extractedInstalledApp] : (installedMode ? [] : ['.']);
  const appArgs = appEntryArgs.concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + debugPort,
    '--remote-debugging-address=127.0.0.1',
  ]);
  app = spawn(testExecutable, appArgs, {
    cwd: repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const value = String(chunk);
    appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.trim().slice(0, 1600));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);

  const target = await findMainTarget(debugPort);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageWait(function () {
    return document.readyState === 'complete' && window.LumiFieldTask13 && window.THREE && window.renderer && window.scene && window.camera;
  }, [], 45000);

  await cdp.call(function () {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'problem9-smoke' });
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
  });
  await pageWait(function () {
    const root = document.getElementById('lf-t13-spectrum-block');
    return root && document.getElementById('fx-panel') && document.getElementById('fx-panel').classList.contains('show');
  }, [], 15000);

  const controls = await cdp.call(function () {
    const block = document.getElementById('lf-t13-spectrum-block');
    const modes = Array.from(block.querySelectorAll('[data-lf-spectrum-mode],[data-lf-spectrum-shape]')).map(node => ({
      value: node.dataset.lfSpectrumMode || node.dataset.lfSpectrumShape,
      text: node.textContent.trim(),
    }));
    const keys = Array.from(block.querySelectorAll('[data-lf-scope="spectrum"][data-lf-key]')).map(node => node.dataset.lfKey);
    return { text: block.textContent, modes, keys };
  });
  pass('spectrum UI keeps only modes one and three', controls.modes.length === 2 &&
    controls.modes.some(item => item.value === '1' || item.value === 'one') &&
    controls.modes.some(item => item.value === '3' || item.value === 'three') &&
    !controls.text.includes('形态二'), controls);
  pass('retired vertical and simulated-peak controls are absent',
    !['verticalCount', 'verticalGap', 'simulatedPeaks'].some(key => controls.keys.includes(key)) &&
    !/(垂直数量|垂直间隔|模拟频点)/.test(controls.text), controls.keys);
  pass('spectrum height control is present', controls.keys.includes('heightScale') && /频谱高度/.test(controls.text), controls.keys);

  const initialContract = await spectrumDiagnostics();
  pass('unified SpectrumState contract', initialContract && initialContract.state && initialContract.debug &&
    ['enabled', 'mode', 'bandCount', 'horizontalGap', 'heightScale', 'opacity', 'brightness', 'glow', 'colorMode',
      'colorA', 'colorB', 'liquidGlassEnabled', 'attack', 'release', 'offset', 'symmetry']
      .every(key => Object.prototype.hasOwnProperty.call(initialContract.state, key)), initialContract);
  pass('retired fields removed from SpectrumState', !['shape', 'barCount', 'verticalCount', 'verticalGap', 'simulatedPeaks', 'glass', 'color1', 'color2']
    .some(key => Object.prototype.hasOwnProperty.call(initialContract.state, key)), initialContract.state);

  const dataUri = toneWavDataUri();
  const audioSetup = await cdp.call(async function (uri) {
    try {
      if (window.audio) { try { window.audio.pause(); } catch (_) {} }
      window.audio = new Audio(uri);
      window.audio.loop = true;
      window.audio.volume = 0.12;
      window.playing = true;
      window.audioReady = false;
      window.audioCtx = null;
      window.source = null;
      window.analyser = null;
      window.beatAnalyser = null;
      window.gainNode = null;
      window.initAudio();
      await window.resumeAudioAnalysis();
      await window.audio.play();
      return {
        paused: window.audio.paused,
        readyState: window.audio.readyState,
        contextState: window.audioCtx && window.audioCtx.state,
        bins: window.analyser && window.analyser.frequencyBinCount,
      };
    } catch (error) {
      return { error: String(error && error.stack || error) };
    }
  }, [dataUri]);
  pass('real shared audio graph is playing', audioSetup && !audioSetup.error && !audioSetup.paused && audioSetup.bins > 0, audioSetup);

  await setSpectrumValue('enabled', true);
  await setSpectrumMode(1);
  await pageWait(function () {
    const api = window.LumiFieldTask13;
    const data = api && api.getSpectrumDebug && api.getSpectrumDebug();
    return data && data.active && data.renderedBandCount > 0;
  }, [], 10000);

  const sharedAnalyser = await spectrumDiagnostics();
  pass('runtime spectrum uses the existing single analyser', sharedAnalyser.debug.analyserMatchesWindow === true &&
    sharedAnalyser.debug.usesSharedFrequencyData === true && sharedAnalyser.debug.audioContextsCreated === 0,
    sharedAnalyser.debug);

  const counts = [];
  for (const requested of [128, 129, 142, 160, 256]) {
    await setSpectrumValue('bandCount', requested);
    await pageWait(function (value) {
      const api = window.LumiFieldTask13;
      const data = api && api.getSpectrumDebug && api.getSpectrumDebug();
      return data && data.requestedBandCount === value && data.renderedBandCount === value;
    }, [requested], 10000);
    const current = await spectrumDiagnostics();
    counts.push({
      input: requested,
      actual: current.debug.renderedBandCount,
      geometryIdentity: current.debug.geometryIdentity,
      geometryInstanceCount: current.debug.geometryInstanceCount,
      rebuildCount: current.debug.geometryRebuildCount,
    });
  }
  pass('bandCount inputs equal real geometry counts without hidden caps', counts.every(item => item.input === item.actual) &&
    counts.every(item => item.geometryInstanceCount === item.input) &&
    new Set(counts.map(item => item.actual)).size === counts.length, counts);
  const explicitLimit = await cdp.call(function () {
    const input = document.querySelector('[data-lf-scope="spectrum"][data-lf-key="bandCount"]');
    input.value = '257';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const state = window.LumiFieldTask13.getState().spectrum;
    const debug = window.LumiFieldTask13.getSpectrumDebug();
    return {
      inputValueAfterRejection: input.value,
      stateBandCount: state.bandCount,
      renderedBandCount: debug.renderedBandCount,
      rejectedBandCount: debug.rejectedBandCount,
      status: document.getElementById('lf-t13-spectrum-safe').textContent,
    };
  });
  pass('device band limit is explicit and rejects instead of silently truncating',
    explicitLimit.inputValueAfterRejection === '256' && explicitLimit.stateBandCount === 256 &&
    explicitLimit.renderedBandCount === 256 && Number(explicitLimit.rejectedBandCount) === 257 &&
    explicitLimit.status.includes('上限') && explicitLimit.status.includes('拒绝'), explicitLimit);

  await setSpectrumValue('bandCount', 128);
  const gaps = [];
  for (const requested of [8, 10, 16]) {
    await setSpectrumValue('horizontalGap', requested);
    await delay(220);
    const current = await spectrumDiagnostics();
    gaps.push({
      input: requested,
      actual: current.debug.actualHorizontalGap,
      positions: current.debug.xPositions,
      geometryIdentity: current.debug.geometryIdentity,
    });
  }
  pass('horizontalGap 8 10 16 changes real X geometry', gaps.every(item => Number.isFinite(item.actual) && item.actual > 0 &&
    Array.isArray(item.positions) && item.positions.length === 128) &&
    gaps[0].actual < gaps[1].actual && gaps[1].actual < gaps[2].actual &&
    new Set(gaps.map(item => JSON.stringify(item.positions))).size === gaps.length, gaps);

  const heightBefore = await spectrumDiagnostics();
  await setSpectrumValue('heightScale', 0.72);
  await delay(280);
  const heightLow = await spectrumDiagnostics();
  await setSpectrumValue('heightScale', 1.64);
  await delay(280);
  const heightHigh = await spectrumDiagnostics();
  const lowNormalizedHeight = heightLow.debug.maxBarHeight / Math.max(0.000001, heightLow.debug.maxEnergy);
  const highNormalizedHeight = heightHigh.debug.maxBarHeight / Math.max(0.000001, heightHigh.debug.maxEnergy);
  pass('spectrum height applies live without geometry rebuild',
    heightLow.debug.geometryIdentity === heightHigh.debug.geometryIdentity &&
    heightLow.debug.geometryRebuildCount === heightHigh.debug.geometryRebuildCount &&
    heightLow.debug.renderedBandCount === heightHigh.debug.renderedBandCount &&
    heightLow.debug.heightScale === 0.72 && heightHigh.debug.heightScale === 1.64 &&
    highNormalizedHeight > lowNormalizedHeight * 1.9,
    { before: heightBefore.debug, low: heightLow.debug, high: heightHigh.debug });
  await delay(380);
  const heightPersistence = await cdp.call(function () {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('lumifield-task13-spectrum-v1') || 'null'); } catch (_) {}
    const exported = typeof window.userFxArchiveExportPayload === 'function'
      ? window.userFxArchiveExportPayload({ name: 'Problem 9 fixture', savedAt: 0, snapshot: {} }) : null;
    return { stored, exportedSpectrum: exported && exported.spectrum };
  });
  pass('spectrum height persists and is included in preset export',
    heightPersistence.stored && heightPersistence.stored.heightScale === 1.64 &&
    heightPersistence.exportedSpectrum && heightPersistence.exportedSpectrum.heightScale === 1.64,
    heightPersistence);

  await cdp.call(function () {
    window.toggleFxPanel(false);
    window.togglePlaylistPanel(false);
  });
  await delay(520);
  const modeOneBefore = await spectrumDiagnostics();
  await screenshot('01-mode-one-middle-stage');
  await cdp.call(async function () {
    if (window.audioCtx && window.audioCtx.state === 'running') await window.audioCtx.suspend();
  });
  await delay(120);
  const stageMovement = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const canvas = window.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const point = { x: rect.left + rect.width * 0.52, y: rect.top + rect.height * 0.42 };
    const anchor = window.scene.getObjectByName('LumiFieldVisualStageTransform');
    const oldPreset = window.fx && window.fx.preset;
    const oldFreeActive = window.freeCamera && window.freeCamera.active;
    const oldFreeLocked = window.freeCamera && window.freeCamera.locked;
    if (window.fx) window.fx.preset = 0;
    if (window.freeCamera) { window.freeCamera.active = false; window.freeCamera.locked = false; }
    const before = api.getSpectrumDebug();
    const beforeStage = {
      particleRotation: window.particles.rotation.toArray(),
      anchorQuaternion: anchor.quaternion.toArray(),
      orbitRadius: window.orbit.userRadius,
    };
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: point.x + 126, clientY: point.y + 62, buttons: 1, movementX: 126, movementY: 62 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: point.x + 126, clientY: point.y + 62, button: 0, buttons: 0 }));
    await new Promise(resolve => {
      let frames = 0;
      function next() { if (++frames >= 30) resolve(); else requestAnimationFrame(next); }
      requestAnimationFrame(next);
    });
    const afterDrag = api.getSpectrumDebug();
    const afterDragStage = {
      particleRotation: window.particles.rotation.toArray(),
      anchorQuaternion: anchor.quaternion.toArray(),
      hadDrag: !!window.mouseDownAt.hadDrag,
    };
    const wheelBefore = window.orbit.userRadius;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, deltaY: 210 });
    canvas.dispatchEvent(wheel);
    await new Promise(resolve => {
      let frames = 0;
      function next() { if (++frames >= 20) resolve(); else requestAnimationFrame(next); }
      requestAnimationFrame(next);
    });
    const afterWheel = api.getSpectrumDebug();
    const wheelAfter = window.orbit.userRadius;
    window.particles.rotation.fromArray(beforeStage.particleRotation);
    if (window.particleSpin) { window.particleSpin.vx = 0; window.particleSpin.vy = 0; }
    window.orbit.userRadius = beforeStage.orbitRadius;
    if (window.fx) window.fx.preset = oldPreset;
    if (window.freeCamera) { window.freeCamera.active = oldFreeActive; window.freeCamera.locked = oldFreeLocked; }
    return { before, beforeStage, afterDrag, afterDragStage, afterWheel, wheel: { before: wheelBefore, after: wheelAfter, prevented: wheel.defaultPrevented } };
  });
  await cdp.call(async function () {
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
  });
  pass('mode one is a Three stage child and follows stage camera transform',
    modeOneBefore.debug.mode === 1 && modeOneBefore.debug.mountType === 'three-world-stage' &&
    modeOneBefore.debug.stageObjectPresent === true && modeOneBefore.debug.stageMeshPresent === true &&
    modeOneBefore.debug.stageAnchorPresent === true && modeOneBefore.debug.stageAnchorName === 'LumiFieldVisualStageTransform' &&
    modeOneBefore.debug.stageObjectName === 'LumiFieldSpectrumStage' &&
    modeOneBefore.debug.stageMeshName === 'LumiFieldRealtimeSpectrumMode1' &&
    stageMovement.afterDragStage.hadDrag &&
    JSON.stringify(stageMovement.beforeStage.particleRotation) !== JSON.stringify(stageMovement.afterDragStage.particleRotation) &&
    JSON.stringify(stageMovement.beforeStage.anchorQuaternion) !== JSON.stringify(stageMovement.afterDragStage.anchorQuaternion) &&
    stageMovement.before.projectedSignature !== stageMovement.afterDrag.projectedSignature &&
    stageMovement.wheel.prevented && stageMovement.wheel.after !== stageMovement.wheel.before &&
    stageMovement.afterDrag.projectedSignature !== stageMovement.afterWheel.projectedSignature,
    { initial: modeOneBefore.debug, movement: stageMovement });
  await setSpectrumMode(3);
  await setSpectrumValue('bandCount', 142);
  await pageWait(function () {
    const data = window.LumiFieldTask13.getSpectrumDebug();
    return data && data.mode === 3 && data.topCount === 142 && data.bottomCount === 142;
  }, [], 10000);
  const modeThree = await spectrumDiagnostics();
  pass('mode three has exactly one top and one bottom vertical band set',
    modeThree.debug.topCount === 142 && modeThree.debug.bottomCount === 142 &&
    modeThree.debug.topSetCount === 1 && modeThree.debug.bottomSetCount === 1 &&
    modeThree.debug.orientation === 'vertical-y' && modeThree.debug.horizontalScanLineCount === 0 &&
    modeThree.debug.ghostLayers === 0 && modeThree.debug.topWidthCoverage >= 0.84 && modeThree.debug.bottomWidthCoverage >= 0.84,
    modeThree.debug);
  const stableX = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      const value = api.getSpectrumDebug();
      samples.push({ top: value.topXSignature || JSON.stringify(value.xPositions), bottom: value.bottomXSignature || JSON.stringify(value.xPositions) });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return samples;
  });
  pass('mode three energy changes only vertically without X jumping',
    new Set(stableX.map(item => item.top)).size === 1 && new Set(stableX.map(item => item.bottom)).size === 1, stableX);
  await screenshot('02-mode-three-top-bottom');

  const interfaceStates = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const secondaryBefore = { state: api.getState().spectrum, debug: api.getSpectrumDebug() };
    window.goHome();
    await new Promise(resolve => setTimeout(resolve, 550));
    const main = { state: api.getState().spectrum, debug: api.getSpectrumDebug(), home: document.body.classList.contains('empty-home-active') };
    window.dismissHomePage({ reason: 'problem9-smoke-return' });
    await new Promise(resolve => setTimeout(resolve, 550));
    const secondaryAfter = { state: api.getState().spectrum, debug: api.getSpectrumDebug(), home: document.body.classList.contains('empty-home-active') };
    return { secondaryBefore, main, secondaryAfter };
  });
  pass('main and secondary interfaces share state and keep safe active mounts',
    interfaceStates.main.home && !interfaceStates.secondaryAfter.home &&
    JSON.stringify(interfaceStates.secondaryBefore.state) === JSON.stringify(interfaceStates.main.state) &&
    JSON.stringify(interfaceStates.secondaryBefore.state) === JSON.stringify(interfaceStates.secondaryAfter.state) &&
    interfaceStates.secondaryBefore.debug.mount === 'secondary' && interfaceStates.main.debug.mount === 'main' &&
    interfaceStates.secondaryAfter.debug.mount === 'secondary' && interfaceStates.main.debug.analyserMatchesWindow === true &&
    interfaceStates.main.debug.mounts.main === 'lf-t13-spectrum-main' && interfaceStates.main.debug.mounts.secondary === 'lf-t13-spectrum',
    interfaceStates);

  await setSpectrumMode(1);
  await setSpectrumValue('liquidGlassEnabled', false);
  await cdp.call(async function () {
    if (window.audioCtx && window.audioCtx.state === 'running') await window.audioCtx.suspend();
  });
  await delay(220);
  const solidDebug = await spectrumDiagnostics();
  const solidShot = await screenshot('03-liquid-glass-off');
  const solidPixels = await screenshotPixels(solidShot.data);
  await setSpectrumValue('liquidGlassEnabled', true);
  await delay(220);
  const glassDebug = await spectrumDiagnostics();
  const glassShot = await screenshot('04-liquid-glass-on');
  const glassPixels = await screenshotPixels(glassShot.data);
  const glassDifference = pixelDifference(solidPixels, glassPixels);
  pass('liquid glass changes live background-sampling material and pixels',
    solidDebug.debug.materialType !== glassDebug.debug.materialType &&
    glassDebug.debug.liquidGlassEnabled === true && glassDebug.debug.backdropReactive === true && glassDebug.debug.transmission > 0 &&
    glassDifference.changedRatio > 0.003 && glassDifference.meanAbsoluteDifference > 0.2,
    { solid: solidDebug.debug, glass: glassDebug.debug, pixels: glassDifference });
  await cdp.call(async function () {
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
  });
  await delay(250);

  const liveRecording = await recordLiveProblem9Evidence();
  const liveVideo = Buffer.from(liveRecording.base64, 'base64');
  const liveVideoPath = path.join(evidenceDir, '05-problem9-live-evidence.webm');
  const liveParametersPath = path.join(evidenceDir, '05-problem9-live-evidence-parameters.json');
  fs.writeFileSync(liveVideoPath, liveVideo);
  const videoEvidence = Object.assign({}, liveRecording, {
    file: liveVideoPath,
    parameterFile: liveParametersPath,
    sha256: require('crypto').createHash('sha256').update(liveVideo).digest('hex').toUpperCase(),
  });
  delete videoEvidence.base64;
  fs.writeFileSync(liveParametersPath, JSON.stringify(videoEvidence, null, 2));
  const liveLabels = liveRecording.parameterLog.map(item => item.label);
  const dragStart = liveRecording.parameterLog.find(item => item.label === '形态一 · 真实鼠标拖动');
  const dragEnd = liveRecording.parameterLog.find(item => item.label === '形态一 · 拖动完成');
  const modeThreeVideo = liveRecording.parameterLog.find(item => item.label === '形态三 · 上下边缘');
  pass('real live WebM records mode one drag mode three and glass switching',
    liveVideo.length === liveRecording.bytes && liveVideo.length > 50000 && liveVideo.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    liveRecording.durationMs >= 5200 && liveRecording.syntheticFrames === false &&
    dragStart && dragEnd && dragStart.debug.projectedSignature !== dragEnd.debug.projectedSignature &&
    modeThreeVideo && modeThreeVideo.debug.mode === 3 && modeThreeVideo.debug.topCount === 142 && modeThreeVideo.debug.bottomCount === 142 &&
    liveLabels.includes('形态三 · 液态玻璃关闭') && liveLabels.includes('形态三 · 液态玻璃开启'), videoEvidence);

  await setSpectrumMode(3);
  await cdp.call(function () {
    window.goHome();
    window.toggleFxPanel(false);
  });
  await pageWait(function () { return document.body.classList.contains('empty-home-active'); }, [], 5000);
  await delay(300);
  const uiSafety = await cdp.call(function () {
    const selectors = ['#search-input', '#user-btn', '#lf-weather-wallpaper-entry', '#lf-hot-comment-card', '#play-btn'];
    const targets = selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing: true };
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { selector, hidden: true };
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        selector,
        hit: !!(hit && (hit === node || node.contains(hit))),
        blockedBySpectrum: !!(hit && hit.closest && hit.closest('[data-lf-spectrum-mount]')),
        hitId: hit && hit.id,
        hitClass: hit && hit.className,
        rect: { width: rect.width, height: rect.height },
      };
    });
    const layers = Array.from(document.querySelectorAll('[data-lf-spectrum-mount]')).map(node => ({
      id: node.id,
      pointerEvents: getComputedStyle(node).pointerEvents,
      zIndex: getComputedStyle(node).zIndex,
    }));
    const rendererLayer = document.getElementById('canvas-container');
    return { targets, layers, rendererZIndex: rendererLayer ? getComputedStyle(rendererLayer).zIndex : '' };
  });
  await cdp.call(function () {
    window.toggleFxPanel(true);
    window.setFxPanelTab('presets');
  });
  await delay(250);
  const consoleSafety = await cdp.call(function () {
    const node = document.getElementById('fx-panel');
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height - 8, 90);
    const hit = document.elementFromPoint(x, y);
    return { visible: node.classList.contains('show'), hit: !!(hit && (hit === node || node.contains(hit))), hitId: hit && hit.id };
  });
  pass('spectrum layers do not intercept or cover interactive UI',
    uiSafety.layers.length === 2 && uiSafety.layers.every(layer =>
      layer.pointerEvents === 'none' && Number(layer.zIndex) < Number(uiSafety.rendererZIndex)) &&
    uiSafety.targets.filter(target => !target.missing && !target.hidden).length >= 4 &&
    uiSafety.targets.filter(target => !target.missing && !target.hidden).filter(target => target.hit).length >= 4 &&
    uiSafety.targets.filter(target => !target.missing && !target.hidden).every(target => !target.blockedBySpectrum) &&
    consoleSafety.visible && consoleSafety.hit, { uiSafety, consoleSafety });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080, height: 608, deviceScaleFactor: 1.5, mobile: false,
  });
  await delay(260);
  const dpiAndLyricLabel = await cdp.call(function () {
    const api = window.LumiFieldTask13;
    const debug = api.getSpectrumDebug();
    const canvases = Array.from(document.querySelectorAll('[data-lf-spectrum-mount]')).map(node => ({
      id: node.id,
      width: node.width,
      height: node.height,
      cssWidth: node.clientWidth,
      cssHeight: node.clientHeight,
      ratioX: node.width / Math.max(1, node.clientWidth),
      ratioY: node.height / Math.max(1, node.clientHeight),
    }));
    return {
      devicePixelRatio: window.devicePixelRatio,
      debug,
      canvases,
      visibleLabel: /LRC\s*估算/.test(document.body.innerText || ''),
    };
  });
  pass('125/150 percent DPI keeps spectrum canvases sharp within the pixel budget',
    Math.abs(dpiAndLyricLabel.devicePixelRatio - 1.5) < 0.01 &&
    Math.abs(dpiAndLyricLabel.debug.effectiveCanvasDpr - 1.5) < 0.01 &&
    dpiAndLyricLabel.canvases.every(canvas => Math.abs(canvas.ratioX - 1.5) < 0.02 && Math.abs(canvas.ratioY - 1.5) < 0.02) &&
    dpiAndLyricLabel.canvases.every(canvas => canvas.width * canvas.height <= dpiAndLyricLabel.debug.canvasPixelBudget),
    dpiAndLyricLabel);
  pass('LRC estimate label has no visible renderer', !dpiAndLyricLabel.visibleLabel, dpiAndLyricLabel);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.call(function () {
    window.toggleFxPanel(false);
    window.dismissHomePage({ reason: 'problem9-smoke-ui-return' });
  });
  await delay(250);

  const activeBeforePause = await spectrumDiagnostics();
  const pauseRelease = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    window.audio.pause();
    window.playing = false;
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 3500) {
      const value = api.getSpectrumDebug();
      samples.push({ at: Math.round(performance.now() - started), energy: value.maxEnergy, active: value.active, releaseHidden: value.releaseHidden });
      if (value.releaseHidden && value.maxEnergy <= 0.0025) break;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    const paused = api.getSpectrumDebug();
    window.playing = true;
    await window.audio.play();
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
    await new Promise(resolve => setTimeout(resolve, 700));
    const resumed = api.getSpectrumDebug();
    return { samples, paused, resumed };
  });
  const monotonicRelease = pauseRelease.samples.every((item, index, rows) => index === 0 || item.energy <= rows[index - 1].energy + 0.025);
  pass('pause releases to zero and hides; resume returns to real analyser',
    activeBeforePause.debug.maxEnergy > 0.003 && pauseRelease.samples.length >= 2 && monotonicRelease &&
    pauseRelease.paused.maxEnergy <= 0.0025 && pauseRelease.paused.releaseHidden === true &&
    pauseRelease.resumed.active === true && pauseRelease.resumed.releaseHidden === false && pauseRelease.resumed.maxEnergy > 0.003,
    pauseRelease);

  let soak = null;
  if (soakMs > 0) {
    await setSpectrumMode(1);
    await setSpectrumValue('bandCount', 256);
    soak = await cdp.call(async function (duration) {
      const api = window.LumiFieldTask13;
      const before = api.getSpectrumDebug();
      const heapBefore = Number(performance.memory && performance.memory.usedJSHeapSize || 0);
      const started = performance.now();
      let frames = 0;
      let minimumFps = Infinity;
      let intervalStarted = started;
      let intervalFrames = 0;
      while (performance.now() - started < duration) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frames += 1;
        intervalFrames += 1;
        const elapsed = performance.now() - intervalStarted;
        if (elapsed >= 5000) {
          minimumFps = Math.min(minimumFps, intervalFrames * 1000 / elapsed);
          intervalStarted = performance.now();
          intervalFrames = 0;
        }
      }
      const after = api.getSpectrumDebug();
      const heapAfter = Number(performance.memory && performance.memory.usedJSHeapSize || 0);
      let stageObjectCount = 0;
      if (window.scene && window.scene.traverse) window.scene.traverse(node => { if (node && node.name === 'LumiFieldSpectrumStage') stageObjectCount += 1; });
      return {
        durationMs: performance.now() - started,
        frames,
        fps: frames * 1000 / Math.max(1, performance.now() - started),
        minimumFps: isFinite(minimumFps) ? minimumFps : 0,
        heapBefore,
        heapAfter,
        heapGrowth: heapAfter - heapBefore,
        before,
        after,
        canvasCount: document.querySelectorAll('[data-lf-spectrum-mount]').length,
        stageObjectCount,
      };
    }, [soakMs]);
    pass('high-band soak has stable GPU resources and responsive frames',
      soak.durationMs >= soakMs * 0.99 && soak.before.renderedBandCount === 256 && soak.after.renderedBandCount === 256 &&
      soak.before.geometryIdentity === soak.after.geometryIdentity &&
      soak.before.geometryRebuildCount === soak.after.geometryRebuildCount &&
      soak.canvasCount === 2 && soak.stageObjectCount === 1 && soak.fps >= 20 && soak.minimumFps >= 15 &&
      (!soak.heapBefore || soak.heapGrowth < 128 * 1024 * 1024), soak);
  }

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);

  const result = {
    ok: true,
    runId,
    mode: (installedMode ? 'Installed Electron' : 'Electron source') + ' + CDP problem 9',
    origin,
    evidenceDir,
    screenshots,
    checks,
    videoEvidence,
    soak,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = {
    ok: false,
    runId,
    origin,
    evidenceDir,
    error: String(error && error.stack || error),
    checks,
    screenshots,
    rendererErrors,
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  if (extractedInstalledApp) {
    try { fs.rmSync(extractedInstalledApp, { recursive: true, force: true }); } catch (_) {}
  }
});
