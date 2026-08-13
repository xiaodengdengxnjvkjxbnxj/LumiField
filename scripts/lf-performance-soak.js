const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const requestedMinutes = Math.max(0.05, Number(process.env.LF_SOAK_MINUTES || 10));
const durationMs = Math.round(requestedMinutes * 60 * 1000);
const intervalMs = Math.max(1000, Number(process.env.LF_SOAK_INTERVAL_MS || 60000));
const qualifiedDuration = durationMs >= 10 * 60 * 1000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceRoot = path.join(repo, 'test-results', qualifiedDuration ? 'lf-performance-soak' : 'lf-performance-soak-preflight', stamp);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-performance-soak-'));
const audioFixture = path.join(userData, 'lf-soak-tone.wav');
const rendererErrors = [];
const mainStdout = [];
const mainStderr = [];
const actionMinutes = qualifiedDuration ? new Set([2, 3, 4, 6, 7, 9]) : new Set([1]);
let app = null;
let appExited = false;
let appExit = null;
let cdp = null;
let debugPort = 0;
let externalHealthTimer = null;
let sourceAtStartGlobal = null;
const liveEvidence = {
  schema: 2,
  startedAt: new Date().toISOString(),
  phase: 'created',
  samples: [],
  interactions: [],
  osHealth: [],
  cdpIncidents: [],
  rendererErrors,
};

fs.mkdirSync(evidenceRoot, { recursive: true });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function progress(phase, extra) {
  process.stdout.write(`${JSON.stringify(Object.assign({ phase, at: new Date().toISOString() }, extra || {}))}\n`);
}

function oneLine(value, max = 1000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function writeJsonAtomic(fileName, value) {
  const target = path.join(evidenceRoot, fileName);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  try { fs.renameSync(temporary, target); }
  catch (_) { try { fs.rmSync(target, { force: true }); } catch (_) {} fs.renameSync(temporary, target); }
}

function persistLive() {
  try {
    liveEvidence.updatedAt = new Date().toISOString();
    liveEvidence.appExit = appExit;
    writeJsonAtomic('live.json', liveEvidence);
  } catch (_) {}
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

function sourceManifest() {
  const relativePaths = ['package.json', 'server.js', 'music-platform-service.js', 'dj-analyzer.js', 'brand.config.json'];
  const collect = directory => {
    const queue = [path.join(repo, directory)];
    while (queue.length) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(fullPath);
        else if (/\.(?:js|css|html|json|svg|nsh|pem)$/i.test(entry.name)) relativePaths.push(path.relative(repo, fullPath).replace(/\\/g, '/'));
      }
    }
  };
  collect('desktop');
  collect('public');
  collect('build');
  const files = Array.from(new Set(relativePaths)).sort().map(relativePath => {
    const fullPath = path.join(repo, relativePath);
    return { relativePath, bytes: fs.statSync(fullPath).size, sha256: sha256(fullPath) };
  });
  const packageJson = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const electronPackage = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', 'electron', 'package.json'), 'utf8'));
  const comprehensive = crypto.createHash('sha256');
  files.forEach(file => {
    comprehensive.update(file.relativePath.replace(/\\/g, '/') + '\0');
    comprehensive.update(fs.readFileSync(path.join(repo, file.relativePath)));
    comprehensive.update('\0');
  });
  return {
    targetType: 'source-electron',
    repo,
    appVersion: packageJson.version,
    electronVersion: electronPackage.version,
    electronExecutable: electron,
    electronExecutableBytes: fs.statSync(electron).size,
    electronExecutableSha256: sha256(electron),
    appAsar: null,
    comprehensiveAlgorithm: 'sha256(sorted relativePath NUL fileBytes NUL)',
    comprehensiveSha256: comprehensive.digest('hex').toUpperCase(),
    files,
  };
}

function sameSourceManifest(left, right) {
  return JSON.stringify(left.files.map(file => [file.relativePath, file.bytes, file.sha256])) === JSON.stringify(right.files.map(file => [file.relativePath, file.bytes, file.sha256]));
}

function pushLines(target, chunk) {
  String(chunk).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(line => target.push(line.slice(0, 4000)));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function stats(values) {
  const list = values.filter(Number.isFinite);
  if (!list.length) return { count: 0, min: 0, p05: 0, average: 0, p95: 0, max: 0 };
  return {
    count: list.length,
    min: Number(Math.min(...list).toFixed(2)),
    p05: Number(percentile(list, 0.05).toFixed(2)),
    average: Number((list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(2)),
    p95: Number(percentile(list, 0.95).toFixed(2)),
    max: Number(Math.max(...list).toFixed(2)),
  };
}

async function reservePort() {
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
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Set();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    const rejectPending = reason => {
      for (const pair of this.pending.values()) pair.reject(new Error(reason));
      this.pending.clear();
    };
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pair = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pair.reject(new Error(message.error.message));
        else pair.resolve(message.result || {});
        return;
      }
      this.handlers.forEach(handler => handler(message));
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onclose = () => rejectPending('CDP websocket closed');
    this.ws.onerror = () => rejectPending('CDP websocket error');
    await this.send('Runtime.enable', {}, 8000);
    await this.send('Page.enable', {}, 8000);
    await this.send('DOM.enable', {}, 8000);
    await this.send('Log.enable', {}, 8000);
    await this.send('Performance.enable', {}, 8000);
  }
  on(handler) { this.handlers.add(handler); }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeoutMs = 8000) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result ? response.result.value : undefined;
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitFor(fn, timeout = 30000, interval = 200) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    if (appExited) throw new Error(`Electron exited early: ${JSON.stringify(appExit)}`);
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout} ms; last=${JSON.stringify(last)}`);
}

async function waitUntil(epochMs) {
  while (Date.now() < epochMs) {
    if (appExited) throw new Error(`Electron exited early: ${JSON.stringify(appExit)}`);
    await delay(Math.min(1000, Math.max(20, epochMs - Date.now())));
  }
}

async function findMainTarget() {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2000) });
    const list = await response.json();
    return list.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url)) || null;
  }, 45000, 250);
}

async function debugEndpointSnapshot() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2500) });
    const list = await response.json();
    return {
      reachable: response.ok,
      targets: list.filter(item => item.type === 'page').map(item => ({ id: item.id, url: item.url, title: item.title, websocket: !!item.webSocketDebuggerUrl })),
    };
  } catch (error) {
    return { reachable: false, error: oneLine(error && error.message, 500), targets: [] };
  }
}

function recordRendererEvent(message) {
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params && message.params.exceptionDetails;
    rendererErrors.push({ type: 'exception', at: new Date().toISOString(), text: oneLine(detail && (detail.exception && detail.exception.description || detail.text), 2000) });
  } else if (message.method === 'Log.entryAdded' && message.params && message.params.entry && message.params.entry.level === 'error') {
    rendererErrors.push({ type: 'log', at: new Date().toISOString(), text: oneLine(message.params.entry.text, 2000), url: oneLine(message.params.entry.url, 1000), source: message.params.entry.source || '' });
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
    const args = (message.params.args || []).map(arg => arg.value || arg.description || '').join(' ');
    rendererErrors.push({ type: 'console', at: new Date().toISOString(), text: oneLine(args, 2000) });
  }
}

function attachCdpEvents(client) { client.on(recordRendererEvent); }

function collectProcessHealth(reason) {
  const started = Date.now();
  const script = [
    '$needle=$env:LF_SOAK_HEALTH_USER_DATA',
    '$rows=@()',
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object {',
    '  $cim=$_; $gp=Get-Process -Id ([int]$cim.ProcessId) -ErrorAction SilentlyContinue',
    '  if($gp){',
    '    $kind="main"; if($cim.CommandLine -match "--type=([^ ]+)"){$kind=$matches[1]}',
    '    $rows += [pscustomobject]@{pid=[int]$cim.ProcessId;parentPid=[int]$cim.ParentProcessId;name=$cim.Name;kind=$kind;cpuSeconds=[double]($gp.CPU);workingSetBytes=[long]$gp.WorkingSet64;privateBytes=[long]$gp.PrivateMemorySize64;responding=[bool]$gp.Responding;threadCount=[int]$gp.Threads.Count}',
    '  }',
    '}',
    '$rows | ConvertTo-Json -Compress',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 8000,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LF_SOAK_HEALTH_USER_DATA: userData }),
  });
  let processes = [];
  let error = '';
  try {
    const parsed = String(result.stdout || '').trim() ? JSON.parse(String(result.stdout).trim()) : [];
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch (parseError) { error = `parse: ${oneLine(parseError.message, 300)}`; }
  if (result.status !== 0) error = oneLine(result.stderr || `powershell exit ${result.status}`, 600);
  const sample = {
    at: new Date().toISOString(),
    reason: reason || 'interval',
    collectionMs: Date.now() - started,
    rootPid: app && app.pid,
    rootAlive: !!(app && !appExited && processes.some(item => Number(item.pid) === Number(app.pid))),
    processCount: processes.length,
    totalWorkingSetBytes: processes.reduce((sum, item) => sum + Number(item.workingSetBytes || 0), 0),
    totalPrivateBytes: processes.reduce((sum, item) => sum + Number(item.privateBytes || 0), 0),
    processes,
    error,
  };
  liveEvidence.osHealth.push(sample);
  if (liveEvidence.osHealth.length > 100) liveEvidence.osHealth.shift();
  persistLive();
  return sample;
}

function startExternalHealthSampling() {
  collectProcessHealth('launch');
  externalHealthTimer = setInterval(() => collectProcessHealth('interval-10s'), 10000);
}

async function reconnectCdp(label, attempt) {
  const snapshot = await debugEndpointSnapshot();
  const page = snapshot.targets.find(item => /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url));
  if (!snapshot.reachable || !page) throw new Error(`Debug target unavailable during ${label}`);
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2500) });
  const list = await response.json();
  const target = list.find(item => item.id === page.id && item.webSocketDebuggerUrl);
  if (!target) throw new Error(`Debug websocket unavailable during ${label}`);
  const replacement = new CDP(target.webSocketDebuggerUrl);
  attachCdpEvents(replacement);
  await replacement.connect();
  const previous = cdp;
  cdp = replacement;
  if (previous) previous.close();
  liveEvidence.cdpIncidents.push({ at: new Date().toISOString(), label, attempt, event: 'reconnected', target: { id: target.id, url: target.url } });
  persistLive();
}

async function cdpWithRecovery(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const beganAt = Date.now();
    try {
      const value = await operation(cdp);
      if (attempt > 1) {
        liveEvidence.cdpIncidents.push({ at: new Date().toISOString(), label, attempt, event: 'recovered', durationMs: Date.now() - beganAt });
        persistLive();
      }
      return value;
    } catch (error) {
      lastError = error;
      const endpoint = await debugEndpointSnapshot();
      const incident = {
        at: new Date().toISOString(), label, attempt, event: 'call-failed', durationMs: Date.now() - beganAt,
        error: oneLine(error && error.message, 1000), endpoint,
        appExited, appExit,
        latestOsHealth: liveEvidence.osHealth[liveEvidence.osHealth.length - 1] || null,
      };
      liveEvidence.cdpIncidents.push(incident);
      persistLive();
      if (attempt >= 3) break;
      try { await reconnectCdp(label, attempt); }
      catch (reconnectError) {
        liveEvidence.cdpIncidents.push({ at: new Date().toISOString(), label, attempt, event: 'reconnect-failed', error: oneLine(reconnectError && reconnectError.message, 1000) });
        persistLive();
      }
      await delay(700);
    }
  }
  throw new Error(`CDP_CONTINUOUS_LOSS ${label}: ${lastError && lastError.message}`);
}

async function safeEvaluate(label, expression) {
  return cdpWithRecovery(label, client => client.evaluate(expression, 8000));
}

async function pageWait(expression, timeout = 30000) {
  return waitFor(() => cdp.evaluate(`Boolean(${expression})`), timeout);
}

async function setFileInput(selector, filePath) {
  const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const inputNode = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  assert(inputNode.nodeId, `Missing file input ${selector}`);
  await cdp.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [filePath] });
}

function nativeWindowScreenshot(filePath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class LFSoakCapture {',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '}',
    '"@',
    '[LFSoakCapture]::SetProcessDPIAware() | Out-Null',
    '$process = Get-Process -Id ([int]$env:LF_SOAK_CAPTURE_PID) -ErrorAction Stop',
    '$process.Refresh()',
    '$handle = [IntPtr]$process.MainWindowHandle',
    'if ($handle -eq [IntPtr]::Zero) { throw "Electron main window handle unavailable" }',
    '[LFSoakCapture]::ShowWindowAsync($handle, 9) | Out-Null',
    '[LFSoakCapture]::SetForegroundWindow($handle) | Out-Null',
    'Start-Sleep -Milliseconds 450',
    '$rect = New-Object LFSoakCapture+RECT',
    'if (-not [LFSoakCapture]::GetWindowRect($handle, [ref]$rect)) { throw "GetWindowRect failed" }',
    '$width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top',
    'if ($width -lt 320 -or $height -lt 240) { throw "Invalid window bounds ${width}x${height}" }',
    '$bitmap = New-Object System.Drawing.Bitmap $width, $height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    'try { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy); $bitmap.Save($env:LF_SOAK_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bitmap.Dispose() }',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 20000,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LF_SOAK_CAPTURE_PID: String(app.pid), LF_SOAK_CAPTURE_PATH: filePath }),
  });
  if (result.status !== 0 || !fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) {
    throw new Error(oneLine(result.stderr || result.stdout || `native screenshot exited ${result.status}`, 1000));
  }
}

async function screenshot(name) {
  try {
    const filePath = path.join(evidenceRoot, name);
    nativeWindowScreenshot(filePath);
    return filePath;
  } catch (nativeError) {
    progress('screenshot-fallback', { name, reason: oneLine(nativeError.message, 300) });
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }, 45000);
  const filePath = path.join(evidenceRoot, name);
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
  return filePath;
}

function createToneWav(filePath, seconds = 120, rate = 8000) {
  const count = seconds * rate;
  const buffer = Buffer.allocUnsafe(44 + count * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const beat = 0.50 + 0.50 * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.75)), 7);
    const sweep = 180 + 120 * (0.5 + 0.5 * Math.sin(t * 0.23));
    const value = (
      Math.sin(t * Math.PI * 2 * 62) * 0.24 * beat +
      Math.sin(t * Math.PI * 2 * sweep) * 0.20 +
      Math.sin(t * Math.PI * 2 * 880) * 0.09 +
      Math.sin(t * Math.PI * 2 * 1760) * 0.045
    );
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 24500))), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function walkVideos(root, limit = 1500) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const queue = [root];
  let visited = 0;
  while (queue.length && visited < limit) {
    const dir = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (++visited > limit) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (/\.(webm|mp4)$/i.test(entry.name)) {
        try {
          const size = fs.statSync(full).size;
          if (size >= 300000 && size <= 80 * 1024 * 1024) found.push({ path: full, size });
        } catch (_) {}
      }
    }
  }
  return found;
}

function videoCandidates() {
  const preferred = [
    'D:\\Program Files\\steam\\steamapps\\workshop\\content\\431960\\3660015309\\a75b44ccb99dac8322053fb1fefca65a.mp4',
    'D:\\Program Files\\steam\\steamapps\\workshop\\content\\431960\\2652738119\\files\\videoplayback.webm',
    'C:\\Users\\35992\\Desktop\\文件13\\视频一.mp4',
  ];
  const rows = [];
  for (const item of preferred) {
    try { if (fs.existsSync(item)) rows.push({ path: item, size: fs.statSync(item).size }); } catch (_) {}
  }
  rows.push(...walkVideos('D:\\Program Files\\steam\\steamapps\\workshop\\content\\431960'));
  rows.push(...walkVideos('C:\\Users\\35992\\Desktop\\文件13', 100));
  const seen = new Set();
  return rows.filter(row => {
    const key = row.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const ai = preferred.findIndex(item => item.toLowerCase() === a.path.toLowerCase());
    const bi = preferred.findIndex(item => item.toLowerCase() === b.path.toLowerCase());
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    if (/\.webm$/i.test(a.path) !== /\.webm$/i.test(b.path)) return /\.webm$/i.test(a.path) ? -1 : 1;
    return a.size - b.size;
  }).slice(0, 20);
}

async function loginTestAccount() {
  const account = `lf-soak-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const password = `LFSoak-${crypto.randomBytes(9).toString('base64url')}A1`;
  const locked = await cdp.evaluate(`document.body.classList.contains('lf-auth-locked')`);
  if (!locked) return { account: '(existing isolated session)', registered: false };
  await cdp.evaluate(`(() => {
    const tab=document.querySelector('[data-lf-auth-tab="register"]'); if(tab) tab.click();
    const input=document.getElementById('lf-register-account'); input.value=${JSON.stringify(account)}; input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('lf-register-send').click();
  })()`);
  await pageWait(`/\\d{6}/.test(document.getElementById('lf-auth-dev-mode').textContent)`, 30000);
  const code = await cdp.evaluate(`document.getElementById('lf-auth-dev-mode').textContent.match(/\\d{6}/)[0]`);
  assert(/^\d{6}$/.test(code), 'Local verification code was not exposed in test mode');
  await cdp.evaluate(`(() => {
    const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('lf-register-nickname','LF Performance Soak');
    set('lf-register-code',${JSON.stringify(code)});
    set('lf-register-password',${JSON.stringify(password)});
    set('lf-register-confirm',${JSON.stringify(password)});
    const agreement=document.getElementById('lf-register-agreement'); agreement.checked=true; agreement.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('lf-register-submit').click();
  })()`);
  await waitFor(async () => {
    return cdp.evaluate(`(() => {
      const login=document.getElementById('lf-login-account');
      const status=document.getElementById('lf-login-status');
      return !!(login && (login.value || (status && status.textContent)));
    })()`);
  }, 30000);
  await cdp.evaluate(`(() => {
    const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('lf-login-account',${JSON.stringify(account)});
    set('lf-login-password',${JSON.stringify(password)});
    document.getElementById('lf-login-submit').click();
  })()`);
  await pageWait(`!document.body.classList.contains('lf-auth-locked') && window.LFAuth && window.LFAuth.getToken()`, 30000);
  return { account, registered: true };
}

async function importStageVideo(candidates) {
  await cdp.evaluate(`document.getElementById('lf-wallpaper-open').click()`);
  await pageWait(`document.getElementById('lf-wallpaper-modal').classList.contains('show')`);
  const attempts = [];
  for (const candidate of candidates) {
    await setFileInput('#lf-wallpaper-file', candidate.path);
    await cdp.evaluate(`(() => {
      const input=document.getElementById('lf-wallpaper-file'); input.dispatchEvent(new Event('change',{bubbles:true}));
      const target=document.getElementById('lf-wallpaper-target'); target.value='stage'; target.dispatchEvent(new Event('change',{bubbles:true}));
      const fit=document.getElementById('lf-wallpaper-fit'); fit.value='cover'; fit.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('lf-wallpaper-apply').click();
    })()`);
    let state;
    try {
      state = await waitFor(async () => {
        const value = await cdp.evaluate(`(() => {
          const v=document.getElementById('lf-stage-wallpaper-video');
          const q=v&&v.getVideoPlaybackQuality?v.getVideoPlaybackQuality():{};
          return {exists:!!v,ready:v&&v.readyState,time:v&&v.currentTime,frames:Number(q.totalVideoFrames||0),paused:v&&v.paused,error:v&&v.error&&v.error.message,src:v&&v.currentSrc};
        })()`);
        return value && value.exists && !value.error && value.ready >= 2 && (value.time > 0.05 || value.frames > 0) ? value : null;
      }, 12000, 300);
    } catch (error) {
      attempts.push({ path: candidate.path, bytes: candidate.size, ok: false, error: oneLine(error.message, 300) });
      continue;
    }
    attempts.push({ path: candidate.path, bytes: candidate.size, ok: true, state });
    await cdp.evaluate(`document.getElementById('lf-wallpaper-ok').click()`);
    await pageWait(`!document.getElementById('lf-wallpaper-modal').classList.contains('show')`, 20000);
    return { selected: candidate, attempts };
  }
  throw new Error(`No local video decoded: ${JSON.stringify(attempts)}`);
}

async function loadAudioAndComplexVisuals() {
  createToneWav(audioFixture);
  await setFileInput('#file-input', audioFixture);
  await cdp.evaluate(`document.getElementById('file-input').dispatchEvent(new Event('change',{bubbles:true}))`);
  await pageWait(`window.audio && isFinite(audio.duration) && audio.duration > 100 && audio.readyState >= 2`, 30000);
  await cdp.evaluate(`(async () => {
    audio.loop=true;
    if (audio.paused) await playAudio();
    if (typeof resumeAudioAnalysis==='function') await resumeAudioAnalysis();
    if (window.gainNode && gainNode.gain) gainNode.gain.value=0;
    if (typeof dismissHomePage==='function') dismissHomePage({reason:'performance-soak'});
    if (typeof emptyHomeActive!=='undefined') emptyHomeActive=false;
    if (typeof homeForcedOpen!=='undefined') homeForcedOpen=false;
    document.body.classList.remove('empty-home-active','home-controls-locked');
    const lyrics=[];
    for(let i=0;i<60;i++) lyrics.push({t:i*2,duration:2,text:'LumiField performance line '+(i+1),translation:'性能浸泡测试 · 第 '+(i+1)+' 行'});
    applyLyricsState(lyrics,false,'soak-fixture');
    const animation=document.querySelector('[data-lf-lyric-mode="animation"]'); if(animation) animation.click();
    if(typeof setParticleLyricsSilently==='function') setParticleLyricsSilently(true);
    if(window.fx){fx.particleLyrics=true;fx.intensity=Math.max(1,Number(fx.intensity)||1);}
    const spectrum=document.querySelector('[data-lf-spectrum-shape="three"]'); if(spectrum) spectrum.click();
    const setControl=(scope,key,value)=>{const el=document.querySelector('[data-lf-scope="'+scope+'"][data-lf-key="'+key+'"]');if(!el)return; if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    setControl('spectrum','enabled',true);setControl('spectrum','barCount',180);setControl('spectrum','verticalCount',3);setControl('spectrum','verticalGap',3);setControl('spectrum','simulatedPeaks',true);setControl('spectrum','glass',true);setControl('spectrum','glow',1.25);setControl('spectrum','sensitivity',1.25);
    if(typeof toggleFxPanel==='function') toggleFxPanel(false);
    if(typeof closeLocalBeatModal==='function') closeLocalBeatModal();
    if(typeof controlsAutoHide!=='undefined') controlsAutoHide=false;
    const bar=document.getElementById('bottom-bar');if(bar){bar.classList.add('visible');bar.classList.remove('soft-hidden');}
    if(typeof revealBottomControls==='function') revealBottomControls(3600000);
    await audio.play();
    await new Promise(r=>setTimeout(r,900));
    if(typeof closeLocalBeatModal==='function') closeLocalBeatModal();
    return true;
  })()`);
  await pageWait(`audio && !audio.paused && window.frequencyData && Array.from(frequencyData).some(v=>v>2)`, 20000);
}

async function installInstrumentation() {
  return cdp.evaluate(`(() => {
    const state=window.__lfPerformanceSoak={
      installedAt:Date.now(),frameCount:0,frameFirst:0,frameLast:0,frameDeltas:[],lastFrameAt:0,sampleCache:{},actionPromises:{},
      playerHiddenTransitions:[],playerVisibleTransitions:[],lastPlayerVisible:true,
      videoObservations:[],videoInterruptions:[],spectrumInterruptions:[],audioInterruptions:[],lastVideoFrames:0,videoStallTicks:0,spectrumZeroTicks:0,lastHealthAt:Date.now()
    };
    function playerVisible(){const el=document.getElementById('bottom-bar');if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.1&&r.width>100&&r.bottom>0&&r.top<innerHeight;}
    function frame(t){if(!state.frameFirst)state.frameFirst=t;if(state.lastFrameAt){const d=t-state.lastFrameAt;if(state.frameDeltas.length<20000)state.frameDeltas.push(d);}state.lastFrameAt=t;state.frameLast=t;state.frameCount++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
    state.lastPlayerVisible=playerVisible();
    state.healthTimer=setInterval(()=>{
      const visible=playerVisible();
      if(visible!==state.lastPlayerVisible){(visible?state.playerVisibleTransitions:state.playerHiddenTransitions).push({at:Date.now(),className:document.getElementById('bottom-bar')&&document.getElementById('bottom-bar').className});state.lastPlayerVisible=visible;}
      const video=document.getElementById('lf-stage-wallpaper-video'),q=video&&video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():{},frames=Number(q.totalVideoFrames||0);
      const videoExpected=!!(video&&!video.hidden&&document.body.classList.contains('lf-stage-wallpaper-active')&&!document.hidden);
      if(videoExpected&&(video.paused||video.readyState<2||video.error)){state.videoObservations.push({at:Date.now(),paused:video.paused,readyState:video.readyState,error:video.error&&video.error.message,frames});}
      if(videoExpected&&(video.paused||video.error)){state.videoInterruptions.push({at:Date.now(),paused:video.paused,readyState:video.readyState,error:video.error&&video.error.message,frames});}
      if(videoExpected&&frames===state.lastVideoFrames)state.videoStallTicks++;else state.videoStallTicks=0;
      if(state.videoStallTicks===5)state.videoInterruptions.push({at:Date.now(),reason:'frames-stalled-5s',frames});
      state.lastVideoFrames=frames;
      if(window.audio&&audio.paused)state.audioInterruptions.push({at:Date.now(),reason:'paused'});
      const data=window.frequencyData,max=data&&data.length?Math.max.apply(null,Array.from(data)):0;
      if(window.audio&&!audio.paused&&max<=2)state.spectrumZeroTicks++;else state.spectrumZeroTicks=0;
      if(state.spectrumZeroTicks===5)state.spectrumInterruptions.push({at:Date.now(),reason:'analyser-zero-5s'});
      state.lastHealthAt=Date.now();
    },1000);
    state.readSample=(sampleId)=>{
      sampleId=String(sampleId||'');
      if(sampleId&&state.sampleCache[sampleId])return state.sampleCache[sampleId];
      const now=performance.now(),elapsed=state.frameFirst&&state.frameLast>state.frameFirst?(state.frameLast-state.frameFirst)/1000:0,frames=state.frameCount;
      const fps=elapsed>0?Math.max(0,(frames-1)/elapsed):0;
      const deltas=state.frameDeltas.slice().sort((a,b)=>a-b),at=p=>deltas.length?deltas[Math.min(deltas.length-1,Math.floor((deltas.length-1)*p))]:0;
      state.frameCount=0;state.frameFirst=0;state.frameLast=0;state.frameDeltas=[];
      const video=document.getElementById('lf-stage-wallpaper-video'),q=video&&video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():{};
      const bar=document.getElementById('bottom-bar'),br=bar&&bar.getBoundingClientRect(),bs=bar&&getComputedStyle(bar);
      const data=window.frequencyData||[],sum=Array.from(data).reduce((a,b)=>a+b,0),max=data.length?Math.max.apply(null,Array.from(data)):0;
      const spectrum=document.getElementById('lf-t13-spectrum'),lyrics=document.getElementById('lf-t13-lyrics');
      const sample={
        at:new Date().toISOString(),fps:Number(fps.toFixed(2)),frameCount:frames,frameWindowSeconds:Number(elapsed.toFixed(3)),frameMsP95:Number(at(.95).toFixed(2)),longFrames:deltas.filter(v=>v>50).length,
        jsHeapUsed:performance.memory&&performance.memory.usedJSHeapSize||null,jsHeapTotal:performance.memory&&performance.memory.totalJSHeapSize||null,domNodes:document.getElementsByTagName('*').length,
        video:{currentTime:video&&Number(video.currentTime.toFixed(3)),duration:video&&Number(video.duration.toFixed(3)),readyState:video&&video.readyState,paused:video&&video.paused,ended:video&&video.ended,frames:Number(q.totalVideoFrames||0),droppedFrames:Number(q.droppedVideoFrames||0),error:video&&video.error&&video.error.message},
        audio:{currentTime:window.audio&&Number(audio.currentTime.toFixed(3)),duration:window.audio&&Number(audio.duration.toFixed(3)),readyState:window.audio&&audio.readyState,paused:window.audio&&audio.paused,ended:window.audio&&audio.ended,error:window.audio&&audio.error&&audio.error.message},
        analyser:{bins:data.length,max,mean:data.length?Number((sum/data.length).toFixed(3)):0,nonzero:Array.from(data).filter(v=>v>2).length},
        visual:{stageWallpaper:document.body.classList.contains('lf-stage-wallpaper-active'),spectrumVisible:!!(spectrum&&getComputedStyle(spectrum).display!=='none'&&Number(getComputedStyle(spectrum).opacity||1)>.05),lyricMode:lyrics&&lyrics.className,lyricsVisible:!!(lyrics&&getComputedStyle(lyrics).display!=='none'),particleLyrics:!!(window.fx&&fx.particleLyrics)},
        player:{visible:playerVisible(),opacity:bs&&bs.opacity,display:bs&&bs.display,visibility:bs&&bs.visibility,rect:br&&{left:br.left,top:br.top,right:br.right,bottom:br.bottom,width:br.width,height:br.height},hiddenTransitions:state.playerHiddenTransitions.length},
        interruptions:{video:state.videoInterruptions.length,spectrum:state.spectrumInterruptions.length,audio:state.audioInterruptions.length}
      };
      if(sampleId)state.sampleCache[sampleId]=sample;
      return sample;
    };
    return {installed:true,playerVisible:state.lastPlayerVisible};
  })()`);
}

async function performanceMetrics(label) {
  const response = await cdpWithRecovery(label || 'performance-metrics', client => client.send('Performance.getMetrics', {}, 8000));
  const map = Object.fromEntries((response.metrics || []).map(metric => [metric.name, metric.value]));
  return {
    jsHeapUsed: map.JSHeapUsedSize || null,
    jsHeapTotal: map.JSHeapTotalSize || null,
    nodes: map.Nodes || null,
    documents: map.Documents || null,
    layoutCount: map.LayoutCount || null,
    recalcStyleCount: map.RecalcStyleCount || null,
  };
}

async function performInteraction(minute) {
  return safeEvaluate(`interaction-minute-${Number(minute)}`, `(async () => {
    const actionKey='minute-${Number(minute)}',soakState=window.__lfPerformanceSoak;
    if(soakState.actionPromises[actionKey])return await soakState.actionPromises[actionKey];
    soakState.actionPromises[actionKey]=(async()=>{
    const video=document.getElementById('lf-stage-wallpaper-video'),quality=()=>video&&video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():{};
    const spectrum=document.getElementById('lf-t13-spectrum');
    function hashCanvas(canvas){if(!canvas||!canvas.width||!canvas.height)return 0;try{const scratch=document.createElement('canvas');scratch.width=32;scratch.height=18;const x=scratch.getContext('2d',{willReadFrequently:true});x.drawImage(canvas,0,0,32,18);const d=x.getImageData(0,0,32,18).data;let h=2166136261;for(let i=0;i<d.length;i+=3){h^=d[i];h=Math.imul(h,16777619);}return h>>>0;}catch(_){return 0;}}
    const before={videoTime:video&&video.currentTime,videoFrames:Number(quality().totalVideoFrames||0),spectrumHash:hashCanvas(spectrum),audioTime:window.audio&&audio.currentTime};
    const opacity=document.getElementById('fx-bgopacity');
    const opacitySweep=[0.18,0.72,0.34,0.91,0.58];
    if(opacity){opacity.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));for(const value of opacitySweep){opacity.value=String(value);opacity.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,90));}opacity.dispatchEvent(new Event('change',{bubbles:true}));opacity.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));}
    let seekTarget=null;
    if(window.audio&&isFinite(audio.duration)&&audio.duration>10){seekTarget=Math.min(audio.duration-3,5+((${Number(minute)}*17)%Math.max(6,audio.duration-10)));audio.currentTime=seekTarget;await new Promise(r=>setTimeout(r,240));if(audio.paused)await audio.play();}
    const bar=document.getElementById('bottom-bar');if(bar){bar.classList.add('visible');bar.classList.remove('soft-hidden');}
    if(typeof revealBottomControls==='function')revealBottomControls(3600000);
    await new Promise(r=>setTimeout(r,1600));
    const data=window.frequencyData||[],q=quality();
    const after={videoTime:video&&video.currentTime,videoFrames:Number(q.totalVideoFrames||0),videoReady:video&&video.readyState,videoPaused:video&&video.paused,videoError:video&&video.error&&video.error.message,spectrumHash:hashCanvas(spectrum),spectrumMax:data.length?Math.max.apply(null,Array.from(data)):0,audioTime:window.audio&&audio.currentTime,audioPaused:window.audio&&audio.paused,playerVisible:window.__lfPerformanceSoak.lastPlayerVisible,opacity:opacity&&Number(opacity.value)};
    return {minute:${Number(minute)},opacitySweep,seekTarget,before,after,seekApplied:seekTarget==null||Math.abs(after.audioTime-seekTarget)<3,videoFrameDelta:after.videoFrames-before.videoFrames,spectrumChanged:after.spectrumHash!==before.spectrumHash&&after.spectrumHash!==0,videoContinuous:!after.videoPaused&&!after.videoError&&after.videoFrames>before.videoFrames,spectrumContinuous:!after.audioPaused&&after.spectrumMax>2};
    })();
    return await soakState.actionPromises[actionKey];
  })()`);
}

async function cleanup() {
  if (externalHealthTimer) { clearInterval(externalHealthTimer); externalHealthTimer = null; }
  if (cdp) cdp.close();
  if (app && app.pid && !appExited) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await delay(800);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.rmSync(userData, { recursive: true, force: true }); break; }
    catch (_) { await delay(300 * (attempt + 1)); }
  }
}

(async () => {
  const sourceAtStart = sourceManifest();
  sourceAtStartGlobal = sourceAtStart;
  liveEvidence.sourceAtStart = sourceAtStart;
  liveEvidence.phase = 'launching';
  persistLive();
  debugPort = await reservePort();
  const startedAt = new Date().toISOString();
  progress('launch', { debugPort, requestedMinutes, intervalMs });
  app = spawn(electron, [
    '.',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ], {
    cwd: repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', chunk => pushLines(mainStdout, chunk));
  app.stderr.on('data', chunk => pushLines(mainStderr, chunk));
  app.once('exit', (code, signal) => { appExited = true; appExit = { code, signal, at: new Date().toISOString() }; });
  startExternalHealthSampling();

  const target = await findMainTarget();
  progress('target', { url: target.url });
  cdp = new CDP(target.webSocketDebuggerUrl);
  attachCdpEvents(cdp);
  await cdp.connect();
  await pageWait(`document.readyState==='complete' && window.LFAuth && window.LumiFieldTask13 && document.getElementById('lf-wallpaper-open') && document.getElementById('lf-t13-spectrum')`, 45000);
  const origin = await cdp.evaluate(`location.origin`);
  progress('page-ready', { origin });
  const account = await loginTestAccount();
  await pageWait(`!document.body.classList.contains('lf-auth-locked')`, 20000);
  progress('authenticated', { registered: account.registered });

  const candidates = videoCandidates();
  assert(candidates.length, 'No lawful local video fixture found');
  const wallpaper = await importStageVideo(candidates);
  progress('stage-video', { path: wallpaper.selected.path, attempts: wallpaper.attempts.length });
  await loadAudioAndComplexVisuals();
  await delay(3500);
  await cdp.evaluate(`(() => {
    const later=document.getElementById('local-beat-later-btn'); if(later) later.click();
    if(typeof closeLocalBeatModal==='function') closeLocalBeatModal();
    return true;
  })()`);
  await delay(800);
  await pageWait(`!document.getElementById('local-beat-modal').classList.contains('show')`, 5000);
  progress('complex-visuals');
  const instrumentation = await installInstrumentation();
  assert(instrumentation.playerVisible, 'Persistent player was not visible when soak began');
  await delay(1500);
  const startScreenshot = await screenshot('start.png');
  progress('soak-start', { screenshot: path.basename(startScreenshot) });
  await safeEvaluate('baseline-sample', `window.__lfPerformanceSoak.readSample('baseline')`);

  const soakStartedAtMs = Date.now();
  const soakStartedAt = new Date(soakStartedAtMs).toISOString();
  liveEvidence.phase = 'soak-running';
  liveEvidence.soakStartedAt = soakStartedAt;
  liveEvidence.expectedDurationSeconds = durationMs / 1000;
  persistLive();
  const samples = [];
  const interactions = [];
  const expectedSamples = Math.ceil(durationMs / intervalMs);
  for (let index = 1; index <= expectedSamples; index++) {
    const targetAt = Math.min(soakStartedAtMs + durationMs, soakStartedAtMs + index * intervalMs);
    await waitUntil(targetAt);
    const elapsedMinute = Math.round((Date.now() - soakStartedAtMs) / 60000);
    if (actionMinutes.has(elapsedMinute)) {
      const interaction = await performInteraction(elapsedMinute);
      interactions.push(interaction);
      liveEvidence.interactions.push(interaction);
      persistLive();
    }
    const sample = await safeEvaluate(`sample-minute-${index}`, `window.__lfPerformanceSoak.readSample('minute-${index}')`);
    sample.minute = Number(((Date.now() - soakStartedAtMs) / 60000).toFixed(3));
    sample.cdp = await performanceMetrics(`performance-metrics-minute-${index}`);
    samples.push(sample);
    liveEvidence.samples.push(sample);
    persistLive();
    process.stdout.write(`${JSON.stringify({ minute: sample.minute, fps: sample.fps, heapMB: Number((sample.jsHeapUsed / 1048576).toFixed(1)), videoFrames: sample.video.frames, dropped: sample.video.droppedFrames, player: sample.player.visible, rendererErrors: rendererErrors.length })}\n`);
  }
  const soakEndedAtMs = Date.now();
  liveEvidence.phase = 'soak-sampled';
  liveEvidence.soakEndedAt = new Date(soakEndedAtMs).toISOString();
  persistLive();
  progress('soak-sampled', { samples: samples.length, interactions: interactions.length });
  const endScreenshot = await screenshot('end.png');
  progress('end-screenshot', { screenshot: path.basename(endScreenshot) });
  const health = await safeEvaluate('final-health', `(() => {const s=window.__lfPerformanceSoak;return {playerHiddenTransitions:s.playerHiddenTransitions,playerVisibleTransitions:s.playerVisibleTransitions,videoObservations:s.videoObservations,videoInterruptions:s.videoInterruptions,spectrumInterruptions:s.spectrumInterruptions,audioInterruptions:s.audioInterruptions,lastHealthAt:s.lastHealthAt};})()`);
  const finalState = await safeEvaluate('final-state', `(() => ({origin:location.origin,authLocked:document.body.classList.contains('lf-auth-locked'),user:window.LFAuth&&LFAuth.getUser&&LFAuth.getUser(),task13:window.LumiFieldTask13.getState(),bodyClass:document.body.className,video:(()=>{const v=document.getElementById('lf-stage-wallpaper-video'),q=v&&v.getVideoPlaybackQuality?v.getVideoPlaybackQuality():{};return v&&{currentTime:v.currentTime,readyState:v.readyState,paused:v.paused,frames:q.totalVideoFrames||0,droppedFrames:q.droppedVideoFrames||0};})(),playerVisible:window.__lfPerformanceSoak.lastPlayerVisible}))()`);
  const sourceAtEnd = sourceManifest();
  const sourceStable = sameSourceManifest(sourceAtStart, sourceAtEnd);
  liveEvidence.sourceAtEnd = sourceAtEnd;
  liveEvidence.sourceStable = sourceStable;
  persistLive();

  const fps = stats(samples.map(sample => sample.fps));
  const heap = stats(samples.map(sample => Number(sample.jsHeapUsed || 0) / 1048576));
  const dom = stats(samples.map(sample => Number(sample.domNodes || 0)));
  const droppedStart = samples[0] ? samples[0].video.droppedFrames : 0;
  const droppedEnd = samples.length ? samples[samples.length - 1].video.droppedFrames : 0;
  const framesStart = samples[0] ? samples[0].video.frames : 0;
  const framesEnd = samples.length ? samples[samples.length - 1].video.frames : 0;
  const renderedFrames = Math.max(0, framesEnd - framesStart);
  const droppedFrames = Math.max(0, droppedEnd - droppedStart);
  const mainFatalErrors = mainStderr.filter(line => /\b(?:FATAL|uncaught|unhandled\s*rejection|heap out of memory)\b/i.test(line));
  const mainErrorLines = mainStderr.filter(line => /\b(?:error|ERR_[A-Z_]+|failed)\b/i.test(line));
  const expectedRendererSignals = rendererErrors.filter(item => item.type === 'log' && /status of 410 \(Gone\)/i.test(item.text));
  const criticalRendererErrors = rendererErrors.filter(item => !expectedRendererSignals.includes(item));
  const soakOsHealth = liveEvidence.osHealth.filter(item => Date.parse(item.at) >= soakStartedAtMs && Date.parse(item.at) <= soakEndedAtMs + 1000);
  const externalHealthPass = soakOsHealth.length >= 50 && soakOsHealth.filter(item => !item.error).every(item => item.rootAlive && item.processCount >= 4);
  const interactionPass = interactions.length >= (qualifiedDuration ? 6 : 0) && interactions.every(item => item.seekApplied && item.videoContinuous && item.spectrumContinuous && item.after.playerVisible);
  const functionalPass = (
    soakEndedAtMs - soakStartedAtMs >= durationMs - 250 &&
    samples.length >= expectedSamples &&
    samples.every(sample => !sample.video.paused && !sample.video.error) &&
    samples.every(sample => !sample.audio.paused && !sample.audio.error && sample.analyser.max > 2) &&
    samples.every(sample => sample.visual.stageWallpaper && sample.visual.spectrumVisible && sample.visual.lyricsVisible && sample.visual.particleLyrics) &&
    samples.every(sample => sample.player.visible) &&
    health.playerHiddenTransitions.length === 0 &&
    health.videoInterruptions.length === 0 &&
    health.spectrumInterruptions.length === 0 &&
    health.audioInterruptions.length === 0 &&
    criticalRendererErrors.length === 0 &&
    mainFatalErrors.length === 0 &&
    sourceStable &&
    externalHealthPass &&
    interactionPass
  );
  const fpsTargetPass = fps.average >= 30;
  const result = {
    ok: qualifiedDuration && functionalPass && fpsTargetPass,
    qualifiedDuration,
    requestedMinutes,
    actualDurationSeconds: Number(((soakEndedAtMs - soakStartedAtMs) / 1000).toFixed(3)),
    startedAt,
    soakStartedAt,
    endedAt: new Date(soakEndedAtMs).toISOString(),
    repo,
    electronPid: app.pid,
    debugPort,
    appOrigin: origin,
    target: { sourceAtStart, sourceAtEnd, sourceStable },
    isolatedUserDataRemovedOnExit: userData,
    account: { registered: account.registered, role: finalState.user && finalState.user.role },
    wallpaper: { selected: wallpaper.selected, attempts: wallpaper.attempts },
    complexMode: { stageVideo: true, spectrumShape: finalState.task13.spectrum.shape, spectrumBars: finalState.task13.spectrum.barCount, animationLyrics: finalState.task13.lyrics.mode, particleLyrics: true, syntheticAudioSeconds: 120 },
    thresholds: { longRunMinutes: 10, averageFps: 30, playerUnexpectedHideEvents: 0, videoActualInterruption: 'paused/error/no-frame-growth>=5s' },
    verdicts: { functionalPass, fpsTargetPass, interactionPass, externalHealthPass, rendererErrorsPass: criticalRendererErrors.length === 0, mainFatalErrorsPass: mainFatalErrors.length === 0, sourceStable, cdpContinuousLossPass: true },
    aggregate: {
      fps,
      jsHeapMB: heap,
      domNodes: dom,
      video: { renderedFrames, droppedFrames, droppedRatio: renderedFrames > 0 ? Number((droppedFrames / renderedFrames).toFixed(6)) : null },
      videoStatusObservations: health.videoObservations.length,
      playerHiddenTransitions: health.playerHiddenTransitions.length,
      rendererErrors: criticalRendererErrors.length,
      rendererConsoleSignals: rendererErrors.length,
      mainFatalErrors: mainFatalErrors.length,
      mainErrorLines: mainErrorLines.length,
      externalHealthSamples: soakOsHealth.length,
      cdpIncidents: liveEvidence.cdpIncidents.length,
    },
    health,
    interactions,
    samples,
    rendererErrors: criticalRendererErrors,
    expectedRendererSignals,
    mainFatalErrors,
    mainErrorLines,
    osHealth: liveEvidence.osHealth,
    cdpIncidents: liveEvidence.cdpIncidents,
    finalState,
    screenshots: { start: path.basename(startScreenshot), end: path.basename(endScreenshot) },
  };
  liveEvidence.phase = 'complete';
  liveEvidence.resultSummary = { ok:result.ok, verdicts:result.verdicts, aggregate:result.aggregate };
  persistLive();
  writeJsonAtomic('result.json', result);
  fs.writeFileSync(path.join(evidenceRoot, 'main-process.log'), [...mainStdout.map(line => `[stdout] ${line}`), ...mainStderr.map(line => `[stderr] ${line}`)].join('\n'));
  process.stdout.write(`${JSON.stringify({ evidenceRoot, ok: result.ok, qualifiedDuration, functionalPass, fpsTargetPass, fps, hidden: result.aggregate.playerHiddenTransitions, rendererErrors: criticalRendererErrors.length, rendererConsoleSignals: rendererErrors.length, mainFatalErrors: mainFatalErrors.length })}\n`);
  if (qualifiedDuration) assert(result.ok, `10-minute soak did not meet acceptance: ${JSON.stringify(result.verdicts)}`);
})().catch(async error => {
  liveEvidence.phase = 'failed';
  liveEvidence.failureAt = new Date().toISOString();
  liveEvidence.failureError = error && error.stack || String(error);
  let failureOsHealth = null;
  try { failureOsHealth = collectProcessHealth('failure-before-cleanup'); } catch (_) {}
  let sourceAtFailure = null;
  try { sourceAtFailure = sourceManifest(); } catch (_) {}
  const debugEndpointAtFailure = await debugEndpointSnapshot();
  let pageStateAtFailure = null;
  try {
    pageStateAtFailure = await cdp.evaluate(`(() => {const v=document.getElementById('lf-stage-wallpaper-video'),q=v&&v.getVideoPlaybackQuality?v.getVideoPlaybackQuality():{},b=document.getElementById('bottom-bar'),s=b&&getComputedStyle(b);return {at:new Date().toISOString(),url:location.href,readyState:document.readyState,video:v&&{currentTime:v.currentTime,readyState:v.readyState,paused:v.paused,frames:q.totalVideoFrames||0,droppedFrames:q.droppedVideoFrames||0,error:v.error&&v.error.message},audio:window.audio&&{currentTime:audio.currentTime,readyState:audio.readyState,paused:audio.paused,error:audio.error&&audio.error.message},player:b&&{className:b.className,opacity:s.opacity,display:s.display},instrumentation:window.__lfPerformanceSoak&&{lastHealthAt:__lfPerformanceSoak.lastHealthAt,playerHiddenTransitions:__lfPerformanceSoak.playerHiddenTransitions.length,videoInterruptions:__lfPerformanceSoak.videoInterruptions.length,spectrumInterruptions:__lfPerformanceSoak.spectrumInterruptions.length,audioInterruptions:__lfPerformanceSoak.audioInterruptions.length}};})()`, 3000);
  } catch (_) {}
  let failureScreenshot = '';
  try { if (app && app.pid && !appExited) { failureScreenshot = 'failure.png'; nativeWindowScreenshot(path.join(evidenceRoot, failureScreenshot)); } } catch (_) { failureScreenshot = ''; }
  const failure = {
    ok: false,
    qualifiedDuration,
    requestedMinutes,
    at: new Date().toISOString(),
    error: error && error.stack || String(error),
    appExit,
    processAliveAtFailure: !!(app && !appExited),
    failureOsHealth,
    lastSuccessfulSample: liveEvidence.samples[liveEvidence.samples.length - 1] || null,
    lastSuccessfulInteraction: liveEvidence.interactions[liveEvidence.interactions.length - 1] || null,
    samples: liveEvidence.samples,
    interactions: liveEvidence.interactions,
    cdpIncidents: liveEvidence.cdpIncidents,
    sourceAtStart: sourceAtStartGlobal,
    sourceAtFailure,
    sourceStableAtFailure: !!(sourceAtStartGlobal && sourceAtFailure && sameSourceManifest(sourceAtStartGlobal, sourceAtFailure)),
    debugEndpointAtFailure,
    pageStateAtFailure,
    failureScreenshot,
    rendererErrors,
    mainStderr,
  };
  try { writeJsonAtomic('failure.json', failure); } catch (_) {}
  persistLive();
  try { fs.writeFileSync(path.join(evidenceRoot, 'main-process.log'), [...mainStdout.map(line => `[stdout] ${line}`), ...mainStderr.map(line => `[stderr] ${line}`)].join('\n')); } catch (_) {}
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceRoot, 'main-process.log'), [...mainStdout.map(line => `[stdout] ${line}`), ...mainStderr.map(line => `[stderr] ${line}`)].join('\n')); } catch (_) {}
  await cleanup();
  const removed = !fs.existsSync(userData);
  try { fs.writeFileSync(path.join(evidenceRoot, 'cleanup.json'), JSON.stringify({ electronRootPid: app && app.pid, ownProcessTreeTerminated: true, isolatedUserData: userData, isolatedUserDataRemoved: removed, at: new Date().toISOString() }, null, 2)); } catch (_) {}
});
