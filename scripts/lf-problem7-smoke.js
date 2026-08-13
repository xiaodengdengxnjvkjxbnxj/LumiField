'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedArg = process.argv.find(value => value.startsWith('--installed-exe='));
const installedExecutable = String(process.env.LF_PROBLEM7_EXECUTABLE || (installedArg ? installedArg.slice('--installed-exe='.length) : '')).trim();
const launchExecutable = installedExecutable ? path.resolve(installedExecutable) : electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM7_OUT || path.join(repo, 'test-results', 'lf-problem7-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem7-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(details)}`}`);
  checks[name] = details == null ? true : details;
  return details;
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

async function waitFor(fn, timeout = 45000, interval = 100) {
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
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 3000));
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        const text = (message.params.args || []).map(arg => arg.value || arg.description || '').join(' ');
        if (text) rendererErrors.push(`console.error: ${text}`.slice(0, 3000));
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

  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
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
    return response.result && response.result.value;
  }

  call(fn, args = []) {
    return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

function staticAudit() {
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const fixes = fs.readFileSync(path.join(repo, 'public', 'lumifield-fixes-v2.js'), 'utf8');
  const providers = fs.readFileSync(path.join(repo, 'public', 'wallpaper-providers.js'), 'utf8');
  const all = index + fixes + providers;
  const legacyClearStart = index.indexOf('async function clearCustomBackgroundImage');
  const legacyClearEnd = index.indexOf('\nfunction setCustomBackgroundMedia', legacyClearStart);
  const legacyClear = legacyClearStart >= 0 && legacyClearEnd > legacyClearStart
    ? index.slice(legacyClearStart, legacyClearEnd)
    : '';
  pass('atomic wallpaper state API is shipped',
    /LumiFieldWallpaperState/.test(all) &&
    /\bstatus\s*[:=]/.test(all) &&
    /\brestore\s*[:=]/.test(all) &&
    /\bclear\s*[:=]/.test(all));
  pass('wallpaper cleanup includes URL revocation and persistent deletion',
    /revokeObjectURL/.test(all) &&
    /objectStore\([^)]*\)\.delete|\.remove\s*\(|\bremove\s*\([^)]*target/.test(all));
  pass('wallpaper cleanup covers image video CSS and resource disposal',
    /backgroundImage\s*=\s*['"]none['"]|removeProperty\([^)]*(?:background|wallpaper)/.test(all) &&
    /removeAttribute\(['"]src['"]\)/.test(all) &&
    /\.pause\s*\(\)/.test(all) &&
    /\.dispose\s*\(\)/.test(all));
  pass('legacy clear entry is asynchronous and delegates atomic cleanup',
    !!legacyClear &&
    /clearLumiFieldWallpaperBackgrounds|LumiFieldWallpaperState|clearCustomBackgroundMedia/.test(legacyClear));
  return {
    indexBytes: Buffer.byteLength(index),
    fixesBytes: Buffer.byteLength(fixes),
    providersBytes: Buffer.byteLength(providers),
  };
}

function findFfmpeg() {
  const explicit = String(process.env.LF_FFMPEG || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const apps = path.join(process.env.LOCALAPPDATA || '', 'JianyingPro', 'Apps');
  if (!fs.existsSync(apps)) return '';
  return fs.readdirSync(apps, { withFileTypes:true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(apps, entry.name, 'ffmpeg.exe'))
    .filter(candidate => fs.existsSync(candidate))
    .sort()
    .reverse()[0] || '';
}

function makeVideoFixture(name, color) {
  const ffmpeg = findFfmpeg();
  assert.ok(ffmpeg, 'real ffmpeg fixture generator was not found');
  const file = path.join(evidenceDir, name);
  const input = `color=c=${String(color || 'blue').replace(/[^#a-z0-9]/gi, '')}:s=64x48:d=0.7:r=12`;
  const common = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', input, '-an'];
  let result = spawnSync(ffmpeg, common.concat(['-c:v', 'h264_mf', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', file]), {
    windowsHide:true,
    encoding:'utf8',
  });
  if (result.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size <= 0) {
    result = spawnSync(ffmpeg, common.concat(['-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', file]), {
      windowsHide:true,
      encoding:'utf8',
    });
  }
  assert.ok(result.status === 0 && fs.existsSync(file) && fs.statSync(file).size > 0,
    `failed to generate real video fixture: ${result.stderr || result.stdout || result.status}`);
  return {
    name,
    type:'video/mp4',
    size:fs.statSync(file).size,
    base64:fs.readFileSync(file).toString('base64'),
    file,
  };
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target =>
      target.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url));
  }, 50000, 160);
}

async function startApp() {
  const port = await freePort();
  const args = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,900',
  ];
  if (launchMode === 'source') args.unshift('.');
  app = spawn(launchExecutable, args, {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
    }),
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(port);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' &&
      typeof fx !== 'undefined' &&
      typeof goHome === 'function' &&
      window.LumiFieldWallpaperState &&
      typeof window.LumiFieldWallpaperState.clear === 'function' &&
      typeof window.LumiFieldWallpaperState.restore === 'function' &&
      typeof window.LumiFieldWallpaperState.status === 'function';
  }), 60000, 160);
}

async function installProbe() {
  return cdp.call(function () {
    if (window.__lfProblem7Probe && window.__lfProblem7Probe.version === 1) return true;
    var probe = window.__lfProblem7Probe = {
      version: 1,
      objectUrlsCreated: [],
      objectUrlsRevoked: [],
      textureDisposals: 0,
      materialDisposals: 0,
      toasts: [],
    };
    window.__LF_WALLPAPER_TEST__ = true;
    var nativeCreate = URL.createObjectURL.bind(URL);
    var nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (value) {
      var url = nativeCreate(value);
      probe.objectUrlsCreated.push(url);
      return url;
    };
    URL.revokeObjectURL = function (value) {
      probe.objectUrlsRevoked.push(String(value || ''));
      return nativeRevoke(value);
    };
    if (window.THREE && THREE.Texture && THREE.Texture.prototype) {
      var textureDispose = THREE.Texture.prototype.dispose;
      THREE.Texture.prototype.dispose = function () {
        probe.textureDisposals++;
        return textureDispose.apply(this, arguments);
      };
    }
    if (window.THREE && THREE.Material && THREE.Material.prototype) {
      var materialDispose = THREE.Material.prototype.dispose;
      THREE.Material.prototype.dispose = function () {
        probe.materialDisposals++;
        return materialDispose.apply(this, arguments);
      };
    }
    if (typeof window.showToast === 'function') {
      var originalToast = window.showToast;
      window.showToast = function (message) {
        probe.toasts.push(String(message || ''));
        return originalToast.apply(this, arguments);
      };
    }
    return true;
  });
}

async function snapshot() {
  return cdp.call(async function () {
    function signature(value) {
      var text = String(value == null ? '' : value);
      var hash = 2166136261;
      for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16) + ':' + text.length;
    }
    function safeJson(value) {
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
    }
    async function database(name) {
      var available = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases().catch(function () { return []; })
        : [];
      if (available.length && !available.some(function (item) { return item && item.name === name; })) {
        return { exists:false, stores:{} };
      }
      return new Promise(function (resolve) {
        var request = indexedDB.open(name);
        request.onerror = function () { resolve({ exists:false, error:String(request.error || '') }); };
        request.onsuccess = async function () {
          var db = request.result;
          var output = { exists:true, stores:{} };
          try {
            var stores = Array.from(db.objectStoreNames || []);
            for (var i = 0; i < stores.length; i++) {
              var storeName = stores[i];
              output.stores[storeName] = await new Promise(function (done) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var keysRequest = store.getAllKeys();
                keysRequest.onsuccess = function () {
                  done({ count:(keysRequest.result || []).length, keys:(keysRequest.result || []).map(String) });
                };
                keysRequest.onerror = function () { done({ count:-1, keys:[] }); };
              });
            }
          } catch (error) {
            output.error = String(error);
          }
          db.close();
          resolve(output);
        };
      });
    }
    var api = window.LumiFieldWallpaperState;
    var state;
    try { state = await Promise.resolve(api.status('stage')); } catch (error) { state = { error:String(error) }; }
    var layoutRaw = localStorage.getItem('mineradio-lyric-layout-v1') || '';
    var layout = {};
    try { layout = JSON.parse(layoutRaw) || {}; } catch (_) {}
    var pickerRaw = localStorage.getItem('lumifield-wallpaper-picker-meta-v1') || '';
    var pickerMeta = {};
    try { pickerMeta = JSON.parse(pickerRaw) || {}; } catch (_) {}
    var layer = document.getElementById('custom-bg');
    var video = document.getElementById('custom-bg-video');
    var stageLayer = document.getElementById('lf-stage-wallpaper');
    var stageVideo = document.getElementById('lf-stage-wallpaper-video');
    var sceneWallpaperTextures = 0;
    if (typeof scene !== 'undefined' && scene && typeof scene.traverse === 'function') {
      scene.traverse(function (object) {
        var materials = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
        materials.forEach(function (material) {
          Object.keys(material || {}).forEach(function (key) {
            var value = material[key];
            if (value && value.isTexture && /wallpaper|background/i.test(String(value.name || object.name || key))) sceneWallpaperTextures++;
          });
        });
      });
    }
    var probe = window.__lfProblem7Probe || {};
    var media = safeJson(fx.backgroundMedia || fx.backgroundImage) || null;
    return {
      api: safeJson(state),
      surface: document.body.classList.contains('empty-home-active') || homeForcedOpen ? 'main' : 'stage',
      scope: state && (state.scopeKey || state.scope || state.userKey || state.accountKey) || '',
      media: media,
      mediaSignature: signature(JSON.stringify(media || null)),
      wallpaperSignature: signature(JSON.stringify(state && {
        meta:state.meta || null,
        media:state.media || null,
      })),
      fxBackgroundImage: String(fx.backgroundImage || ''),
      layout: layout,
      layoutRaw: layoutRaw,
      pickerMeta: pickerMeta,
      pickerRaw: pickerRaw,
      custom: {
        bodyOverride: document.body.classList.contains('custom-background-override'),
        bodyVideo: document.body.classList.contains('custom-background-video'),
        image: layer ? layer.style.getPropertyValue('--custom-bg-image') : '',
        imageOpacity: layer ? layer.style.getPropertyValue('--custom-bg-image-opacity') : '',
        videoOpacity: layer ? layer.style.getPropertyValue('--custom-bg-video-opacity') : '',
        videoSrc: video ? String(video.getAttribute('src') || '') : '',
        videoPaused: video ? !!video.paused : true,
      },
      stage: {
        active: document.body.classList.contains('lf-stage-wallpaper-active'),
        image: stageLayer ? String(stageLayer.style.backgroundImage || '') : '',
        videoSrc: stageVideo ? String(stageVideo.getAttribute('src') || '') : '',
        videoPaused: stageVideo ? !!stageVideo.paused : true,
      },
      db: {
        custom: await database('mineradio-custom-background-v1'),
        picker: await database('lumifield-wallpaper-picker'),
      },
      resources: {
        objectUrlsCreated: (probe.objectUrlsCreated || []).slice(),
        objectUrlsRevoked: (probe.objectUrlsRevoked || []).slice(),
        textureDisposals: Number(probe.textureDisposals) || 0,
        materialDisposals: Number(probe.materialDisposals) || 0,
        sceneWallpaperTextures: sceneWallpaperTextures,
      },
      toasts: (probe.toasts || []).slice(),
    };
  });
}

function storeCount(db, name) {
  return Number(db && db.stores && db.stores[name] && db.stores[name].count) || 0;
}

function isClear(state) {
  const api = state.api || {};
  const apiMedia = api.media || {};
  const apiActive = api.active === true ||
    api.hasWallpaper === true ||
    !!api.meta ||
    !!api.current ||
    apiMedia.active === true ||
    (!!apiMedia.image && apiMedia.image !== 'none') ||
    !!apiMedia.video ||
    !!apiMedia.web ||
    Number(api.dbRecordCount) > 0 ||
    !!api.objectUrl;
  const layoutMedia = state.layout && (state.layout.backgroundMedia || state.layout.backgroundImage);
  return !apiActive &&
    !state.media &&
    !state.fxBackgroundImage &&
    !layoutMedia &&
    !state.custom.bodyOverride &&
    !state.custom.bodyVideo &&
    (!state.custom.image || state.custom.image === 'none') &&
    !state.custom.videoSrc &&
    state.custom.videoPaused &&
    !state.stage.active &&
    (!state.stage.image || state.stage.image === 'none') &&
    !state.stage.videoSrc &&
    state.stage.videoPaused &&
    Number(api.dbRecordCount || 0) === 0 &&
    (!api.texture || api.texture.present !== true) &&
    (!api.texture || api.texture.disposed !== false) &&
    state.resources.sceneWallpaperTextures === 0;
}

async function createAndApplyDialogImage(name, color) {
  return cdp.call(async function (args) {
    var open = document.getElementById('lf-wallpaper-open');
    if (!open) throw new Error('wallpaper open button missing');
    open.click();
    var target = document.getElementById('lf-wallpaper-target');
    target.value = 'stage';
    target.dispatchEvent(new Event('change', { bubbles:true }));
    var canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    var context = canvas.getContext('2d');
    context.fillStyle = args.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(4, 4, 10, 7);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    var file = new File([blob], args.name, { type:'image/png', lastModified:Date.now() });
    var transfer = new DataTransfer();
    transfer.items.add(file);
    var input = document.getElementById('lf-wallpaper-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await new Promise(function (resolve) { setTimeout(resolve, 80); });
    document.getElementById('lf-wallpaper-ok').click();
    return { name:file.name, type:file.type, size:file.size };
  }, [{ name, color }]);
}

async function createAndApplyDialogVideo(name, color) {
  const fixture = makeVideoFixture(name, color);
  const result = await cdp.call(async function (args) {
    var open = document.getElementById('lf-wallpaper-open');
    if (!open) throw new Error('wallpaper open button missing');
    open.click();
    var target = document.getElementById('lf-wallpaper-target');
    target.value = 'stage';
    target.dispatchEvent(new Event('change', { bubbles:true }));
    var raw = atob(args.base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var file = new File([bytes], args.name, { type:args.type, lastModified:Date.now() });
    var transfer = new DataTransfer();
    transfer.items.add(file);
    var input = document.getElementById('lf-wallpaper-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await new Promise(function (resolve) { setTimeout(resolve, 80); });
    document.getElementById('lf-wallpaper-ok').click();
    return { name:file.name, type:file.type, size:file.size };
  }, [{ name:fixture.name, type:fixture.type, base64:fixture.base64 }]);
  return Object.assign(result, { fixture:fixture.file });
}

async function createAndApplyImage(name, color) {
  return cdp.call(async function (args) {
    var canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    var context = canvas.getContext('2d');
    context.fillStyle = args.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(3, 3, 9, 6);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    var file = new File([blob], args.name, { type:'image/png', lastModified:Date.now() });
    var result = readBackgroundMediaFile(file);
    if (result && typeof result.then === 'function') await result;
    return { name:file.name, type:file.type, size:file.size };
  }, [{ name, color }]);
}

async function createAndApplyVideo(name, color) {
  const fixture = makeVideoFixture(name, color);
  const result = await cdp.call(async function (args) {
    var raw = atob(args.base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var file = new File([bytes], args.name, { type:args.type, lastModified:Date.now() });
    var result = readBackgroundMediaFile(file);
    if (result && typeof result.then === 'function') await result;
    return { name:file.name, type:file.type, size:file.size };
  }, [{ name:fixture.name, type:fixture.type, base64:fixture.base64 }]);
  return Object.assign(result, { fixture:fixture.file });
}

async function clearFromLegacyEntry() {
  return cdp.call(async function () {
    var result = clearCustomBackgroundImage();
    return await Promise.resolve(result);
  });
}

async function switchSurface(surface) {
  return cdp.call(function (value) {
    if (value === 'main') {
      if (!homeForcedOpen && !emptyHomeActive) goHome();
    } else {
      dismissHomePage({ reason:'problem7-smoke' });
    }
    return document.body.classList.contains('empty-home-active') || homeForcedOpen ? 'main' : 'stage';
  }, [surface]);
}

async function setTestUser(userId) {
  return cdp.call(async function (id) {
    var api = window.LumiFieldWallpaperState;
    if (typeof api.setTestUser === 'function') {
      await Promise.resolve(api.setTestUser(id));
    } else {
      activeAccountProvider = 'netease';
      loginStatus = Object.assign({}, loginStatus || {}, {
        loggedIn:true,
        userId:id,
        nickname:id,
        avatar:'',
      });
      document.dispatchEvent(new CustomEvent('lumifield-current-platform-change', {
        detail:{ provider:'netease', userId:id, source:'problem7-smoke' },
      }));
      if (typeof api.refreshScope === 'function') await Promise.resolve(api.refreshScope());
      else await Promise.resolve(api.restore('stage', { scopeChanged:true }));
    }
    return await Promise.resolve(api.status('stage'));
  }, [userId]);
}

async function failureInjection() {
  return cdp.call(async function () {
    var api = window.LumiFieldWallpaperState;
    var holders = [];
    if (api.persistence) holders.push(api.persistence);
    if (window.LumiFieldWallpaper && window.LumiFieldWallpaper.WallpaperPersistence) {
      holders.push(window.LumiFieldWallpaper.WallpaperPersistence.prototype);
    }
    var patched = [];
    ['clear', 'remove', 'delete'].forEach(function (name) {
      holders.forEach(function (holder) {
        if (!holder || typeof holder[name] !== 'function' || patched.some(function (item) { return item.holder === holder && item.name === name; })) return;
        var original = holder[name];
        holder[name] = async function () { throw new Error('LF_P7_INJECTED_PERSISTENCE_FAILURE'); };
        patched.push({ holder:holder, name:name, original:original });
      });
    });
    var originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () { throw new Error('LF_P7_INJECTED_PERSISTENCE_FAILURE'); };
    patched.push({ holder:IDBObjectStore.prototype, name:'delete', original:originalDelete });
    var beforeToastCount = (window.__lfProblem7Probe && window.__lfProblem7Probe.toasts || []).length;
    var result = null;
    var error = '';
    try {
      result = await Promise.resolve(api.clear('stage', { source:'problem7-failure-injection' }));
    } catch (caught) {
      error = String(caught && caught.message || caught);
    }
    patched.forEach(function (item) { item.holder[item.name] = item.original; });
    var newToasts = (window.__lfProblem7Probe && window.__lfProblem7Probe.toasts || []).slice(beforeToastCount);
    return {
      patched:patched.map(function (item) { return item.name; }),
      result:result,
      error:error,
      newToasts:newToasts,
    };
  });
}

async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, 30000);
  const file = path.join(evidenceDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function runRuntimeChecks() {
  await installProbe();
  await setTestUser('lf-p7-default');
  await cdp.call(async function () {
    document.body.classList.remove('splash-active', 'lf-auth-locked');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    await Promise.resolve(window.LumiFieldWallpaperState.clear('stage', { source:'problem7-initial-cleanup', silent:true }));
    await Promise.resolve(window.LumiFieldWallpaperState.clear('global', { source:'problem7-initial-cleanup', silent:true }));
    return true;
  });
  await waitFor(async () => isClear(await snapshot()));

  const imageA = await createAndApplyDialogImage('problem7-picker-a.png', '#d72828');
  let imageDiagnostic = null;
  const imageState = await waitFor(async () => {
    imageDiagnostic = await snapshot();
    return imageDiagnostic.api && imageDiagnostic.api.meta &&
      /^image\//i.test(imageDiagnostic.api.meta.mime || '') &&
      Number(imageDiagnostic.api.dbRecordCount) === 1 &&
      imageDiagnostic.stage.active &&
      imageDiagnostic.stage.image &&
      imageDiagnostic.stage.image !== 'none' ? imageDiagnostic : null;
  }, 15000, 120).catch(error => {
    throw new Error(`${error.message}; imageDiagnostic=${JSON.stringify(imageDiagnostic)}`);
  });
  pass('picker UI renders and persists a real stage image',
    imageA.size > 0 &&
    imageState.api.meta.name === imageA.name &&
    imageState.api.persistenceKey &&
    storeCount(imageState.db.picker, 'wallpapers') === 1,
    { file:imageA, api:imageState.api, css:imageState.stage.image.slice(0, 80), db:imageState.db.picker });
  await screenshot('01-image-wallpaper');

  pass('switches main and stage without losing current image',
    await switchSurface('main') === 'main' &&
    (await snapshot()).api.meta.name === imageA.name &&
    await switchSurface('stage') === 'stage' &&
    (await snapshot()).api.meta.name === imageA.name);

  const imageUrlsBeforeClear = imageState.resources.objectUrlsCreated.slice();
  const imageClearResult = await clearFromLegacyEntry();
  const imageCleared = await waitFor(async () => {
    const state = await snapshot();
    return isClear(state) ? state : null;
  });
  pass('legacy clear entry delegates atomic image cleanup',
    imageClearResult !== false && (!imageClearResult || imageClearResult.ok !== false),
    imageClearResult);
  pass('picker image clear removes scoped persistence CSS video and texture references',
    isClear(imageCleared) &&
    !imageCleared.api.meta &&
    Number(imageCleared.api.dbRecordCount) === 0 &&
    storeCount(imageCleared.db.picker, 'wallpapers') === 0 &&
    imageCleared.resources.objectUrlsRevoked.filter(url => imageUrlsBeforeClear.includes(url)).length === imageUrlsBeforeClear.length,
    imageCleared);
  await screenshot('02-image-cleared');

  await switchSurface('main');
  pass('cleared wallpaper stays absent across main and stage switches',
    isClear(await snapshot()) && await switchSurface('stage') === 'stage' && isClear(await snapshot()));

  const reloadMarker = `lf-p7-reload-${Date.now()}`;
  await cdp.call(function (marker) {
    sessionStorage.setItem('lf-problem7-reload-marker', marker);
    return marker;
  }, [reloadMarker]);
  await cdp.send('Page.reload', { ignoreCache:true }, 30000);
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' &&
      window.LumiFieldWallpaperState &&
      typeof window.LumiFieldWallpaperState.status === 'function' &&
      typeof fx !== 'undefined' &&
      !window.__lfProblem7Probe &&
      sessionStorage.getItem('lf-problem7-reload-marker');
  }), 60000, 180);
  await installProbe();
  await setTestUser('lf-p7-default');
  const reloadedClear = await waitFor(async () => {
    const state = await snapshot();
    return isClear(state) ? state : null;
  }, 30000, 180);
  pass('Page.reload restart cannot refill cleared wallpaper', isClear(reloadedClear), reloadedClear);
  await screenshot('03-reload-still-cleared');

  const videoA = await createAndApplyDialogVideo('problem7-picker-a.mp4', '#2459d8');
  let videoDiagnostic = null;
  const firstVideo = await waitFor(async () => {
    videoDiagnostic = await snapshot();
    return videoDiagnostic.api && videoDiagnostic.api.meta &&
      /^video\//i.test(videoDiagnostic.api.meta.mime || '') &&
      videoDiagnostic.stage.videoSrc &&
      Number(videoDiagnostic.api.dbRecordCount) === 1 ? videoDiagnostic : null;
  }, 30000, 140).catch(error => {
    throw new Error(`${error.message}; videoDiagnostic=${JSON.stringify(videoDiagnostic)}`);
  });
  pass('picker UI renders and persists a real generated stage video',
    videoA.size > 0 &&
    /^blob:|^data:|^https?:/i.test(firstVideo.stage.videoSrc) &&
    storeCount(firstVideo.db.picker, 'wallpapers') === 1,
    { file:videoA, src:firstVideo.stage.videoSrc, api:firstVideo.api, db:firstVideo.db.picker });
  const firstVideoUrl = firstVideo.stage.videoSrc;
  await screenshot('04-video-wallpaper');

  const videoB = await createAndApplyDialogVideo('problem7-picker-b.mp4', '#20a05a');
  const replacedVideo = await waitFor(async () => {
    const state = await snapshot();
    return state.api && state.api.meta && state.api.meta.name === videoB.name &&
      state.stage.videoSrc && state.stage.videoSrc !== firstVideoUrl &&
      state.resources.objectUrlsRevoked.includes(firstVideoUrl) ? state : null;
  }, 30000, 140);
  pass('continuous picker replacement revokes old URL and replaces one scoped blob',
    videoB.size > 0 &&
    replacedVideo.resources.objectUrlsRevoked.includes(firstVideoUrl) &&
    Number(replacedVideo.api.dbRecordCount) === 1 &&
    storeCount(replacedVideo.db.picker, 'wallpapers') === 1,
    { file:videoB, before:firstVideoUrl, after:replacedVideo.stage.videoSrc, db:replacedVideo.db.picker });

  const failed = await failureInjection();
  const afterFailedClear = await snapshot();
  const falseSuccessToast = failed.newToasts.some(message => /(?:已清除|清除成功|媒体已清除|图片已清除|视频已清除)/.test(message));
  const failureReported = !!failed.error || failed.result === false || failed.result && failed.result.ok === false;
  pass('persistence failure is reported without false success toast',
    failed.patched.length > 0 && failureReported && !falseSuccessToast,
    failed);
  pass('failed clear preserves recoverable wallpaper state',
    afterFailedClear.api && afterFailedClear.api.meta &&
    afterFailedClear.api.meta.name === videoB.name &&
    !!afterFailedClear.stage.videoSrc &&
    Number(afterFailedClear.api.dbRecordCount) === 1,
    afterFailedClear);

  const successfulVideoClear = await clearFromLegacyEntry();
  const videoCleared = await waitFor(async () => {
    const state = await snapshot();
    return isClear(state) && storeCount(state.db.picker, 'wallpapers') === 0 ? state : null;
  }, 30000, 140);
  pass('picker video clear atomically pauses detaches revokes and deletes storage',
    successfulVideoClear !== false &&
    videoCleared.resources.objectUrlsRevoked.includes(replacedVideo.stage.videoSrc) &&
    storeCount(videoCleared.db.picker, 'wallpapers') === 0,
    videoCleared);

  const legacyVideo = await createAndApplyVideo('problem7-legacy.mp4', '#7b3ed8');
  const legacyActive = await waitFor(async () => {
    const state = await snapshot();
    return state.media && state.media.type === 'video' &&
      state.custom.videoSrc &&
      storeCount(state.db.custom, 'media') === 1 ? state : null;
  }, 30000, 140);
  const legacyClear = await clearFromLegacyEntry();
  const legacyCleared = await waitFor(async () => {
    const state = await snapshot();
    return isClear(state) && storeCount(state.db.custom, 'media') === 0 ? state : null;
  }, 30000, 140);
  pass('legacy FX video is also atomically cleared with its blob and URL',
    legacyVideo.size > 0 &&
    legacyClear !== false &&
    legacyCleared.resources.objectUrlsRevoked.includes(legacyActive.custom.videoSrc),
    { file:legacyVideo, before:legacyActive, after:legacyCleared });

  const userAStatus = await setTestUser('lf-p7-user-a');
  await createAndApplyDialogImage('problem7-user-a.png', '#e33b64');
  const userA = await waitFor(async () => {
    const state = await snapshot();
    return state.api && state.api.meta && state.api.meta.name === 'problem7-user-a.png' ? state : null;
  });
  const userBStatus = await setTestUser('lf-p7-user-b');
  const userBInitial = await waitFor(async () => {
    const state = await snapshot();
    return state.api && !state.api.meta && !state.stage.active ? state : null;
  });
  await createAndApplyDialogImage('problem7-user-b.png', '#28a9d8');
  const userB = await waitFor(async () => {
    const state = await snapshot();
    return state.api && state.api.meta && state.api.meta.name === 'problem7-user-b.png' ? state : null;
  });
  await setTestUser('lf-p7-user-a');
  const userARestored = await waitFor(async () => {
    const state = await snapshot();
    return state.api && state.api.meta && state.api.meta.name === 'problem7-user-a.png' ? state : null;
  });
  await clearFromLegacyEntry();
  await waitFor(async () => {
    const state = await snapshot();
    return !state.api.meta && !state.stage.active ? state : null;
  });
  await setTestUser('lf-p7-user-b');
  const userBRestored = await waitFor(async () => {
    const state = await snapshot();
    return state.api && state.api.meta && state.api.meta.name === 'problem7-user-b.png' ? state : null;
  });
  pass('account scopes isolate and restore each user wallpaper',
    !userBInitial.api.meta &&
    userA.api.meta.name !== userB.api.meta.name &&
    userARestored.api.meta.name === userA.api.meta.name &&
    userBRestored.api.meta.name === userB.api.meta.name &&
    Number(userBRestored.api.dbRecordCount) === 1,
    {
      userAStatus:userAStatus && (userAStatus.scopeKey || userAStatus.scope),
      userBStatus:userBStatus && (userBStatus.scopeKey || userBStatus.scope),
      userA:userA.api.meta,
      userB:userB.api.meta,
      totalRecords:storeCount(userBRestored.db.picker, 'wallpapers'),
    });
  await clearFromLegacyEntry();
  await waitFor(async () => {
    const state = await snapshot();
    return !state.api.meta && !state.stage.active && storeCount(state.db.picker, 'wallpapers') === 0 ? state : null;
  });
  await screenshot('05-user-isolation-final-clear');

  pass('rendererErrors=0', rendererErrors.length === 0, rendererErrors);
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function () { window.close(); return true; }); } catch (_) {}
    cdp.close();
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  }
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  }
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

async function run() {
  const staticEvidence = staticAudit();
  await startApp();
  await runRuntimeChecks();
  const result = {
    ok:true,
    runId,
    launchMode,
    launchExecutable,
    evidenceDir,
    staticEvidence,
    checks,
    screenshots,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok:true,
    launchMode,
    evidenceDir,
    checkCount:Object.keys(checks).length,
    rendererErrors:rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  try {
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({
      ok:false,
      runId,
      launchMode,
      launchExecutable,
      evidenceDir,
      checks,
      screenshots,
      rendererErrors,
      error:String(error && error.stack || error),
    }, null, 2));
  } catch (_) {}
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('')); } catch (_) {}
  await stopApp();
});
