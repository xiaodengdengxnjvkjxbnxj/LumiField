'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const appExecutable = String(process.env.LF_NEW5_APP_EXE || '').trim();
const packagedMode = !!appExecutable;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(
  process.env.LF_NEW5_RUNTIME_OUT ||
  path.join(repo, 'test-results', 'lf-new5-runtime', runId)
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new5-runtime-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let child = null;
let cdp = null;

fs.mkdirSync(output, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(name, condition, detail) {
  assert.ok(condition, name + ': ' + JSON.stringify(detail));
  checks[name] = detail == null ? true : detail;
}

async function waitFor(fn, timeout = 30000, interval = 100) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timeout; last=' + JSON.stringify(last));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
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
    this.ws.onmessage = (event) => {
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
        rendererErrors.push(String(
          detail.exception && detail.exception.description ||
          detail.text ||
          'Renderer exception'
        ).slice(0, 1800));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        rendererErrors.push((message.params.args || []).map((arg) =>
          String(arg.value || arg.description || '')
        ).join(' ').slice(0, 1800));
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
      throw new Error(
        response.exceptionDetails.exception && response.exceptionDetails.exception.description ||
        response.exceptionDetails.text ||
        'Runtime.evaluate failed'
      );
    }
    return response.result && response.result.value;
  }

  call(fn, args = []) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')');
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function api(port, method, pathname, payload, token) {
  const response = await fetch('http://127.0.0.1:' + port + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  });
  return response.json();
}

async function screenshot(name) {
  try {
    const image = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, 15000);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    screenshots.push(file);
  } catch (error) {
    appLog.push('[New5 runtime screenshot skipped] ' + name + ': ' + String(error && error.message || error) + '\n');
  }
}

function staticAudit() {
  const preload = fs.readFileSync(path.join(repo, 'desktop', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repo, 'public', 'lf-auth-monitor.js'), 'utf8');
  pass('renderer bridge exposes status and parameterless acknowledgement only',
    /lfIntegrityStatus:\s*\(\)\s*=>/.test(preload) &&
      /lfAcknowledgeIntegrityWarning:\s*\(\)\s*=>/.test(preload),
    true);
  pass('renderer bridge exposes no integrity evidence report method',
    !/lf(?:Report|Submit|Send)Integrity|integrity-report|integrity\/report/i.test(preload),
    true);
  pass('warning acknowledgement is attached only to the confirm button',
    /button\.onclick\s*=\s*async function[\s\S]{0,400}lfAcknowledgeIntegrityWarning\(\)/.test(renderer) &&
      (renderer.match(/lfAcknowledgeIntegrityWarning\(\)/g) || []).length === 1,
    true);
}

async function startApp() {
  const port = await freePort();
  const command = packagedMode ? path.resolve(appExecutable) : electron;
  const args = [
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920',
  ];
  if (!packagedMode) args.unshift('.');
  child = spawn(command, args, {
    cwd: packagedMode ? path.dirname(command) : repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    }),
  });
  const collect = (chunk) => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) {
      rendererErrors.push(text.trim().slice(0, 1800));
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const list = await response.json();
    return list.find((item) =>
      item.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url)
    );
  }, 50000, 180);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(() => cdp.call(function() {
    return document.readyState === 'complete' &&
      !!window.desktopWindow &&
      typeof window.desktopWindow.lfIntegrityStatus === 'function' &&
      typeof window.desktopWindow.lfAcknowledgeIntegrityWarning === 'function' &&
      !!window.LFAuth;
  }), 50000, 120);
}

async function createAccountAndSessions() {
  const account = 'new5-runtime-' + Date.now() + '@example.com';
  const password = 'N5runtime' + crypto.randomBytes(8).toString('hex') + 'Z7';
  const registered = await cdp.call(async function(values) {
    var sent = await window.desktopWindow.lfSendCode({ account: values.account, purpose: 'register' });
    if (!sent || !sent.ok || !sent.localCode) return { sent: sent };
    var created = await window.desktopWindow.lfRegister({
      account: values.account,
      nickname: 'New5 Runtime',
      code: sent.localCode,
      password: values.password
    });
    if (!created || !created.ok) return { sent: sent, created: created };
    var logged = await window.desktopWindow.lfLogin({
      account: values.account,
      password: values.password,
      method: 'password',
      deviceType: 'pc',
      deviceName: 'New5 Runtime Main',
      locationAuthorized: true,
      location: 'Local Test'
    });
    return { sent: sent, created: created, logged: logged };
  }, [{ account, password }]);
  pass('main process owns a real authenticated session',
    registered.sent && registered.sent.ok &&
      registered.created && registered.created.ok &&
      registered.logged && registered.logged.ok &&
      !registered.logged.token &&
      !registered.logged.refreshToken,
    registered);

  const backend = await cdp.call(async function() {
    return window.desktopWindow.lfBackendStatus();
  });
  pass('runtime uses isolated local LF backend', backend && backend.ok && Number(backend.port) > 0, backend);

  const external = await api(backend.port, 'POST', '/v1/auth/login', {
    account,
    password,
    method: 'password',
    deviceType: 'pc',
    deviceName: 'New5 Runtime Reporter',
    locationAuthorized: true,
    location: 'Local Test',
  });
  pass('independent reporter session created for test evidence setup',
    external && external.ok && typeof external.token === 'string' && external.token.length > 20,
    { ok: external && external.ok, userId: external && external.user && external.user.id });
  return { account, password, backendPort: backend.port, reporterToken: external.token };
}

async function clickWarningButton() {
  const point = await cdp.call(function() {
    var button = document.getElementById('lf-integrity-warning-ack');
    if (!button) return null;
    var box = button.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      width: box.width,
      height: box.height
    };
  });
  pass('warning acknowledgement button is visible and clickable',
    point && point.width > 20 && point.height > 20,
    point);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function runRuntime() {
  const keys = await cdp.call(function() {
    return {
      names: Object.keys(window.desktopWindow).sort(),
      ackArity: window.desktopWindow.lfAcknowledgeIntegrityWarning.length,
    };
  });
  pass('runtime renderer has no integrity reporting capability',
    !keys.names.some((name) => /integrity/i.test(name) && /report|submit|send/i.test(name)) &&
      keys.names.includes('lfIntegrityStatus') &&
      keys.names.includes('lfAcknowledgeIntegrityWarning') &&
      keys.ackArity === 0,
    keys);

  const session = await createAccountAndSessions();
  const initial = await cdp.call(async function() {
    return window.desktopWindow.lfIntegrityStatus();
  });
  pass('runtime reports accurate packaged or source integrity status',
    initial && initial.ok &&
      initial.state === 'clean' &&
      initial.local &&
      (packagedMode
        ? initial.local.reason === 'VERIFIED' && initial.local.enforced === true
        : initial.local.reason === 'NOT_PACKAGED' && initial.local.enforced === false),
    initial);

  const deviceFile = path.join(userData, 'lf-device-id');
  const deviceId = await waitFor(() => {
    try {
      const value = fs.readFileSync(deviceFile, 'utf8').trim();
      return /^device-[a-f0-9]{32}$/.test(value) && value;
    } catch (_) {
      return null;
    }
  }, 5000, 50);
  const appVersion = String(initial.local.version || require('../package.json').version);
  const report = await api(session.backendPort, 'POST', '/v1/integrity/report', {
    deviceId,
    manifestId: 'runtime-' + crypto.randomBytes(12).toString('hex'),
    appVersion,
    changedFileId: 'app-asar',
    path: 'resources/app.asar',
    expectedHash: 'a'.repeat(64),
    actualHash: 'b'.repeat(64),
    eventType: 'hash_mismatch',
    observedAt: Date.now(),
    confirmed: true,
  }, session.reporterToken);
  pass('backend test setup creates first-warning state without renderer evidence',
    report && report.ok &&
      report.state === 'warned_pending_ack' &&
      report.warning &&
      report.warning.requiresAcknowledgement === true,
    report);

  const status = await cdp.call(async function() {
    return window.desktopWindow.lfIntegrityStatus();
  });
  pass('renderer status query is read-only and receives pending warning',
    status && status.ok &&
      status.state === 'warned_pending_ack' &&
      status.warning &&
      status.warning.requiresAcknowledgement === true,
    status);

  const warning = await waitFor(() => cdp.call(function() {
    var root = document.getElementById('lf-integrity-warning');
    if (!root) return null;
    return {
      message: document.getElementById('lf-integrity-warning-message').textContent,
      contact: document.getElementById('lf-integrity-warning-contact').textContent,
      button: document.getElementById('lf-integrity-warning-ack').textContent,
      active: root.isConnected,
    };
  }), 8000, 80);
  pass('warning renders the exact required text',
    warning.active &&
      warning.message === '您没有权限对此软件进行开发，如若继续您的账户将会被自动拉黑。' &&
      warning.contact === '如执意开发/进行二创，请联系作者：3599284614@qq.com / 15037841583@139.com。' &&
      warning.button === '我已知晓',
    warning);
  await screenshot('01-integrity-warning-before-confirm');

  await delay(700);
  const beforeClick = await api(
    session.backendPort,
    'GET',
    '/v1/integrity/status?deviceId=' + encodeURIComponent(deviceId),
    null,
    session.reporterToken
  );
  pass('warning remains pending and unacknowledged before the click',
    beforeClick.ok &&
      beforeClick.state === 'warned_pending_ack' &&
      beforeClick.warningAckAt == null &&
      !!(await cdp.call(function() { return document.getElementById('lf-integrity-warning'); })),
    beforeClick);

  await clickWarningButton();
  await waitFor(() => cdp.call(function() {
    return !document.getElementById('lf-integrity-warning');
  }), 8000, 80);
  const afterClick = await waitFor(async () => {
    const value = await api(
      session.backendPort,
      'GET',
      '/v1/integrity/status?deviceId=' + encodeURIComponent(deviceId),
      null,
      session.reporterToken
    );
    return value && value.state === 'warned' && value.warningAckAt && value;
  }, 8000, 100);
  pass('only the real confirm click acknowledges the warning',
    afterClick.ok &&
      afterClick.state === 'warned' &&
      Number(afterClick.warningAckAt) > 0 &&
      afterClick.warning &&
      afterClick.warning.requiresAcknowledgement === false,
    afterClick);
  await screenshot('02-integrity-warning-confirmed');
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function() { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (child && child.pid && child.exitCode == null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(3000),
    ]);
  }
  if (child && child.pid && child.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  staticAudit();
  await startApp();
  await runRuntime();
  pass('rendererErrors=0', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    runId,
    output,
    checkCount: Object.keys(checks).length,
    checks,
    screenshots,
    rendererErrors,
  };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    output,
    checkCount: result.checkCount,
    screenshots: screenshots.length,
    rendererErrors: rendererErrors.length,
  }, null, 2));
}

run().catch((error) => {
  const failure = {
    ok: false,
    error: String(error && error.stack || error),
    output,
    checks,
    screenshots,
    rendererErrors,
  };
  try { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify(failure, null, 2)); } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(output, 'app.log'), appLog.join('')); } catch (_) {}
  await stopApp();
});
