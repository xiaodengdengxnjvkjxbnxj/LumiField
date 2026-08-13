'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runtimeApp = String(process.env.LF_NEW6_APP_PATH || '.').trim() || '.';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW6_OUT || path.join(repo, 'test-results', 'lf-new6-runtime-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new6-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });

function pass(name, condition, detail) {
  assert.ok(condition, name + (detail == null ? '' : ': ' + JSON.stringify(detail)));
  checks[name] = detail == null ? true : detail;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(fn, timeout = 30000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out; last=' + JSON.stringify(last));
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression, awaitPromise:true, returnByValue:true, userGesture:true,
    });
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result && response.result.value;
  }
  call(fn, args) { return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')'); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find(target => target.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 45000, 200);
}
async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
}

function staticAudit() {
  const schema = require(path.join(repo, 'public', 'lumifield-preset-schema.js'));
  const taskSource = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const fixture = {
    type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, name:'功能6 portable',
    visual:{
      intensity:1.26, backgroundColorMode:'custom', backgroundColor:'#123456', backgroundOpacity:.43,
      shelfShowPodcasts:false, shelfMergeCollections:true, shelfAngleYManual:true,
    },
    wallpaper:{ media:{ type:'image', src:'file:///C:/Users/private/wallpaper.png' } },
    accessToken:'SECRET_NEW6',
  };
  const normalized = schema.normalize(fixture);
  const clean = schema.sanitizeForShare(normalized.canonical);
  const text = JSON.stringify(clean.canonical);
  pass('portable background and shelf fields survive canonical sanitization',
    clean.canonical.visual.backgroundColorMode === 'custom' &&
    clean.canonical.visual.backgroundColor === '#123456' &&
    clean.canonical.visual.backgroundOpacity === .43 &&
    clean.canonical.visual.shelfShowPodcasts === false &&
    clean.canonical.visual.shelfMergeCollections === true &&
    clean.canonical.visual.shelfAngleYManual === true, clean.canonical.visual);
  pass('private wallpaper and token never enter shared canonical',
    !/SECRET_NEW6|file:|Users[\\/]+private|wallpaper/i.test(text), clean);
  pass('renderer calls the preload bridge with direct transport arguments',
    /lfPresetShareCreate\(sanitized\)/.test(taskSource) &&
    /lfPresetShareRedeem\(code\)/.test(taskSource) &&
    /lfPresetShareRevoke\(entry\.shareId\)/.test(taskSource) &&
    /lfPresetShareMine\(\)/.test(taskSource), true);
  pass('user archive UI retains all actions and adds share-code controls',
    ['应用','保存','命名','导出','删除','分享'].every(label => htmlSource.includes('>' + label + '</button>')) &&
    /id="lf-preset-share-code"/.test(htmlSource) && /applyPresetShareCode/.test(htmlSource), true);
  return { schema, fixture:normalized.canonical };
}

async function startApp() {
  const port = await freePort();
  app = spawn(electron, [runtimeApp, '--user-data-dir=' + userData, '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], {
    cwd:runtimeApp === '.' ? repo : path.dirname(path.resolve(runtimeApp)),
    env:Object.assign({}, process.env, {
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true',
      LUMIFIELD_SKIP_SPLASH:'1',
      LF_ALLOW_LOCAL_CODES:'1',
      LF_PRESET_SHARE_ALLOW_LOCAL_TEST:'1',
      LF_REMOTE_API_URL:' ',
      LF_BOOTSTRAP_ADMIN_EMAILS:'new6-admin@example.test',
      LF_BOOTSTRAP_ADMIN_PASSWORD:'New6BootstrapAdmin123',
      LF_MAIL_HOST:' ',
      LF_MAIL_USER:' ',
      LF_MAIL_PASSWORD:' ',
    }),
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
  });
  const collect = chunk => {
    const value = String(chunk);
    appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.trim().slice(0, 1800));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(port);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LumiFieldCanonicalPresets &&
      window.LumiFieldCanonicalPresetSchema && window.LumiFieldTask13 && window.fx &&
      window.desktopWindow && typeof window.desktopWindow.lfPresetShareCreate === 'function' &&
      typeof window.shareUserFxArchive === 'function' && document.getElementById('lf-preset-share-code');
  }), 50000, 120);
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function () { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  }
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  app = null;
}

async function run() {
  const fixtures = staticAudit();
  await startApp();

  const login = await cdp.call(async function () {
    return window.desktopWindow.lfLogin({
      account:'new6-admin@example.test',
      password:'New6BootstrapAdmin123',
      deviceType:'pc',
      deviceName:'New6 runtime smoke',
    });
  });
  pass('runtime has an authenticated main-process session', login && login.ok === true && !login.token && !login.refreshToken, login);

  const source = await cdp.call(async function (fixture) {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    var auth = document.getElementById('lf-auth-root'); if (auth) auth.classList.remove('show');
    var splash = document.getElementById('splash'); if (splash) splash.style.display = 'none';
    window.fx.backgroundMedia = { type:'image', src:'file:///C:/Users/private/new6.png', id:'private-new6' };
    window.fx.backgroundImage = 'file:///C:/Users/private/new6.png';
    var applied = window.LumiFieldCanonicalPresets.apply(Object.assign({}, fixture, {
      presetId:'lf-new6-source-preset', name:'功能6 分享源',
    }), { createArchive:true, importWallpaper:false, presetId:'lf-new6-source-preset', source:'new6-runtime' });
    var archive = window.LumiFieldCanonicalPresets.listArchives().find(function (item) { return item.presetId === 'lf-new6-source-preset'; });
    var sensitive = {};
    Object.keys(localStorage).filter(function (key) { return /auth|cookie|token|music.*login|netease|qq.*login/i.test(key); })
      .sort().forEach(function (key) { sensitive[key] = localStorage.getItem(key); });
    var authStatus = await window.desktopWindow.lfAuthStatus('main-process', {});
    var music = await Promise.all(['netease','qq'].map(async function (provider) {
      try {
        var status = await window.desktopWindow.getMusicPlatformLoginStatus(provider);
        return { provider:provider, loggedIn:!!(status && status.loggedIn) };
      } catch (_) { return { provider:provider, loggedIn:false }; }
    }));
    return {
      applied:applied, archive:archive, sensitive:sensitive, authUser:authStatus && authStatus.user && authStatus.user.id,
      music:music, media:window.fx.backgroundMedia,
    };
  }, [fixtures.fixture]);
  pass('known portable preset is saved without replacing private wallpaper media',
    source.applied === true && source.archive && /private-new6/.test(JSON.stringify(source.media)), source);

  const created = await cdp.call(async function (index) {
    await Promise.all([window.shareUserFxArchive(index), window.shareUserFxArchive(index)]);
    var slot = window.userFxArchives[index];
    var state = window.getUserFxArchiveShareState(index);
    var mine = await window.desktopWindow.lfPresetShareMine();
    var modal = document.getElementById('lf-t13-share-dialog');
    return {
      state:state,
      code:modal && modal.querySelector('.lf-t13-share-value').value,
      mine:mine,
      actionLabels:Array.from(document.querySelectorAll('.user-archive-slot[data-slot="' + index + '"] .user-archive-actions button')).map(function (button) { return button.textContent.trim(); }),
      slotName:slot && slot.name,
    };
  }, [source.archive.index]);
  pass('double share is de-duplicated and returns a Crockford LF code',
    created.state && created.state.status === 'active' &&
    /^LF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(created.code) &&
    created.mine && created.mine.ok && created.mine.shares.length === 1, created);
  pass('saved card keeps all six actions',
    ['应用','保存','命名','导出','删除','分享'].every(label => created.actionLabels.includes(label)), created.actionLabels);

  await cdp.call(function () {
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(true);
    if (typeof window.setFxPanelTab === 'function') window.setFxPanelTab('presets');
    return true;
  });
  await screenshot('01-share-code-and-user-archive-actions');

  const redeemed = await cdp.call(async function (code, before) {
    var input = document.getElementById('lf-preset-share-code');
    var button = input.nextElementSibling;
    var archiveCount = window.LumiFieldCanonicalPresets.listArchives().length;
    input.value = code;
    await window.applyPresetShareCode(button);
    var sensitive = {};
    Object.keys(localStorage).filter(function (key) { return /auth|cookie|token|music.*login|netease|qq.*login/i.test(key); })
      .sort().forEach(function (key) { sensitive[key] = localStorage.getItem(key); });
    var authStatus = await window.desktopWindow.lfAuthStatus('main-process', {});
    var music = await Promise.all(['netease','qq'].map(async function (provider) {
      try {
        var status = await window.desktopWindow.getMusicPlatformLoginStatus(provider);
        return { provider:provider, loggedIn:!!(status && status.loggedIn) };
      } catch (_) { return { provider:provider, loggedIn:false }; }
    }));
    return {
      archiveBefore:archiveCount,
      archiveAfter:window.LumiFieldCanonicalPresets.listArchives().length,
      current:window.LumiFieldCanonicalPresets.getCurrentPresetId(),
      visual:{
        backgroundColorMode:window.fx.backgroundColorMode,
        backgroundColor:window.fx.backgroundColor,
        backgroundOpacity:window.fx.backgroundOpacity,
        shelfShowPodcasts:window.fx.shelfShowPodcasts,
        shelfMergeCollections:window.fx.shelfMergeCollections,
        shelfAngleYManual:window.fx.shelfAngleYManual,
      },
      media:window.fx.backgroundMedia,
      sensitiveEqual:JSON.stringify(sensitive) === JSON.stringify(before.sensitive),
      authUser:authStatus && authStatus.user && authStatus.user.id,
      music:music,
      buttonEnabled:!(document.querySelector('#lf-preset-share-code + button') || button).disabled,
    };
  }, [created.code, source]);
  pass('redeem imports one archive and immediately applies all portable fields',
    redeemed.archiveAfter === redeemed.archiveBefore + 1 && /^lf-share-/.test(redeemed.current) &&
    redeemed.visual.backgroundColorMode === 'custom' && redeemed.visual.backgroundColor === '#123456' &&
    Math.abs(redeemed.visual.backgroundOpacity - .43) < .001 &&
    redeemed.visual.shelfShowPodcasts === false && redeemed.visual.shelfMergeCollections === true &&
    redeemed.visual.shelfAngleYManual === true && redeemed.buttonEnabled, redeemed);
  pass('redeem leaves account, music login and private wallpaper unchanged',
    redeemed.sensitiveEqual && redeemed.authUser === source.authUser &&
    JSON.stringify(redeemed.music) === JSON.stringify(source.music) &&
    /private-new6/.test(JSON.stringify(redeemed.media)), redeemed);

  const rollback = await cdp.call(async function (code) {
    var api = window.LumiFieldCanonicalPresets;
    var before = {
      current:api.getCurrentPresetId(),
      archives:api.listArchives().length,
      intensity:window.fx.intensity,
      backgroundColor:window.fx.backgroundColor,
      stored:localStorage.getItem('lumifield-task13-current-preset-v1'),
    };
    var originalApply = api.apply;
    api.apply = function (payload, options) {
      return originalApply.call(api, payload, Object.assign({}, options, { failAtStage:'after-apply' }));
    };
    var input = document.getElementById('lf-preset-share-code');
    try {
      input.value = code;
      await window.applyPresetShareCode(input.nextElementSibling);
    } finally {
      api.apply = originalApply;
    }
    var after = {
      current:api.getCurrentPresetId(),
      archives:api.listArchives().length,
      intensity:window.fx.intensity,
      backgroundColor:window.fx.backgroundColor,
      stored:localStorage.getItem('lumifield-task13-current-preset-v1'),
    };
    return { before:before, after:after, toast:document.getElementById('toast').textContent };
  }, [created.code]);
  pass('share apply failure rolls back visual, archive and current preset atomically',
    JSON.stringify(rollback.before) === JSON.stringify(rollback.after) && /回滚/.test(rollback.toast), rollback);

  const revoked = await cdp.call(async function (index, code) {
    var originalConfirm = window.confirm;
    window.confirm = function () { return true; };
    await window.revokeUserFxArchiveShare(index);
    window.confirm = originalConfirm;
    var state = window.getUserFxArchiveShareState(index);
    var input = document.getElementById('lf-preset-share-code');
    var before = window.LumiFieldCanonicalPresets.listArchives().length;
    input.value = code;
    await window.applyPresetShareCode(input.nextElementSibling);
    var toast = document.getElementById('toast').textContent;
    var after = window.LumiFieldCanonicalPresets.listArchives().length;
    input.value = 'LF-0000-0000-0000';
    await window.applyPresetShareCode(input.nextElementSibling);
    var missingToast = document.getElementById('toast').textContent;
    return { state:state, toast:toast, missingToast:missingToast, before:before, after:after };
  }, [source.archive.index, created.code]);
  pass('revoked and missing codes show distinct accurate errors without importing',
    revoked.state && revoked.state.status === 'revoked' && revoked.before === revoked.after &&
    /撤销/.test(revoked.toast) && /不存在/.test(revoked.missingToast), revoked);
  await screenshot('02-revoked-share-state');

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = { ok:true, runId, evidenceDir, userData, runtimeApp:path.resolve(runtimeApp), checks, screenshots, rendererErrors };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join(''));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = { ok:false, runId, evidenceDir, error:String(error && error.stack || error), checks, screenshots, rendererErrors };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join(''));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
