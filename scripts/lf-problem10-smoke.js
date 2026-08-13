const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM10_OUT || path.join(repo, 'test-results', 'lf-problem10-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem10-'));
const rendererErrors = [];
const appLog = [];
const screenshots = [];
const checks = {};
let app = null;
let cdp = null;
let origin = '';

fs.mkdirSync(evidenceDir, { recursive: true });

function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
  return details;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
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
  call(fn, args) { return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')'); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function waitFor(fn, timeout = 30000, interval = 120) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
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
  const response = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return { file, data: response.data };
}

async function screenshotMetrics(base64) {
  return cdp.call(async function (png) {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const values = [];
    let luminance = 0;
    let colored = 0;
    let bright = 0;
    let count = 0;
    for (let y = Math.floor(canvas.height * 0.20); y < canvas.height * 0.76; y += 18) {
      for (let x = Math.floor(canvas.width * 0.10); x < canvas.width * 0.84; x += 18) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        const light = pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
        const chroma = Math.max(pixel[0], pixel[1], pixel[2]) - Math.min(pixel[0], pixel[1], pixel[2]);
        values.push(pixel[0], pixel[1], pixel[2]);
        luminance += light;
        if (chroma > 18 && light > 8) colored += 1;
        if (light > 28) bright += 1;
        count += 1;
      }
    }
    return { width: canvas.width, height: canvas.height, values,
      meanLuminance: luminance / Math.max(1, count), coloredRatio: colored / Math.max(1, count),
      brightRatio: bright / Math.max(1, count), sampleCount: count };
  }, [base64]);
}

async function imageDifference(onBase64, offBase64) {
  return cdp.call(async function (values) {
    async function decode(base64) {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { canvas, context };
    }
    const on = await decode(values.on);
    const off = await decode(values.off);
    const width = Math.min(on.canvas.width, off.canvas.width);
    const height = Math.min(on.canvas.height, off.canvas.height);
    let changed = 0;
    let brighter = 0;
    let darker = 0;
    let onLight = 0;
    let offLight = 0;
    let samples = 0;
    for (let y = 0; y < height; y += 6) {
      for (let x = 0; x < width; x += 6) {
        const a = on.context.getImageData(x, y, 1, 1).data;
        const b = off.context.getImageData(x, y, 1, 1).data;
        const delta = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (delta > 12) {
          const al = a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
          const bl = b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722;
          changed += 1;
          onLight += al;
          offLight += bl;
          if (al > bl + 2) brighter += 1;
          if (bl > al + 2) darker += 1;
        }
        samples += 1;
      }
    }
    return {
      width,
      height,
      samples,
      changed,
      changedRatio: changed / Math.max(1, samples),
      brighterRatio: brighter / Math.max(1, samples),
      darkerRatio: darker / Math.max(1, samples),
      meanOnChangedLuminance: onLight / Math.max(1, changed),
      meanOffChangedLuminance: offLight / Math.max(1, changed),
    };
  }, [{ on: onBase64, off: offBase64 }]);
}

// Original deterministic test audio. Each clip uses a different spectral centre and
// a gated transient train so the real analyser exercises terrain and peak events.
function bandWavDataUri(style, durationSeconds = 4, sampleRate = 44100) {
  const tones = {
    low: [[67, 0.52], [113, 0.31], [186, 0.13]],
    mid: [[620, 0.34], [1180, 0.45], [1940, 0.19]],
    high: [[4200, 0.27], [6900, 0.43], [9700, 0.26]],
  }[style];
  if (!tones) throw new Error('Unknown style: ' + style);
  const samples = Math.floor(durationSeconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
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
    const phase = time % 0.5;
    const onset = Math.exp(-phase * 15);
    const sustain = 0.42 + 0.58 * Math.pow(Math.max(0, Math.sin(Math.PI * phase / 0.5)), 0.65);
    const edge = Math.min(1, index / 240) * Math.min(1, (samples - index) / 240);
    let value = 0;
    for (const [frequency, gain] of tones) value += Math.sin(Math.PI * 2 * frequency * time) * gain;
    value *= edge * (0.30 + 0.70 * Math.min(1, onset * 1.25 + sustain * 0.42));
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 23500))), 44 + index * 2);
  }
  return 'data:audio/wav;base64,' + buffer.toString('base64');
}

async function echoDiagnostics() {
  return cdp.call(function () {
    const api = window.LumiFieldTask13;
    return {
      state: api && api.getState ? api.getState().echo : null,
      debug: api && api.getEchoDebug ? api.getEchoDebug() : null,
    };
  });
}

async function setEcho(patch, settle = 260) {
  const result = await cdp.call(function (value) {
    const api = window.LumiFieldTask13;
    if (!api || typeof api.setEchoState !== 'function') return { ok: false, reason: 'missing API' };
    try {
      const applied = api.setEchoState(value);
      return { ok: applied !== false, result: applied, state: api.getState().echo };
    }
    catch (error) { return { ok: false, error: String(error && error.message || error), state: api.getState().echo }; }
  }, [patch]);
  pass('echo state API accepts ' + Object.keys(patch).join(','), result && result.ok, result);
  await delay(settle);
  return result;
}

function sum(values, start, end) {
  return values.slice(start, end).reduce((total, value) => total + Number(value || 0), 0);
}

function vectorDistance(a, b) {
  const size = Math.min(a.length, b.length);
  let total = 0;
  for (let index = 0; index < size; index += 1) total += Math.abs(Number(a[index] || 0) - Number(b[index] || 0));
  return total / Math.max(1, size);
}

async function run() {
  const task13Source = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const echoStart = task13Source.indexOf('var ECHO_BAND_COUNT');
  const echoEnd = task13Source.indexOf('// ---------- Visual console controls', echoStart + 1);
  const echoSource = echoStart >= 0 ? task13Source.slice(echoStart, echoEnd > echoStart ? echoEnd : task13Source.length) : task13Source;
  pass('task13 echo creates no AudioContext or AnalyserNode',
    !/\b(?:new\s+)?(?:window\.)?(?:AudioContext|webkitAudioContext)\s*\(/.test(echoSource) &&
    !/createAnalyser\s*\(/.test(echoSource), {
      audioContexts: (echoSource.match(/(?:AudioContext|webkitAudioContext)\s*\(/g) || []).length,
      analysers: (echoSource.match(/createAnalyser\s*\(/g) || []).length,
    });
  pass('task13 echo creates no additional WebGL renderer', !/new\s+(?:window\.)?THREE\.WebGLRenderer\s*\(/.test(echoSource), {
    renderers: (echoSource.match(/WebGLRenderer\s*\(/g) || []).length,
  });
  pass('task13 echo has no analytics telemetry or borrowed branding',
    !/(sonic[ -]?topography|google-analytics|gtag\s*\(|mixpanel|telemetry|anonymous.?usage)/i.test(task13Source));

  const debugPort = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
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
    return document.readyState === 'complete' && window.LumiFieldTask13 &&
      typeof window.LumiFieldTask13.getEchoDebug === 'function' &&
      typeof window.LumiFieldTask13.setEchoState === 'function' &&
      window.THREE && window.renderer && window.scene && window.camera;
  }, [], 45000);

  await cdp.call(function () {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    window.immersiveMode = true;
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'problem10-smoke' });
    if (typeof window.togglePlaylistPanel === 'function') window.togglePlaylistPanel(false);
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
  });
  await pageWait(function () {
    const root = document.getElementById('lf-t13-echo-block');
    const panel = document.getElementById('fx-panel');
    return root && panel && panel.classList.contains('show');
  }, [], 15000);

  const uiContract = await cdp.call(function () {
    const root = document.getElementById('lf-t13-echo-block');
    const keys = Array.from(root.querySelectorAll('[data-lf-scope="echo"][data-lf-key]')).map(node => node.dataset.lfKey);
    const visualEqInputs = Array.from(root.querySelectorAll('[data-lf-echo-eq]')).map(node => Number(node.dataset.lfEchoEq));
    const allCanvases = Array.from(document.querySelectorAll('canvas')).map(node => ({ id: node.id, className: node.className }));
    return { keys, visualEqInputs, text: root.textContent, allCanvases };
  });
  const requiredControls = ['enabled', 'renderResolution', 'theme', 'accentEnabled', 'accentStrength', 'responseStrength',
    'responseRange', 'rippleEnabled', 'particleStrength', 'idleWave', 'cameraDistance', 'cameraHorizontal',
    'cameraElevation', 'autoRotate', 'rotateSpeed', 'playerVisible'];
  const removedMeteorControls = ['meteorEnabled', 'meteorSensitivity', 'meteorCooldown', 'clickMeteor'];
  pass('echo settings UI exposes all required controls and eight EQ sliders', requiredControls.every(key => uiContract.keys.includes(key)) &&
    removedMeteorControls.every(key => !uiContract.keys.includes(key)) &&
    uiContract.visualEqInputs.length === 8 && new Set(uiContract.visualEqInputs).size === 8, uiContract);

  const initial = await echoDiagnostics();
  pass('echo state and debug expose an eight-band visual EQ', initial.state && initial.debug &&
    Array.isArray(initial.state.visualEq) && initial.state.visualEq.length === 8 &&
    Array.isArray(initial.debug.visualEq) && initial.debug.visualEq.length === 8, initial);
  pass('echo debug declares reuse of project renderer and audio data', (initial.debug.rendererMatchesWindow === true || initial.debug.rendererReused === true) &&
    initial.debug.audioContextsCreated === 0 && initial.debug.audioGraphMutations === 0, initial.debug);
  const spectrumDisabled = await cdp.call(function () {
    const api = window.LumiFieldTask13;
    return typeof api.setSpectrumState === 'function' && api.setSpectrumState({ enabled: false }) !== false && api.getState().spectrum.enabled === false;
  });
  pass('realtime spectrum is disabled to isolate echo terrain evidence', spectrumDisabled === true);

  const clips = {
    low: bandWavDataUri('low'),
    mid: bandWavDataUri('mid'),
    high: bandWavDataUri('high'),
  };
  const clipFiles = {};
  for (const [style, uri] of Object.entries(clips)) {
    const file = path.join(evidenceDir, 'generated-' + style + '-frequency.wav');
    fs.writeFileSync(file, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
    clipFiles[style] = file;
  }
  const audioSetup = await cdp.call(async function (uri) {
    try {
      if (window.audio) { try { window.audio.pause(); } catch (_) {} }
      window.audio = new Audio(uri);
      window.audio.loop = true;
      window.audio.volume = 0.10;
      window.audio.playbackRate = 1;
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
      window.__lfP10Analyser = window.analyser;
      window.__lfP10FrequencyData = window.frequencyData;
      window.__lfP10AudioCtx = window.audioCtx;
      window.__lfP10Source = window.source;
      window.__lfP10Gain = window.gainNode;
      return {
        paused: window.audio.paused,
        readyState: window.audio.readyState,
        contextState: window.audioCtx && window.audioCtx.state,
        bins: window.analyser && window.analyser.frequencyBinCount,
      };
    } catch (error) { return { error: String(error && error.stack || error) }; }
  }, [clips.low]);
  pass('generated WAV enters real app initAudio analyser graph', audioSetup && !audioSetup.error &&
    !audioSetup.paused && audioSetup.contextState === 'running' && audioSetup.bins > 0, audioSetup);

  await setEcho({
    enabled: true,
    shape: 'one',
    audioMonitor: true,
    idleWave: false,
    renderResolution: 0.72,
    responseStrength: 1.35,
    responseRange: 1,
    rippleEnabled: true,
    rippleSensitivity: 0.9,
    rippleCooldown: 3,
    particleStrength: 1,
    autoRotate: false,
    visualEq: [1, 1, 1, 1, 1, 1, 1, 1],
  }, 700);
  await cdp.call(function () {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    window.immersiveMode = true;
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
  });
  await pageWait(function () {
    const debug = window.LumiFieldTask13.getEchoDebug();
    return debug && debug.active && debug.stagePresent && debug.meshPresent && debug.instanceCount > 0 && debug.maxHeight > 0.001;
  }, [], 15000);

  const runtimeGraph = await cdp.call(function () {
    const debug = window.LumiFieldTask13.getEchoDebug();
    let stageCount = 0;
    let mainMeshCount = 0;
    let instancedMeshes = 0;
    let stage = null;
    let mesh = null;
    window.scene.traverse(node => {
      if (node.name === 'LumiFieldEchoTerrainStage') { stageCount += 1; stage = node; }
      if (node.name === 'LumiFieldEchoTerrainGrid') { mainMeshCount += 1; mesh = node; }
      if (node.isInstancedMesh && node.name.indexOf('LumiFieldEcho') === 0) instancedMeshes += 1;
    });
    const matrix = new window.THREE.Matrix4();
    const position = new window.THREE.Vector3();
    const xs = [];
    const zs = [];
    const colorHexes = [];
    if (mesh && mesh.isInstancedMesh) {
      const count = Math.min(mesh.count, 256);
      for (let index = 0; index < count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix);
        xs.push(position.x); zs.push(position.z);
      }
      if (mesh.instanceColor && typeof mesh.getColorAt === 'function') {
        const color = new window.THREE.Color();
        for (let index = 0; index < Math.min(mesh.count, 192); index += 4) {
          mesh.getColorAt(index, color);
          colorHexes.push(color.getHexString());
        }
      }
    }
    return {
      debug,
      stageCount,
      mainMeshCount,
      instancedMeshes,
      isInstancedMesh: !!(mesh && mesh.isInstancedMesh),
      geometryIs3D: !!(mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position && mesh.geometry.attributes.position.itemSize === 3),
      xRange: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      zRange: zs.length ? Math.max(...zs) - Math.min(...zs) : 0,
      terrainVisible: !!(mesh && mesh.visible),
      materialVisible: !!(mesh && mesh.material && mesh.material.visible && mesh.material.opacity > 0.25),
      materialOpacity: mesh && mesh.material && mesh.material.opacity,
      hasInstanceColor: !!(mesh && mesh.instanceColor),
      uniqueInstanceColors: new Set(colorHexes).size,
      instanceColors: colorHexes,
      stageParentInScene: !!(stage && stage.parent),
      analyserSame: window.analyser === window.__lfP10Analyser,
      frequencyDataSame: window.frequencyData === window.__lfP10FrequencyData,
      audioContextSame: window.audioCtx === window.__lfP10AudioCtx,
    };
  });
  pass('one unique real Three terrain stage and InstancedMesh occupy X/Z space',
    runtimeGraph.stageCount === 1 && runtimeGraph.mainMeshCount === 1 && runtimeGraph.isInstancedMesh &&
    runtimeGraph.geometryIs3D && runtimeGraph.xRange > 0.1 && runtimeGraph.zRange > 0.1 && runtimeGraph.stageParentInScene,
    runtimeGraph);
  pass('terrain material and per-instance colors are visible and non-uniform',
    runtimeGraph.terrainVisible && runtimeGraph.materialVisible && runtimeGraph.hasInstanceColor &&
    runtimeGraph.uniqueInstanceColors >= 3, runtimeGraph);
  pass('echo reuses exact analyser frequency array and AudioContext objects',
    runtimeGraph.analyserSame && runtimeGraph.frequencyDataSame && runtimeGraph.audioContextSame &&
    runtimeGraph.debug.analyserMatchesWindow === true && runtimeGraph.debug.usesSharedFrequencyData === true &&
    (runtimeGraph.debug.rendererMatchesWindow === true || runtimeGraph.debug.rendererReused === true) &&
    runtimeGraph.debug.audioContextsCreated === 0 && runtimeGraph.debug.audioGraphMutations === 0,
    runtimeGraph.debug);

  const precisionRows = [];
  for (const requested of [0.45, 0.85, 1.25]) {
    await setEcho({ renderResolution: requested }, 500);
    const row = await cdp.call(function () {
      const debug = window.LumiFieldTask13.getEchoDebug();
      let stages = 0;
      let grids = 0;
      window.scene.traverse(node => {
        if (node.name === 'LumiFieldEchoTerrainStage') stages += 1;
        if (node.name === 'LumiFieldEchoTerrainGrid') grids += 1;
      });
      return {
        requested: window.LumiFieldTask13.getState().echo.renderResolution,
        instanceCount: debug.instanceCount,
        meshUuid: debug.meshUuid || debug.meshUUID,
        rebuildCount: debug.rebuildCount == null ? debug.geometryRebuildCount : debug.rebuildCount,
        rows: debug.rows,
        columns: debug.columns,
        stages,
        grids,
      };
    });
    precisionRows.push(row);
  }
  pass('render resolution changes real terrain instance density without duplicate stages',
    precisionRows.every(row => row.stages === 1 && row.grids === 1 && row.instanceCount > 0) &&
    precisionRows[0].instanceCount < precisionRows[1].instanceCount &&
    precisionRows[1].instanceCount < precisionRows[2].instanceCount &&
    precisionRows[2].instanceCount >= precisionRows[0].instanceCount * 2,
    precisionRows);
  await setEcho({ renderResolution: 0.78 }, 450);

  async function playStyle(style, imageName) {
    const loaded = await cdp.call(async function (args) {
      window.audio.pause();
      window.audio.src = args.uri;
      window.audio.currentTime = 0;
      window.audio.loop = true;
      window.audio.load();
      window.playing = true;
      await window.resumeAudioAnalysis();
      await window.audio.play();
      await new Promise(resolve => setTimeout(resolve, 1350));
      const samples = [];
      for (let index = 0; index < 8; index += 1) {
        const debug = window.LumiFieldTask13.getEchoDebug();
        samples.push({
          bands: Array.from(debug.bandEnergies || []),
          region: debug.regionResponse,
          low: Number(debug.low || 0),
          mid: Number(debug.mid || 0),
          high: Number(debug.high || 0),
          height: Number(debug.maxHeight || 0),
          spectralFlux: Number(debug.spectralFlux || 0),
          peakTriggered: !!debug.peakTriggered,
          ripples: debug.ripples,
        });
        await new Promise(resolve => setTimeout(resolve, 90));
      }
      const count = samples.length;
      const bands = new Array(8).fill(0);
      samples.forEach(sample => sample.bands.slice(0, 8).forEach((value, index) => { bands[index] += Number(value || 0) / count; }));
      return {
        style: args.style,
        paused: window.audio.paused,
        analyserSame: window.analyser === window.__lfP10Analyser,
        frequencyDataSame: window.frequencyData === window.__lfP10FrequencyData,
        contextSame: window.audioCtx === window.__lfP10AudioCtx,
        sourceSame: window.source === window.__lfP10Source,
        gainSame: window.gainNode === window.__lfP10Gain,
        bands,
        low: samples.reduce((n, sample) => n + sample.low, 0) / count,
        mid: samples.reduce((n, sample) => n + sample.mid, 0) / count,
        high: samples.reduce((n, sample) => n + sample.high, 0) / count,
        height: samples.reduce((n, sample) => n + sample.height, 0) / count,
        regions: samples.map(sample => sample.region),
        samples,
      };
    }, [{ style, uri: clips[style] }]);
    const shot = await screenshot(imageName);
    loaded.screenshot = shot.file;
    loaded.pixels = await screenshotMetrics(shot.data);
    return loaded;
  }

  const lowStyle = await playStyle('low', '01-low-frequency-terrain');
  const midStyle = await playStyle('mid', '02-mid-frequency-terrain');
  const highStyle = await playStyle('high', '03-high-frequency-terrain');
  const styles = [lowStyle, midStyle, highStyle];
  pass('all three original WAVs reuse the same complete audio graph', styles.every(row =>
    !row.paused && row.analyserSame && row.frequencyDataSame && row.contextSame && row.sourceSame && row.gainSame), styles);
  pass('debug returns eight real analyser bands for every style', styles.every(row =>
    Array.isArray(row.bands) && row.bands.length === 8 && row.bands.some(value => value > 0.003)), styles);
  const spectralGroups = {
    low: { low: sum(lowStyle.bands, 0, 2), mid: sum(lowStyle.bands, 2, 5), high: sum(lowStyle.bands, 5, 8) },
    mid: { low: sum(midStyle.bands, 0, 2), mid: sum(midStyle.bands, 2, 5), high: sum(midStyle.bands, 5, 8) },
    high: { low: sum(highStyle.bands, 0, 2), mid: sum(highStyle.bands, 2, 5), high: sum(highStyle.bands, 5, 8) },
  };
  pass('low mid and high WAVs drive significantly different eight-band regions',
    spectralGroups.low.low > spectralGroups.low.mid && spectralGroups.low.low > spectralGroups.low.high &&
    spectralGroups.mid.mid > spectralGroups.mid.low && spectralGroups.mid.mid > spectralGroups.mid.high &&
    spectralGroups.high.high > spectralGroups.high.low && spectralGroups.high.high > spectralGroups.high.mid &&
    vectorDistance(lowStyle.bands, midStyle.bands) > 0.01 &&
    vectorDistance(midStyle.bands, highStyle.bands) > 0.01 &&
    vectorDistance(lowStyle.bands, highStyle.bands) > 0.01,
    { spectralGroups, low: lowStyle.bands, mid: midStyle.bands, high: highStyle.bands });
  pass('terrain exposes distinct low middle and high spatial response',
    styles.every(row => Array.isArray(row.regions) && row.regions.some(value => value && typeof value === 'object')) &&
    JSON.stringify(lowStyle.regions) !== JSON.stringify(midStyle.regions) &&
    JSON.stringify(midStyle.regions) !== JSON.stringify(highStyle.regions),
    { low: lowStyle.regions, mid: midStyle.regions, high: highStyle.regions });
  pass('low mid and high screenshots are visibly rendered and measurably different',
    styles.every(row => row.pixels.meanLuminance > 8 && row.pixels.coloredRatio > 0.08 && row.pixels.brightRatio > 0.015) &&
    vectorDistance(lowStyle.pixels.values, midStyle.pixels.values) > 1.2 &&
    vectorDistance(midStyle.pixels.values, highStyle.pixels.values) > 1.2 &&
    vectorDistance(lowStyle.pixels.values, highStyle.pixels.values) > 1.2,
    { low: Object.assign({}, lowStyle.pixels, { values:undefined }),
      mid: Object.assign({}, midStyle.pixels, { values:undefined }),
      high: Object.assign({}, highStyle.pixels, { values:undefined }),
      differences: {
        lowMid: vectorDistance(lowStyle.pixels.values, midStyle.pixels.values),
        midHigh: vectorDistance(midStyle.pixels.values, highStyle.pixels.values),
        lowHigh: vectorDistance(lowStyle.pixels.values, highStyle.pixels.values),
      } });

  const echoComposite = await cdp.call(function () {
    const anchor = window.scene.getObjectByName('LumiFieldEchoAnchor');
    const terrain = window.scene.getObjectByName('LumiFieldEchoTerrainGrid');
    const previousVisible = anchor.visible;
    anchor.visible = true;
    window.renderer.render(window.scene, window.camera);
    const on = window.renderer.domElement.toDataURL('image/png').split(',')[1];
    anchor.visible = false;
    window.renderer.render(window.scene, window.camera);
    const off = window.renderer.domElement.toDataURL('image/png').split(',')[1];
    anchor.visible = previousVisible;
    window.renderer.render(window.scene, window.camera);
    return {
      on,
      off,
      material: terrain && terrain.material ? {
        type: terrain.material.type,
        color: terrain.material.color && terrain.material.color.getHexString(),
        vertexColors: terrain.material.vertexColors,
        opacity: terrain.material.opacity,
        blending: terrain.material.blending,
        depthWrite: terrain.material.depthWrite,
        depthTest: terrain.material.depthTest,
        toneMapped: terrain.material.toneMapped,
      } : null,
      instanceColor: !!(terrain && terrain.instanceColor),
      instanceColorCount: terrain && terrain.instanceColor && terrain.instanceColor.count,
    };
  });
  const echoOnFile = path.join(evidenceDir, '04-echo-composite-on.png');
  const echoOffFile = path.join(evidenceDir, '04-echo-composite-off.png');
  fs.writeFileSync(echoOnFile, Buffer.from(echoComposite.on, 'base64'));
  fs.writeFileSync(echoOffFile, Buffer.from(echoComposite.off, 'base64'));
  screenshots.push(echoOnFile, echoOffFile);
  const echoCompositeDifference = await imageDifference(echoComposite.on, echoComposite.off);
  pass('actual composite pixels prove echo terrain is colored and bright rather than a black occluder',
    echoComposite.instanceColor && echoComposite.instanceColorCount > 0 &&
    echoComposite.material && echoComposite.material.depthTest === true && echoComposite.material.depthWrite === false &&
    echoCompositeDifference.changedRatio > 0.003 &&
    echoCompositeDifference.brighterRatio > echoCompositeDifference.darkerRatio * 1.2 &&
    echoCompositeDifference.meanOnChangedLuminance > echoCompositeDifference.meanOffChangedLuminance + 2,
    { material: echoComposite.material, instanceColorCount: echoComposite.instanceColorCount, difference: echoCompositeDifference });

  await cdp.call(async function (uri) {
    window.audio.pause();
    window.audio.src = uri;
    window.audio.currentTime = 0;
    window.audio.load();
    window.playing = true;
    await window.audio.play();
  }, [clips.low]);
  await setEcho({ visualEq: [1, 1, 1, 1, 1, 1, 1, 1] }, 900);
  const eqBaseline = await cdp.call(function () {
    const debug = window.LumiFieldTask13.getEchoDebug();
    return {
      vector: Array.from(debug.visualBandEnergies || debug.bandEnergies || []),
      region: debug.regionResponse,
      analyser: window.analyser === window.__lfP10Analyser,
      source: window.source === window.__lfP10Source,
      gain: window.gainNode === window.__lfP10Gain,
      volume: window.audio.volume,
      rate: window.audio.playbackRate,
      currentTime: window.audio.currentTime,
      mutations: debug.audioGraphMutations,
    };
  });
  await setEcho({ visualEq: [2, 2, 1.8, 0.25, 0.25, 0.25, 0.25, 0.25] }, 850);
  const eqBoosted = await cdp.call(function () {
    const debug = window.LumiFieldTask13.getEchoDebug();
    return {
      visualEq: Array.from(debug.visualEq || []),
      vector: Array.from(debug.visualBandEnergies || debug.bandEnergies || []),
      region: debug.regionResponse,
      analyser: window.analyser === window.__lfP10Analyser,
      source: window.source === window.__lfP10Source,
      gain: window.gainNode === window.__lfP10Gain,
      volume: window.audio.volume,
      rate: window.audio.playbackRate,
      currentTime: window.audio.currentTime,
      mutations: debug.audioGraphMutations,
    };
  });
  pass('eight-band EQ changes visual response only and leaves sound graph untouched',
    eqBoosted.visualEq.length === 8 &&
    sum(eqBoosted.vector, 0, 3) > sum(eqBaseline.vector, 0, 3) * 1.15 &&
    vectorDistance(eqBaseline.vector, eqBoosted.vector) > 0.008 &&
    eqBaseline.analyser && eqBaseline.source && eqBaseline.gain && eqBoosted.analyser && eqBoosted.source && eqBoosted.gain &&
    eqBoosted.volume === eqBaseline.volume && eqBoosted.rate === eqBaseline.rate &&
    eqBoosted.currentTime > eqBaseline.currentTime && eqBaseline.mutations === 0 && eqBoosted.mutations === 0,
    { baseline: eqBaseline, boosted: eqBoosted });
  await setEcho({ visualEq: [1, 1, 1, 1, 1, 1, 1, 1] }, 300);

  await setEcho({
    rippleEnabled: true,
    rippleSensitivity: 1,
    rippleCooldown: 1,
    particleStrength: 1,
    idleWave: false,
  }, 160);
  const peakEvidence = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const samples = [];
    const particlePool = window.scene.getObjectByName('LumiFieldAudioEchoImpactParticlePool');
    const particleGeometry = particlePool && particlePool.geometry;
    const birthAttribute = particleGeometry && particleGeometry.getAttribute('aBirth');
    let previousParticleVersion = birthAttribute ? birthAttribute.version : -1;
    const started = performance.now();
    while (performance.now() - started < 2600) {
      const debug = api.getEchoDebug();
      const pool = window.scene.getObjectByName('LumiFieldAudioEchoImpactParticlePool');
      const geometry = pool && pool.geometry;
      const birth = geometry && geometry.getAttribute('aBirth');
      const origin = geometry && geometry.getAttribute('aOrigin');
      const velocity = geometry && geometry.getAttribute('aVelocity');
      const life = geometry && geometry.getAttribute('aLife');
      const particleVersion = birth ? birth.version : -1;
      let latestSlot = -1;
      let latestBirth = -Infinity;
      if (birth) {
        for (let index = 0; index < birth.count; index += 1) {
          const value = birth.getX(index);
          if (value > latestBirth) { latestBirth = value; latestSlot = index; }
        }
      }
      const latestParticle = latestSlot >= 0 ? {
        slot: latestSlot,
        birth: latestBirth,
        life: life.getX(latestSlot),
        origin: [origin.getX(latestSlot), origin.getY(latestSlot), origin.getZ(latestSlot)],
        velocity: [velocity.getX(latestSlot), velocity.getY(latestSlot), velocity.getZ(latestSlot)],
      } : null;
      samples.push({
        at: Math.round(performance.now() - started),
        flux: Number(debug.spectralFlux || 0),
        rippleCount: Number(debug.rippleCount || 0),
        particleCapacity: Number(debug.particleCapacity || 0),
        particleVersion,
        particleSpawned: particleVersion > previousParticleVersion,
        latestParticle,
      });
      previousParticleVersion = particleVersion;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const beforePause = api.getEchoDebug();
    const beforePauseVersion = birthAttribute ? birthAttribute.version : -1;
    window.audio.pause();
    window.playing = false;
    await new Promise(resolve => setTimeout(resolve, 1000));
    const afterPause = api.getEchoDebug();
    const afterPauseVersion = birthAttribute ? birthAttribute.version : -1;
    return { samples, beforePause, afterPause, beforePauseVersion, afterPauseVersion };
  });
  const impactSamples = peakEvidence.samples.filter(row => row.particleSpawned && row.rippleCount > 0 && row.flux > 0.0045);
  const finiteImpact = event => event && [event.birth, event.life].concat(event.origin, event.velocity)
    .every(value => Number.isFinite(Number(value)));
  const noMeteorFields = ['meteorEnabled', 'meteorSensitivity', 'meteorCooldown', 'clickMeteor']
    .every(key => !Object.prototype.hasOwnProperty.call(peakEvidence.beforePause.state || {}, key) &&
      !Object.prototype.hasOwnProperty.call(peakEvidence.beforePause, key));
  pass('real spectral peaks trigger bounded ripples and controlled impact particles only while audio plays',
    impactSamples.length > 0 && impactSamples.every(row =>
      row.rippleCount > 0 && row.rippleCount <= 8 &&
      row.particleCapacity > 0 && row.particleCapacity <= 256 &&
      finiteImpact(row.latestParticle) && row.latestParticle.life > 0) &&
    peakEvidence.afterPauseVersion === peakEvidence.beforePauseVersion &&
    noMeteorFields && !/\bMath\.random\s*\(/.test(echoSource),
    { impactCount: impactSamples.length, impacts: impactSamples.slice(-8),
      noMeteorFields, beforePause: peakEvidence.beforePause, afterPause: peakEvidence.afterPause });
  await cdp.call(async function () {
    window.playing = true;
    await window.audio.play();
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
  });
  await delay(450);

  async function transformSignature() {
    return cdp.call(function () {
      const debug = window.LumiFieldTask13.getEchoDebug();
      const values = [];
      ['LumiFieldEchoAnchor', 'LumiFieldEchoTerrainStage'].forEach(name => {
        const node = window.scene.getObjectByName(name);
        if (node) { node.updateWorldMatrix(true, false); values.push(...Array.from(node.matrixWorld.elements).map(value => Number(value.toFixed(5)))); }
      });
      values.push(...Array.from(window.camera.matrixWorld.elements).map(value => Number(value.toFixed(5))));
      return { values, camera: debug.camera, effectiveCamera: debug.effectiveCamera, transform: debug.transformSignature };
    });
  }
  await setEcho({ autoRotate: false, cameraDistance: 0.75, cameraHorizontal: -52, cameraElevation: 18 }, 350);
  const cameraA = await transformSignature();
  await setEcho({ cameraDistance: 1.75 }, 350);
  const cameraDistance = await transformSignature();
  await setEcho({ cameraHorizontal: 66 }, 350);
  const cameraHorizontal = await transformSignature();
  await setEcho({ cameraElevation: 62 }, 350);
  const cameraElevation = await transformSignature();
  await setEcho({ autoRotate: true, rotateSpeed: 0.8 }, 100);
  const rotateA = await transformSignature();
  await delay(800);
  const rotateB = await transformSignature();
  pass('distance horizontal elevation and autorotate alter actual Three transforms',
    JSON.stringify(cameraA.values) !== JSON.stringify(cameraDistance.values) &&
    JSON.stringify(cameraDistance.values) !== JSON.stringify(cameraHorizontal.values) &&
    JSON.stringify(cameraHorizontal.values) !== JSON.stringify(cameraElevation.values) &&
    JSON.stringify(rotateA.values) !== JSON.stringify(rotateB.values),
    { cameraA, cameraDistance, cameraHorizontal, cameraElevation, rotateA, rotateB });
  await setEcho({ autoRotate: false, rotateSpeed: 0.16, cameraDistance: 1.05, cameraHorizontal: 0, cameraElevation: 34 }, 300);

  async function terrainVisualSignature() {
    return cdp.call(function () {
      const debug = window.LumiFieldTask13.getEchoDebug();
      const mesh = window.scene.getObjectByName('LumiFieldEchoTerrainGrid');
      const colors = [];
      const materials = mesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      materials.forEach(material => {
        if (!material) return;
        if (material.color) colors.push(material.color.getHexString());
        if (material.emissive) colors.push(material.emissive.getHexString());
        if (material.uniforms) Object.keys(material.uniforms).sort().forEach(key => {
          const value = material.uniforms[key] && material.uniforms[key].value;
          if (value && value.isColor) colors.push(key + ':' + value.getHexString());
        });
      });
      if (mesh && mesh.instanceColor && typeof mesh.getColorAt === 'function') {
        const color = new window.THREE.Color();
        for (let index = 0; index < Math.min(mesh.count, 24); index += 3) {
          mesh.getColorAt(index, color);
          colors.push(color.getHexString());
        }
      }
      const matrix = new window.THREE.Matrix4();
      const scale = new window.THREE.Vector3();
      const heights = [];
      if (mesh && mesh.isInstancedMesh) {
        for (let index = 0; index < mesh.count; index += 1) {
          mesh.getMatrixAt(index, matrix);
          scale.setFromMatrixScale(matrix);
          heights.push(scale.y);
        }
      }
      return {
        debug,
        colors,
        meanHeight: heights.reduce((total, value) => total + value, 0) / Math.max(1, heights.length),
        maxHeight: heights.length ? Math.max(...heights) : 0,
        activeInstances: heights.filter(value => value > 0.025).length,
      };
    });
  }

  await setEcho({ theme: 'azure', accentEnabled: false, accentStrength: 0 }, 500);
  const themeAzure = await terrainVisualSignature();
  await setEcho({ theme: 'flame', accentEnabled: true, accentStrength: 1.8 }, 500);
  const themeFlame = await terrainVisualSignature();
  pass('theme and accent settings update live terrain material or instance colors',
    themeAzure.debug.theme === 'azure' && themeFlame.debug.theme === 'flame' &&
    (themeAzure.debug.accentEnabled === false || themeAzure.debug.accent && themeAzure.debug.accent.enabled === false) &&
    (themeFlame.debug.accentEnabled === true || themeFlame.debug.accent && themeFlame.debug.accent.enabled === true) &&
    (themeFlame.debug.accentStrength === 1.8 || themeFlame.debug.accent && themeFlame.debug.accent.strength === 1.8) &&
    (JSON.stringify(themeAzure.colors) !== JSON.stringify(themeFlame.colors) ||
      themeAzure.debug.colorSignature !== themeFlame.debug.colorSignature),
    { azure: themeAzure, flame: themeFlame });

  await setEcho({ responseStrength: 0.32, responseRange: 1 }, 700);
  const responseWeak = await terrainVisualSignature();
  await setEcho({ responseStrength: 2.35 }, 700);
  const responseStrong = await terrainVisualSignature();
  pass('response strength changes real instance heights',
    (responseStrong.debug.responseStrength === 2.35 || responseStrong.debug.state.responseStrength === 2.35) &&
    (responseWeak.debug.responseStrength === 0.32 || responseWeak.debug.state.responseStrength === 0.32) &&
    responseStrong.maxHeight > responseWeak.maxHeight * 1.45 &&
    responseStrong.meanHeight > responseWeak.meanHeight * 1.25,
    { weak: responseWeak, strong: responseStrong });

  await setEcho({ responseStrength: 1.2, responseRange: 0.18 }, 700);
  const responseNarrow = await terrainVisualSignature();
  await setEcho({ responseRange: 1 }, 700);
  const responseWide = await terrainVisualSignature();
  const narrowBins = Number(responseNarrow.debug.responseBinCount || responseNarrow.debug.sampledBinCount || responseNarrow.debug.effectiveBinCount || 0);
  const wideBins = Number(responseWide.debug.responseBinCount || responseWide.debug.sampledBinCount || responseWide.debug.effectiveBinCount || 0);
  pass('response range changes analyser coverage or spatial region response',
    (responseNarrow.debug.responseRange === 0.18 || responseNarrow.debug.state.responseRange === 0.18) &&
    (responseWide.debug.responseRange === 1 || responseWide.debug.state.responseRange === 1) &&
    ((narrowBins > 0 && wideBins > narrowBins) ||
      JSON.stringify(responseNarrow.debug.regionResponse) !== JSON.stringify(responseWide.debug.regionResponse)),
    { narrowBins, wideBins, narrow: responseNarrow.debug, wide: responseWide.debug });

  await cdp.call(function () { window.audio.pause(); window.playing = false; });
  await setEcho({ idleWave: true, idleDebounce: 0, idleFade: 0.1, rippleEnabled: false }, 850);
  const idleOn = await terrainVisualSignature();
  await setEcho({ idleWave: false }, 1000);
  const idleOff = await terrainVisualSignature();
  pass('idle wave setting drives terrain only after audio becomes idle',
    (idleOn.debug.idleWave === true || idleOn.debug.state.idleWave === true) &&
    (idleOn.debug.idleWaveActive === true || idleOn.debug.idleMix > 0.01) && idleOn.maxHeight > 0.001 &&
    (idleOff.debug.idleWave === false || idleOff.debug.state.idleWave === false) &&
    (idleOff.debug.idleWaveActive === false || idleOff.debug.idleMix <= 0.001) && idleOff.maxHeight < idleOn.maxHeight,
    { on: idleOn, off: idleOff });
  await cdp.call(async function () {
    window.playing = true;
    await window.audio.play();
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
  });
  await setEcho({ idleWave: false, rippleEnabled: true }, 450);

  await setEcho({ playerVisible: false }, 250);
  const playerHidden = await cdp.call(function () {
    const node = document.getElementById('lf-t13-echo-player');
    const style = node && getComputedStyle(node);
    return { debug: window.LumiFieldTask13.getEchoDebug(), exists: !!node,
      visible: !!(node && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01) };
  });
  await setEcho({ playerVisible: true, playerCover: false, playerSize: 1.35, playerX: 12, playerY: -9 }, 300);
  const playerShown = await cdp.call(function () {
    const node = document.getElementById('lf-t13-echo-player');
    const style = node && getComputedStyle(node);
    return { debug: window.LumiFieldTask13.getEchoDebug(), exists: !!node,
      visible: !!(node && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01),
      withoutCover: !!(node && node.classList.contains('without-cover')),
      size: node && style.getPropertyValue('--lf-echo-player-size').trim(),
      x: node && style.getPropertyValue('--lf-echo-player-x').trim(),
      y: node && style.getPropertyValue('--lf-echo-player-y').trim() };
  });
  pass('player visibility cover size and position settings are live',
    playerHidden.exists && !playerHidden.visible && playerShown.exists && playerShown.visible && playerShown.withoutCover &&
    (playerShown.debug.playerVisible === true || playerShown.debug.player.visible === true) &&
    (playerShown.debug.playerCover === false || playerShown.debug.player.cover === false) &&
    (playerShown.debug.playerSize === 1.35 || playerShown.debug.player.size === 1.35) &&
    (playerShown.debug.playerX === 12 || playerShown.debug.player.x === 12) &&
    (playerShown.debug.playerY === -9 || playerShown.debug.player.y === -9) &&
    playerShown.size === '1.35' && playerShown.x === '12vw' && playerShown.y === '-9vh',
    { hidden: playerHidden, shown: playerShown });

  const jsonEvidence = await cdp.call(function () {
    const api = window.LumiFieldTask13;
    const validEq = [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.45, 1.6];
    api.setEchoState({ visualEq: validEq });
    const exportPayload = window.userFxArchiveExportPayload({ name: 'Problem 10 fixture', savedAt: 10, snapshot: {} });
    const beforeValidCount = Array.isArray(window.userFxArchives) ? window.userFxArchives.length : 0;
    const importEq = [1.6, 1.45, 1.3, 1.15, 1, 0.85, 0.7, 0.55];
    const validResult = window.importUserFxArchiveText(JSON.stringify({
      schema: 2,
      name: 'Problem 10 valid EQ',
      echo: { visualEq: importEq },
    }), 'problem10-valid.json', { preview: false });
    const afterValid = api.getState().echo;
    const beforeInvalid = JSON.stringify(afterValid);
    const storedBefore = localStorage.getItem('lumifield-task13-echo-v1');
    const archivesBefore = Array.isArray(window.userFxArchives) ? window.userFxArchives.length : 0;
    const invalidResult = window.importUserFxArchiveText(JSON.stringify({
      schema: 2,
      name: 'Problem 10 invalid EQ',
      echo: { visualEq: [1, 1, 1] },
    }), 'problem10-invalid.json', { preview: false });
    const afterInvalid = JSON.stringify(api.getState().echo);
    const storedAfter = localStorage.getItem('lumifield-task13-echo-v1');
    const archivesAfter = Array.isArray(window.userFxArchives) ? window.userFxArchives.length : 0;
    let directRejected = false;
    try { directRejected = api.setEchoState({ visualEq: [1, 'bad', 1, 1, 1, 1, 1, 1] }) === false; } catch (_) { directRejected = true; }
    return {
      exportPayload,
      validResult,
      importEq,
      afterValid,
      validArchiveDelta: archivesBefore - beforeValidCount,
      invalidResult,
      invalidStateUnchanged: beforeInvalid === afterInvalid,
      invalidStorageUnchanged: storedBefore === storedAfter,
      invalidArchivesUnchanged: archivesBefore === archivesAfter,
      directRejected,
      directStateUnchanged: afterInvalid === JSON.stringify(api.getState().echo),
    };
  });
  pass('JSON export and valid import preserve exactly eight visual EQ values',
    jsonEvidence.exportPayload && jsonEvidence.exportPayload.echo &&
    Array.isArray(jsonEvidence.exportPayload.echo.visualEq) && jsonEvidence.exportPayload.echo.visualEq.length === 8 &&
    jsonEvidence.validResult === true && jsonEvidence.validArchiveDelta === 1 &&
    JSON.stringify(jsonEvidence.afterValid.visualEq) === JSON.stringify(jsonEvidence.importEq), jsonEvidence);
  pass('invalid visual EQ import is rejected transactionally with full rollback',
    jsonEvidence.invalidResult === false && jsonEvidence.invalidStateUnchanged && jsonEvidence.invalidStorageUnchanged &&
    jsonEvidence.invalidArchivesUnchanged && jsonEvidence.directRejected && jsonEvidence.directStateUnchanged, jsonEvidence);
  await setEcho({ visualEq: [1, 1, 1, 1, 1, 1, 1, 1] }, 250);

  const shapeSafety = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    const rows = [];
    const memoryBefore = window.renderer.info && window.renderer.info.memory ? Object.assign({}, window.renderer.info.memory) : {};
    for (let index = 0; index < 8; index += 1) {
      const shape = index % 2 === 0 ? 'one' : 'two';
      api.setEchoState({ enabled: true, shape });
      await new Promise(resolve => setTimeout(resolve, 180));
      const debug = api.getEchoDebug();
      let stages = 0;
      let echoObjects = 0;
      window.scene.traverse(node => {
        if (node.name === 'LumiFieldEchoTerrainStage') stages += 1;
        if (node.name && node.name.indexOf('LumiFieldEcho') === 0) echoObjects += 1;
      });
      rows.push({
        shape,
        stages,
        echoObjects,
        meshUuid: debug.meshUuid || debug.meshUUID,
        instanceCount: debug.instanceCount,
        resourceCount: debug.resources && (debug.resources.total || debug.resources.active || debug.resources.count),
        disposed: debug.disposedResources || debug.disposed || debug.resources && debug.resources.disposals,
      });
    }
    const memoryAfter = window.renderer.info && window.renderer.info.memory ? Object.assign({}, window.renderer.info.memory) : {};
    const beforeDestroy = api.getEchoDebug();
    const oldUuid = beforeDestroy.meshUuid || beforeDestroy.meshUUID;
    const destroyResult = typeof api.destroyEcho === 'function' ? api.destroyEcho() : null;
    await new Promise(resolve => setTimeout(resolve, 100));
    let stagesAfterDestroy = 0;
    let oldMeshAfterDestroy = 0;
    window.scene.traverse(node => {
      if (node.name === 'LumiFieldEchoTerrainStage') stagesAfterDestroy += 1;
      if (node.uuid === oldUuid) oldMeshAfterDestroy += 1;
    });
    api.setEchoState({ enabled: true, shape: 'one' });
    await new Promise(resolve => setTimeout(resolve, 350));
    let stagesAfterRecreate = 0;
    window.scene.traverse(node => { if (node.name === 'LumiFieldEchoTerrainStage') stagesAfterRecreate += 1; });
    return {
      rows,
      memoryBefore,
      memoryAfter,
      destroyResult,
      stagesAfterDestroy,
      oldMeshAfterDestroy,
      stagesAfterRecreate,
      recreated: api.getEchoDebug(),
    };
  });
  const shapeObjectCounts = shapeSafety.rows.map(row => row.echoObjects);
  pass('shape one/two switches dispose superseded GPU resources and keep one stage',
    shapeSafety.rows.every(row => row.stages === 1 && row.instanceCount > 0) &&
    Math.max(...shapeObjectCounts) - Math.min(...shapeObjectCounts) <= 4 &&
    Number(shapeSafety.memoryAfter.geometries || 0) <= Number(shapeSafety.memoryBefore.geometries || 0) + 6 &&
    Number(shapeSafety.memoryAfter.textures || 0) <= Number(shapeSafety.memoryBefore.textures || 0) + 4 &&
    shapeSafety.stagesAfterDestroy === 0 && shapeSafety.oldMeshAfterDestroy === 0 && shapeSafety.stagesAfterRecreate === 1,
    shapeSafety);

  await cdp.call(async function (uri) {
    window.audio.pause();
    window.audio.src = uri;
    window.audio.currentTime = 0;
    window.audio.load();
    window.audio.loop = true;
    window.playing = true;
    await window.audio.play();
  }, [clips.low]);
  await setEcho({ enabled: true, shape: 'one', idleWave: false, responseStrength: 1.35 }, 850);
  const pauseRelease = await cdp.call(async function () {
    const api = window.LumiFieldTask13;
    function snapshot() {
      const debug = api.getEchoDebug();
      const mesh = window.scene.getObjectByName('LumiFieldEchoTerrainGrid');
      const matrix = new window.THREE.Matrix4();
      const scale = new window.THREE.Vector3();
      let maxHeight = 0;
      if (mesh && mesh.isInstancedMesh) {
        for (let index = 0; index < mesh.count; index += 1) {
          mesh.getMatrixAt(index, matrix);
          scale.setFromMatrixScale(matrix);
          maxHeight = Math.max(maxHeight, scale.y);
        }
      }
      return Object.assign({}, debug, {
        maxHeight: Number(debug.maxHeight == null ? maxHeight : debug.maxHeight),
        releaseHidden: debug.releaseHidden == null ? !!(mesh && !mesh.visible) : !!debug.releaseHidden,
      });
    }
    const before = snapshot();
    window.audio.pause();
    window.playing = false;
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 3600) {
      const debug = snapshot();
      samples.push({ at: Math.round(performance.now() - started), height: Number(debug.maxHeight || 0),
        energy: Number(debug.energy || debug.maxEnergy || 0), hidden: !!debug.releaseHidden });
      if (debug.releaseHidden && Number(debug.maxHeight || 0) <= 0.0025) break;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    const paused = snapshot();
    window.playing = true;
    await window.audio.play();
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
    await new Promise(resolve => setTimeout(resolve, 750));
    return { before, samples, paused, resumed: snapshot() };
  });
  const smoothRelease = pauseRelease.samples.length >= 3 && pauseRelease.samples.slice(1).every((row, index) =>
    row.height <= pauseRelease.samples[index].height + 0.04);
  pass('pause smoothly releases terrain to hidden zero and resume restores analyser response',
    pauseRelease.before.maxHeight > 0.003 && smoothRelease &&
    pauseRelease.samples[1].height > 0.0001 && pauseRelease.paused.maxHeight <= 0.0025 &&
    pauseRelease.paused.releaseHidden === true && pauseRelease.resumed.maxHeight > 0.003 &&
    pauseRelease.resumed.releaseHidden === false, pauseRelease);

  await setEcho({ playerVisible: true, playerCover: true, playerSize: 1, playerX: 0, playerY: 0 }, 180);
  await cdp.call(function () {
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    if (typeof window.togglePlaylistPanel === 'function') window.togglePlaylistPanel(false);
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'problem10-ui-safety' });
  });
  await delay(300);
  const uiSafety = await cdp.call(function () {
    const selectors = ['#search-input', '#user-btn', '#play-btn', '#prev-btn', '#next-btn', '#volume-btn', '#progress-bar'];
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
        blockedByEcho: !!(hit && hit.closest && hit.closest('#lf-t13-echo,#lf-t13-echo-player')),
        hitId: hit && hit.id,
      };
    });
    const oldCanvas = document.getElementById('lf-t13-echo');
    const rendererStyle = getComputedStyle(window.renderer.domElement);
    return { targets, oldCanvasPresent: !!oldCanvas, rendererPointerEvents: rendererStyle.pointerEvents };
  });
  const visibleTargets = uiSafety.targets.filter(row => !row.missing && !row.hidden);
  pass('3D echo has no obsolete overlay and does not block LF controls',
    !uiSafety.oldCanvasPresent && visibleTargets.length >= 6 &&
    visibleTargets.filter(row => row.hit).length >= 5 && visibleTargets.every(row => !row.blockedByEcho), uiSafety);

  await cdp.call(function () {
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
    const block = document.getElementById('lf-t13-echo-block');
    if (block) {
      block.open = true;
      const eq = block.querySelector('[data-lf-echo-eq]');
      (eq || block).scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  });
  await delay(350);
  const settingsSafety = await cdp.call(function () {
    const panel = document.getElementById('fx-panel');
    const block = document.getElementById('lf-t13-echo-block');
    const rect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 90);
    const visualEq = block && block.querySelector('[data-lf-echo-eq]');
    const blockRect = block && block.getBoundingClientRect();
    const eqRect = visualEq && visualEq.getBoundingClientRect();
    return {
      panelVisible: panel.classList.contains('show'),
      panelHit: !!(hit && (hit === panel || panel.contains(hit))),
      blockOpen: !!(block && block.open),
      visualEqPresent: !!visualEq,
      visualEqEnabled: !!(visualEq && !visualEq.disabled),
      blockInViewport: !!(blockRect && blockRect.bottom > 0 && blockRect.top < innerHeight),
      visualEqInViewport: !!(eqRect && eqRect.bottom > 0 && eqRect.top < innerHeight),
    };
  });
  pass('echo settings panel remains visible clickable and operable',
    settingsSafety.panelVisible && settingsSafety.panelHit && settingsSafety.blockOpen &&
    settingsSafety.visualEqPresent && settingsSafety.visualEqEnabled &&
    settingsSafety.blockInViewport && settingsSafety.visualEqInViewport, settingsSafety);
  await screenshot('04-echo-settings-and-visual-eq');

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const finalDebug = await echoDiagnostics();
  const result = {
    ok: true,
    runId,
    mode: 'Electron source + CDP problem 10',
    origin,
    evidenceDir,
    generatedAudio: {
      type: 'test-generated original deterministic WAV',
      styles: ['low-frequency dominant', 'mid-frequency dominant', 'high-frequency dominant'],
      durationSecondsEach: 4,
      sampleRate: 44100,
      files: clipFiles,
    },
    screenshots,
    checks,
    spectralGroups,
    precisionRows,
    finalDebug,
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
});
