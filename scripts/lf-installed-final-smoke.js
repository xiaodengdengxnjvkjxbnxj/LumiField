'use strict';

const assert = require('assert');
const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const repo = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(process.env.LF_INSTALLED_FINAL_OUT || path.join(repo, 'test-results', 'lf-installed-final', runId));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-installed-final-'));
const electron = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe');
const expected = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(value => value.startsWith(prefix));
  return path.resolve(match ? match.slice(prefix.length) : fallback);
}

const mainExe = argument('main-exe', 'D:\\LumiField\\LumiField.exe');
const monitorExe = argument('monitor-exe', 'D:\\LF后台监控\\LF后台监控.exe');
const builtMainAsar = argument('built-main-asar', path.join(repo, 'dist', 'win-unpacked', 'resources', 'app.asar'));
const builtMonitorAsar = argument('built-monitor-asar', path.join(repo, 'dist-monitor', 'win-unpacked', 'resources', 'app.asar'));
const installedMainAsar = path.join(path.dirname(mainExe), 'resources', 'app.asar');
const installedMonitorAsar = path.join(path.dirname(monitorExe), 'resources', 'app.asar');
const mainInstaller = argument('main-installer', path.join(repo, 'dist', `LumiField-${expected.version}-Setup.exe`));
const monitorInstaller = argument('monitor-installer', path.join(repo, 'dist-monitor', `LF-Monitor-${expected.version}-Setup.exe`));
const releaseManifest = `${mainInstaller}.release.json`;

const checks = {};
const logs = { mainDirect: [], mainHarness: [], monitor: [] };
const children = new Set();
let activeClient = null;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function safeText(value) { return String(value || '').replace(/\b\d{6}\b/g, '[REDACTED_CODE]').slice(-12000); }
function psEscape(value) { return String(value).replace(/'/g, "''"); }
function runPowerShell(source, timeout = 30000) {
  const prefix = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);$OutputEncoding=[Console]::OutputEncoding;";
  const encoded = Buffer.from(`${prefix}\n${source}`, 'utf16le').toString('base64');
  return childProcess.execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, timeout,
  }).trim();
}
function requireFile(file) { assert(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing file: ${file}`); }
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject); stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
function killTree(child) {
  if (!child || !child.pid || child.exitCode != null) return;
  childProcess.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
async function waitForExit(child, timeout = 8000) {
  if (!child || child.exitCode != null) return;
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(timeout)]);
  if (child.exitCode == null) killTree(child);
}
function removeTemporary() {
  const resolved = path.resolve(temporary), root = path.resolve(os.tmpdir());
  assert(resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith('lf-installed-final-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
function executableMetadata(file) {
  const json = runPowerShell(`$v=(Get-Item -LiteralPath '${psEscape(file)}').VersionInfo;[pscustomobject]@{fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;productName=$v.ProductName;fileDescription=$v.FileDescription;originalFilename=$v.OriginalFilename}|ConvertTo-Json -Compress`);
  return JSON.parse(json);
}
function existingTargetProcesses() {
  const json = runPowerShell(`$targets=@('${psEscape(mainExe)}','${psEscape(monitorExe)}');$items=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -and $targets -contains $_.ExecutablePath}|Select-Object ProcessId,Name,ExecutablePath);ConvertTo-Json -Compress -InputObject @($items)`);
  return json ? JSON.parse(json) : [];
}
async function waitWindow(processId, titlePattern, timeout = 40000) {
  const started = Date.now(); let last = null;
  while (Date.now() - started < timeout) {
    try {
      const text = runPowerShell(`$p=Get-Process -Id ${Number(processId)} -ErrorAction Stop;$p.Refresh();[pscustomobject]@{handle=[int64]$p.MainWindowHandle;title=$p.MainWindowTitle;responding=$p.Responding}|ConvertTo-Json -Compress`, 5000);
      last = JSON.parse(text);
      if (Number(last.handle) > 0 && last.responding && titlePattern.test(String(last.title || ''))) return last;
    } catch (_) {}
    await delay(250);
  }
  throw new Error(`Window did not become ready for pid ${processId}: ${JSON.stringify(last)}`);
}
function collect(child, bucket) {
  children.add(child);
  child.stdout && child.stdout.on('data', chunk => bucket.push(String(chunk)));
  child.stderr && child.stderr.on('data', chunk => bucket.push(String(chunk)));
  child.once('exit', () => children.delete(child));
  return child;
}
function isolatedEnvironment(root, extra) {
  const env = { ...process.env };
  Object.keys(env).filter(key => /^(?:LF_|LUMIFIELD_)/i.test(key)).forEach(key => { env[key] = ' '; });
  [path.join(repo, '.env'), path.join(path.dirname(mainExe), '.env'), path.join(path.dirname(monitorExe), '.env')].forEach(file => {
    if (!fs.existsSync(file)) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = ' ';
  });
  const appData = path.join(root, 'AppData'), localAppData = path.join(root, 'LocalAppData');
  fs.mkdirSync(appData, { recursive: true }); fs.mkdirSync(localAppData, { recursive: true });
  return Object.assign(env, {
    APPDATA: appData, LOCALAPPDATA: localAppData, LF_REMOTE_API_URL: ' ', LF_ALLOW_LOCAL_CODES: '0',
    LF_MAIL_HOST: ' ', LF_MAIL_USER: ' ', LF_MAIL_PASSWORD: ' ', LUMIFIELD_SKIP_SPLASH: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  }, extra || {});
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.exceptions = []; this.consoleErrors = []; }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 8000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket failed')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(String(event.data)); } catch (_) { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        return message.error ? pending.reject(new Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result || {});
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        this.exceptions.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        this.consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' ').slice(0, 1800));
      } else if (message.method === 'Log.entryAdded' && message.params && message.params.entry && message.params.entry.level === 'error') {
        this.consoleErrors.push(String(message.params.entry.text || 'Renderer log error').slice(0, 1800));
      }
    });
    await this.send('Runtime.enable'); await this.send('Log.enable'); await this.send('Page.enable');
    const hook = `window.__lfInstalledSmokeErrors=[];addEventListener('error',e=>window.__lfInstalledSmokeErrors.push(String(e.error&&e.error.stack||e.message||'window error')));addEventListener('unhandledrejection',e=>window.__lfInstalledSmokeErrors.push(String(e.reason&&e.reason.stack||e.reason||'unhandled rejection')));`;
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
    try { await this.evaluate(`(()=>{${hook}return true})()`); } catch (_) {}
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { method, resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function waitFor(fn, timeout = 45000, interval = 180) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout}ms: ${JSON.stringify(last)}`);
}
async function waitTarget(port, predicate, timeout = 45000) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    const targets = await response.json(); return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && predicate(item));
  }, timeout, 180);
}
async function json(origin, route, options, timeout = 120000) {
  const response = await fetch(origin + route, { ...(options || {}), signal: AbortSignal.timeout(timeout) });
  const text = await response.text(); let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text: text.slice(0, 500) };
}
async function probeMedia(url, provider) {
  const referer = { kugou: 'https://www.kugou.com/', netease: 'https://music.163.com/', qq: 'https://y.qq.com/', qishui: 'https://www.qishui.com/' }[provider] || 'https://www.kugou.com/';
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { Range: 'bytes=0-8191', 'User-Agent': 'Mozilla/5.0', Referer: referer } });
    const reader = response.body && response.body.getReader(); const chunks = []; let bytes = 0;
    if (reader) {
      while (bytes < 8192) { const part = await reader.read(); if (part.done) break; chunks.push(Buffer.from(part.value)); bytes += part.value.byteLength; }
      await reader.cancel().catch(() => {});
    }
    const buffer = Buffer.concat(chunks); const type = String(response.headers.get('content-type') || '').toLowerCase();
    const prefix = buffer.subarray(0, 256).toString('utf8').toLowerCase();
    const mediaLike = /audio|video|octet-stream|mpegurl|application\/vnd\.apple/i.test(type) || buffer.subarray(0, 3).toString('latin1').toLowerCase() === 'id3' || buffer[0] === 0xff || /ftyp/.test(buffer.subarray(0, 32).toString('latin1'));
    return { ok: [200, 206].includes(response.status) && bytes > 128 && mediaLike && !/<html|<!doctype/.test(prefix), status: response.status, contentType: type, bytes, finalUrl: response.url };
  } catch (error) { return { ok: false, status: 0, contentType: '', bytes: 0, error: String(error && error.message || error) }; }
}
function normalized(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[（(【\[].*?[）)】\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, ''); }
function exactTitle(expectedTitle, actual) { const left = normalized(expectedTitle), right = normalized(actual); return !!left && !!right && (left === right || right.startsWith(left)); }
function songArtist(song) { return Array.isArray(song && song.artist) ? song.artist.join(' / ') : String(song && (song.artist || song.artists || song.author) || ''); }
function derivative(value) { return /(翻唱|cover|伴奏|instrumental|remix|dj(?:版)?|现场|live|片段|铃声|纯音乐|karaoke|demo|加速版|降速版|抖音版|剪辑版|女声版|男声版)/i.test(String(value || '')); }

async function verifyRelease() {
  [mainInstaller, releaseManifest, monitorInstaller, path.join(repo, 'build', 'lf-update-public.pem')].forEach(requireFile);
  const manifest = JSON.parse(fs.readFileSync(releaseManifest, 'utf8'));
  const [mainHash, monitorHash] = await Promise.all([sha256(mainInstaller), sha256(monitorInstaller)]);
  assert.equal(manifest.version, expected.version); assert.equal(manifest.file, path.basename(mainInstaller)); assert.equal(manifest.sha256, mainHash);
  const publicKey = fs.readFileSync(path.join(repo, 'build', 'lf-update-public.pem'), 'utf8');
  assert(crypto.verify('sha256', Buffer.from(`${manifest.version}:${mainHash}`), publicKey, Buffer.from(manifest.signature, 'base64')), 'Release signature verification failed');
  checks.release = { version: manifest.version, mainInstaller, mainSha256: mainHash, signatureVerified: true, monitorInstaller, monitorSha256: monitorHash };
}

async function verifyArtifacts() {
  [mainExe, monitorExe, installedMainAsar, installedMonitorAsar, builtMainAsar, builtMonitorAsar, electron].forEach(requireFile);
  assert.deepEqual(existingTargetProcesses(), [], 'Close running installed LumiField/monitor instances before final smoke');
  const [installedMainHash, builtMainHash, installedMonitorHash, builtMonitorHash] = await Promise.all([
    sha256(installedMainAsar), sha256(builtMainAsar), sha256(installedMonitorAsar), sha256(builtMonitorAsar),
  ]);
  assert.equal(installedMainHash, builtMainHash, 'Installed main app.asar differs from build output');
  assert.equal(installedMonitorHash, builtMonitorHash, 'Installed monitor app.asar differs from build output');
  const mainPackage = JSON.parse(asar.extractFile(installedMainAsar, 'package.json').toString('utf8'));
  const monitorPackage = JSON.parse(asar.extractFile(installedMonitorAsar, 'package.json').toString('utf8'));
  const versionManifest = JSON.parse(asar.extractFile(installedMainAsar, 'public/version-manifest.json').toString('utf8'));
  assert.equal(mainPackage.version, expected.version); assert.equal(monitorPackage.version, expected.version); assert.equal(versionManifest.version, expected.version);
  assert(/^[a-f0-9]{64}$/i.test(versionManifest.sourceSha256), 'Invalid installed source fingerprint');
  const mainMetadata = executableMetadata(mainExe), monitorMetadata = executableMetadata(monitorExe);
  assert.equal(mainMetadata.fileVersion, expected.version); assert.equal(mainMetadata.productVersion, expected.version); assert.equal(mainMetadata.productName, 'LumiField');
  assert.equal(monitorMetadata.fileVersion, expected.version); assert.equal(monitorMetadata.productVersion, expected.version); assert.equal(monitorMetadata.productName, 'LF后台监控');
  checks.artifacts = { version: expected.version, sourceSha256: versionManifest.sourceSha256, main: { exe: mainExe, asarSha256: installedMainHash, metadata: mainMetadata }, monitor: { exe: monitorExe, asarSha256: installedMonitorHash, metadata: monitorMetadata } };
}

async function verifyInstalledMainWindow() {
  const root = path.join(temporary, 'main-direct'); fs.mkdirSync(root, { recursive: true });
  const child = collect(childProcess.spawn(mainExe, [`--user-data-dir=${path.join(root, 'UserData')}`], { cwd: path.dirname(mainExe), env: isolatedEnvironment(root), windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] }), logs.mainDirect);
  try {
    const window = await waitWindow(child.pid, /LumiField/i);
    await delay(1200); assert.equal(child.exitCode, null, 'Installed LumiField exited after opening');
    assert(!logs.mainDirect.some(line => /(?:FATAL|uncaught exception|renderer process crashed)/i.test(line)), 'Installed LumiField emitted a fatal startup error');
    checks.installedMainWindow = window;
  } finally { killTree(child); await waitForExit(child); await delay(800); }
}

async function p16Audit(origin) {
  const fixtures = [
    { query: '小城夏天 LBI利比', title: '小城夏天', artist: /LBI|利比/i },
    { query: '七里香 周杰伦', title: '七里香', artist: /周杰伦|Jay\s*Chou/i },
    { query: '后来 刘若英', title: '后来', artist: /刘若英/i },
  ];
  const attempts = []; let selected = null;
  for (const fixture of fixtures) {
    const search = await json(origin, `/api/platform/search?keywords=${encodeURIComponent(fixture.query)}&limit=18&force=1`);
    assert.equal(search.status, 200, `Search failed: ${fixture.query}`);
    assert.deepEqual((search.body.providersTried || []).slice(0, 3), ['kugou', 'netease', 'qq']);
    assert(search.body.qishuiSearchEnabled === true || search.body.qishuiSearchEnabled === false, 'Qishui search capability must be explicit');
    const song = search.body.songs && search.body.songs[0];
    assert(song && exactTitle(fixture.title, song.name || song.title) && fixture.artist.test(songArtist(song)) && !derivative(song.name || song.title), `Inaccurate first result: ${fixture.query}`);
    const resolve = await json(origin, '/api/platform/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ song }) });
    assert.equal(resolve.status, 200); assert.deepEqual(resolve.body.priority || [], ['kugou', 'netease', 'qq', 'qishui']); assert(Array.isArray(resolve.body.attempts));
    const probe = resolve.body.playable && resolve.body.url ? await probeMedia(resolve.body.url, resolve.body.provider || song.provider || song.source) : { ok: false, status: 0, bytes: 0 };
    attempts.push({ query: fixture.query, song: { name: song.name || song.title, artist: songArtist(song), provider: song.provider || song.source }, providersTried: search.body.providersTried, playable: !!resolve.body.playable, reason: resolve.body.reason || resolve.body.restriction && resolve.body.restriction.category || '', resolvedProvider: resolve.body.provider || '', probe });
    if (probe.ok) { selected = { fixture, song, resolve: resolve.body, probe }; break; }
  }
  assert(selected, `No P16 result produced playable Range media: ${JSON.stringify(attempts)}`);
  return { query: selected.fixture.query, attempts, selected: { name: selected.song.name || selected.song.title, artist: songArtist(selected.song), provider: selected.resolve.provider || '', range: selected.probe } };
}

async function problem17Audit(client, origin) {
  const live = await json(origin, `/api/weather/current?city=${encodeURIComponent('北京')}&force=1`, null, 30000);
  assert.equal(live.status, 200, 'Installed weather API real city query failed');
  assert(live.body.ok && live.body.weather && live.body.weather.label && live.body.weather.label !== '天气', 'Installed weather API returned a generic label');
  assert(Number.isFinite(live.body.weather.temperature) && Number.isFinite(live.body.weather.humidity) && Number.isFinite(live.body.weather.windSpeed), 'Installed weather API lost temperature/humidity/wind');
  const missing = await json(origin, `/api/weather/current?city=${encodeURIComponent(`此地绝不存在ZXQ${Date.now()}`)}&force=1`, null, 30000);
  assert.equal(missing.status, 404, 'Installed weather API must reject an unknown city');
  assert.equal(missing.body.code, 'WEATHER_CITY_NOT_FOUND');
  assert(!missing.body.weather, 'Unknown city must not silently fall back to Shanghai');

  const ui = await client.evaluate(`(async()=>{
    document.body.classList.remove('lf-auth-locked','splash-active');
    const auth=document.getElementById('lf-auth-root');if(auth){auth.classList.remove('show');auth.style.setProperty('display','none','important');}
    const splash=document.getElementById('splash');if(splash)splash.style.display='none';
    const input=document.getElementById('lf-weather-city-input'),search=document.getElementById('lf-weather-search'),label=document.getElementById('lf-weather-label'),updated=document.getElementById('lf-weather-updated');
    const originalFetch=window.fetch,calls=[],pending=[];
    const wait=async(fn,ms=4000)=>{const start=Date.now();while(Date.now()-start<ms){if(fn())return true;await new Promise(r=>setTimeout(r,10));}return false;};
    const key=(composing)=>{const event=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true});if(composing){try{Object.defineProperty(event,'isComposing',{value:true});}catch(_){}try{Object.defineProperty(event,'keyCode',{value:229});}catch(_){}}input.dispatchEvent(event);return event.defaultPrevented;};
    try{
      await wait(()=>!search.disabled,20000);
      window.fetch=(url,options)=>{const value=String(url||'');if(!value.includes('/api/weather/current'))return originalFetch.call(window,url,options);calls.push(value);return new Promise(resolve=>pending.push(resolve));};
      input.value='杭州';key(true);await new Promise(r=>setTimeout(r,30));const composingRequests=calls.length;
      const prevented=key(false);key(false);search.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      await wait(()=>pending.length===1);
      pending[0]({ok:true,status:200,json:async()=>({ok:true,weather:{location:{name:'杭州'},weatherCode:63,label:'中雨',temperature:22,apparentTemperature:21,humidity:68,windSpeed:12,windDirection:90,forecast:[{date:'2026-07-26',weatherCode:63,temperatureMax:26,temperatureMin:19,precipitationProbability:40}]}})});
      await wait(()=>label.textContent==='中雨'&&!search.disabled);
      const success={city:document.getElementById('lf-weather-city').textContent,label:label.textContent,details:document.getElementById('lf-weather-details').textContent,saved:localStorage.getItem('lumifield-weather-city')};
      input.value='不存在的地区';key(false);await wait(()=>pending.length===2);
      pending[1]({ok:false,status:404,json:async()=>({ok:false,code:'WEATHER_CITY_NOT_FOUND',error:'WEATHER_CITY_NOT_FOUND'})});
      await wait(()=>updated.textContent.includes('未找到该城市或地区')&&!search.disabled);
      return{composingRequests,requests:calls.length,prevented,success,failure:{status:updated.textContent,city:document.getElementById('lf-weather-city').textContent,label:label.textContent,saved:localStorage.getItem('lumifield-weather-city')}};
    }finally{window.fetch=originalFetch;}
  })()`);
  assert.equal(ui.composingRequests, 0, 'Installed IME composition Enter issued a request');
  assert.equal(ui.requests, 2, 'Installed duplicate Enter/click was not de-duplicated');
  assert(ui.prevented && ui.success.city === '杭州' && ui.success.label === '中雨' && ui.success.details.includes('湿度 68%') && ui.success.details.includes('东风 12 km/h') && ui.success.saved === '杭州', 'Installed Enter weather update failed');
  assert(ui.failure.status.includes('未找到该城市或地区') && ui.failure.city === '杭州' && ui.failure.label === '中雨' && ui.failure.saved === '杭州', 'Installed weather failure state was inaccurate or polluted persistence');
  return {
    live: {
      location: live.body.weather.location,
      code: live.body.weather.weatherCode,
      label: live.body.weather.label,
      temperature: live.body.weather.temperature,
      humidity: live.body.weather.humidity,
      windSpeed: live.body.weather.windSpeed,
    },
    missing: { status: missing.status, code: missing.body.code },
    ui,
  };
}

async function verifyMainAsarRuntime() {
  const extracted = path.join(temporary, 'main-asar'); asar.extractAll(installedMainAsar, extracted);
  const root = path.join(temporary, 'main-harness'); fs.mkdirSync(root, { recursive: true });
  const port = await freePort();
  const child = collect(childProcess.spawn(electron, [extracted, `--user-data-dir=${path.join(root, 'UserData')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--window-size=1500,950'], { cwd: extracted, env: isolatedEnvironment(root), windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] }), logs.mainHarness);
  let client;
  try {
    const target = await waitTarget(port, () => true); client = activeClient = new CDP(target.webSocketDebuggerUrl); await client.connect();
    await waitFor(() => client.evaluate(`location.protocol==='http:'&&document.readyState==='complete'&&typeof doSearch==='function'&&typeof playSearchResult==='function'&&!!document.getElementById('t-wallpaperMode')&&!!document.getElementById('lf-qr-refresh')`), 60000);
    const origin = await client.evaluate('location.origin');
    const version = await json(origin, '/api/app/version', null, 15000); assert.equal(version.status, 200); assert.equal(version.body.version, expected.version);
    const paused = await client.evaluate(`(()=>{const wall=document.getElementById('t-wallpaperMode'),opacity=document.getElementById('fx-wallpaperopacity'),qr=document.getElementById('lf-qr-refresh');return{title:document.title,wallpaperLocked:wall.classList.contains('dev-locked')&&/开发中/.test(wall.textContent),wallpaperOpacityDisabled:!!opacity.disabled,mobileQrPaused:!!qr.disabled&&/开发中/.test(qr.textContent),bridge:!!window.desktopWindow};})()`);
    assert(/LumiField/i.test(paused.title)); assert(paused.wallpaperLocked && paused.wallpaperOpacityDisabled && paused.mobileQrPaused);
    const problem17 = await problem17Audit(client, origin);
    await client.screenshot(path.join(output, 'problem17-weather-installed-asar.png'));
    const p16 = await p16Audit(origin);
    const rendererQuery = JSON.stringify(p16.query);
    const renderer = await client.evaluate(`(async()=>{document.body.classList.remove('lf-auth-locked','splash-active');const auth=document.getElementById('lf-auth-root');if(auth){auth.classList.remove('show');auth.style.setProperty('display','none','important');}const splash=document.getElementById('splash');if(splash)splash.style.display='none';const input=document.getElementById('search-input');if(input)input.value=${rendererQuery};searchMode='song';await doSearch(${rendererQuery});await new Promise(r=>setTimeout(r,1200));return{count:Array.isArray(window.playlist)?playlist.length:0,first:window.playlist&&playlist[0]&&{name:playlist[0].name,artist:Array.isArray(playlist[0].artist)?playlist[0].artist.join(' / '):playlist[0].artist,provider:playlist[0].provider||playlist[0].source},resultVisible:!!document.querySelector('#search-results .search-result')};})()`);
    assert(renderer.count > 0 && renderer.first && renderer.resultVisible && exactTitle(p16.selected.name, renderer.first.name) && !derivative(renderer.first.name), 'Installed renderer search did not render the accurate P16 result');
    await client.screenshot(path.join(output, 'main-installed-asar.png'));
    await delay(800);
    const windowErrors = await client.evaluate('window.__lfInstalledSmokeErrors||[]');
    const criticalLogs = logs.mainHarness.filter(line => /(?:FATAL|uncaught exception|renderer process crashed)/i.test(line));
    const criticalConsole = client.consoleErrors.filter(line => /(?:uncaught|unhandled|TypeError|ReferenceError|SyntaxError|renderer process|crash)/i.test(line));
    assert.deepEqual(client.exceptions, [], 'Main renderer exceptions'); assert.deepEqual(windowErrors, [], 'Main window/unhandled errors'); assert.deepEqual(criticalConsole, [], 'Main critical console errors'); assert.deepEqual(criticalLogs, [], 'Main process fatal errors');
    checks.mainRuntime = { mode: 'SHA256-matched installed app.asar under repository Electron for CDP (packaged executable intentionally disables remote debugging)', origin, apiVersion: version.body.version, paused, problem17, p16, renderer, rendererErrors: [], consoleSignals: client.consoleErrors };
  } finally {
    if (client) { try { await Promise.race([client.send('Browser.close'), delay(1000)]); } catch (_) {} client.close(); activeClient = null; }
    await waitForExit(child); killTree(child); await delay(800);
  }
}

async function verifyInstalledMonitor() {
  const root = path.join(temporary, 'monitor'); fs.mkdirSync(root, { recursive: true });
  const port = await freePort();
  const env = isolatedEnvironment(root, { LF_SHARED_USER_DATA_DIR: path.join(root, 'Shared') });
  fs.mkdirSync(env.LF_SHARED_USER_DATA_DIR, { recursive: true });
  const child = collect(childProcess.spawn(monitorExe, [`--user-data-dir=${path.join(root, 'UserData')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { cwd: path.dirname(monitorExe), env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] }), logs.monitor);
  let client;
  try {
    const target = await waitTarget(port, item => /lf-monitor\.html/i.test(item.url)); client = activeClient = new CDP(target.webSocketDebuggerUrl); await client.connect();
    await waitFor(() => client.evaluate(`document.readyState==='complete'&&!!window.LFMonitor&&!!document.getElementById('monitor-login')`));
    const window = await waitWindow(child.pid, /LF\s*后台监控/);
    const runtime = await client.evaluate(`(async()=>{const status=await window.LFMonitor.backendStatus();return{title:document.title,version:status.appVersion,apiOk:status.ok===true,mode:status.mode,loginVisible:!document.getElementById('monitor-login').hidden,bridge:['login','authStatus','dashboard','backendStatus'].every(name=>typeof window.LFMonitor[name]==='function')};})()`);
    assert(/LF\s*后台监控/.test(runtime.title)); assert.equal(runtime.version, expected.version); assert(runtime.apiOk && runtime.loginVisible && runtime.bridge);
    await client.screenshot(path.join(output, 'monitor-installed.png')); await delay(500);
    const windowErrors = await client.evaluate('window.__lfInstalledSmokeErrors||[]');
    const criticalLogs = logs.monitor.filter(line => /(?:FATAL|uncaught exception|renderer process crashed)/i.test(line));
    const criticalConsole = client.consoleErrors.filter(line => /(?:uncaught|unhandled|TypeError|ReferenceError|SyntaxError|renderer process|crash)/i.test(line));
    assert.deepEqual(client.exceptions, [], 'Monitor renderer exceptions'); assert.deepEqual(windowErrors, [], 'Monitor window/unhandled errors'); assert.deepEqual(criticalConsole, [], 'Monitor critical console errors'); assert.deepEqual(criticalLogs, [], 'Monitor process fatal errors');
    checks.monitorRuntime = { window, ...runtime, rendererErrors: [], consoleSignals: client.consoleErrors };
  } finally {
    if (client) { try { await Promise.race([client.send('Browser.close'), delay(1000)]); } catch (_) {} client.close(); activeClient = null; }
    await waitForExit(child); killTree(child);
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await verifyArtifacts();
  await verifyRelease();
  await verifyInstalledMainWindow();
  await verifyMainAsarRuntime();
  await verifyInstalledMonitor();
  const result = { ok: true, checkedAt: new Date().toISOString(), runId, output, checks };
  fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  for (const [name, values] of Object.entries(logs)) fs.writeFileSync(path.join(output, `${name}.log`), safeText(values.join('')));
  process.stdout.write(`${JSON.stringify({ ok: true, output, version: expected.version, mainAsar: checks.artifacts.main.asarSha256, monitorAsar: checks.artifacts.monitor.asarSha256, p16: checks.mainRuntime.p16.selected, rendererErrors: 0 })}\n`);
}

main().catch(error => {
  const failure = { ok: false, checkedAt: new Date().toISOString(), runId, output, error: String(error && error.stack || error), checks };
  try { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`); } catch (_) {}
  console.error(failure.error); process.exitCode = 1;
}).finally(async () => {
  if (activeClient) activeClient.close();
  for (const child of children) killTree(child);
  try { removeTemporary(); } catch (_) {}
});
