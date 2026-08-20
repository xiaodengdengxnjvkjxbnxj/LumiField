const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const outDir = path.join(repo, 'test-results', 'lf-combined-perf-diagnostic');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-combined-perf-'));
const videoFixture = [
  'C:\\Users\\35992\\Desktop\\动态壁纸\\Blue Archive - hoshino 4k.mp4',
  'C:\\Users\\35992\\Desktop\\文件13\\视频五.mp4',
].find(file => fs.existsSync(file));

let app;
let cdp;

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
async function waitFor(fn, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await fn(); if (value) return value; } catch (_) {}
    await delay(120);
  }
  throw new Error('timeout');
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Performance.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timeout')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  call(fn, args = []) { return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')'); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function metrics() {
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries((result.metrics || []).map(item => [item.name, item.value]));
}

async function configure(config) {
  await cdp.call(async function (cfg) {
    document.body.classList.remove('lf-auth-locked', 'splash-active', 'empty-home-active', 'lf-fx-open');
    const auth = document.getElementById('lf-auth-root');
    if (auth) auth.classList.remove('show');
    const panel = document.getElementById('fx-panel');
    if (panel) panel.classList.remove('show', 'peek', 'closing');
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    window.immersiveMode = false;
    if (document.getElementById('bottom-bar')) document.getElementById('bottom-bar').classList.add('visible');
    if (window.scene) window.scene.visible = cfg.scene !== false;
    LumiFieldTask13.setSpectrumState({
      enabled: !!cfg.spectrum,
      mode: 3,
      liquidGlassEnabled: !!cfg.glass,
      bandCount: 52,
      horizontalGap: 3,
      heightScale: 1.35,
      brightness: 1.35,
      opacity: 0.84,
      attack: 0.9,
      release: 0.25,
    });
    LumiFieldTask13.setEchoState({
      enabled: !!cfg.echo,
      shape: cfg.echoShape || 'two',
      renderResolution: 0.82,
      playerVisible: true,
    });
    const video = document.getElementById('lf-stage-wallpaper-video');
    if (video) {
      if (cfg.video) {
        video.hidden = false;
        document.body.classList.add('lf-stage-wallpaper-active');
        try { await video.play(); } catch (_) {}
      } else {
        try { video.pause(); } catch (_) {}
        video.hidden = true;
        document.body.classList.remove('lf-stage-wallpaper-active');
      }
    }
  }, [config]);
  await delay(700);
}

async function measure(label, config, duration = 2200) {
  await configure(config);
  const before = await metrics();
  const data = await cdp.call(async function (name, ms) {
    const intervals = [];
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
      observer.observe({ entryTypes:['longtask'] });
    } catch (_) {}
    const start = performance.now();
    let previous = start;
    let frames = 0;
    await new Promise(resolve => {
      function frame(now) {
        frames += 1;
        intervals.push(now - previous);
        previous = now;
        if (now - start >= ms) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    if (observer) observer.disconnect();
    const elapsed = performance.now() - start;
    const sorted = intervals.slice().sort((a,b) => a-b);
    const quantile = value => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] || 0;
    const video = document.getElementById('lf-stage-wallpaper-video');
    const quality = video && video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : {};
    const snapshot = window.__lumifieldPerfSnapshot ? window.__lumifieldPerfSnapshot() : null;
    const spectrum = LumiFieldTask13.getSpectrumDebug();
    const echo = LumiFieldTask13.getEchoDebug();
    return {
      label:name,
      elapsed,
      frames,
      fps:frames * 1000 / elapsed,
      interval:{ p50:quantile(0.5), p95:quantile(0.95), max:sorted[sorted.length - 1] || 0 },
      longTasks:{ count:longTasks.length, total:longTasks.reduce((sum,value) => sum + value, 0), max:Math.max(0, ...longTasks) },
      visibility:{ hidden:document.hidden, state:document.visibilityState, focus:document.hasFocus() },
      video:{ present:!!video, hidden:video ? video.hidden : null, paused:video ? video.paused : null, readyState:video ? video.readyState : null,
        frames:Number(quality.totalVideoFrames || 0), dropped:Number(quality.droppedVideoFrames || 0) },
      spectrum:{ enabled:spectrum.state.enabled, mode:spectrum.mode, glass:spectrum.liquidGlassEnabled, fps:spectrum.fps, backdrop:spectrum.backdropSampleSource },
      echo:{ enabled:echo.enabled, active:echo.active, shape:echo.state.shape, instances:echo.instanceCount },
      sceneVisible:window.scene && window.scene.visible,
      renderer:snapshot && snapshot.renderer,
      coreRender:snapshot && snapshot.render,
      viewport:snapshot && snapshot.viewport,
    };
  }, [label, duration]);
  const after = await metrics();
  data.cpu = {
    taskDuration: (after.TaskDuration || 0) - (before.TaskDuration || 0),
    scriptDuration: (after.ScriptDuration || 0) - (before.ScriptDuration || 0),
    layoutDuration: (after.LayoutDuration || 0) - (before.LayoutDuration || 0),
    recalcStyleDuration: (after.RecalcStyleDuration || 0) - (before.RecalcStyleDuration || 0),
  };
  process.stdout.write(label + ': ' + data.fps.toFixed(2) + ' FPS, p95=' + data.interval.p95.toFixed(1) + 'ms, task=' + data.cpu.taskDuration.toFixed(3) + 's\n');
  return data;
}

async function run() {
  if (!videoFixture) throw new Error('video fixture not found');
  fs.mkdirSync(outDir, { recursive: true });
  const sourceHash = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(repo,'public','lumifield-task13.js'))).digest('hex');
  const port = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    windowsHide: true,
    env: Object.assign({}, process.env, { LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' }),
    stdio:['ignore','pipe','pipe'],
  });
  app.stdout.on('data', chunk => process.stderr.write('[app] ' + chunk));
  app.stderr.on('data', chunk => process.stderr.write('[app] ' + chunk));
  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const list = await response.json();
    return list.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url));
  }, 45000);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    await waitFor(() => cdp.call(function () {
      return document.readyState === 'complete' && window.LumiFieldTask13 && window.renderer;
    }), 45000);
  } catch (error) {
    const state = await cdp.call(function () {
      return { url:location.href, ready:document.readyState, title:document.title, body:document.body && document.body.className,
        task13:!!window.LumiFieldTask13, renderer:!!window.renderer, wallpaper:!!document.getElementById('lf-stage-wallpaper-video'), text:(document.body && document.body.innerText || '').slice(0,300) };
    });
    throw new Error('renderer readiness timeout: ' + JSON.stringify(state));
  }
  await cdp.call(async function () {
    document.body.classList.remove('lf-auth-locked', 'splash-active', 'empty-home-active');
    const auth = document.getElementById('lf-auth-root'); if (auth) auth.classList.remove('show');
    window.emptyHomeActive = false; window.homeForcedOpen = false; window.immersiveMode = false;
    const audio = window.audio;
    if (audio) {
      const rate = 8000, seconds = 3, samples = rate * seconds;
      const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
      const write = (offset, text) => { for (let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i)); };
      write(0,'RIFF'); view.setUint32(4,36+samples*2,true); write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true);
      view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,rate,true); view.setUint32(28,rate*2,true);
      view.setUint16(32,2,true); view.setUint16(34,16,true); write(36,'data'); view.setUint32(40,samples*2,true);
      for (let i=0;i<samples;i++) view.setInt16(44+i*2, Math.sin(i/rate*Math.PI*2*220)*11000, true);
      audio.src = URL.createObjectURL(new Blob([buffer], {type:'audio/wav'})); audio.loop = true; audio.volume = 0;
      try { await audio.play(); } catch (_) {}
      window.playing = true;
    }
    clearInterval(window.__lfDiagnosticFeed);
    window.__lfDiagnosticFeed = setInterval(function () {
      if (!window.frequencyData) return;
      for (let i=0;i<window.frequencyData.length;i++) window.frequencyData[i] = 70 + Math.round(170*Math.abs(Math.sin(i*0.091 + performance.now()*0.001)));
      window.lumiFieldFrequencyDataTimestamp = performance.now();
    }, 18);
  });

  const documentNode = await cdp.send('DOM.getDocument', { depth:-1, pierce:true });
  const inputNode = await cdp.send('DOM.querySelector', { nodeId:documentNode.root.nodeId, selector:'#lf-wallpaper-file' });
  if (!inputNode.nodeId) throw new Error('wallpaper input missing');
  await cdp.send('DOM.setFileInputFiles', { nodeId:inputNode.nodeId, files:[videoFixture] });
  await cdp.call(async function () {
    const input = document.getElementById('lf-wallpaper-file');
    let video = document.getElementById('lf-stage-wallpaper-video');
    if (!video) {
      video = document.createElement('video');
      video.id = 'lf-stage-wallpaper-video';
      Object.assign(video.style, { position:'fixed', inset:'0', width:'100%', height:'100%', objectFit:'cover', zIndex:'0', pointerEvents:'none' });
      document.body.insertBefore(video, document.body.firstChild);
    }
    video.src = URL.createObjectURL(input.files[0]); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.hidden = false;
    document.body.classList.add('lf-stage-wallpaper-active');
    video.load();
    try { await video.play(); } catch (_) {}
  });
  await waitFor(() => cdp.call(function () { const v=document.getElementById('lf-stage-wallpaper-video'); return v && v.readyState >= 2; }), 20000);

  const cases = [];
  cases.push(await measure('stage-only', { scene:true }, 1500));
  cases.push(await measure('spectrum3-glass', { scene:true, spectrum:true, glass:true }, 1500));
  cases.push(await measure('echo2-only', { scene:true, echo:true, echoShape:'two' }, 1500));
  cases.push(await measure('full-video+spectrum3-glass+echo2', { scene:true, video:true, spectrum:true, glass:true, echo:true, echoShape:'two' }, 1800));

  const readbacks = await cdp.call(function () {
    const canvas = document.getElementById('lf-t13-spectrum');
    const context = canvas.getContext('2d');
    const durations = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      context.getImageData(0, 0, canvas.width, canvas.height);
      durations.push(performance.now() - started);
    }
    return { width:canvas.width, height:canvas.height, durations };
  });
  cases.push(await measure('full-after-5-full-canvas-readbacks', { scene:true, video:true, spectrum:true, glass:true, echo:true, echoShape:'two' }, 1800));

  const foreground = await cdp.call(function () { return { hidden:document.hidden, state:document.visibilityState, focus:document.hasFocus() }; });

  const result = {
    runAt:new Date().toISOString(),
    sourceHash,
    videoFixture,
    readbacks,
    foreground,
    cases,
  };
  const file = path.join(outDir, new Date().toISOString().replace(/[:.]/g,'-') + '.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  process.stdout.write('RESULT ' + file + '\n');
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
