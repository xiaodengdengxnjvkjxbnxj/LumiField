const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_PROBLEM4_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(process.env.LF_PROBLEM4_OUT || path.join(repo, 'test-results', 'lf-problem4-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem4-'));
const checks = {};
const rendererErrors = [];
const appLog = [];
const screenshots = [];
let app;
let cdp;

fs.mkdirSync(outDir, { recursive: true });

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(details)}`}`);
  checks[name] = details == null ? true : details;
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

async function waitFor(fn, timeout = 30000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout} ms: ${JSON.stringify(last)}`);
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
        const details = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(details.exception && details.exception.description || details.text || 'renderer exception').slice(0, 1800));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception || {};
      throw new Error(exception.description || result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result && result.result.value;
  }
  call(fn, args = []) {
    return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`);
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

function wavDataUri(duration = 4, sampleRate = 44100) {
  const samples = Math.floor(duration * sampleRate);
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
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate;
    const pulse = Math.exp(-(time % 0.48) * 13);
    const value = (
      Math.sin(Math.PI * 2 * 72 * time) * 0.52 +
      Math.sin(Math.PI * 2 * 860 * time) * 0.30 +
      Math.sin(Math.PI * 2 * 5200 * time) * 0.18
    ) * (0.35 + pulse * 0.65);
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 22000))), 44 + index * 2);
  }
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const target = path.join(outDir, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  screenshots.push(target);
  return target;
}

function visualFieldMetrics(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const cellSize = 4;
  const cellColumns = Math.ceil(png.width / cellSize);
  const cellRows = Math.ceil(png.height / cellSize);
  const rawFieldCells = new Uint8Array(cellColumns * cellRows);
  const isFieldPixel = (r, g, b) => {
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return luminance >= 52 && chroma >= 22;
  };

  // Build a coarse chromatic-luminance mask. It ignores the near-black app
  // background and neutral UI glyphs while retaining cyan, purple and warm
  // terrain columns from all four reference modes.
  for (let cellY = 0; cellY < cellRows; cellY++) {
    for (let cellX = 0; cellX < cellColumns; cellX++) {
      let sampledPixels = 0;
      let fieldPixels = 0;
      const startX = cellX * cellSize;
      const startY = cellY * cellSize;
      for (let y = startY; y < Math.min(png.height * 0.84, startY + cellSize); y++) {
        for (let x = startX; x < Math.min(png.width, startX + cellSize); x++) {
          const offset = (y * png.width + x) * 4;
          sampledPixels++;
          if (isFieldPixel(png.data[offset], png.data[offset + 1], png.data[offset + 2])) fieldPixels++;
        }
      }
      if (sampledPixels && fieldPixels / sampledPixels >= 0.18) {
        rawFieldCells[cellY * cellColumns + cellX] = 1;
      }
    }
  }

  // Two cells of closing tolerance bridge the intentional gaps between
  // independent columns without allowing remote controls to become the field.
  let connectedMask = rawFieldCells;
  for (let iteration = 0; iteration < 2; iteration++) {
    const expanded = new Uint8Array(connectedMask);
    for (let y = 1; y < cellRows - 1; y++) {
      for (let x = 1; x < cellColumns - 1; x++) {
        if (!connectedMask[y * cellColumns + x]) continue;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            expanded[(y + offsetY) * cellColumns + x + offsetX] = 1;
          }
        }
      }
    }
    connectedMask = expanded;
  }

  const visited = new Uint8Array(connectedMask.length);
  let largestComponent = [];
  for (let start = 0; start < connectedMask.length; start++) {
    if (!connectedMask[start] || visited[start]) continue;
    const component = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < component.length; cursor++) {
      const index = component[cursor];
      const x = index % cellColumns;
      const y = Math.floor(index / cellColumns);
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= cellColumns || nextY >= cellRows) continue;
          const next = nextY * cellColumns + nextX;
          if (connectedMask[next] && !visited[next]) {
            visited[next] = 1;
            component.push(next);
          }
        }
      }
    }
    if (component.length > largestComponent.length) largestComponent = component;
  }

  const componentCells = new Uint8Array(connectedMask.length);
  let minCellX = cellColumns;
  let minCellY = cellRows;
  let maxCellX = -1;
  let maxCellY = -1;
  largestComponent.forEach(index => {
    componentCells[index] = 1;
    const x = index % cellColumns;
    const y = Math.floor(index / cellColumns);
    minCellX = Math.min(minCellX, x);
    minCellY = Math.min(minCellY, y);
    maxCellX = Math.max(maxCellX, x);
    maxCellY = Math.max(maxCellY, y);
  });

  const componentFound = largestComponent.length > 0;
  const fieldLeft = componentFound ? minCellX * cellSize : 0;
  const fieldTop = componentFound ? minCellY * cellSize : 0;
  const fieldRight = componentFound ? Math.min(png.width, (maxCellX + 1) * cellSize) : 0;
  const fieldBottom = componentFound ? Math.min(png.height, (maxCellY + 1) * cellSize) : 0;
  let coreWeight = 0;
  let coreX = 0;
  let coreY = 0;
  let componentFieldPixels = 0;
  if (componentFound) {
    for (let y = fieldTop; y < fieldBottom; y += 2) {
      for (let x = fieldLeft; x < fieldRight; x += 2) {
        const cell = Math.floor(y / cellSize) * cellColumns + Math.floor(x / cellSize);
        if (!componentCells[cell]) continue;
        const offset = (y * png.width + x) * 4;
        const r = png.data[offset];
        const g = png.data[offset + 1];
        const b = png.data[offset + 2];
        if (!isFieldPixel(r, g, b)) continue;
        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const weight = Math.pow(Math.max(1, luminance - 70), 2);
        componentFieldPixels++;
        coreWeight += weight;
        coreX += x * weight;
        coreY += y * weight;
      }
    }
  }

  // The title-bar controls plus Home/account controls are protected. The
  // terrain may sit behind glass UI elsewhere, but it must not wash these out.
  const topUiZones = [
    [0.75, 0, 1, 0.09],
    [0.84, 0.08, 1, 0.20],
  ];
  let topUiSampled = 0;
  let topUiFieldPixels = 0;
  topUiZones.forEach(zone => {
    for (let y = Math.floor(png.height * zone[1]); y < png.height * zone[3]; y += 2) {
      for (let x = Math.floor(png.width * zone[0]); x < png.width * zone[2]; x += 2) {
        const offset = (y * png.width + x) * 4;
        topUiSampled++;
        if (isFieldPixel(png.data[offset], png.data[offset + 1], png.data[offset + 2])) topUiFieldPixels++;
      }
    }
  });

  const x0 = Math.floor(png.width * 0.28);
  const x1 = Math.floor(png.width * 0.84);
  const y0 = Math.floor(png.height * 0.15);
  const y1 = Math.floor(png.height * 0.74);
  let sampled = 0;
  let colored = 0;
  let bright = 0;
  let luminanceSum = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const offset = (y * png.width + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      sampled++;
      luminanceSum += luminance;
      if (luminance >= 58 && chroma >= 24) colored++;
      if (luminance >= 118) bright++;
    }
  }
  return {
    width:png.width,
    height:png.height,
    sampled,
    coloredRatio:colored / Math.max(1, sampled),
    brightRatio:bright / Math.max(1, sampled),
    meanLuminance:luminanceSum / Math.max(1, sampled),
    componentFound,
    componentRatio:largestComponent.length / Math.max(1, cellColumns * cellRows),
    componentFieldPixelRatio:componentFieldPixels / Math.max(1, png.width * png.height / 4),
    fieldBbox:{
      left:fieldLeft / png.width,
      top:fieldTop / png.height,
      right:fieldRight / png.width,
      bottom:fieldBottom / png.height,
      width:(fieldRight - fieldLeft) / png.width,
      height:(fieldBottom - fieldTop) / png.height,
    },
    margins:{
      left:fieldLeft / png.width,
      right:1 - fieldRight / png.width,
      top:fieldTop / png.height,
      bottom:1 - fieldBottom / png.height,
    },
    coreCentroid:{
      x:coreWeight ? coreX / coreWeight / png.width : -1,
      y:coreWeight ? coreY / coreWeight / png.height : -1,
    },
    topUiFieldRatio:topUiFieldPixels / Math.max(1, topUiSampled),
  };
}

async function pageWait(fn, args = [], timeout = 30000) {
  return waitFor(() => cdp.call(fn, args).then(Boolean), timeout, 100);
}

async function setEcho(patch, settle = 350) {
  const result = await cdp.call(function (value) {
    const api = window.LumiFieldTask13;
    const ok = api && api.setEchoState(value);
    return { ok:ok !== false, state:api && api.getState().echo };
  }, [patch]);
  pass(`apply ${Object.keys(patch).join(',')}`, result && result.ok, result);
  await delay(settle);
  return result;
}

async function debugSummary() {
  return cdp.call(function () {
    const debug = window.LumiFieldTask13.getEchoDebug();
    let echoRoots = 0;
    let terrainMeshes = 0;
    let instanceMatrixVersion = -1;
    let terrainMaterial = null;
    window.scene.traverse(node => {
      if (node.userData && node.userData.audioEchoRoot) echoRoots += 1;
      if (node.userData && node.userData.audioEchoMode && node.isInstancedMesh) {
        terrainMeshes += 1;
        instanceMatrixVersion = node.instanceMatrix.version;
        terrainMaterial = {
          type:node.material && node.material.type,
          fragment:String(node.material && node.material.fragmentShader || '').slice(-220),
          transparent:!!(node.material && node.material.transparent),
          blending:node.material && node.material.blending,
        };
      }
    });
    return {
      mode:debug.mode,
      modeName:debug.modeName,
      autoRotate:!!window.LumiFieldTask13.getState().echo.autoRotate,
      topologySignature:debug.topologySignature,
      quality:debug.quality,
      columns:debug.columns,
      rows:debug.rows,
      instanceCount:debug.instanceCount,
      activeModeResourceCount:debug.activeModeResourceCount,
      staticInstanceMatrices:debug.staticInstanceMatrices,
      gpuUniformDriven:debug.gpuUniformDriven,
      allocations:debug.allocations,
      shared:debug.shared,
      render:debug.render,
      bands:debug.bands,
      totalEnergy:debug.totalEnergy,
      rippleCount:debug.rippleCount,
      particleCapacity:debug.particleCapacity,
      lyrics:debug.lyrics,
      visibility:debug.visibility,
      shaderColors:debug.shaderColors,
      echoRoots,
      terrainMeshes,
      instanceMatrixVersion,
      terrainMaterial,
      playerPresent:!!document.getElementById('lf-t13-echo-player'),
      oldCanvasPresent:!!document.getElementById('lf-t13-echo'),
      shaderFailures:(window.renderer.info.programs || []).filter(program =>
        program.diagnostics && program.diagnostics.runnable === false
      ).map(program => ({
        name:program.name,
        programLog:program.diagnostics && program.diagnostics.programLog || '',
        vertexLog:program.diagnostics && program.diagnostics.vertexShader && program.diagnostics.vertexShader.log || '',
        fragmentLog:program.diagnostics && program.diagnostics.fragmentShader && program.diagnostics.fragmentShader.log || '',
      })),
    };
  });
}

async function run() {
  const managerSource = fs.readFileSync(path.join(repo, 'public', 'lumifield-audio-echo.js'), 'utf8');
  const taskSource = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  pass('clean-room runtime creates no duplicate core resources',
    !/new\s+THREE\.WebGLRenderer/.test(managerSource) &&
    !/(?:new\s+)?(?:window\.)?(?:AudioContext|webkitAudioContext)\s*\(/.test(managerSource) &&
    !/createAnalyser\s*\(/.test(managerSource) &&
    !/requestAnimationFrame\s*\(/.test(managerSource) &&
    !/requestAnimationFrame\s*\(\s*echoFrame/.test(taskSource) &&
    !taskSource.includes('lf-t13-echo-player') &&
    !taskSource.includes('LumiFieldEchoTerrainStage'));
  pass('clean-room license audit is present',
    fs.existsSync(path.join(repo, 'docs', 'licenses', 'audio-echo', 'AUDIT.md')) &&
    fs.existsSync(path.join(repo, 'docs', 'licenses', 'audio-echo', 'CLEAN_ROOM.md')));
  pass('clean-room manager contains no reference branding, network import, or packaged media',
    !/(sonic[ -]?topography|yin-yizhen|hgbhh258|zhang-le-zun|cmzya|\balex-zeya\b|wallpaper engine|soundhelix)/i.test(managerSource) &&
    !/(?:https?:\/\/|fetch\s*\(|XMLHttpRequest|WebSocket|TextureLoader|GLTFLoader)/.test(managerSource) &&
    !/['"][^'"]+\.(?:gif|png|jpe?g|mp3|wav|ogg|flac|glb|gltf|woff2?|ttf|otf)['"]/i.test(managerSource));
  const packageManifest = require(path.join(repo, 'package.json'));
  pass('production package includes clean-room manager through the public app bundle',
    packageManifest.build && Array.isArray(packageManifest.build.files) &&
    packageManifest.build.files.includes('public/**/*'));
  pass('manager is loaded after state facade',
    taskSource.includes('updateEchoFrame') &&
    fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8').includes('/lumifield-audio-echo.js'));

  const port = await freePort();
  const launchArgs = (installedExecutable ? [] : ['.']).concat([
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
  ]);
  app = spawn(launchExecutable, launchArgs, {
    cwd:installedExecutable ? path.dirname(installedExecutable) : repo,
    env:Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH:'1',
      LF_ALLOW_LOCAL_CODES:'1',
      LF_ALLOW_PACKAGED_CDP_TEST:'1',
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true',
      LF_MAIL_HOST:' ',
      LF_MAIL_USER:' ',
      LF_MAIL_PASSWORD:' ',
      LF_REMOTE_API_URL:' ',
    }),
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) rendererErrors.push(text.slice(0,1800));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 45000, 180);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageWait(function () {
    return document.readyState === 'complete' && window.LumiFieldTask13 &&
      window.LumiFieldAudioEchoManager && window.renderer && window.scene && window.camera;
  }, [], 45000);

  await cdp.call(function () {
    try { Object.defineProperty(document,'hidden',{ configurable:true, get:function(){ return false; } }); } catch (_) {}
    try { Object.defineProperty(document,'visibilityState',{ configurable:true, get:function(){ return 'visible'; } }); } catch (_) {}
    if (window.desktopRuntimeState) {
      window.desktopRuntimeState.minimized = false;
      window.desktopRuntimeState.visible = true;
    }
    document.body.classList.remove('lf-auth-locked','splash-active','empty-home-active','render-deep-sleep');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason:'problem4-smoke' });
    if (window.LumiFieldAudioEchoManager) window.LumiFieldAudioEchoManager.resume();
  });

  await setEcho({
    enabled:true,
    shape:'one',
    quality:'high',
    mode1LeftLyricsEnabled:false,
    autoRotate:false,
    idleDebounce:0,
    idleFade:0.1,
  }, 700);
  const audioUri = wavDataUri();
  await cdp.call(async function (uri) {
    if (!window.audio) {
      window.audio = new Audio();
      window.audio.crossOrigin = 'anonymous';
    }
    if (!window.audioReady && typeof window.initAudio === 'function') window.initAudio();
    window.audio.src = uri;
    window.audio.loop = true;
    window.audio.currentTime = 0;
    window.audio.load();
    window.playing = true;
    await window.audio.play();
    if (window.audioCtx && window.audioCtx.state === 'suspended') await window.audioCtx.resume();
  }, [audioUri]);
  await delay(900);
  const visualStageReady = await cdp.call(function () {
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason:'problem4-visual-evidence' });
    document.body.classList.remove('empty-home-active','home-controls-locked');
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    return !document.body.classList.contains('empty-home-active') &&
      !document.body.classList.contains('home-controls-locked') &&
      window.emptyHomeActive === false && window.homeForcedOpen === false;
  });
  pass('visual evidence runs on the unobstructed immersive stage after splash settles', visualStageReady, visualStageReady);
  await delay(180);
  const expectedCounts = { one:25600, two:25600, three:23104, four:24576 };
  const modeRows = [];
  for (const shape of ['one','two','three','four']) {
    await setEcho({ enabled:true, shape, quality:'high', autoRotate:false }, 520);
    await cdp.call(function () {
      document.querySelectorAll('.modal-mask').forEach(node => {
        node.classList.remove('show','open');
        node.style.display = 'none';
      });
      if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    });
    await delay(120);
    const row = await debugSummary();
    modeRows.push(row);
    const modeScreenshot = await screenshot(`mode-${shape}-high`);
    row.visualMetrics = visualFieldMetrics(modeScreenshot);
    pass(`${shape} uses its exact high-density topology`,
      row.mode === shape && row.instanceCount === expectedCounts[shape] &&
      row.echoRoots === 1 && row.terrainMeshes === 1 &&
      row.activeModeResourceCount === 1 && row.staticInstanceMatrices && row.gpuUniformDriven &&
      row.shaderFailures.length === 0 && row.visualMetrics.coloredRatio > 0.025 &&
      row.autoRotate === false, row);
  }
  pass('all four mode topologies are genuinely distinct',
    new Set(modeRows.map(row => row.topologySignature)).size === 4, modeRows);

  const visualTargets = {
    one:{ width:[0.35,0.92], height:[0.38,0.82] },
    two:{ width:[0.65,0.92], height:[0.45,0.82] },
    three:{ width:[0.36,0.72], height:[0.26,0.62] },
    four:{ width:[0.72,0.92], height:[0.45,0.82] },
  };
  const visualRows = Object.fromEntries(modeRows.map(row => [row.mode, row.visualMetrics]));
  const modeVisualChecks = modeRows.map(row => {
    const metrics = row.visualMetrics;
    const target = visualTargets[row.mode];
    const bbox = metrics.fieldBbox;
    const margins = metrics.margins;
    const core = metrics.coreCentroid;
    return {
      mode:row.mode,
      component:metrics.componentFound && metrics.componentRatio >= 0.012,
      width:bbox.width >= target.width[0] && bbox.width <= target.width[1],
      height:bbox.height >= target.height[0] && bbox.height <= target.height[1],
      safeMargins:Object.values(margins).every(value => value >= 0.04),
      centeredCore:core.x >= 0.42 && core.x <= 0.62 && core.y >= 0.32 && core.y <= 0.62,
      topUiProtected:metrics.topUiFieldRatio <= 0.03,
      videoLuminance:row.mode !== 'one' ||
        (metrics.meanLuminance >= 35 && metrics.meanLuminance <= 78 &&
          metrics.brightRatio >= 0.012 && metrics.brightRatio <= 0.18),
      metrics,
    };
  });
  const projectedSpan = row => {
    const points = row.visibility.projectedBounds;
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    return { width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys) };
  };
  const modeOneSpan = projectedSpan(modeRows.find(row => row.mode === 'one'));
  const modeThreeSpan = projectedSpan(modeRows.find(row => row.mode === 'three'));
  const relativeVisualChecks = {
    modeThreeSmaller:
      modeThreeSpan.width <= modeOneSpan.width * 0.75 &&
      modeThreeSpan.height <= modeOneSpan.height * 0.75,
    modeFourWider:
      visualRows.four.fieldBbox.width >= visualRows.one.fieldBbox.width + 0.015,
  };
  pass('file 13 visual framing keeps every mode centered clear of UI and preserves relative scale',
    modeVisualChecks.every(row =>
      row.component && row.width && row.height && row.safeMargins &&
      row.centeredCore && row.topUiProtected && row.videoLuminance
    ) &&
    relativeVisualChecks.modeThreeSmaller &&
    relativeVisualChecks.modeFourWider,
    { modeVisualChecks, relativeVisualChecks });

  const qualityRows = [];
  for (const quality of ['high','medium','low']) {
    await setEcho({ enabled:true, shape:'one', quality, autoRotate:false }, 420);
    qualityRows.push(await debugSummary());
  }
  pass('mode one quality tiers are 160² 112² 72²',
    qualityRows.map(row => row.instanceCount).join(',') === '25600,12544,5184', qualityRows);

  const beforeAudio = await debugSummary();
  await delay(900);
  const afterAudio = await debugSummary();
  pass('real shared analyser data drives GPU terrain without matrix rewrites',
    afterAudio.totalEnergy > 0.005 &&
    afterAudio.bands.some(value => value > 0.005) &&
    afterAudio.instanceMatrixVersion === beforeAudio.instanceMatrixVersion &&
    afterAudio.shared.analyserMatchesWindow &&
    afterAudio.shared.contextMatchesWindow &&
    afterAudio.shared.frequencyDataMatchesWindow, { beforeAudio, afterAudio });
  pass('single shared renderer pass is clipped and state-restored',
    afterAudio.render.echoPasses > 0 &&
    afterAudio.render.renderPasses === afterAudio.render.echoPasses &&
    afterAudio.render.uiPasses === 0 &&
    afterAudio.render.clearDepthCalls > 0 &&
    afterAudio.render.stateRestoreCount > 0 &&
    afterAudio.render.rendererErrors.length === 0, afterAudio.render);
  pass('no renderer audio camera scene or frame loop was allocated',
    Object.values(afterAudio.allocations).every(value => value === 0) &&
    afterAudio.shared.rendererMatchesWindow &&
    afterAudio.shared.sceneMatchesWindow &&
    afterAudio.shared.cameraMatchesWindow, afterAudio);

  await cdp.call(function () {
    const fixture = [];
    for (let index = 0; index < 12; index++) {
      fixture.push({ t:index*0.3, text:`真实时间轴测试歌词 ${index}`, translation:`Timeline translation ${index}` });
    }
    window.lyricsLines.length = 0;
    Array.prototype.push.apply(window.lyricsLines, fixture);
    window.playQueue.length = 0;
    window.playQueue.push({ id:'problem4-real-timeline', provider:'local', name:'真实歌词时间轴', artist:'LumiField QA' });
    window.currentIdx = 0;
    window.audio.pause();
    window.playing = false;
    window.audio.currentTime = 1.52;
  });
  await setEcho({ enabled:true, shape:'one', quality:'medium', mode1LeftLyricsEnabled:true, autoRotate:false }, 260);
  const lyricFirst = await cdp.call(function () {
    const root = document.getElementById('lf-mode1-left-lyrics-layer');
    const container = document.getElementById('canvas-container');
    const rows = root ? Array.from(root.querySelectorAll('.lf-mode1-left-lyrics-row')) : [];
    const rects = rows.map(row => {
      const rect = row.getBoundingClientRect();
      return { top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right };
    });
    const containerRect = container && container.getBoundingClientRect();
    return {
      mounted:!!root,
      pointerEvents:root && getComputedStyle(root).pointerEvents,
      title:root && root.querySelector('h2').textContent,
      rows:rows.length,
      current:root && root.querySelector('.current') && root.querySelector('.current').dataset.lyricIndex,
      translation:root && root.querySelector('.current small') && root.querySelector('.current small').textContent,
      planeTransform:root && getComputedStyle(root.querySelector('.lf-mode1-left-lyrics-plane')).transform,
      rects,
      containerRect:containerRect && {
        top:containerRect.top, bottom:containerRect.bottom,
        left:containerRect.left, right:containerRect.right
      },
    };
  });
  pass('mode one mounts real bounded perspective lyric timeline',
    lyricFirst.mounted && lyricFirst.pointerEvents === 'none' && lyricFirst.title === '真实歌词时间轴' &&
    lyricFirst.rows === 7 && lyricFirst.current === '5' &&
    lyricFirst.translation === 'Timeline translation 5' && lyricFirst.planeTransform !== 'none' &&
    lyricFirst.rects.every((rect, index, rows) =>
      rect.top >= lyricFirst.containerRect.top + 60 &&
      rect.bottom <= lyricFirst.containerRect.bottom - 120 &&
      (index === 0 || rect.top >= rows[index - 1].bottom + 4)
    ), lyricFirst);
  await cdp.call(function () { window.audio.currentTime = 2.42; });
  await delay(130);
  const seekIndex = await cdp.call(function () {
    const current = document.querySelector('#lf-mode1-left-lyrics-layer .current');
    return current && current.dataset.lyricIndex;
  });
  pass('left lyrics follow seek within 150ms', seekIndex === '8', { seekIndex });
  await screenshot('mode-one-left-lyrics');
  await setEcho({ shape:'two' }, 120);
  const lyricsAfterModeSwitch = await cdp.call(function () { return !!document.getElementById('lf-mode1-left-lyrics-layer'); });
  pass('left lyrics unmount immediately outside mode one', !lyricsAfterModeSwitch);
  await setEcho({ shape:'one', mode1LeftLyricsEnabled:false }, 120);
  const lyricsAfterDisable = await cdp.call(function () { return !!document.getElementById('lf-mode1-left-lyrics-layer'); });
  pass('left lyrics disabled state has zero DOM residue', !lyricsAfterDisable);

  const ui = await cdp.call(function () {
    window.LumiFieldTask13.setEchoState({ shape:'two' });
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
    const block = document.getElementById('lf-t13-echo-block');
    if (block) block.open = true;
    const shape = block && block.querySelector('[data-lf-key="shape"]');
    const required = ['quality','particleStrength','mode1LeftLyricsEnabled'];
    const forbidden = ['meteorEnabled','meteorSensitivity','meteorCooldown','clickMeteor'];
    const modeOneLyricsDisabled = !!(block && block.querySelector('[data-lf-key="mode1LeftLyricsEnabled"]').disabled);
    const modeOneLyricsLabel = block && block.querySelector('.lf-t13-mode1-lyrics-control small') &&
      block.querySelector('.lf-t13-mode1-lyrics-control small').textContent;
    window.LumiFieldTask13.setEchoState({ shape:'one' });
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    ['login-modal','user-modal','playlist-panel'].forEach(id => {
      const node = document.getElementById(id);
      if (node) { node.classList.remove('show','open'); node.style.display = 'none'; }
    });
    const hitRows = ['#search-input','#user-btn','#play-btn','#progress-bar'].map(selector => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing:true };
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return { selector, hidden:true };
      const hit = document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      return {
        selector,
        hit:!!(hit && (hit===node || node.contains(hit))),
        blockedByRenderer:hit === window.renderer.domElement,
        hitId:hit && hit.id
      };
    });
    return {
      shapeOptions:shape ? Array.from(shape.options).map(option => option.value) : [],
      required:required.map(key => !!(block && block.querySelector(`[data-lf-key="${key}"]`))),
      forbidden:forbidden.map(key => !!(block && block.querySelector(`[data-lf-key="${key}"]`))),
      modeOneLyricsDisabled,
      modeOneLyricsLabel,
      cameraResetPresent:!!(block && block.querySelector('[data-lf-echo-action="camera-reset"]')),
      playerPresent:!!document.getElementById('lf-t13-echo-player'),
      rendererPointerEvents:getComputedStyle(window.renderer.domElement).pointerEvents,
      hitRows,
    };
  });
  pass('four-mode controls are complete and duplicate player is absent',
    ui.shapeOptions.join(',') === 'one,two,three,four' && ui.required.every(Boolean) &&
    ui.forbidden.every(value => !value) && ui.modeOneLyricsDisabled &&
    ui.modeOneLyricsLabel === '仅形态一可用' && ui.cameraResetPresent && !ui.playerPresent, ui);
  pass('echo canvas does not block main or secondary UI',
    ui.rendererPointerEvents !== 'none' &&
    ui.hitRows.filter(row => !row.missing && !row.hidden).every(row => !row.blockedByRenderer), ui);
  await cdp.call(function () {
    const login = document.getElementById('login-modal');
    if (login) login.style.display = '';
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
    const block = document.getElementById('lf-t13-echo-block');
    if (block) { block.open = true; block.scrollIntoView({ block:'center' }); }
  });
  await delay(180);
  await screenshot('settings-four-mode-controls');

  await cdp.call(function () {
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    ['login-modal','user-modal','playlist-panel'].forEach(id => {
      const node = document.getElementById(id);
      if (node) { node.classList.remove('show','open'); node.style.display = 'none'; }
    });
  });
  await delay(380);
  const pointerPulse = await cdp.call(async function () {
    const manager = window.LumiFieldAudioEchoManager;
    const canvas = window.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const before = manager.getDebug().interaction.pointerPulse.pulseCount;
    const candidates = [[.54,.50],[.62,.46],[.46,.54],[.68,.56],[.38,.48]];
    const attempts = [];
    for (let i = 0; i < candidates.length; i++) {
      const x = rect.left+rect.width*candidates[i][0];
      const y = rect.top+rect.height*candidates[i][1];
      if (document.elementFromPoint(x,y) !== canvas) continue;
      attempts.push(candidates[i]);
      canvas.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,pointerId:41+i,pointerType:'mouse',isPrimary:true,
        button:0,buttons:1,clientX:x,clientY:y
      }));
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,pointerId:41+i,pointerType:'mouse',isPrimary:true,
        button:0,buttons:0,clientX:x,clientY:y
      }));
      await new Promise(resolve => setTimeout(resolve,90));
      if (manager.getDebug().interaction.pointerPulse.pulseCount > before) break;
    }
    const after = manager.getDebug();
    return {
      before,
      after:after.interaction.pointerPulse,
      rippleKinds:after.rippleKinds,
      rippleDiagnostics:after.rippleDiagnostics,
      attempts
    };
  });
  const largePulse = pointerPulse.rippleDiagnostics.find(row => row.kind === 'large-cyan');
  pass('real blank-canvas click maps to a terrain point and starts the three-second cyan pulse',
    pointerPulse.after.pulseCount === pointerPulse.before+1 &&
    pointerPulse.after.lastLocation &&
    Math.abs(pointerPulse.after.lastLocation.x) <= 1 &&
    Math.abs(pointerPulse.after.lastLocation.z) <= 1 &&
    pointerPulse.rippleKinds.includes('large-cyan') &&
    largePulse && largePulse.life >= 2.8 && largePulse.life <= 3.2 &&
    largePulse.speed >= 0.36 && largePulse.speed <= 0.48, pointerPulse);
  await delay(520);
  await screenshot('mode-one-click-cyan-pulse');

  const camera = await cdp.call(async function () {
    const canvas = window.renderer.domElement;
    const before = {
      theta:window.orbit.userTheta,
      phi:window.orbit.userPhi,
      radius:window.orbit.userRadius,
      gestureX:window.gestureRotation.x,
      gestureY:window.gestureRotation.y,
      echoRotation:window.LumiFieldAudioEchoManager.getDebug().interaction.groupTransform.rotation
    };
    const rect = canvas.getBoundingClientRect();
    let x = rect.left+rect.width*0.50;
    let y = rect.top+rect.height*0.45;
    const candidates = [[.5,.45],[.42,.42],[.62,.40],[.34,.52],[.70,.56]];
    for (const point of candidates) {
      const cx = rect.left+rect.width*point[0];
      const cy = rect.top+rect.height*point[1];
      if (document.elementFromPoint(cx,cy) === canvas) { x=cx; y=cy; break; }
    }
    const hitId = document.elementFromPoint(x,y) && document.elementFromPoint(x,y).id;
    canvas.dispatchEvent(new MouseEvent('mousedown',{ bubbles:true,buttons:1,button:0,clientX:x,clientY:y }));
    window.dispatchEvent(new MouseEvent('mousemove',{ bubbles:true,buttons:1,clientX:x+90,clientY:y+45 }));
    window.dispatchEvent(new MouseEvent('mouseup',{ bubbles:true,button:0,clientX:x+90,clientY:y+45 }));
    canvas.dispatchEvent(new WheelEvent('wheel',{ bubbles:true,cancelable:true,deltaY:180,clientX:x,clientY:y }));
    await new Promise(resolve => setTimeout(resolve,220));
    return {
      before,
      after:{
        theta:window.orbit.userTheta,
        phi:window.orbit.userPhi,
        radius:window.orbit.userRadius,
        gestureX:window.gestureRotation.x,
        gestureY:window.gestureRotation.y,
        echoRotation:window.LumiFieldAudioEchoManager.getDebug().interaction.groupTransform.rotation
      },
      hitId,
    };
  });
  pass('blank shared canvas retains drag and wheel camera control',
    (Math.abs(camera.after.gestureX-camera.before.gestureX) > 0.001 ||
      Math.abs(camera.after.gestureY-camera.before.gestureY) > 0.001) &&
    (Math.abs(camera.after.echoRotation[0]-camera.before.echoRotation[0]) > 0.01 ||
      Math.abs(camera.after.echoRotation[1]-camera.before.echoRotation[1]) > 0.01) &&
    Math.abs(camera.after.radius-camera.before.radius) > 0.001, camera);

  const managerLifecycle = await cdp.call(async function () {
    const manager = window.LumiFieldAudioEchoManager;
    const required = [
      'registerMode','activateMode','deactivateMode','disposeMode','updateAudioFrame',
      'updateCamera','updateViewport','updateQuality','updateTheme','savePreset',
      'restorePreset','pause','resume','handleVisibilityChange','handleResize',
      'setMode1LeftLyricsEnabled','updateLyricTimeline','handleLyricLineChange',
      'disposeMode1LeftLyricsLayer','resetCamera'
    ];
    const saved = manager.savePreset();
    const paused = manager.pause();
    await new Promise(resolve => setTimeout(resolve,80));
    const inactive = !manager.getDebug().active;
    const resumed = manager.resume();
    await new Promise(resolve => setTimeout(resolve,180));
    return {
      methods:required.map(name => typeof manager[name] === 'function'),
      saved,
      paused,
      inactive,
      resumed,
      active:manager.getDebug().active,
      roots:(() => {
        let count = 0;
        window.scene.traverse(node => { if (node.userData && node.userData.audioEchoRoot) count++; });
        return count;
      })(),
    };
  });
  pass('unified manager lifecycle preserves one shared mode resource',
    managerLifecycle.methods.every(Boolean) && managerLifecycle.saved.shape === 'one' &&
    managerLifecycle.paused && managerLifecycle.inactive && managerLifecycle.resumed &&
    managerLifecycle.active && managerLifecycle.roots === 1, managerLifecycle);

  const canonical = await cdp.call(function () {
    const api = window.LumiFieldTask13;
    api.setEchoState({ enabled:true, shape:'four', quality:'low', particleStrength:1.24, mode1LeftLyricsEnabled:false });
    const payload = window.userFxArchiveExportPayload({ id:'problem4-export', name:'Problem 4 export', savedAt:4, snapshot:{} });
    const imported = window.importUserFxArchiveText(JSON.stringify({
      type:'lumifield-canonical-preset',
      schema:'lumifield-canonical-preset',
      version:window.LumiFieldCanonicalPresetSchema.VERSION,
      name:'Problem 4 import',
      echo:{ enabled:true, shape:'three', quality:'medium', particleStrength:0.44, mode1LeftLyricsEnabled:false },
    }), 'problem4-import.json', { preview:false });
    const afterImport = api.getState().echo;
    const beforeInvalid = JSON.stringify(afterImport);
    const invalid = api.setEchoState({ shape:'invalid-mode' });
    return {
      exported:payload && payload.echo,
      imported,
      afterImport,
      invalid,
      rollback:beforeInvalid === JSON.stringify(api.getState().echo),
      stored:JSON.parse(localStorage.getItem('lumifield-task13-echo-v1') || '{}'),
    };
  });
  pass('canonical export import persistence and invalid rollback include new fields',
    canonical.exported && canonical.exported.shape === 'four' && canonical.exported.quality === 'low' &&
    canonical.exported.particleStrength === 1.24 &&
    canonical.imported === true && canonical.afterImport.shape === 'three' && canonical.afterImport.quality === 'medium' &&
    canonical.afterImport.particleStrength === 0.44 && canonical.invalid === false && canonical.rollback &&
    canonical.stored.shape === 'three' && canonical.stored.quality === 'medium', canonical);

  await cdp.send('Page.reload', { ignoreCache:true });
  await delay(900);
  await pageWait(function () {
    return document.body && document.readyState === 'complete' && window.LumiFieldTask13 && window.LumiFieldAudioEchoManager;
  }, [], 45000);
  await cdp.call(function () {
    try { Object.defineProperty(document,'hidden',{ configurable:true, get:function(){ return false; } }); } catch (_) {}
    try { Object.defineProperty(document,'visibilityState',{ configurable:true, get:function(){ return 'visible'; } }); } catch (_) {}
    if (window.desktopRuntimeState) {
      window.desktopRuntimeState.minimized = false;
      window.desktopRuntimeState.visible = true;
    }
    document.body.classList.remove('lf-auth-locked','splash-active','empty-home-active','render-deep-sleep');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    if (window.LumiFieldAudioEchoManager) window.LumiFieldAudioEchoManager.resume();
  });
  await delay(650);
  const restored = await debugSummary();
  pass('mode state restores after renderer reload',
    restored.mode === 'three' && restored.quality === 'medium' &&
    restored.instanceCount === 10816 && restored.echoRoots === 1, restored);

  pass('renderer has no uncaught runtime or shader exceptions',
    rendererErrors.length === 0 && restored.render.rendererErrors.length === 0 &&
    restored.shaderFailures.length === 0,
    { rendererErrors, managerErrors:restored.render.rendererErrors, shaderFailures:restored.shaderFailures });

  const result = {
    ok:true,
    runId,
    mode:installedExecutable ? 'Electron installed CDP problem 4' : 'Electron source CDP problem 4',
    outDir,
    checks,
    screenshots,
    modeRows,
    qualityRows,
    restored,
    rendererErrors,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'app.log'), appLog.join(''));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

run().catch(error => {
  const failure = {
    ok:false,
    runId,
    outDir,
    error:String(error && error.stack || error),
    checks,
    screenshots,
    rendererErrors,
  };
  try {
    fs.writeFileSync(path.join(outDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(outDir, 'app.log'), appLog.join(''));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  }
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
