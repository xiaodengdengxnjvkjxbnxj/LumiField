'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const { LFBackend } = require('../desktop/lf-backend');

const projectRoot = path.resolve(__dirname, '..');
const monitorConfigPath = path.join(projectRoot, 'build', 'monitor-builder.json');
const packagePath = path.join(projectRoot, 'package.json');
const executablePath = path.join(projectRoot, 'dist-monitor', 'win-unpacked', 'LF后台监控.exe');
const electronPath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const asarPath = path.join(projectRoot, 'dist-monitor', 'win-unpacked', 'resources', 'app.asar');
const mainPreloadPath = path.join(projectRoot, 'desktop', 'preload.js');
const monitorMainPath = path.join(projectRoot, 'desktop', 'lf-monitor-main.js');
const artifactRoot = path.join(projectRoot, 'dist-monitor', 'smoke-artifacts', new Date().toISOString().replace(/[:.]/g, '-'));

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function psEscape(value) { return String(value).replace(/'/g, "''"); }
function runPowerShell(source) {
  const prefix = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $OutputEncoding=[Console]::OutputEncoding;";
  const encoded = Buffer.from(`${prefix}\n${source}`, 'utf16le').toString('base64');
  return childProcess.execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true }).trim();
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function killTree(processId) {
  if (!processId) return;
  childProcess.spawnSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
function waitForExit(child, timeout = 8000) {
  if (!child || child.exitCode != null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, timeout);
    const onExit = () => { clearTimeout(timer); resolve(true); };
    child.once('exit', onExit);
  });
}
function safeRemoveTemp(directory) {
  const resolved = path.resolve(directory);
  const temp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temp}${path.sep}`) || !path.basename(resolved).startsWith('lf-monitor-smoke-')) {
    throw new Error(`Refusing to remove non-smoke directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

class CDPClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
  }
  async connect() {
    assert.equal(typeof WebSocket, 'function', 'Node.js with global WebSocket support is required');
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 8000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket failed')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (_) { return; }
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        this.errors.push(detail.exception && detail.exception.description || detail.text || 'Renderer exception');
      }
      if (message.method === 'Log.entryAdded' && message.params && message.params.entry && message.params.entry.level === 'error') {
        this.errors.push(message.params.entry.text || 'Renderer log error');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        this.errors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
    });
    this.socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error(`${entry.method}: CDP connection closed`));
      this.pending.clear();
    });
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
    await this.evaluate(`(() => {
      window.__lfMonitorSmokeErrors = [];
      window.addEventListener('error', event => window.__lfMonitorSmokeErrors.push(String(event.error && event.error.stack || event.message || 'window error')));
      window.addEventListener('unhandledrejection', event => window.__lfMonitorSmokeErrors.push(String(event.reason && event.reason.stack || event.reason || 'unhandled rejection')));
      return true;
    })()`);
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      throw new Error(detail.exception && detail.exception.description || detail.text || 'Renderer evaluation failed');
    }
    return response.result ? response.result.value : undefined;
  }
  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }
  close() {
    try { this.socket.close(); } catch (_) {}
  }
}

async function waitForTarget(port, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      const target = targets.find(item => item.type === 'page' && /lf-monitor\.html/i.test(item.url));
      if (target && target.webSocketDebuggerUrl) return target;
    } catch (_) {}
    await delay(150);
  }
  throw new Error('Monitor renderer target did not appear');
}

async function waitFor(client, expression, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await client.evaluate(expression)) return; } catch (_) {}
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function maskedChildEnvironment(bootstrap) {
  const result = { ...process.env };
  Object.keys(result).filter(key => /^LF_/i.test(key)).forEach(key => { result[key] = ' '; });
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const keys = fs.readFileSync(envFile, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm);
    for (const match of keys) result[match[1]] = ' ';
  }
  return Object.assign(result, bootstrap, {
    LF_REMOTE_API_URL: ' ',
    LF_ALLOW_LOCAL_CODES: '0',
  });
}

async function launchMonitor(options) {
  const port = await freePort();
  const chromiumLog = path.join(artifactRoot, `${options.label}-chromium.log`);
  const child = childProcess.spawn(executablePath, [
    `--user-data-dir=${options.userData}`,
    `--remote-debugging-port=${port}`,
    '--enable-logging',
    `--log-file=${chromiumLog}`,
  ], {
    cwd: options.tempRoot,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    const target = await waitForTarget(port);
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();
    await waitFor(client, `document.readyState === 'complete' && !!window.LFMonitor && !!document.getElementById('monitor-login')`, 'monitor DOM');
    return { child, client, target, logs: () => ({ stdout, stderr, chromiumLog }) };
  } catch (error) {
    killTree(child.pid);
    throw new Error(`${error.message}; stdout=${stdout.slice(-1200)}; stderr=${stderr.slice(-1200)}`);
  }
}

async function main() {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const checks = {};
  let tempRoot = '';
  let running = null;
  try {
    const monitorConfig = JSON.parse(fs.readFileSync(monitorConfigPath, 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const monitorMain = fs.readFileSync(monitorMainPath, 'utf8');
    const mainPreload = fs.readFileSync(mainPreloadPath, 'utf8');

    assert.equal(monitorConfig.appId, 'com.lumifield.monitor');
    assert.notEqual(monitorConfig.appId, packageJson.build.appId);
    assert.equal(monitorConfig.productName, 'LF后台监控');
    assert.equal(monitorConfig.win.executableName, 'LF后台监控');
    assert.equal(monitorConfig.extraMetadata.main, 'desktop/lf-monitor-main.js');
    assert(monitorMain.includes("app.setAppUserModelId('com.lumifield.monitor')"));
    assert(monitorMain.includes('contextIsolation: true') && monitorMain.includes('nodeIntegration: false') && monitorMain.includes('sandbox: true'));
    checks.independentConfiguration = true;

    const forbiddenMainPreload = mainPreload.match(/(?:ipcRenderer\.(?:invoke|send|on)\(\s*['"]monitor-|\blfMonitorAdmin\b|\badminDashboard\b|\bopenMonitor\b)/g) || [];
    assert.deepEqual(forbiddenMainPreload, []);
    checks.mainPreloadHasNoAdminIPC = true;

    assert(monitorMain.includes('crypto.randomBytes(8)'));
    assert(monitorMain.includes("flag: 'wx'"));
    assert(monitorMain.includes('movedPrevious') && monitorMain.includes('fs.renameSync(backup, target)'));
    checks.atomicSessionReplacement = true;
    assert(!monitorMain.includes('monitor-save-login-service'));
    assert(!monitorMain.includes('safeOAuthTestUrl'));
    assert(!monitorMain.includes('BLOCKED_EXTERNAL_CONFIG'));
    checks.oauthConfigurationRemovedFromMain = true;

    assert(fs.existsSync(executablePath), `Missing ${executablePath}`);
    assert(fs.existsSync(asarPath), `Missing ${asarPath}`);
    const entries = new Set(asar.listPackage(asarPath).map(item => item.replace(/\\/g, '/').replace(/^\//, '')));
    [
      'desktop/lf-monitor-main.js',
      'desktop/lf-monitor-preload.js',
      'desktop/lf-secure-login-config.js',
      'desktop/lf-oauth-providers.js',
      'public/lf-monitor.html',
      'public/lf-monitor.js',
    ].forEach(entry => assert(entries.has(entry), `Packaged module missing: ${entry}`));
    const packagedMetadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    assert.equal(packagedMetadata.name, 'lumifield-monitor');
    assert.equal(packagedMetadata.productName, 'LF后台监控');
    assert.equal(packagedMetadata.main, 'desktop/lf-monitor-main.js');
    checks.packagedEntryPoints = true;

    const metadataScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
function IconHash([string]$Path) {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Path)
  $bitmap = $icon.ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash($stream.ToArray())).Replace('-', '')
  $sha.Dispose(); $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose()
  return $hash
}
$exe = Get-Item -LiteralPath '${psEscape(executablePath)}'
$version = $exe.VersionInfo
[pscustomobject]@{
  fileVersion = $version.FileVersion
  productVersion = $version.ProductVersion
  productName = $version.ProductName
  fileDescription = $version.FileDescription
  originalFilename = $version.OriginalFilename
  monitorIconHash = IconHash '${psEscape(executablePath)}'
  electronIconHash = IconHash '${psEscape(electronPath)}'
} | ConvertTo-Json -Compress
`;
    const metadata = JSON.parse(runPowerShell(metadataScript));
    assert.equal(metadata.fileVersion, packageJson.version);
    assert.equal(metadata.productVersion, packageJson.version);
    assert.equal(metadata.productName, 'LF后台监控');
    assert.equal(metadata.fileDescription, 'LF后台监控');
    assert.equal(metadata.originalFilename, 'LF后台监控.exe');
    assert.notEqual(metadata.monitorIconHash, metadata.electronIconHash);
    checks.executableMetadata = metadata;

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-monitor-smoke-'));
    const appData = path.join(tempRoot, 'AppData');
    const localAppData = path.join(tempRoot, 'LocalAppData');
    const userData = path.join(tempRoot, 'MonitorUserData');
    const sharedDirectory = path.join(appData, 'LumiField');
    fs.mkdirSync(sharedDirectory, { recursive: true });
    fs.mkdirSync(localAppData, { recursive: true });
    fs.mkdirSync(userData, { recursive: true });
    const bootstrap = {
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      LF_SHARED_USER_DATA_DIR: sharedDirectory,
      LF_BOOTSTRAP_ADMIN_EMAILS: 'admin-monitor@example.test',
      LF_BOOTSTRAP_ADMIN_PASSWORD: 'BootstrapAdmin123',
    };
    const backend = new LFBackend({
      dbPath: path.join(sharedDirectory, 'lf-backend.sqlite3'),
      appVersion: packageJson.version,
      env: { ...bootstrap, LF_ALLOW_LOCAL_CODES: '1' },
      allowLocalCodes: true,
    });
    try {
      const sent = await backend.sendVerificationCode({ target: 'normal-monitor@example.test', purpose: 'register', requestIp: '127.0.0.1' });
      assert(sent.ok && sent.localCode);
      const registered = backend.register({ account: 'normal-monitor@example.test', password: 'NormalUser123', code: sent.localCode });
      assert(registered.ok && registered.user.role === 'user');
    } finally { backend.close(); }

    const childEnv = maskedChildEnvironment(bootstrap);
    running = await launchMonitor({ label: 'initial', tempRoot, userData, env: childEnv });
    await waitFor(running.client, `document.getElementById('monitor-login-status').textContent.length > 0`, 'fresh auth status');
    const fresh = await running.client.evaluate(`(() => ({
      title: document.title,
      bridge: ['login','authStatus','dashboard'].every(name => typeof window.LFMonitor[name] === 'function') && typeof window.LFMonitor.saveLoginService === 'undefined',
      loginVisible: !document.getElementById('monitor-login').hidden,
      deniedHidden: document.getElementById('monitor-denied').hidden,
      contentHidden: document.getElementById('monitor-content').hidden,
      loginHandler: typeof document.getElementById('monitor-login-submit').onclick === 'function',
      stylesheets: document.styleSheets.length
    }))()`);
    assert(fresh.bridge && fresh.loginVisible && fresh.deniedHidden && fresh.contentHidden && fresh.loginHandler);
    assert(fresh.stylesheets >= 2);
    await running.client.screenshot(path.join(artifactRoot, '01-fresh-login.png'));
    checks.freshLoginGate = fresh;

    const directUserGate = await running.client.evaluate(`window.LFMonitor.login({account:'normal-monitor@example.test',password:'NormalUser123'})`);
    assert.equal(directUserGate.ok, false);
    assert.equal(directUserGate.error, 'FORBIDDEN');
    await running.client.evaluate(`(() => {
      document.getElementById('monitor-account').value='normal-monitor@example.test';
      document.getElementById('monitor-password').value='NormalUser123';
      document.getElementById('monitor-login-submit').click();
      return true;
    })()`);
    await waitFor(running.client, `!document.getElementById('monitor-denied').hidden`, 'ordinary-user denial');
    const denied = await running.client.evaluate(`(() => ({
      deniedVisible: !document.getElementById('monitor-denied').hidden,
      contentHidden: document.getElementById('monitor-content').hidden,
      loginHidden: document.getElementById('monitor-login').hidden
    }))()`);
    assert(denied.deniedVisible && denied.contentHidden && denied.loginHidden);
    await running.client.screenshot(path.join(artifactRoot, '02-ordinary-user-denied.png'));
    checks.ordinaryUserDenied = { directError: directUserGate.error, ui: denied };

    await running.client.evaluate(`(() => {
      document.getElementById('monitor-denied-back').click();
      document.getElementById('monitor-account').value='admin-monitor@example.test';
      document.getElementById('monitor-password').value='BootstrapAdmin123';
      document.getElementById('monitor-login-submit').click();
      return true;
    })()`);
    await waitFor(running.client, `!document.getElementById('monitor-content').hidden && document.getElementById('monitor-stats').children.length > 0`, 'administrator dashboard');
    const admin = await running.client.evaluate(`(() => ({
      contentVisible: !document.getElementById('monitor-content').hidden,
      loginHidden: document.getElementById('monitor-login').hidden,
      usersRendered: document.getElementById('monitor-users').children.length,
      statsRendered: document.getElementById('monitor-stats').children.length,
      serviceCards: document.querySelectorAll('#monitor-login-services .service-card').length,
      hasWechatConfig: !!document.querySelector('[data-config-provider="wechat"]'),
      hasQqConfig: !!document.querySelector('[data-config-provider="qq"]'),
      oauthTestButtons: document.querySelectorAll('#monitor-login-services [data-service="wechat"],#monitor-login-services [data-service="qq"],[data-service-action="test-login"]').length,
      configForms: document.querySelectorAll('#monitor-login-services [data-config-provider],[data-service-save]').length,
      servicesText: document.getElementById('monitor-login-services').innerText
    }))()`);
    assert(admin.contentVisible && admin.loginHidden && admin.usersRendered >= 2 && admin.statsRendered > 0);
    assert.equal(admin.serviceCards, 1);
    assert(!admin.hasWechatConfig && !admin.hasQqConfig && admin.oauthTestButtons === 0 && admin.configForms === 0);
    assert(!admin.servicesText.includes('BLOCKED_EXTERNAL_CONFIG'));
    checks.adminDashboard = admin;

    const services = await running.client.evaluate(`window.LFMonitor.dashboard()`);
    assert(services.ok && services.loginServices && services.loginServices.email);
    assert.deepEqual(Object.keys(services.loginServices), ['email']);
    await running.client.evaluate(`document.getElementById('monitor-refresh').click()`);
    await waitFor(running.client, `document.querySelectorAll('#monitor-login-services .service-card').length === 1`, 'email-only login service render');
    await running.client.evaluate(`document.querySelector('[data-tab="services"]').click()`);
    await running.client.screenshot(path.join(artifactRoot, '03-admin-email-service-only.png'));
    checks.oauthConfigurationRemoved = { renderedServiceCards: 1, providers: Object.keys(services.loginServices) };

    const inPageErrors = await running.client.evaluate(`window.__lfMonitorSmokeErrors.slice()`);
    assert.deepEqual(inPageErrors, []);
    assert.deepEqual(running.client.errors, []);
    checks.rendererErrorsInitial = [];
    const initialLogs = running.logs();
    running.client.evaluate(`window.LFMonitor.close()`).catch(() => {});
    const initialExited = await waitForExit(running.child);
    running.client.close();
    if (!initialExited) killTree(running.child.pid);
    running = null;
    await delay(500);
    fs.writeFileSync(path.join(artifactRoot, 'initial-stdout.log'), initialLogs.stdout);
    fs.writeFileSync(path.join(artifactRoot, 'initial-stderr.log'), initialLogs.stderr);

    running = await launchMonitor({ label: 'session-relaunch', tempRoot, userData, env: childEnv });
    try {
      await waitFor(running.client, `!document.getElementById('monitor-content').hidden && document.getElementById('monitor-stats').children.length > 0`, 'persisted administrator session');
    } catch (error) {
      const state = await running.client.evaluate(`(async () => ({
        auth: await window.LFMonitor.authStatus(),
        loginHidden: document.getElementById('monitor-login').hidden,
        deniedHidden: document.getElementById('monitor-denied').hidden,
        contentHidden: document.getElementById('monitor-content').hidden,
        status: document.getElementById('monitor-login-status').textContent,
        errors: window.__lfMonitorSmokeErrors.slice()
      }))()`);
      throw new Error(`${error.message}; relaunch=${JSON.stringify(state)}`);
    }
    const relaunched = await running.client.evaluate(`(() => ({
      contentVisible: !document.getElementById('monitor-content').hidden,
      loginHidden: document.getElementById('monitor-login').hidden,
      errors: window.__lfMonitorSmokeErrors.slice()
    }))()`);
    assert(relaunched.contentVisible && relaunched.loginHidden);
    assert.deepEqual(relaunched.errors, []);
    assert.deepEqual(running.client.errors, []);
    await running.client.screenshot(path.join(artifactRoot, '04-session-relaunch.png'));
    checks.encryptedSessionRelaunch = true;
    const relaunchLogs = running.logs();
    running.client.evaluate(`window.LFMonitor.close()`).catch(() => {});
    const relaunchExited = await waitForExit(running.child);
    running.client.close();
    if (!relaunchExited) killTree(running.child.pid);
    running = null;
    fs.writeFileSync(path.join(artifactRoot, 'relaunch-stdout.log'), relaunchLogs.stdout);
    fs.writeFileSync(path.join(artifactRoot, 'relaunch-stderr.log'), relaunchLogs.stderr);

    const result = { ok: true, product: 'LF后台监控', version: packageJson.version, executablePath, artifactRoot, tempUserData: userData, checks };
    fs.writeFileSync(path.join(artifactRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (!process.env.LF_MONITOR_SMOKE_KEEP_TEMP) safeRemoveTemp(tempRoot);
  } catch (error) {
    if (running) {
      try { running.client.close(); } catch (_) {}
      killTree(running.child && running.child.pid);
    }
    const result = { ok: false, error: error && error.stack || String(error), executablePath, artifactRoot, tempRoot, checks };
    try { fs.mkdirSync(artifactRoot, { recursive: true }); fs.writeFileSync(path.join(artifactRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`); } catch (_) {}
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

main();
