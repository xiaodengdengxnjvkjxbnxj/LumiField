'use strict';

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
const sourceElectron = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const prefix = '--' + name + '=';
  const item = argv.find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};
const phase = arg('phase', 'baseline').toLowerCase();
if (!['baseline', 'after', 'installed'].includes(phase)) {
  throw new Error('--phase must be baseline, after, or installed');
}
const baselinePath = arg('baseline', '');
const requestedExe = arg('exe', process.env.LF_PROBLEM16_EXE || '');
const installedExe = requestedExe || 'D:\\LumiField\\LumiField.exe';
const isInstalled = phase === 'installed';
if (isInstalled && !fs.existsSync(installedExe)) {
  throw new Error('installed executable not found: ' + installedExe);
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(
  arg('out', process.env.LF_MASTER_PROBLEM16_OUT || path.join(repo, 'test-results', 'lf-master-problem16-smoke', phase, runId))
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-p16-'));
const soakMinutes = Math.max(0, Number(arg('soak-minutes', '0')) || 0);
const cpuProfileEnabled = arg('cpu-profile', '0') === '1';
const appLog = [];
const rendererErrors = [];
const screenshots = [];
const network = { requests: 0, failures: 0, bytes: 0, types: {} };
let app = null;
let cdp = null;
let browserCdp = null;
let target = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function focusTestWindow() {
  const focusScript = [
    "Add-Type -Name Win32 -Namespace LF -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    '$p=Get-Process -Id ' + Number(app && app.pid || 0) + ' -ErrorAction SilentlyContinue',
    'if($p -and $p.MainWindowHandle -ne 0){[LF.Win32]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null; [LF.Win32]::SetForegroundWindow($p.MainWindowHandle)|Out-Null}'
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', focusScript], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12000
  });
  await cdp.send('Page.bringToFront').catch(() => {});
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await waitFor(() => cdp.call(function () { return !document.hidden; }), 12000, 150);
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

async function waitFor(fn, timeout = 45000, interval = 120) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('timeout after ' + timeout + 'ms; last=' + JSON.stringify(last));
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * scale) / scale : 0;
}

function summarizeCpuProfile(profile, limit = 24) {
  if (!profile || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) return [];
  const nodes = new Map((profile.nodes || []).map(node => [node.id, node]));
  const totals = new Map();
  profile.samples.forEach((nodeId, index) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    const frame = node.callFrame || {};
    const url = String(frame.url || '');
    if (!url || url.startsWith('node:') || url === 'native V8Runtime') return;
    const key = [frame.functionName || '(anonymous)', url, Number(frame.lineNumber || 0) + 1].join('|');
    totals.set(key, (totals.get(key) || 0) + Number(profile.timeDeltas[index] || 0));
  });
  return [...totals.entries()].map(([key, microseconds]) => {
    const [functionName, url, line] = key.split('|');
    return { functionName, url, line:Number(line), selfMs:round(microseconds / 1000, 2) };
  }).sort((a, b) => b.selfMs - a.selfMs).slice(0, limit);
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

  async connect(enablePageDomains = true) {
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
        rendererErrors.push({
          kind: 'exception',
          text: String(detail.exception && detail.exception.description || detail.text || 'renderer exception').slice(0, 1800),
          line: detail.lineNumber,
          column: detail.columnNumber
        });
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        rendererErrors.push({
          kind: 'console',
          text: (message.params.args || []).map(item => item.value || item.description || '').join(' ').slice(0, 1800)
        });
      } else if (message.method === 'Network.requestWillBeSent') {
        network.requests += 1;
        const type = String(message.params.type || 'Other');
        network.types[type] = (network.types[type] || 0) + 1;
      } else if (message.method === 'Network.loadingFailed') {
        network.failures += 1;
      } else if (message.method === 'Network.loadingFinished') {
        network.bytes += Number(message.params.encodedDataLength || 0);
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    if (!enablePageDomains) return;
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Performance.enable');
    await this.send('Network.enable', { maxTotalBufferSize: 1000000, maxResourceBufferSize: 100000 });
    await this.send('DOM.enable');
    await this.send('Log.enable').catch(() => {});
  }

  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timeout'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, returnByValue = true) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return returnByValue ? response.result && response.result.value : response.result;
  }

  call(fn, args = []) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')');
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function performanceMetrics() {
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries((result.metrics || []).map(item => [item.name, item.value]));
}

async function processInfo() {
  try {
    const result = await (browserCdp || cdp).send('SystemInfo.getProcessInfo');
    return result.processInfo || [];
  } catch (_) {
    return [];
  }
}

function windowsMemory(pids) {
  const ids = [...new Set((pids || []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
  if (!ids.length) return { totalWorkingSetMB: 0, totalPrivateMB: 0, processes: [] };
  const command = [
    '$p=Get-Process -Id ' + ids.join(',') + ' -ErrorAction SilentlyContinue',
    '$p | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress'
  ].join('; ');
  const response = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12000
  });
  if (response.status !== 0 || !String(response.stdout || '').trim()) {
    return { totalWorkingSetMB: 0, totalPrivateMB: 0, processes: [] };
  }
  try {
    const parsed = JSON.parse(response.stdout);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
      pid: Number(row.Id || 0),
      workingSetMB: round(Number(row.WorkingSet64 || 0) / 1048576, 2),
      privateMB: round(Number(row.PrivateMemorySize64 || 0) / 1048576, 2),
      cpuSeconds: round(Number(row.CPU || 0), 3)
    }));
    return {
      totalWorkingSetMB: round(rows.reduce((sum, row) => sum + row.workingSetMB, 0), 2),
      totalPrivateMB: round(rows.reduce((sum, row) => sum + row.privateMB, 0), 2),
      processes: rows
    };
  } catch (_) {
    return { totalWorkingSetMB: 0, totalPrivateMB: 0, processes: [] };
  }
}

function windowsGpuUtilization(pids, durationMs) {
  const ids = [...new Set((pids || []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
  if (!ids.length) return Promise.resolve({ supported: false, samples: 0, averagePercent: 0, maxPercent: 0, values: [] });
  const maxSamples = Math.max(2, Math.min(12, Math.ceil(Number(durationMs || 0) / 1000)));
  const pattern = '^pid_(?:' + ids.join('|') + ')_';
  const command = [
    '$pattern=' + JSON.stringify(pattern),
    '$sets=Get-Counter "\\GPU Engine(*)\\Utilization Percentage" -SampleInterval 1 -MaxSamples ' + maxSamples,
    '$values=@()',
    'foreach($set in $sets){$sum=0;foreach($sample in $set.CounterSamples){if($sample.InstanceName -match $pattern){$sum+=[double]$sample.CookedValue}};$values+=$sum}',
    '$average=if($values.Count){($values|Measure-Object -Average).Average}else{0}',
    '$maximum=if($values.Count){($values|Measure-Object -Maximum).Maximum}else{0}',
    '[pscustomobject]@{supported=$true;samples=$values.Count;averagePercent=$average;maxPercent=$maximum;values=$values}|ConvertTo-Json -Compress'
  ].join('; ');
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      resolve({ supported: false, samples: 0, averagePercent: 0, maxPercent: 0, values: [], error: 'timeout' });
    }, maxSamples * 1800 + 8000);
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) return resolve({ supported: false, samples: 0, averagePercent: 0, maxPercent: 0, values: [] });
      try {
        const value = JSON.parse(stdout);
        value.averagePercent = round(Number(value.averagePercent || 0), 3);
        value.maxPercent = round(Number(value.maxPercent || 0), 3);
        value.values = (Array.isArray(value.values) ? value.values : [value.values]).map(item => round(Number(item || 0), 3));
        resolve(value);
      } catch (error) {
        resolve({ supported: false, samples: 0, averagePercent: 0, maxPercent: 0, values: [], error: String(error.message || error) });
      }
    });
    child.once('error', error => {
      clearTimeout(timer);
      resolve({ supported: false, samples: 0, averagePercent: 0, maxPercent: 0, values: [], error: String(error.message || error) });
    });
  });
}

async function capture(name) {
  const data = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(data.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function installInstrumentation() {
  return cdp.call(function () {
    if (window.__lfMasterP16) return window.__lfMasterP16.snapshot();
    var nativeRaf = window.requestAnimationFrame.bind(window);
    var nativeCancel = window.cancelAnimationFrame.bind(window);
    var pending = new Set();
    var raf = { requested: 0, completed: 0, cancelled: 0, pending: 0, maxPending: 0 };
    window.requestAnimationFrame = function (callback) {
      raf.requested += 1;
      var id = nativeRaf(function (now) {
        if (pending.delete(id)) raf.pending = pending.size;
        raf.completed += 1;
        callback(now);
      });
      pending.add(id);
      raf.pending = pending.size;
      raf.maxPending = Math.max(raf.maxPending, raf.pending);
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      if (pending.delete(id)) {
        raf.cancelled += 1;
        raf.pending = pending.size;
      }
      return nativeCancel(id);
    };

    var contexts = [];
    function wrapContext(name) {
      var Native = window[name];
      if (typeof Native !== 'function' || Native.__lfP16Wrapped) return;
      function Wrapped() {
        var value = Reflect.construct(Native, arguments, new.target || Wrapped);
        contexts.push(value);
        return value;
      }
      Object.setPrototypeOf(Wrapped, Native);
      Wrapped.prototype = Native.prototype;
      Wrapped.__lfP16Wrapped = true;
      window[name] = Wrapped;
    }
    wrapContext('AudioContext');
    wrapContext('webkitAudioContext');

    var knownAudioContexts = function () {
      var candidates = [];
      try { if (typeof audioCtx !== 'undefined' && audioCtx) candidates.push(audioCtx); } catch (_) {}
      try { if (typeof uiSfxCtx !== 'undefined' && uiSfxCtx) candidates.push(uiSfxCtx); } catch (_) {}
      try { if (typeof splashAudioCtx !== 'undefined' && splashAudioCtx) candidates.push(splashAudioCtx); } catch (_) {}
      contexts.forEach(function (ctx) { if (ctx) candidates.push(ctx); });
      return Array.from(new Set(candidates));
    };
    var sceneResources = function () {
      var geometries = new Set(), materials = new Set(), textures = new Set(), objects = 0;
      try {
        if (window.scene && scene.traverse) scene.traverse(function (object) {
          objects += 1;
          if (object.geometry) geometries.add(object.geometry);
          var list = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
          list.forEach(function (material) {
            materials.add(material);
            Object.keys(material).forEach(function (key) {
              var value = material[key];
              if (value && value.isTexture) textures.add(value);
            });
          });
        });
      } catch (_) {}
      return { objects: objects, geometries: geometries.size, materials: materials.size, textures: textures.size };
    };
    var resources = function () {
      var entries = performance.getEntriesByType('resource') || [];
      var types = {}, transferSize = 0, decodedBodySize = 0;
      entries.forEach(function (entry) {
        var type = entry.initiatorType || 'other';
        types[type] = (types[type] || 0) + 1;
        transferSize += Number(entry.transferSize || 0);
        decodedBodySize += Number(entry.decodedBodySize || 0);
      });
      return { count: entries.length, types: types, transferSize: transferSize, decodedBodySize: decodedBodySize };
    };
    var snapshot = function () {
      var runtime = typeof window.__lumifieldPerfSnapshot === 'function' ? window.__lumifieldPerfSnapshot() : null;
      var rendererInfo = window.renderer && renderer.info ? renderer.info : null;
      var audio = knownAudioContexts();
      var gpu = null;
      try {
        var gl = window.renderer && renderer.getContext ? renderer.getContext() : null;
        var debugInfo = gl && gl.getExtension('WEBGL_debug_renderer_info');
        gpu = gl ? {
          vendor: String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) || ''),
          renderer: String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || ''),
          version: String(gl.getParameter(gl.VERSION) || ''),
          maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0)
        } : null;
      } catch (_) {}
      return {
        at: performance.now(),
        visibility: { hidden: document.hidden, state: document.visibilityState, focus: document.hasFocus() },
        raf: Object.assign({}, raf),
        audioContexts: {
          count: audio.length,
          states: audio.map(function (ctx) { return String(ctx.state || 'unknown'); }),
          createdAfterInstrumentation: contexts.length
        },
        renderer: rendererInfo ? {
          memory: Object.assign({}, rendererInfo.memory || {}),
          render: Object.assign({}, rendererInfo.render || {}),
          programs: Array.isArray(rendererInfo.programs) ? rendererInfo.programs.length : 0
        } : null,
        gpu: gpu,
        scene: sceneResources(),
        runtime: runtime,
        resources: resources(),
        dom: {
          nodes: document.getElementsByTagName('*').length,
          images: document.images.length,
          canvases: document.querySelectorAll('canvas').length
        },
        task13: window.LumiFieldTask13 ? {
          lyrics: LumiFieldTask13.getLyricDebug && LumiFieldTask13.getLyricDebug(),
          spectrum: LumiFieldTask13.getSpectrumDebug && LumiFieldTask13.getSpectrumDebug(),
          echo: LumiFieldTask13.getEchoDebug && LumiFieldTask13.getEchoDebug()
        } : null
      };
    };
    window.__lfMasterP16 = { snapshot: snapshot, nativeRaf: nativeRaf };
    return snapshot();
  });
}

async function listenerSnapshot() {
  const targets = [
    ['window', 'window'],
    ['document', 'document'],
    ['body', 'document.body'],
    ['renderer', 'window.renderer && renderer.domElement'],
    ['fxPanel', 'document.getElementById("fx-panel")'],
    ['queue', 'document.getElementById("mini-queue-list")']
  ];
  const rows = [];
  for (const [name, expression] of targets) {
    try {
      const object = await cdp.evaluate(expression, false);
      if (!object || !object.objectId) continue;
      const response = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.objectId, depth: 2, pierce: true });
      const types = {};
      (response.listeners || []).forEach(listener => {
        types[listener.type] = (types[listener.type] || 0) + 1;
      });
      rows.push({ target: name, count: (response.listeners || []).length, types });
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    } catch (_) {}
  }
  return {
    targets: rows,
    total: rows.reduce((sum, row) => sum + row.count, 0)
  };
}

async function pageSnapshot() {
  const [page, metrics, processes] = await Promise.all([
    cdp.call(function () { return window.__lfMasterP16.snapshot(); }),
    performanceMetrics(),
    processInfo()
  ]);
  const memory = windowsMemory(processes.map(item => item.id).concat(app && app.pid || []));
  return {
    page,
    cdp: {
      Timestamp: metrics.Timestamp || 0,
      TaskDuration: metrics.TaskDuration || 0,
      ScriptDuration: metrics.ScriptDuration || 0,
      LayoutDuration: metrics.LayoutDuration || 0,
      RecalcStyleDuration: metrics.RecalcStyleDuration || 0,
      JSHeapUsedSize: metrics.JSHeapUsedSize || 0,
      JSHeapTotalSize: metrics.JSHeapTotalSize || 0,
      Nodes: metrics.Nodes || 0,
      Documents: metrics.Documents || 0,
      LayoutCount: metrics.LayoutCount || 0,
      RecalcStyleCount: metrics.RecalcStyleCount || 0
    },
    processes,
    memory
  };
}

async function sampleFrames(label, durationMs, scrollSelector) {
  return cdp.call(async function (name, duration, selector) {
    var intervals = [];
    var longTasks = [];
    var observer = null;
    try {
      observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { longTasks.push(entry.duration); });
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (_) {}
    var scroller = selector ? document.querySelector(selector) : null;
    var started = performance.now();
    var previous = started;
    var frames = 0;
    var done = false;
    await new Promise(function (resolve) {
      var timer = setTimeout(function () { done = true; resolve(); }, duration + 250);
      function frame(now) {
        if (done) return;
        frames += 1;
        intervals.push(now - previous);
        previous = now;
        if (scroller) {
          var max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = max * (0.5 + 0.5 * Math.sin((now - started) / 650));
        }
        if (now - started >= duration) {
          done = true;
          clearTimeout(timer);
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      }
      requestAnimationFrame(frame);
    });
    if (observer) observer.disconnect();
    var elapsed = Math.max(1, performance.now() - started);
    var sorted = intervals.slice().sort(function (a, b) { return a - b; });
    function q(p) { return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0; }
    return {
      label: name,
      elapsedMs: elapsed,
      frames: frames,
      fps: frames * 1000 / elapsed,
      frameMs: { p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] || 0 },
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce(function (sum, value) { return sum + value; }, 0),
        maxMs: Math.max.apply(Math, [0].concat(longTasks))
      },
      scroll: scroller ? {
        top: scroller.scrollTop,
        height: scroller.scrollHeight,
        viewport: scroller.clientHeight,
        children: scroller.children.length
      } : null
    };
  }, [label, durationMs, scrollSelector || '']);
}

function processCpuDelta(before, after, elapsedSec) {
  const beforeById = new Map((before || []).map(item => [item.id, item]));
  const byType = {};
  (after || []).forEach(item => {
    const previous = beforeById.get(item.id);
    const delta = previous ? Math.max(0, Number(item.cpuTime || 0) - Number(previous.cpuTime || 0)) : 0;
    const key = String(item.type || 'unknown');
    byType[key] = (byType[key] || 0) + delta;
  });
  Object.keys(byType).forEach(key => {
    byType[key] = {
      cpuSeconds: round(byType[key], 4),
      cpuPercentOneCore: round(byType[key] / Math.max(0.001, elapsedSec) * 100, 2)
    };
  });
  return byType;
}

async function measure(label, durationMs, scrollSelector) {
  const before = await pageSnapshot();
  const gpuPromise = windowsGpuUtilization(before.processes.map(item => item.id).concat(app && app.pid || []), durationMs);
  if (cpuProfileEnabled) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval:1000 }).catch(() => {});
    await cdp.send('Profiler.start');
  }
  const frames = await sampleFrames(label, durationMs, scrollSelector);
  const cpuProfile = cpuProfileEnabled ? await cdp.send('Profiler.stop') : null;
  const cpuProfileTop = summarizeCpuProfile(cpuProfile && cpuProfile.profile);
  if (cpuProfileEnabled) {
    fs.writeFileSync(
      path.join(evidenceDir, 'cpu-profile-' + String(label).replace(/[^a-z0-9_-]+/gi, '-') + '.json'),
      JSON.stringify({ label, durationMs, top:cpuProfileTop }, null, 2)
    );
  }
  const gpuUtilization = await gpuPromise;
  const after = await pageSnapshot();
  const elapsedSec = frames.elapsedMs / 1000;
  const delta = key => Number(after.cdp[key] || 0) - Number(before.cdp[key] || 0);
  const result = {
    label,
    frames: {
      fps: round(frames.fps, 2),
      count: frames.frames,
      elapsedMs: round(frames.elapsedMs, 1),
      p50Ms: round(frames.frameMs.p50, 2),
      p95Ms: round(frames.frameMs.p95, 2),
      maxMs: round(frames.frameMs.max, 2)
    },
    longTasks: {
      count: frames.longTasks.count,
      totalMs: round(frames.longTasks.totalMs, 2),
      maxMs: round(frames.longTasks.maxMs, 2)
    },
    cpu: {
      taskSeconds: round(delta('TaskDuration'), 4),
      taskPercentOneCore: round(delta('TaskDuration') / Math.max(0.001, elapsedSec) * 100, 2),
      scriptSeconds: round(delta('ScriptDuration'), 4),
      layoutSeconds: round(delta('LayoutDuration'), 4),
      styleSeconds: round(delta('RecalcStyleDuration'), 4),
      processes: processCpuDelta(before.processes, after.processes, elapsedSec)
    },
    gpu: {
      utilization: gpuUtilization,
      device: after.page.gpu || before.page.gpu || null,
      renderFrames: Number(after.page.renderer && after.page.renderer.render && after.page.renderer.render.frame || 0) -
        Number(before.page.renderer && before.page.renderer.render && before.page.renderer.render.frame || 0),
      drawCallsEnd: Number(after.page.renderer && after.page.renderer.render && after.page.renderer.render.calls || 0),
      trianglesEnd: Number(after.page.renderer && after.page.renderer.render && after.page.renderer.render.triangles || 0),
      pointsEnd: Number(after.page.renderer && after.page.renderer.render && after.page.renderer.render.points || 0)
    },
    memory: {
      jsHeapStartMB: round(before.cdp.JSHeapUsedSize / 1048576, 2),
      jsHeapEndMB: round(after.cdp.JSHeapUsedSize / 1048576, 2),
      jsHeapDeltaMB: round((after.cdp.JSHeapUsedSize - before.cdp.JSHeapUsedSize) / 1048576, 2),
      workingSetStartMB: before.memory.totalWorkingSetMB,
      workingSetEndMB: after.memory.totalWorkingSetMB,
      workingSetDeltaMB: round(after.memory.totalWorkingSetMB - before.memory.totalWorkingSetMB, 2),
      privateStartMB: before.memory.totalPrivateMB,
      privateEndMB: after.memory.totalPrivateMB,
      privateDeltaMB: round(after.memory.totalPrivateMB - before.memory.totalPrivateMB, 2)
    },
    layout: {
      count: delta('LayoutCount'),
      styleCount: delta('RecalcStyleCount')
    },
    scroll: frames.scroll,
    cpuProfileTop,
    end: after.page
  };
  process.stdout.write(
    label + ': ' + result.frames.fps.toFixed(2) + ' FPS, p95=' + result.frames.p95Ms.toFixed(1) +
    'ms, task=' + result.cpu.taskPercentOneCore.toFixed(1) + '%, heapΔ=' + result.memory.jsHeapDeltaMB.toFixed(2) + 'MB\n'
  );
  return result;
}

async function prepareApp() {
  return cdp.call(async function () {
    document.body.classList.remove('lf-auth-locked', 'splash-active', 'splash-revealing', 'empty-home-active', 'immersive-mode');
    var auth = document.getElementById('lf-auth-root');
    if (auth) {
      auth.classList.remove('show');
      auth.style.setProperty('display', 'none', 'important');
    }
    var splash = document.getElementById('splash');
    if (splash) splash.style.setProperty('display', 'none', 'important');
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    window.immersiveMode = false;
    if (typeof applyDiyMode === 'function') applyDiyMode(true, { save: false, toast: false, animate: false });
    if (typeof toggleFxPanel === 'function') toggleFxPanel(false);
    if (typeof setMiniQueueOpen === 'function') setMiniQueueOpen(false);
    var audioElement = window.audio;
    if (audioElement && !window.__lfP16AudioUrl) {
      var rate = 8000, seconds = 6, samples = rate * seconds;
      var buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
      function write(offset, text) { for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); }
      write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
      view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true);
      for (var s = 0; s < samples; s++) {
        var wave = Math.sin(s / rate * Math.PI * 2 * 110) * 0.52 + Math.sin(s / rate * Math.PI * 2 * 330) * 0.24;
        view.setInt16(44 + s * 2, wave * 16000, true);
      }
      window.__lfP16AudioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
      audioElement.src = window.__lfP16AudioUrl;
      audioElement.loop = true;
      audioElement.volume = 0;
      try { await audioElement.play(); } catch (_) {}
      window.playing = true;
    }
    clearInterval(window.__lfP16FrequencyFeed);
    window.__lfP16FrequencyFeed = setInterval(function () {
      if (!window.frequencyData) return;
      var now = performance.now() * 0.001;
      for (var i = 0; i < window.frequencyData.length; i++) {
        window.frequencyData[i] = 35 + Math.round(205 * Math.abs(Math.sin(i * 0.105 + now * (1.4 + (i % 7) * 0.03))));
      }
      window.lumiFieldFrequencyDataTimestamp = performance.now();
    }, 24);
    return { diy: document.body.classList.contains('diy-mode'), audio: !!audioElement, renderer: !!window.renderer };
  });
}

async function modeSwitchBenchmark() {
  return cdp.call(async function () {
    var durations = [];
    for (var i = 0; i < 16; i++) {
      var started = performance.now();
      applyDiyMode(!document.body.classList.contains('diy-mode'), { save: false, toast: false, animate: false });
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      durations.push(performance.now() - started);
    }
    applyDiyMode(true, { save: false, toast: false, animate: false });
    return {
      cycles: durations.length,
      medianMs: durations.slice().sort(function (a, b) { return a - b; })[Math.floor(durations.length / 2)],
      p95Ms: durations.slice().sort(function (a, b) { return a - b; })[Math.floor((durations.length - 1) * 0.95)],
      maxMs: Math.max.apply(Math, durations),
      valuesMs: durations
    };
  });
}

async function consoleBenchmark() {
  return cdp.call(async function () {
    var open = [], close = [];
    for (var i = 0; i < 6; i++) {
      var started = performance.now();
      toggleFxPanel(true);
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      open.push(performance.now() - started);
      started = performance.now();
      toggleFxPanel(false);
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      close.push(performance.now() - started);
    }
    toggleFxPanel(true);
    var sorted = open.slice().sort(function (a, b) { return a - b; });
    return {
      cycles: open.length,
      openMedianMs: sorted[Math.floor(sorted.length / 2)],
      openP95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
      openMaxMs: Math.max.apply(Math, open),
      closeMedianMs: close.slice().sort(function (a, b) { return a - b; })[Math.floor(close.length / 2)],
      interactive: (function () {
        var panel = document.getElementById('fx-panel');
        if (!panel) return false;
        var style = getComputedStyle(panel);
        return panel.classList.contains('show') && style.pointerEvents !== 'none' && style.visibility !== 'hidden';
      })()
    };
  });
}

async function backgroundThrottleBenchmark() {
  const state = await cdp.call(async function () {
    var api = window.desktopWindow;
    if (!api || typeof api.setBackgroundKeep !== 'function') return { supported:false, ok:false };
    var original = fx.performanceBackground;
    setPerformanceBackgroundMode('keep',true);
    await new Promise(function(resolve){ setTimeout(resolve,80); });
    var keep = await api.setBackgroundKeep(true);
    setPerformanceBackgroundMode('auto',true);
    await new Promise(function(resolve){ setTimeout(resolve,80); });
    var auto = await api.setBackgroundKeep(false);
    setPerformanceBackgroundMode(original,true);
    return {
      supported:true,
      keep:keep,
      auto:auto,
      ok:!!(keep && keep.ok && keep.keep === true && keep.backgroundThrottling === false &&
        auto && auto.ok && auto.keep === false && auto.backgroundThrottling === true)
    };
  });
  if (!state || !state.ok) throw new Error('desktop background keep bridge failed: ' + JSON.stringify(state));
  return state;
}

async function prepareQueue() {
  return cdp.call(async function () {
    window.__lfP16OriginalQueue = Array.isArray(window.playQueue) ? window.playQueue.slice() : [];
    window.__lfP16OriginalIndex = Number(window.currentIdx || 0);
    window.playQueue = Array.from({ length: 600 }, function (_, index) {
      return {
        id: 'lf-p16-' + index,
        songId: 'lf-p16-' + index,
        name: '性能测试曲目 ' + (index + 1),
        artist: 'LumiField Benchmark',
        album: 'Problem 16',
        cover: '',
        duration: 180000,
        provider: 'local',
        playable: true
      };
    });
    window.currentIdx = 300;
    var started = performance.now();
    setMiniQueueOpen(true);
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
    var list = document.getElementById('mini-queue-list');
    return {
      openMs: performance.now() - started,
      rows: list ? list.querySelectorAll('.mini-queue-item').length : 0,
      domChildren: list ? list.children.length : 0,
      totalQueue: window.playQueue.length,
      virtualized: !!(list && window.playQueue.length > 120 && list.querySelectorAll('.mini-queue-item').length < window.playQueue.length),
      renderMode: list && list.dataset.lfVirtualization || 'none',
      scrollHeight: list ? list.scrollHeight : 0
    };
  });
}

async function restoreQueue() {
  await cdp.call(function () {
    setMiniQueueOpen(false);
    if (Array.isArray(window.__lfP16OriginalQueue)) window.playQueue = window.__lfP16OriginalQueue;
    window.currentIdx = Number(window.__lfP16OriginalIndex || 0);
    var list = document.getElementById('mini-queue-list');
    if (!window.playQueue.length && list) list.innerHTML = '';
    else if (typeof renderMiniQueuePanel === 'function') {
      setMiniQueueOpen(true);
      renderMiniQueuePanel({ animate: false });
      setMiniQueueOpen(false);
    }
    delete window.__lfP16OriginalQueue;
  });
}

async function prepareLyrics() {
  return cdp.call(function () {
    var lines = Array.from({ length: 240 }, function (_, index) {
      return { t: index * 0.5, text: 'LumiField 性能歌词 ' + (index + 1), translation: 'Performance lyric ' + (index + 1) };
    });
    window.lyricsLines = lines;
    window.lyricsTimingSource = 'custom-lrc';
    window.lyricsHasNativeKaraoke = false;
    window.lyricsVisible = true;
    if (window.fx) fx.particleLyrics = true;
    LumiFieldTask13.setLyricState({ translate: false });
    if (typeof showStageLine === 'function') showStageLine(lines[0].text, false, lines[0].translation);
    return LumiFieldTask13.getLyricDebug();
  });
}

async function configureSpectrum(enabled) {
  return cdp.call(function (on) {
    return LumiFieldTask13.setSpectrumState({
      enabled: !!on,
      mode: 3,
      bandCount: 96,
      liquidGlassEnabled: true,
      horizontalGap: 4,
      heightScale: 1.3,
      brightness: 1.25,
      opacity: 0.86,
      attack: 0.88,
      release: 0.22
    });
  }, [enabled]);
}

async function configureEcho(enabled) {
  return cdp.call(function (on) {
    return LumiFieldTask13.setEchoState({
      enabled: !!on,
      shape: 'one',
      renderResolution: 0.82,
      playerVisible: true
    });
  }, [enabled]);
}

async function hiddenBenchmark(durationMs = 8000) {
  const originalState = await cdp.call(async function () {
    return window.desktopWindow && desktopWindow.getState ? desktopWindow.getState() : {};
  });
  const before = await pageSnapshot();
  const rafBefore = before.page.raf.completed;
  await cdp.call(async function () {
    if (window.desktopWindow && desktopWindow.minimize) await desktopWindow.minimize();
  });
  await waitFor(() => cdp.call(function () {
    return document.hidden || document.visibilityState === 'hidden' ||
      (typeof desktopRuntimeState !== 'undefined' && desktopRuntimeState.minimized);
  }), 12000, 150);
  await delay(durationMs);
  const after = await pageSnapshot();
  await cdp.call(async function (wasMaximized) {
    if (!window.desktopWindow) return;
    var state = desktopWindow.getState ? await desktopWindow.getState() : {};
    if (state && state.isMinimized && desktopWindow.toggleMaximize) await desktopWindow.toggleMaximize();
    state = desktopWindow.getState ? await desktopWindow.getState() : {};
    if (!wasMaximized && state && state.isMaximized && desktopWindow.toggleMaximize) await desktopWindow.toggleMaximize();
  }, [!!(originalState && originalState.isMaximized)]);
  await cdp.send('Page.bringToFront').catch(() => {});
  try {
    await waitFor(() => cdp.call(function () { return !document.hidden; }), 5000, 150);
  } catch (_) {
    const restoreScript = [
      "Add-Type -Name Win32 -Namespace LF -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);'",
      '$p=Get-Process -Id ' + Number(app && app.pid || 0) + ' -ErrorAction SilentlyContinue',
      'if($p -and $p.MainWindowHandle -ne 0){[LF.Win32]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null}'
    ].join('; ');
    spawnSync('powershell.exe', ['-NoProfile', '-Command', restoreScript], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 12000
    });
    await cdp.send('Page.bringToFront').catch(() => {});
    await waitFor(() => cdp.call(function () { return !document.hidden; }), 12000, 150);
  }
  const elapsedSec = Math.max(0.001, Number(after.cdp.Timestamp || 0) - Number(before.cdp.Timestamp || 0));
  return {
    durationMs: round(elapsedSec * 1000, 1),
    becameHidden: !!(after.page.visibility.hidden || after.page.runtime && after.page.runtime.deepSleep),
    rafCallbacks: after.page.raf.completed - rafBefore,
    rafPerSecond: round((after.page.raf.completed - rafBefore) / elapsedSec, 2),
    taskSeconds: round(after.cdp.TaskDuration - before.cdp.TaskDuration, 4),
    taskPercentOneCore: round((after.cdp.TaskDuration - before.cdp.TaskDuration) / elapsedSec * 100, 2),
    processCpu: processCpuDelta(before.processes, after.processes, elapsedSec),
    jsHeapDeltaMB: round((after.cdp.JSHeapUsedSize - before.cdp.JSHeapUsedSize) / 1048576, 2),
    workingSetDeltaMB: round(after.memory.totalWorkingSetMB - before.memory.totalWorkingSetMB, 2),
    end: after.page
  };
}

async function hiddenKeepBenchmark() {
  const originalMode = await cdp.call(function () { return currentPerformanceBackgroundMode(); });
  await cdp.call(async function () {
    setPerformanceBackgroundMode('keep',true);
    if (window.desktopWindow && desktopWindow.setBackgroundKeep) await desktopWindow.setBackgroundKeep(true);
  });
  await delay(180);
  try {
    const kept = await hiddenBenchmark(4000);
    // DWM may independently clamp an occluded Electron surface anywhere from
    // roughly 1-15 Hz even when Chromium background throttling is disabled.
    // Keep mode must stay live; the paired auto sample below owns the actual
    // application-throttling contract.
    kept.minimumLiveFps = 1;
    kept.contractOk = kept.rafPerSecond >= kept.minimumLiveFps;
    if (!kept.contractOk) throw new Error('background keep did not preserve rendering: ' + JSON.stringify({ keep:kept.rafPerSecond, end:kept.end && kept.end.runtime }));
    return kept;
  } finally {
    await cdp.call(async function (mode) {
      setPerformanceBackgroundMode(mode,true);
      if (window.desktopWindow && desktopWindow.setBackgroundKeep) await desktopWindow.setBackgroundKeep(mode === 'keep');
    }, [originalMode]);
  }
}

async function soakBenchmark(minutes) {
  if (!(minutes > 0)) return null;
  const started = Date.now();
  const samples = [];
  while (Date.now() - started < minutes * 60000) {
    const snap = await pageSnapshot();
    const gpu = await windowsGpuUtilization(snap.processes.map(item => item.id).concat(app && app.pid || []), 2000);
    samples.push({
      elapsedSec: round((Date.now() - started) / 1000, 1),
      heapMB: round(snap.cdp.JSHeapUsedSize / 1048576, 2),
      workingSetMB: snap.memory.totalWorkingSetMB,
      privateMB: snap.memory.totalPrivateMB,
      renderer: snap.page.renderer,
      scene: snap.page.scene,
      raf: snap.page.raf,
      audioContexts: snap.page.audioContexts,
      gpu: gpu
    });
    fs.writeFileSync(path.join(evidenceDir, 'soak.partial.json'), JSON.stringify(samples, null, 2));
    await delay(Math.min(30000, Math.max(1000, minutes * 60000 - (Date.now() - started))));
  }
  const first = samples[0] || {};
  const last = samples[samples.length - 1] || {};
  const gpuValues = samples.reduce((values, sample) => values.concat(sample.gpu && sample.gpu.supported ? sample.gpu.values || [] : []), []);
  return {
    requestedMinutes: minutes,
    elapsedMinutes: round((Date.now() - started) / 60000, 3),
    samples,
    gpu: {
      supported: gpuValues.length > 0,
      samples: gpuValues.length,
      averagePercent: round(gpuValues.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1,gpuValues.length), 3),
      maxPercent: round(Math.max.apply(Math,[0].concat(gpuValues)), 3)
    },
    deltas: {
      heapMB: round(Number(last.heapMB || 0) - Number(first.heapMB || 0), 2),
      workingSetMB: round(Number(last.workingSetMB || 0) - Number(first.workingSetMB || 0), 2),
      privateMB: round(Number(last.privateMB || 0) - Number(first.privateMB || 0), 2),
      geometries: Number(last.renderer && last.renderer.memory && last.renderer.memory.geometries || 0) -
        Number(first.renderer && first.renderer.memory && first.renderer.memory.geometries || 0),
      textures: Number(last.renderer && last.renderer.memory && last.renderer.memory.textures || 0) -
        Number(first.renderer && first.renderer.memory && first.renderer.memory.textures || 0),
      audioContexts: Number(last.audioContexts && last.audioContexts.count || 0) -
        Number(first.audioContexts && first.audioContexts.count || 0)
    }
  };
}

function loadBaseline(file) {
  if (!file) return null;
  let resolved = path.resolve(file);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) resolved = path.join(resolved, 'result.json');
  if (!fs.existsSync(resolved)) throw new Error('baseline result not found: ' + resolved);
  return { file: resolved, result: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function compareResults(baseline, current) {
  if (!baseline) return null;
  const before = baseline.result;
  const rows = [];
  const metric = (name, beforeValue, afterValue, direction) => {
    const b = Number(beforeValue || 0), a = Number(afterValue || 0);
    rows.push({
      metric: name,
      baseline: round(b, 3),
      current: round(a, 3),
      delta: round(a - b, 3),
      deltaPercent: b ? round((a - b) / Math.abs(b) * 100, 2) : null,
      better: direction === 'higher' ? a > b : a < b
    });
  };
  metric('startup.spawnToInteractiveMs', before.startup && before.startup.spawnToInteractiveMs, current.startup.spawnToInteractiveMs, 'lower');
  metric('modeSwitch.p95Ms', before.interactions && before.interactions.modeSwitch && before.interactions.modeSwitch.p95Ms,
    current.interactions.modeSwitch.p95Ms, 'lower');
  metric('visualConsole.openP95Ms', before.interactions && before.interactions.visualConsole && before.interactions.visualConsole.openP95Ms,
    current.interactions.visualConsole.openP95Ms, 'lower');
  ['idle', 'queueScroll', 'lyrics', 'spectrum', 'echo', 'combined'].forEach(name => {
    const b = before.scenarios && before.scenarios[name];
    const a = current.scenarios && current.scenarios[name];
    if (!a) return;
    metric(name + '.fps', b && b.frames && b.frames.fps, a.frames.fps, 'higher');
    metric(name + '.taskPercentOneCore', b && b.cpu && b.cpu.taskPercentOneCore, a.cpu.taskPercentOneCore, 'lower');
    metric(name + '.heapDeltaMB', b && b.memory && b.memory.jsHeapDeltaMB, a.memory.jsHeapDeltaMB, 'lower');
    if (b && b.gpu && b.gpu.utilization && b.gpu.utilization.supported && a.gpu && a.gpu.utilization && a.gpu.utilization.supported) {
      metric(name + '.gpuAveragePercent', b.gpu.utilization.averagePercent, a.gpu.utilization.averagePercent, 'lower');
    }
  });
  metric('hidden.taskPercentOneCore', before.hidden && before.hidden.taskPercentOneCore, current.hidden.taskPercentOneCore, 'lower');
  metric('hidden.rafPerSecond', before.hidden && before.hidden.rafPerSecond, current.hidden.rafPerSecond, 'lower');
  return { baselineFile: baseline.file, metrics: rows };
}

async function stopApp() {
  if (browserCdp || cdp) {
    try { await (browserCdp || cdp).send('Browser.close', {}, 5000); } catch (_) {}
  }
  if (cdp) {
    cdp.close();
    cdp = null;
  }
  if (browserCdp) {
    browserCdp.close();
    browserCdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  }
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  const baseline = loadBaseline(baselinePath);
  const port = await freePort();
  const command = isInstalled ? installedExe : sourceElectron;
  const launchArgs = isInstalled ? [] : ['.'];
  launchArgs.push(
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*'
  );
  const launchedAt = Date.now();
  app = spawn(command, launchArgs, {
    cwd: isInstalled ? path.dirname(installedExe) : repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
      LF_MASTER_TEST: '1',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_ALLOW_LOCAL_CODES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' '
    }
  });
  const collectLog = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) {
      rendererErrors.push({ kind: 'process', text: text.slice(0, 1800) });
    }
  };
  app.stdout.on('data', collectLog);
  app.stderr.on('data', collectLog);

  target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2500) });
    const targets = await response.json();
    return targets.find(item => item.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000, 180);
  const targetAt = Date.now();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    const versionResponse = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(2500) });
    const version = await versionResponse.json();
    if (version && version.webSocketDebuggerUrl) {
      browserCdp = new CDP(version.webSocketDebuggerUrl);
      await browserCdp.connect(false);
    }
  } catch (_) {
    browserCdp = null;
  }
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && !!window.renderer && !!window.scene &&
      !!window.LumiFieldTask13 && typeof toggleFxPanel === 'function' &&
      typeof applyDiyMode === 'function' && typeof setMiniQueueOpen === 'function';
  }), 60000, 160);
  const interactiveAt = Date.now();
  const navigation = await cdp.call(function () {
    var nav = performance.getEntriesByType('navigation')[0];
    return nav ? {
      startTime: nav.startTime,
      domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
      loadEventEnd: nav.loadEventEnd,
      duration: nav.duration
    } : null;
  });
  const startup = {
    launchedAt: new Date(launchedAt).toISOString(),
    targetDiscoveredMs: targetAt - launchedAt,
    targetToInteractiveMs: interactiveAt - targetAt,
    spawnToInteractiveMs: interactiveAt - launchedAt,
    navigation
  };

  await focusTestWindow();
  await installInstrumentation();
  const prepared = await prepareApp();
  await delay(1000);
  await capture('01-ready');
  const listenersBefore = await listenerSnapshot();
  const initial = await pageSnapshot();

  const scenarios = {};
  scenarios.idle = await measure('idle', 5000);
  const modeSwitch = await modeSwitchBenchmark();
  const visualConsole = await consoleBenchmark();
  const backgroundThrottle = await backgroundThrottleBenchmark();
  await capture('02-visual-console');
  const queueSetup = await prepareQueue();
  await capture('03-long-queue');
  scenarios.queueScroll = await measure('queue-scroll', 6500, '#mini-queue-list');
  await restoreQueue();
  await prepareLyrics();
  scenarios.lyrics = await measure('lyrics-animation', 5500);
  await configureSpectrum(true);
  await configureEcho(false);
  scenarios.spectrum = await measure('spectrum', 5500);
  await configureSpectrum(false);
  await configureEcho(true);
  scenarios.echo = await measure('audio-echo', 5500);
  await configureSpectrum(true);
  await configureEcho(true);
  scenarios.combined = await measure('lyrics-spectrum-echo', 6500);
  const hiddenKeep = await hiddenKeepBenchmark();
  const hidden = await hiddenBenchmark();
  // When DWM has already clamped keep mode near its occluded-window floor,
  // requiring another exact 50% reduction is not measurable. Auto mode must
  // either halve the live keep rate or reach the app's verified ~2 Hz floor.
  hidden.contractLimitFps = round(Math.max(2.75, hiddenKeep.rafPerSecond * 0.5), 2);
  hidden.contractOk = hidden.rafPerSecond <= hidden.contractLimitFps;
  if (!hidden.contractOk) throw new Error('automatic background throttling did not reduce rendering: ' + JSON.stringify({ auto:hidden.rafPerSecond, keep:hiddenKeep.rafPerSecond }));
  const soak = await soakBenchmark(soakMinutes);
  const listenersAfter = await listenerSnapshot();
  const final = await pageSnapshot();

  const result = {
    ok: true,
    schema: 'lumifield-master-problem16-profile-v1',
    runId,
    phase,
    executable: isInstalled ? installedExe : sourceElectron,
    source: isInstalled ? 'installed' : repo,
    evidenceDir,
    startup,
    prepared,
    interactions: { modeSwitch, visualConsole, backgroundThrottle, queueOpen: queueSetup },
    scenarios,
    hidden,
    hiddenKeep,
    soak,
    listeners: {
      before: listenersBefore,
      after: listenersAfter,
      delta: listenersAfter.total - listenersBefore.total
    },
    resources: {
      cdpNetwork: network,
      initial: initial.page.resources,
      final: final.page.resources,
      requestsAdded: final.page.resources.count - initial.page.resources.count
    },
    renderer: {
      initial: { renderer: initial.page.renderer, scene: initial.page.scene },
      final: { renderer: final.page.renderer, scene: final.page.scene },
      geometriesDelta: Number(final.page.renderer && final.page.renderer.memory && final.page.renderer.memory.geometries || 0) -
        Number(initial.page.renderer && initial.page.renderer.memory && initial.page.renderer.memory.geometries || 0),
      texturesDelta: Number(final.page.renderer && final.page.renderer.memory && final.page.renderer.memory.textures || 0) -
        Number(initial.page.renderer && initial.page.renderer.memory && initial.page.renderer.memory.textures || 0),
      materialsDelta: Number(final.page.scene && final.page.scene.materials || 0) - Number(initial.page.scene && initial.page.scene.materials || 0)
    },
    audioContexts: {
      initial: initial.page.audioContexts,
      final: final.page.audioContexts,
      delta: final.page.audioContexts.count - initial.page.audioContexts.count
    },
    memory: {
      initial: {
        jsHeapMB: round(initial.cdp.JSHeapUsedSize / 1048576, 2),
        workingSetMB: initial.memory.totalWorkingSetMB,
        privateMB: initial.memory.totalPrivateMB
      },
      final: {
        jsHeapMB: round(final.cdp.JSHeapUsedSize / 1048576, 2),
        workingSetMB: final.memory.totalWorkingSetMB,
        privateMB: final.memory.totalPrivateMB
      },
      delta: {
        jsHeapMB: round((final.cdp.JSHeapUsedSize - initial.cdp.JSHeapUsedSize) / 1048576, 2),
        workingSetMB: round(final.memory.totalWorkingSetMB - initial.memory.totalWorkingSetMB, 2),
        privateMB: round(final.memory.totalPrivateMB - initial.memory.totalPrivateMB, 2)
      }
    },
    rendererErrors,
    screenshots
  };
  result.comparison = compareResults(baseline, result);
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify({
    ok: true,
    phase,
    evidenceDir,
    startupMs: startup.spawnToInteractiveMs,
    queueFps: scenarios.queueScroll.frames.fps,
    spectrumFps: scenarios.spectrum.frames.fps,
    echoFps: scenarios.echo.frames.fps,
    hiddenCpu: hidden.taskPercentOneCore,
    listenerDelta: result.listeners.delta,
    audioContextDelta: result.audioContexts.delta,
    rendererErrors: rendererErrors.length
  }, null, 2) + '\n');
}

run().catch(error => {
  const failure = {
    ok: false,
    runId,
    phase,
    evidenceDir,
    error: String(error && error.stack || error),
    rendererErrors
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(stopApp);
