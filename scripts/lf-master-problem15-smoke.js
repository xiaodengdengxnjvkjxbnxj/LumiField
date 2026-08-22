'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_MASTER_PROBLEM15_OUT ||
  path.join(repo, 'test-results', 'lf-master-problem15-smoke', runId));
const suppliedUserData = String(process.env.LF_PROBLEM15_LIVE_USER_DATA || '').trim();
const userData = suppliedUserData
  ? path.resolve(suppliedUserData)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem15-'));
const disposableUserData = !suppliedUserData;
const PROVIDERS = Object.freeze(['netease', 'qq', 'kugou', 'kugou_concept', 'qishui']);
const LABELS = Object.freeze({
  netease: '网易云音乐',
  qq: 'QQ音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  qishui: '汽水音乐',
});
const ROUTES = Object.freeze({
  netease: '/api/playlist/tracks',
  qq: '/api/qq/playlist/tracks',
  kugou: '/api/kugou/playlist/tracks',
  kugou_concept: '/api/kugou-concept/playlist/tracks',
  qishui: '/api/qishui/playlist/tracks',
});
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function compact(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 1800 ? `${value.slice(0, 1800)}…` : value;
  if (value instanceof Error) return compact({ name:value.name, message:value.message, code:value.code }, depth);
  if (depth >= 5) return Array.isArray(value) ? `[Array(${value.length})]` : `{Object(${Object.keys(value).length})}`;
  if (Array.isArray(value)) {
    const out = value.slice(0, 28).map(item => compact(item, depth + 1));
    if (value.length > 28) out.push({ truncatedItems:value.length - 28 });
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    keys.slice(0, 72).forEach(key => { out[key] = compact(value[key], depth + 1); });
    if (keys.length > 72) out.__truncatedKeys = keys.length - 72;
    return out;
  }
  return String(value);
}
function pass(name, condition, details) {
  const evidence = details == null ? true : compact(details);
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(evidence)}`}`);
  checks[name] = evidence;
  return details;
}
function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(key => { out[key] = stableJson(value[key]); });
  return out;
}
function deepEqual(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}
function getPath(value, paths) {
  for (const fieldPath of paths) {
    const result = String(fieldPath).split('.').reduce((current, key) =>
      current == null ? undefined : current[key], value);
    if (result !== undefined) return result;
  }
  return undefined;
}
function stateOf(snapshot) {
  return String(getPath(snapshot, ['debug.state', 'debug.status', 'debug.phase', 'state', 'status', 'phase']) || '').toLowerCase();
}
function tracksOf(snapshot) {
  const value = getPath(snapshot, ['debug.tracks', 'debug.allTracks', 'debug.songs', 'tracks', 'songs']);
  return Array.isArray(value) ? value : [];
}
function messageOf(snapshot) {
  return String(getPath(snapshot, [
    'debug.message', 'debug.error.message', 'debug.errorMessage', 'message', 'error.message',
  ]) || '');
}
function errorCodeOf(snapshot) {
  return String(getPath(snapshot, [
    'debug.error.code', 'debug.errorCode', 'debug.code', 'error.code', 'code',
  ]) || '');
}
function canonicalTrack(track, provider) {
  return !!track &&
    String(track.provider || '') === provider &&
    String(track.source || '') === provider &&
    String(track.id || '') &&
    String(track.songId || '') === String(track.id || '') &&
    typeof track.name === 'string' && track.name.trim().length > 0 &&
    typeof track.artist === 'string' &&
    typeof track.album === 'string' &&
    typeof track.cover === 'string' &&
    Number.isFinite(Number(track.duration)) && Number(track.duration) >= 0 &&
    typeof track.playable === 'boolean';
}

function staticAudit() {
  const indexFile = path.join(repo, 'public', 'index.html');
  const adapterFile = path.join(repo, 'public', 'music-platform-adapters.js');
  const importerFile = path.join(repo, 'public', 'lf-playlist-link-import.js');
  const index = fs.readFileSync(indexFile, 'utf8');
  const adapter = fs.readFileSync(adapterFile, 'utf8');
  const importer = fs.readFileSync(importerFile, 'utf8');
  const contentStart = index.indexOf('function makeContentListManager');
  const contentEnd = index.indexOf('function compactCount', contentStart);
  const content = contentStart >= 0 && contentEnd > contentStart ? index.slice(contentStart, contentEnd) : '';

  pass('unified MusicPlatformManager publishes playlistTracks and playlistDetail',
    /playlistTracks\s*:\s*function/.test(adapter) &&
    /playlistDetail\s*:\s*function/.test(adapter) &&
    /getPlaylistTracks/.test(adapter) && /getPlaylistDetail/.test(adapter), true);
  pass('all five providers have exact playlist-track endpoints',
    Object.entries(ROUTES).every(([provider, route]) =>
      adapter.includes(route) &&
      (provider === 'netease' || adapter.includes(`provider === '${provider}'`))),
    ROUTES);
  pass('adapter strips provider prefixes and rejects provider mismatch instead of double-prefixing IDs',
    /while\s*\(\s*\(match\s*=\s*raw\.match/.test(adapter) &&
    /PLAYLIST_PROVIDER_MISMATCH/.test(adapter) &&
    /url\.searchParams\.set\(['"]id['"],\s*rawId\)/.test(adapter), true);
  pass('adapter rejects business failures and maps expired sessions to provider login-required errors',
    /result\.ok\s*===\s*false/.test(adapter) &&
    /result\.loggedIn\s*===\s*false/.test(adapter) &&
    /result\.sessionValid\s*===\s*false/.test(adapter) &&
    /PLAYLIST_LOGIN_REQUIRED/.test(adapter) &&
    /loginRequired\s*=\s*true/.test(adapter), true);
  pass('adapter normalizes every required canonical song field',
    ['provider', 'source', 'id', 'songId', 'name', 'artist', 'album', 'cover', 'duration', 'playable']
      .every(field => new RegExp(`\\b${field}\\s*:`).test(adapter)), true);
  pass('3D content uses the unified manager rather than direct provider endpoint branching',
    /LumiFieldMusicPlatformManager/.test(content) &&
    /\.playlistTracks\s*\(/.test(content) &&
    !/await\s+apiJson\s*\(\s*playlistTracksEndpoint/.test(content), true);
  pass('3D content implements observable loading ready empty error and login-required states',
    /getDebug\s*:\s*function/.test(content) &&
    /loading/i.test(content) && /ready/i.test(content) && /empty/i.test(content) &&
    /error/i.test(content) && /login-required|login_required/i.test(content), true);
  pass('3D content cancels or isolates superseded requests',
    /AbortController/.test(content) && /requestToken/.test(content) &&
    /abort\s*\(/.test(content) && /token\s*!==\s*requestToken/.test(content), true);
  pass('P13 persisted imported songs are consulted by the 3D content path',
    /LumiFieldPlaylistLinkImport/.test(content) && /loadImportedPlaylist/.test(content) &&
    /loadImportedPlaylist/.test(importer), true);
  pass('3D click long-press and playlist X integrations remain connected',
    /playRow\s*:\s*function/.test(content) &&
    /requestDelete\s*:\s*function/.test(content) &&
    /getOpenPlaylistRef\s*:\s*function/.test(content) &&
    /3d-playlist-row/.test(fs.readFileSync(path.join(repo, 'public', 'lf-climax-preview.js'), 'utf8')), true);
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
  throw new Error(`Timed out after ${timeout} ms; last=${JSON.stringify(compact(last))}`);
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
        rendererErrors.push(String(
          detail.exception && detail.exception.description || detail.text || 'Renderer exception'
        ).slice(0, 3000));
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params && message.params.entry || {};
        if (/^(?:error|assert)$/.test(String(entry.level || '')) &&
            String(entry.source || '').toLowerCase() !== 'network') {
          rendererErrors.push(String(entry.text || 'Renderer log error').slice(0, 3000));
        }
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Log.enable');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled:true });
    await this.send('Page.bringToFront');
  }
  send(method, params = {}, timeout = 90000) {
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
  async evaluate(expression, timeout = 90000) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeout);
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result && response.result.value;
  }
  call(fn, args = [], timeout = 90000) {
    return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`, timeout);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target => target.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 60000, 160);
}
async function pageReady() {
  return waitFor(async () => {
    return cdp.call(function (expectedOrigin) {
      var manager = window.LumiFieldMusicPlatformManager;
      return document.readyState === 'complete' && location.origin === expectedOrigin &&
        window.renderer && window.shelfManager && typeof makeContentListManager === 'function' &&
        manager && typeof manager.playlistTracks === 'function' &&
        window.LumiFieldPlaylistLinkImport &&
        typeof window.LumiFieldPlaylistLinkImport.loadImportedPlaylist === 'function';
    }, [origin]);
  }, 70000, 100);
}
async function startApp() {
  const port = await freePort();
  app = spawn(electron, [
    '.',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1500,940',
  ], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_ALLOW_LOCAL_CODES: '1',
      LF_MASTER_TEST: '1',
      LUMIFIELD_E2E_TEST: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    }),
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|unhandled rejection|renderer process crashed)/i.test(text)) {
      rendererErrors.push(text.trim().slice(0, 3000));
    }
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(port);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pageReady();
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
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  app = null;
  if (disposableUserData) {
    try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
  }
  await delay(250);
}
async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(evidenceDir,
    `${String(screenshots.length + 1).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function prepareSurface() {
  return cdp.call(function () {
    document.documentElement.setAttribute('data-lf-e2e', 'problem15');
    document.body.classList.remove('splash-active', 'empty-home-active', 'lf-auth-locked');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var auth = document.getElementById('lf-auth-root');
    if (auth) auth.style.display = 'none';
    try {
      emptyHomeActive = false;
      homeForcedOpen = false;
      homeSuppressed = true;
      if (typeof setShelfMode === 'function') setShelfMode('side');
      if (window.fx) {
        fx.shelfMode = 'side';
        fx.shelfPresence = 'always';
      }
      if (typeof setShelfPinnedOpen === 'function') setShelfPinnedOpen(true, true);
    } catch (_) {}
    return {
      manager: typeof window.LumiFieldMusicPlatformManager,
      importer: typeof window.LumiFieldPlaylistLinkImport,
      shelf: typeof window.shelfManager,
    };
  });
}

async function probeLiveSessions() {
  return cdp.call(async function (providers) {
    var manager = window.LumiFieldMusicPlatformManager;
    var installed = !!window.__lfP15Harness;
    var results = [];
    async function bounded(promise, ms) {
      return Promise.race([
        promise,
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('LIVE_PROBE_TIMEOUT')); }, ms);
        }),
      ]);
    }
    for (var i = 0; i < providers.length; i++) {
      var provider = providers[i];
      var item = { provider:provider, loggedIn:false, playlistCount:0, sampled:false };
      try {
        var status = await bounded(Promise.resolve(manager.status(provider)), 8000);
        item.loggedIn = !!(status && status.loggedIn);
        item.sessionValid = !!(status && (status.sessionValid !== false));
        item.userIdPresent = !!(status && (status.userId || status.profile && status.profile.userId));
        if (item.loggedIn) {
          var listResult = await bounded(Promise.resolve(manager.playlists(provider)), 12000);
          var playlists = listResult && (listResult.playlists || listResult.items || listResult.data) || [];
          item.playlistCount = Array.isArray(playlists) ? playlists.length : 0;
          var first = Array.isArray(playlists) && playlists.find(function (playlist) {
            return playlist && (playlist.id || playlist.playlistId);
          });
          if (first) {
            var id = String(first.id || first.playlistId);
            var detail = await bounded(Promise.resolve(manager.playlistTracks(provider, id, {
              limit: 8,
              timeoutMs: 12000,
            })), 15000);
            var tracks = detail && (detail.tracks || detail.songs) || [];
            item.sampled = true;
            item.playlistId = id;
            item.trackCount = Array.isArray(tracks) ? tracks.length : 0;
            item.canonical = Array.isArray(tracks) && tracks.every(function (track) {
              return track && track.provider === provider && track.source === provider &&
                String(track.id || '') && String(track.songId || '') === String(track.id || '') &&
                typeof track.name === 'string' && typeof track.artist === 'string' &&
                typeof track.album === 'string' && typeof track.cover === 'string' &&
                isFinite(Number(track.duration)) && typeof track.playable === 'boolean';
            });
          }
        }
      } catch (error) {
        item.error = String(error && (error.code || error.message) || error);
      }
      results.push(item);
    }
    return { fixtureInstalled:installed, providers:results };
  }, [PROVIDERS], 70000);
}

async function installDeterministicHarness() {
  return cdp.call(function (providers, labels) {
    var manager = window.LumiFieldMusicPlatformManager;
    if (!manager || typeof manager.playlistTracks !== 'function') {
      throw new Error('UNIFIED_PLAYLIST_TRACKS_MISSING');
    }
    if (window.__lfP15Harness && window.__lfP15Harness.originals) {
      var old = window.__lfP15Harness;
      manager.playlistTracks = old.originals.playlistTracks;
      manager.playlistDetail = old.originals.playlistDetail;
      manager.status = old.originals.status;
      manager.playlists = old.originals.playlists;
      if (old.originals.hasPlatformLogin) window.hasPlatformLogin = old.originals.hasPlatformLogin;
      if (old.originals.platformStatus) window.platformStatus = old.originals.platformStatus;
      if (old.originals.showToast) window.showToast = old.originals.showToast;
      if (old.originals.playQueueAt) window.playQueueAt = old.originals.playQueueAt;
    }
    function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function rawId(provider, input) {
      var raw = String(input == null ? '' : input);
      var match;
      while ((match = raw.match(/^(netease|qq|kugou|kugou_concept|qishui):(.*)$/))) {
        if (match[1] !== provider) {
          var mismatch = new Error('PLAYLIST_PROVIDER_MISMATCH');
          mismatch.code = 'PLAYLIST_PROVIDER_MISMATCH';
          mismatch.provider = provider;
          mismatch.playlistId = raw;
          throw mismatch;
        }
        raw = String(match[2] || '');
      }
      return raw;
    }
    function songs(provider, id, tag) {
      return [1, 2, 3].map(function (index) {
        var songId = provider + '-' + id + '-' + String(tag || 'ready') + '-' + index;
        return {
          provider:provider,
          source:provider,
          type:provider === 'netease' ? 'song' : provider,
          id:songId,
          songId:songId,
          name:labels[provider] + '状态机歌曲' + index,
          artist:labels[provider] + '歌手' + index,
          album:labels[provider] + '专辑' + index,
          cover:'',
          duration:180000 + index * 1000,
          playable:true,
          climaxStartSec:32 + index,
        };
      });
    }
    var harness = {
      deterministicFixtureOnly:true,
      fixtureDisclaimer:'受控歌曲仅验证状态机，不作为真实平台数据验收证据',
      controls:{},
      statuses:{},
      requests:[],
      toasts:[],
      playCalls:[],
      originals:{
        playlistTracks:manager.playlistTracks,
        playlistDetail:manager.playlistDetail,
        status:manager.status,
        playlists:manager.playlists,
        hasPlatformLogin:window.hasPlatformLogin,
        platformStatus:window.platformStatus,
        showToast:window.showToast,
        playQueueAt:window.playQueueAt,
      },
    };
    providers.forEach(function (provider) {
      harness.statuses[provider] = {
        ok:true,
        provider:provider,
        loggedIn:true,
        sessionValid:true,
        userId:'p15-' + provider + '-user',
      };
    });
    manager.playlistTracks = function (provider, input, options) {
      provider = String(provider || '');
      options = options || {};
      var id;
      try { id = rawId(provider, input); }
      catch (error) { return Promise.reject(error); }
      var key = provider + ':' + id;
      var control = copy(harness.controls[key] || harness.controls[provider + ':*'] || {
        mode:'ready',
        delay:60,
        tag:'default',
      });
      var request = {
        provider:provider,
        inputId:String(input),
        rawId:id,
        key:key,
        mode:String(control.mode || 'ready'),
        startedAt:Date.now(),
        aborted:false,
        settled:false,
      };
      harness.requests.push(request);
      return new Promise(function (resolve, reject) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          request.settled = true;
          request.settledAt = Date.now();
          if (request.aborted || options.signal && options.signal.aborted) {
            var aborted = new Error('歌单详情加载已取消');
            aborted.name = 'AbortError';
            aborted.code = 'PLAYLIST_TRACKS_ABORTED';
            aborted.provider = provider;
            aborted.playlistId = id;
            return reject(aborted);
          }
          if (control.mode === 'login') {
            var login = new Error('请重新登录' + labels[provider] + '后加载该歌单');
            login.code = 'PLAYLIST_LOGIN_REQUIRED';
            login.loginRequired = true;
            login.provider = provider;
            login.playlistId = id;
            return reject(login);
          }
          if (control.mode === 'error') {
            var failed = new Error(labels[provider] + '歌单详情加载失败');
            failed.code = String(control.code || 'PLAYLIST_TRACKS_FAILED');
            failed.provider = provider;
            failed.playlistId = id;
            return reject(failed);
          }
          var tracks = control.mode === 'empty' ? [] : songs(provider, id, control.tag || 'ready');
          return resolve({
            ok:true,
            provider:provider,
            playlistId:id,
            playlist:{
              provider:provider,
              id:id,
              playlistId:id,
              name:labels[provider] + '受控歌单',
              trackCount:tracks.length,
              songCount:tracks.length,
            },
            tracks:copy(tracks),
            songs:copy(tracks),
            empty:tracks.length === 0,
          });
        }
        var timer = setTimeout(finish, Math.max(0, Number(control.delay) || 0));
        if (options.signal && typeof options.signal.addEventListener === 'function') {
          options.signal.addEventListener('abort', function () {
            request.aborted = true;
            clearTimeout(timer);
            finish();
          }, { once:true });
        }
      });
    };
    manager.playlistDetail = function (provider, id, options) {
      return manager.playlistTracks(provider, id, options);
    };
    manager.status = function (provider) {
      return Promise.resolve(copy(harness.statuses[String(provider || '')] || {
        ok:true,
        provider:String(provider || ''),
        loggedIn:false,
        sessionValid:false,
      }));
    };
    manager.playlists = function (provider) {
      provider = String(provider || '');
      var id = 'fixture-list-' + provider;
      return Promise.resolve({
        ok:true,
        provider:provider,
        playlists:[{
          provider:provider,
          source:provider,
          id:id,
          playlistId:id,
          name:labels[provider] + '受控歌单',
          trackCount:3,
          songCount:3,
          cover:'',
        }],
      });
    };
    window.hasPlatformLogin = function (provider) {
      var status = harness.statuses[String(provider || '')];
      return !!(status && status.loggedIn);
    };
    window.platformStatus = function (provider) {
      return copy(harness.statuses[String(provider || '')] || {
        provider:String(provider || ''),
        loggedIn:false,
        sessionValid:false,
      });
    };
    window.showToast = function (message) {
      harness.toasts.push({ message:String(message || ''), at:Date.now() });
    };
    window.playQueueAt = function (index, options) {
      var song = window.playQueue && window.playQueue[index];
      harness.playCalls.push({
        index:Number(index),
        provider:song && song.provider,
        id:song && song.id,
        options:copy(options || {}),
      });
      return Promise.resolve({ ok:true, test:true });
    };
    window.__lfP15Harness = harness;
    return {
      installed:true,
      providers:providers,
      disclaimer:harness.fixtureDisclaimer,
      methods:{
        playlistTracks:typeof manager.playlistTracks,
        playlistDetail:typeof manager.playlistDetail,
      },
    };
  }, [PROVIDERS, LABELS]);
}

async function setHarnessControl(provider, id, control) {
  return cdp.call(function (name, playlistId, next) {
    var harness = window.__lfP15Harness;
    harness.controls[name + ':' + playlistId] = Object.assign({
      mode:'ready',
      delay:60,
      tag:'ready',
    }, next || {});
    return JSON.parse(JSON.stringify(harness.controls[name + ':' + playlistId]));
  }, [provider, id, control]);
}
async function setHarnessLogin(provider, loggedIn) {
  return cdp.call(function (name, value) {
    var harness = window.__lfP15Harness;
    harness.statuses[name] = Object.assign({}, harness.statuses[name] || {}, {
      ok:true,
      provider:name,
      loggedIn:!!value,
      sessionValid:!!value,
    });
    return JSON.parse(JSON.stringify(harness.statuses[name]));
  }, [provider, loggedIn]);
}
async function harnessSnapshot() {
  return cdp.call(function () {
    var harness = window.__lfP15Harness;
    return {
      disclaimer:harness.fixtureDisclaimer,
      controls:JSON.parse(JSON.stringify(harness.controls)),
      statuses:JSON.parse(JSON.stringify(harness.statuses)),
      requests:JSON.parse(JSON.stringify(harness.requests)),
      toasts:JSON.parse(JSON.stringify(harness.toasts)),
      playCalls:JSON.parse(JSON.stringify(harness.playCalls)),
    };
  });
}

async function openDirect(provider, id, title, encodedReference) {
  return cdp.call(function (name, playlistId, label, reference) {
    if (window.__lfP15Content && window.__lfP15Content.close) {
      try { window.__lfP15Content.close(); } catch (_) {}
    }
    var content = makeContentListManager();
    window.__lfP15Content = content;
    window.__lfP15OpenPromise = Promise.resolve(content.open(
      reference || (name + ':' + playlistId),
      label,
      { item:{
        provider:name,
        rawPlaylistId:String(playlistId),
        playlistId:name + ':' + playlistId,
        title:label,
        cover:'',
      } }
    ));
    var debug = content.getDebug && content.getDebug();
    return {
      debug:debug,
      ref:content.getOpenPlaylistRef && content.getOpenPlaylistRef(),
      rows:(content.getRows && content.getRows() || []).map(function (row) {
        return { index:row.index, song:row.song };
      }),
    };
  }, [provider, id, title || `${LABELS[provider]} P15`, encodedReference || '']);
}
async function openOnCurrent(provider, id, title, encodedReference) {
  return cdp.call(function (name, playlistId, label, reference) {
    var content = window.__lfP15Content;
    if (!content) throw new Error('P15_CONTENT_NOT_CREATED');
    window.__lfP15OpenPromise = Promise.resolve(content.open(
      reference || (name + ':' + playlistId),
      label,
      { item:{
        provider:name,
        rawPlaylistId:String(playlistId),
        playlistId:name + ':' + playlistId,
        title:label,
        cover:'',
      } }
    ));
    return content.getDebug && content.getDebug();
  }, [provider, id, title || `${LABELS[provider]} P15`, encodedReference || '']);
}
async function contentSnapshot(useShelf = false) {
  return cdp.call(function (shelf) {
    var content = shelf
      ? window.shelfManager && shelfManager.getContentList && shelfManager.getContentList()
      : window.__lfP15Content;
    if (!content) return null;
    return {
      debug:content.getDebug && content.getDebug(),
      ref:content.getOpenPlaylistRef && content.getOpenPlaylistRef(),
      open:!!(content.isOpen && content.isOpen()),
      center:content.getCenterIdx && content.getCenterIdx(),
      rows:(content.getRows && content.getRows() || []).map(function (row) {
        return {
          index:row.index,
          visible:!!(row.mesh && row.mesh.visible),
          song:row.song && JSON.parse(JSON.stringify(row.song)),
        };
      }),
    };
  }, [useShelf]);
}
async function waitContentState(expected, useShelf = false, timeout = 12000) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  return waitFor(async () => {
    const snapshot = await contentSnapshot(useShelf);
    return snapshot && accepted.includes(stateOf(snapshot)) ? snapshot : false;
  }, timeout, 60);
}

async function verifyFiveProviderReadyContract() {
  const results = [];
  for (const provider of PROVIDERS) {
    const id = `raw-${provider}-1501`;
    await setHarnessLogin(provider, true);
    await setHarnessControl(provider, id, {
      mode:'ready',
      delay:180,
      tag:'five-provider',
    });
    const loading = await openDirect(provider, id, `${LABELS[provider]}真实结构测试`);
    const loadingRows = loading.rows.map(row => String(row.song && row.song.name || ''));
    pass(`${provider}: 3D detail enters loading before the adapter settles`,
      stateOf(loading) === 'loading' &&
      loadingRows.some(name => /加载|载入/.test(name)) &&
      !loadingRows.some(name => /歌单为空/.test(name)),
      loading);
    const ready = await waitContentState('ready');
    const tracks = tracksOf(ready);
    const request = (await harnessSnapshot()).requests.slice().reverse()
      .find(item => item.provider === provider && item.rawId === id);
    pass(`${provider}: provider and raw playlistId reach the unified adapter exactly once`,
      !!request && request.inputId === id &&
      ready.ref && ready.ref.provider === provider && ready.ref.id === id,
      { request, ref:ready.ref });
    pass(`${provider}: ready state contains normalized real-shape song fields`,
      tracks.length === 3 && tracks.every(track => canonicalTrack(track, provider)),
      tracks);
    pass(`${provider}: visible 3D rows preserve provider and song IDs from the ready result`,
      ready.rows.some(row => row.song && row.song.id === tracks[0].id) &&
      ready.rows.filter(row => row.song && row.song.id).every(row =>
        row.song.provider === provider && tracks.some(track => track.id === row.song.id)),
      { tracks:tracks.map(track => track.id), rows:ready.rows });
    results.push({ provider, id, ids:tracks.map(track => track.id) });
  }
  await screenshot('five-provider-ready-3d-detail');
  return results;
}

async function verifyAdapterIdAndModeInvariance() {
  const result = await cdp.call(async function (providers) {
    var manager = window.LumiFieldMusicPlatformManager;
    var output = [];
    for (var i = 0; i < providers.length; i++) {
      var provider = providers[i];
      var id = 'repeat-prefix-' + provider;
      window.__lfP15Harness.controls[provider + ':' + id] = {
        mode:'ready',
        delay:0,
        tag:'prefix',
      };
      var response = await manager.playlistTracks(provider, provider + ':' + provider + ':' + id);
      output.push({
        provider:provider,
        id:response.playlistId,
        trackProviders:response.tracks.map(function (track) { return track.provider; }),
      });
    }
    return output;
  }, [PROVIDERS]);
  pass('unified adapter accepts legacy repeated same-provider prefixes without double-prefixing',
    result.every(item => item.id === `repeat-prefix-${item.provider}` &&
      item.trackProviders.every(provider => provider === item.provider)),
    result);

  const provider = 'kugou';
  const id = 'mode-invariant-15';
  await setHarnessControl(provider, id, { mode:'ready', delay:30, tag:'single' });
  const modeResults = await cdp.call(async function (name, playlistId) {
    var prior = !!window.multiProviderMode;
    var content = makeContentListManager();
    window.__lfP15Content = content;
    window.multiProviderMode = false;
    await content.open(name + ':' + playlistId, 'single', {
      item:{ provider:name, rawPlaylistId:playlistId, title:'single' }
    });
    var single = content.getDebug();
    content.close();
    content = makeContentListManager();
    window.__lfP15Content = content;
    window.multiProviderMode = true;
    await content.open(name + ':' + playlistId, 'multi', {
      item:{ provider:name, rawPlaylistId:playlistId, title:'multi' }
    });
    var multi = content.getDebug();
    window.multiProviderMode = prior;
    return { single:single, multi:multi };
  }, [provider, id]);
  pass('single-platform and multi-platform modes return identical provider song identities',
    deepEqual(
      tracksOf({ debug:modeResults.single }).map(track => `${track.provider}:${track.id}`),
      tracksOf({ debug:modeResults.multi }).map(track => `${track.provider}:${track.id}`)
    ), modeResults);
}

async function verifyEmptyErrorAndLoginStates() {
  await setHarnessControl('netease', 'true-empty', { mode:'empty', delay:70 });
  const emptyLoading = await openDirect('netease', 'true-empty', '真正空歌单');
  pass('successful zero-track response still shows loading before empty',
    stateOf(emptyLoading) === 'loading' &&
    !emptyLoading.rows.some(row => /歌单为空/.test(String(row.song && row.song.name || ''))),
    emptyLoading);
  const empty = await waitContentState('empty');
  pass('only a successful zero-track response renders exact empty state',
    tracksOf(empty).length === 0 &&
    (messageOf(empty) === '歌单为空' ||
      empty.rows.some(row => String(row.song && row.song.name || '') === '歌单为空')),
    empty);

  await setHarnessControl('netease', 'network-failure', {
    mode:'error',
    delay:70,
    code:'PLAYLIST_TRACKS_FAILED',
  });
  await openDirect('netease', 'network-failure', '失败不是空');
  const failed = await waitContentState('error');
  pass('request failure is an error and never masquerades as empty',
    stateOf(failed) === 'error' &&
    errorCodeOf(failed) === 'PLAYLIST_TRACKS_FAILED' &&
    !/歌单为空/.test(messageOf(failed)) &&
    !failed.rows.some(row => /歌单为空/.test(String(row.song && row.song.name || ''))),
    failed);

  for (const provider of PROVIDERS) {
    const id = `login-expired-${provider}`;
    await setHarnessLogin(provider, false);
    await setHarnessControl(provider, id, { mode:'login', delay:50 });
    await openDirect(provider, id, `${LABELS[provider]}失效会话`);
    const login = await waitContentState(['login-required', 'login_required']);
    const text = `${messageOf(login)} ${login.rows.map(row => row.song && row.song.name || '').join(' ')}`;
    pass(`${provider}: expired session asks to re-login the exact provider instead of showing empty`,
      errorCodeOf(login) === 'PLAYLIST_LOGIN_REQUIRED' &&
      /重新登录/.test(text) && text.includes(LABELS[provider]) && !/歌单为空/.test(text),
      login);
  }
  await screenshot('provider-login-required-not-empty');
  PROVIDERS.forEach(() => {});
  for (const provider of PROVIDERS) await setHarnessLogin(provider, true);
}

async function verifySupersededRequestIsolation() {
  await setHarnessControl('netease', 'slow-a', {
    mode:'ready',
    delay:680,
    tag:'slow-a',
  });
  await setHarnessControl('qq', 'fast-b', {
    mode:'ready',
    delay:70,
    tag:'fast-b',
  });
  await openDirect('netease', 'slow-a', '慢歌单A');
  await delay(35);
  await openOnCurrent('qq', 'fast-b', '快歌单B');
  const fast = await waitContentState('ready');
  await delay(760);
  const settled = await contentSnapshot();
  const ids = tracksOf(settled).map(track => track.id);
  const harness = await harnessSnapshot();
  const requestA = harness.requests.slice().reverse().find(item =>
    item.provider === 'netease' && item.rawId === 'slow-a');
  const requestB = harness.requests.slice().reverse().find(item =>
    item.provider === 'qq' && item.rawId === 'fast-b');
  pass('rapid A-to-B switch leaves B ready after slow A eventually settles',
    fast.ref && fast.ref.key === 'qq:fast-b' &&
    settled.ref && settled.ref.key === 'qq:fast-b' &&
    ids.length === 3 && ids.every(id => /^qq-fast-b-fast-b-/.test(id)),
    { fast, settled, requestA, requestB });
  pass('superseded A is actively aborted or safely ignored by the request token',
    !!requestA && !!requestB && requestB.settled === true &&
    (requestA.aborted === true ||
      (settled.ref.key === 'qq:fast-b' && !ids.some(id => /^netease-slow-a-/.test(id)))),
    { requestA, requestB, settled });
}

async function verifyProviderCacheIsolation() {
  const rawId = 'shared-raw-id-15';
  const seen = {};
  for (const provider of ['netease', 'qq', 'kugou']) {
    await setHarnessControl(provider, rawId, {
      mode:'ready',
      delay:20,
      tag:`cache-${provider}`,
    });
    await openDirect(provider, rawId, `${LABELS[provider]}同ID`);
    const ready = await waitContentState('ready');
    const tracks = tracksOf(ready);
    seen[provider] = {
      ref:ready.ref,
      cacheKey:String(getPath(ready, ['debug.cacheKey', 'debug.requestKey', 'debug.openRef.key']) || ''),
      ids:tracks.map(track => track.id),
    };
  }
  pass('same raw playlistId never leaks tracks across provider caches',
    Object.entries(seen).every(([provider, item]) =>
      item.ref && item.ref.key === `${provider}:${rawId}` &&
      item.ids.length === 3 && item.ids.every(id => id.startsWith(`${provider}-${rawId}-`))) &&
    new Set(Object.values(seen).flatMap(item => item.ids)).size === 9,
    seen);
  pass('observable cache/request identity is provider plus raw playlistId',
    Object.entries(seen).every(([provider, item]) =>
      !item.cacheKey || item.cacheKey === `${provider}:${rawId}`),
    seen);
}

async function seedPersistedImportedPlaylist(provider, id) {
  return cdp.call(async function (name, playlistId, label) {
    var importer = window.LumiFieldPlaylistLinkImport;
    await importer.setTestUser('problem15-imported-user');
    var debug = importer.getDebug();
    var scope = String(debug.scopeHash || '');
    if (!scope) throw new Error('P13_IMPORT_SCOPE_MISSING');
    var songs = [1, 2].map(function (index) {
      var songId = name + '-p13-persisted-' + index;
      return {
        provider:name,
        source:name,
        type:name,
        id:songId,
        songId:songId,
        name:'P13持久化真实结构歌曲' + index,
        artist:'P13公开导入歌手',
        album:'P13公开导入专辑',
        cover:'',
        duration:210000 + index * 1000,
        playable:true,
        climaxStartSec:36 + index,
      };
    });
    var key = name + ':' + playlistId;
    var record = {
      schema:'lumifield.imported-playlist',
      version:1,
      key:key,
      provider:name,
      source:name,
      id:playlistId,
      playlistId:playlistId,
      sourceProvider:name,
      sourcePlaylistId:playlistId,
      canonicalUrl:'https://www.qishui.com/playlist/' + playlistId,
      sourceUrl:'https://www.qishui.com/playlist/' + playlistId,
      updatedAt:Date.now(),
      createdAt:Date.now(),
      importedAt:Date.now(),
      name:label,
      cover:'',
      creator:'P13公开导入创建者',
      trackCount:songs.length,
      songCount:songs.length,
      songs:songs,
      metadata:{ name:label, cover:'', creator:'P13公开导入创建者', songCount:songs.length },
      private:false,
      requiresLogin:false,
      lfImportedPlaylist:true,
      lfImportScope:scope,
    };
    var storageKey = 'lumifield-playlist-link-imports-v1';
    var root;
    try { root = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
    if (!root || typeof root !== 'object') {
      root = { schema:'lumifield.playlist-link-imports', version:1, scopes:{} };
    }
    if (!root.scopes || typeof root.scopes !== 'object') root.scopes = {};
    root.scopes[scope] = {
      version:1,
      updatedAt:Date.now(),
      items:Object.assign({}, root.scopes[scope] && root.scopes[scope].items || {}),
    };
    root.scopes[scope].items[key] = record;
    localStorage.setItem(storageKey, JSON.stringify(root));
    await importer.setTestUser('problem15-imported-user');
    var loaded = importer.loadImportedPlaylist(name, playlistId, { surface:'3d' });
    return {
      key:key,
      scope:scope,
      loaded:loaded,
      imported:importer.getImportedPlaylists(),
    };
  }, [provider, id, `${LABELS[provider]} P13公开导入`]);
}

async function verifyPersistedP13Import() {
  const provider = 'qishui';
  const id = '1500130015';
  const seeded = await seedPersistedImportedPlaylist(provider, id);
  pass('P13 persisted import is read through the real importer API with canonical songs',
    seeded.loaded && seeded.loaded.ok === true &&
    seeded.loaded.songs.length === 2 &&
    seeded.loaded.songs.every(track => canonicalTrack(track, provider)) &&
    seeded.imported.some(item => item.key === `${provider}:${id}`),
    seeded);
  await setHarnessLogin(provider, false);
  await setHarnessControl(provider, id, { mode:'login', delay:20 });
  const before = (await harnessSnapshot()).requests.length;
  await cdp.call(async function (name) {
    window.playlistAccountProvider = name;
    await refreshUserPlaylists(true, { provider:name });
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('p15-imported', false);
    return true;
  }, [provider]);
  const surface = await cdp.call(function (name, playlistId) {
    return {
      userKeys:(window.userPlaylists || []).map(function (playlist) {
        return String(playlist.provider || playlist.source || '') + ':' +
          String(playlist.id || playlist.playlistId || '');
      }),
      shelfKeys:shelfManager.getPlaylistKeys ? shelfManager.getPlaylistKeys() : [],
      loggedIn:hasPlatformLogin(name),
      loaded:window.LumiFieldPlaylistLinkImport.loadImportedPlaylist(name, playlistId, { surface:'3d' }),
    };
  }, [provider, id]);
  pass('public P13 import remains in 2D and 3D sources without a platform login',
    surface.loggedIn === false &&
    surface.userKeys.includes(`${provider}:${id}`) &&
    surface.shelfKeys.includes(`${provider}:${id}`),
    surface);
  await openDirect(provider, id, 'P13公开导入');
  const ready = await waitContentState('ready');
  const after = (await harnessSnapshot()).requests.length;
  pass('3D detail prefers persisted imported songs and does not require the expired platform session',
    ready.ref && ready.ref.key === `${provider}:${id}` &&
    tracksOf(ready).map(track => track.id).join('|') ===
      seeded.loaded.songs.map(track => track.id).join('|') &&
    after === before,
    { ready, requestCount:{ before, after } });
  await setHarnessLogin(provider, true);
}

async function configureRealShelf(provider, id) {
  return cdp.call(async function (name, playlistId, label) {
    if (typeof togglePlaylistPanel === 'function') togglePlaylistPanel(false);
    var playlistPanel = document.getElementById('playlist-panel');
    if (playlistPanel) playlistPanel.classList.remove('show', 'peek');
    emptyHomeActive = false;
    homeForcedOpen = false;
    document.body.classList.remove('splash-active', 'empty-home-active');
    if (typeof setShelfMode === 'function') setShelfMode('stage');
    else if (shelfManager && shelfManager.setMode) shelfManager.setMode('stage');
    if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) shelfManager.closeContent();
    var playlist = {
      provider:name,
      source:name,
      id:playlistId,
      playlistId:playlistId,
      rawPlaylistId:playlistId,
      name:label,
      cover:'',
      trackCount:3,
      songCount:3,
      subscribed:false,
    };
    window.playlistAccountProvider = name;
    window.userPlaylists = [playlist];
    if (name === 'netease') window.neteasePlaylists = [playlist];
    else if (name === 'qq') window.qqPlaylists = [playlist];
    else if (name === 'kugou') window.kugouPlaylists = [playlist];
    else if (name === 'kugou_concept') window.kugouConceptPlaylists = [playlist];
    else if (name === 'qishui') window.qishuiPlaylists = [playlist];
    window.multiProviderMode = true;
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('p15-real-shelf', false);
    else shelfManager.rebuild(false);
    var cards = shelfManager.getCards ? shelfManager.getCards() : [];
    var card = cards.find(function (entry) {
      return entry && entry.item && entry.item.provider === name &&
        String(entry.item.rawPlaylistId || '') === String(playlistId);
    });
    if (!card) return {
      found:false,
      cards:cards.map(function (entry) {
        return entry && entry.item && {
          provider:entry.item.provider,
          id:entry.item.rawPlaylistId,
          title:entry.item.title,
        };
      }),
    };
    shelfManager.openContent(card.index);
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    return {
      found:true,
      index:card.index,
      title:card.item.title,
      stageActive:typeof isVisualStageInteractionActive === 'function' && isVisualStageInteractionActive(),
      mode:shelfManager.getMode && shelfManager.getMode(),
    };
  }, [provider, id, `${LABELS[provider]}交互回归`]);
}
async function clickableShelfRowPoint(index, action) {
  return cdp.call(function (wanted, wantedAction) {
    var content = shelfManager && shelfManager.getContentList && shelfManager.getContentList();
    if (!content || !content.getRows || !content.pickRowAtScreen) return null;
    var row = content.getRows().find(function (entry) {
      return entry && entry.index === wanted && entry.mesh && entry.mesh.visible;
    });
    if (!row) return null;
    var p = row.mesh.geometry && row.mesh.geometry.parameters || {};
    var hw = (p.width || 2.5) / 2;
    var hh = (p.height || .36) / 2;
    var points = [
      new THREE.Vector3(-hw,-hh,0),
      new THREE.Vector3(hw,-hh,0),
      new THREE.Vector3(hw,hh,0),
      new THREE.Vector3(-hw,hh,0),
    ];
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    var best=null,bestScore=Infinity;
    row.mesh.updateMatrixWorld(true);
    points.forEach(function (point) {
      point.applyMatrix4(row.mesh.matrixWorld).project(camera);
      var x=(point.x+1)*innerWidth/2, y=(1-point.y)*innerHeight/2;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    });
    for (var y=minY+8; y<=maxY-8; y+=6) {
      for (var x=minX+24; x<=maxX-8; x+=8) {
        var hit=content.pickRowAtScreen(x,y);
        var screenAction=hit&&!hit.uv&&content.rowActionAtScreen
          ? content.rowActionAtScreen(hit.row,x,y) : null;
        var correctZone=wantedAction==='play'
          ? !!(hit&&((hit.uv&&hit.uv.x>=.84&&hit.uv.y>.20&&hit.uv.y<.82)||screenAction==='play'))
          : !!(hit&&(!hit.uv||hit.uv.x<.55));
        if (hit&&hit.row&&hit.row.index===wanted&&correctZone&&document.elementFromPoint(x,y)===renderer.domElement) {
          var targetU=wantedAction==='play'?.91:.32;
          var targetV=.5;
          var hitU=hit.uv?hit.uv.x:targetU;
          var hitV=hit.uv?hit.uv.y:targetV;
          var score=Math.abs(hitU-targetU)+Math.abs(hitV-targetV);
          if (score<bestScore) {
            bestScore=score;
            best={ x:x, y:y, index:wanted, id:row.song&&row.song.id, action:wantedAction||'body', uv:{x:hitU,y:hitV} };
          }
        }
      }
    }
    return best;
  }, [index, action || 'body']);
}
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', {
    type:'mousePressed', x, y, button:'left', buttons:1, clickCount:1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type:'mouseReleased', x, y, button:'left', buttons:0, clickCount:1,
  });
}

async function verifyTwoAndThreeDimensionalConsistencyAndActions() {
  const provider = 'kugou_concept';
  const id = 'interaction-15015';
  await setHarnessLogin(provider, true);
  await setHarnessControl(provider, id, {
    mode:'ready',
    delay:40,
    tag:'interaction',
  });
  const twoD = await cdp.call(async function (name, playlistId, title) {
    await openPlaylistPanelDetail(name, playlistId, title);
    return {
      key:playlistPanelDetailState.key,
      loading:playlistPanelDetailState.loading,
      error:playlistPanelDetailState.error,
      tracks:playlistPanelDetailState.tracks.map(function (track) {
        return { provider:track.provider, id:track.id, songId:track.songId };
      }),
    };
  }, [provider, id, 'P15 2D']);
  pass('2D detail reaches ready through the same provider and canonical IDs',
    twoD.key === `${provider}:${id}` && twoD.loading === false && !twoD.error &&
    twoD.tracks.length === 3 &&
    twoD.tracks.every(track => track.provider === provider && track.songId === track.id),
    twoD);

  const started = await configureRealShelf(provider, id);
  pass('real 3D shelf card opens through the production click data source',
    started.found === true && started.stageActive === true && started.mode === 'stage', started);
  const threeD = await waitContentState('ready', true);
  pass('2D and 3D details expose the identical canonical provider/song identities',
    deepEqual(
      twoD.tracks.map(track => `${track.provider}:${track.id}`),
      tracksOf(threeD).map(track => `${track.provider}:${track.id}`)
    ), { twoD, threeD });

  const center = Number(threeD.center) || 0;
  const point = await waitFor(() => clickableShelfRowPoint(center, 'play'), 5000, 80);
  pass('loaded 3D detail exposes a real clickable play hotspot', !!point, { point, threeD });
  await cdp.call(function () {
    window.__lfP15Harness.playCalls.length = 0;
    if (typeof mouseDownAt !== 'undefined') mouseDownAt.hadDrag = false;
    window.__lfP15ClickProbe = [];
    renderer.domElement.addEventListener('click', function probe(e) {
      var content = shelfManager && shelfManager.getContentList && shelfManager.getContentList();
      var hit = content && content.pickRowAtScreen ? content.pickRowAtScreen(e.clientX, e.clientY) : null;
      window.__lfP15ClickProbe.push({
        x:e.clientX,
        y:e.clientY,
        detail:e.detail,
        target:e.target && (e.target.id || e.target.tagName),
        topElement:(document.elementFromPoint(e.clientX, e.clientY) || {}).id || '',
        stageActive:typeof isVisualStageInteractionActive === 'function' && isVisualStageInteractionActive(),
        pointerOverUi:typeof isPointerOverUi === 'function' && isPointerOverUi(e),
        hadDrag:typeof mouseDownAt !== 'undefined' && mouseDownAt.hadDrag,
        mode:shelfManager && shelfManager.getMode && shelfManager.getMode(),
        hasOpenContent:!!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()),
        row:hit && hit.row && hit.row.index,
        uv:hit && hit.uv && { x:hit.uv.x, y:hit.uv.y },
        action:hit && !hit.uv && content.rowActionAtScreen
          ? content.rowActionAtScreen(hit.row, e.clientX, e.clientY) : null
      });
    }, { capture:true, once:true });
    return true;
  });
  await clickAt(point.x, point.y);
  await delay(300);
  const played = await harnessSnapshot();
  const clickProbe = await cdp.call(function () { return window.__lfP15ClickProbe || []; });
  pass('real 3D play-hotspot click preserves provider/id into queue and reaches playback',
    played.playCalls.length === 1 &&
    played.playCalls[0].provider === provider &&
    played.playCalls[0].id === point.id,
    { playCalls:played.playCalls, clickProbe, point });

  await configureRealShelf(provider, id);
  const reopened = await waitContentState('ready', true);
  const longPoint = await waitFor(() => clickableShelfRowPoint(Number(reopened.center) || 0), 5000, 80);
  const longPress = await cdp.call(function (screenPoint) {
    window.__lfClimaxPreviewTestConfig = { holdMs:10000, segmentSeconds:1 };
    var event = {
      target:renderer.domElement,
      clientX:screenPoint.x,
      clientY:screenPoint.y,
      pointerId:15,
      button:0,
      isPrimary:true,
    };
    var resolved = window.LumiFieldClimaxPreview.resolveShelfSong(event);
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles:true,
      cancelable:true,
      pointerId:15,
      pointerType:'mouse',
      isPrimary:true,
      button:0,
      clientX:screenPoint.x,
      clientY:screenPoint.y,
    }));
    var status = window.LumiFieldClimaxPreview.status();
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles:true,
      pointerId:15,
      pointerType:'mouse',
      isPrimary:true,
      button:0,
      clientX:screenPoint.x,
      clientY:screenPoint.y,
    }));
    return {
      resolved:resolved && {
        origin:resolved.origin,
        id:resolved.song && resolved.song.id,
        provider:resolved.song && resolved.song.provider,
      },
      status:status,
      diagnostics:window.LumiFieldClimaxPreview.diagnostics(),
    };
  }, [longPoint]);
  pass('3D row long-press resolver still enters the climax-preview hold path',
    longPress.resolved && longPress.resolved.origin === '3d-playlist-row' &&
    longPress.resolved.id === longPoint.id &&
    longPress.resolved.provider === provider &&
    longPress.status.origin === '3d-playlist-row' &&
    longPress.status.holding === true,
    longPress);

  const deleteUi = await cdp.call(function () {
    var content = shelfManager.getContentList();
    var requested = content.requestDelete();
    var modal = document.getElementById('playlist-delete-modal');
    var mutation = window.LumiFieldPlaylistMutation && window.LumiFieldPlaylistMutation.status
      ? window.LumiFieldPlaylistMutation.status()
      : null;
    var pending = mutation && mutation.pending;
    return {
      requested:requested,
      modalClass:modal && modal.className,
      modalText:modal && modal.textContent,
      pending:pending && {
        provider:pending.provider,
        id:pending.id,
        key:pending.key,
      },
      ref:content.getOpenPlaylistRef(),
    };
  });
  pass('3D playlist X still opens the non-destructive confirmation for the exact provider/id',
    deleteUi.requested === true && /\bshow\b/.test(deleteUi.modalClass || '') &&
    deleteUi.pending && deleteUi.pending.key === `${provider}:${id}` &&
    deleteUi.ref && deleteUi.ref.key === `${provider}:${id}`,
    deleteUi);
  await cdp.call(function () {
    if (typeof cancelPlaylistDelete === 'function') cancelPlaylistDelete();
    return true;
  });
  await screenshot('2d-3d-consistency-click-longpress-x');
}

async function verifyScopeAndLogoutCloseStaleDetail() {
  const provider = 'qq';
  const id = 'scope-close-15';
  await setHarnessLogin(provider, true);
  await setHarnessControl(provider, id, { mode:'ready', delay:20, tag:'scope' });
  await configureRealShelf(provider, id);
  await waitContentState('ready', true);
  const results = await cdp.call(async function (name) {
    var before = shelfManager.hasOpenContent();
    document.dispatchEvent(new CustomEvent('lumifield-current-platform-change', {
      detail:{ provider:'netease' }
    }));
    await new Promise(function (resolve) { setTimeout(resolve, 80); });
    var afterProvider = shelfManager.hasOpenContent();
    if (afterProvider && shelfManager.closeContent) shelfManager.closeContent();
    return { before:before, afterProvider:afterProvider, provider:name };
  }, [provider]);
  pass('platform change closes or invalidates an old-provider 3D detail',
    results.before === true && results.afterProvider === false,
    results);
}

async function run() {
  staticAudit();
  await startApp();
  const prepared = await prepareSurface();
  pass('real Electron renderer exposes shelf, importer and unified manager', 
    prepared.manager === 'object' && prepared.importer === 'object' && prepared.shelf === 'object',
    prepared);

  const live = await probeLiveSessions();
  pass('read-only live-session probe runs before any deterministic fixture is installed',
    live.fixtureInstalled === false && live.providers.length === PROVIDERS.length,
    live);
  const liveSamples = live.providers.filter(item => item.sampled);
  pass('every available live-session sample is canonical without fixture substitution',
    liveSamples.every(item => item.canonical === true),
    {
      configuredUserData:suppliedUserData || null,
      sampleCount:liveSamples.length,
      providers:live.providers,
      note:liveSamples.length ? 'live samples validated' :
        'no usable real session existed in this isolated profile; fixture checks below do not replace live acceptance',
    });

  const installed = await installDeterministicHarness();
  pass('deterministic harness declares its non-live scope and covers all five providers',
    installed.installed === true &&
    installed.disclaimer.includes('不作为真实平台数据验收证据') &&
    deepEqual(installed.providers.slice().sort(), PROVIDERS.slice().sort()),
    installed);
  const providerResults = await verifyFiveProviderReadyContract();
  await verifyAdapterIdAndModeInvariance();
  await verifyEmptyErrorAndLoginStates();
  await verifySupersededRequestIsolation();
  await verifyProviderCacheIsolation();
  await verifyPersistedP13Import();
  await verifyTwoAndThreeDimensionalConsistencyAndActions();
  await verifyScopeAndLogoutCloseStaleDetail();
  pass('real Electron renderer has zero uncaught exceptions',
    rendererErrors.length === 0, rendererErrors);

  const result = {
    ok:true,
    problem:15,
    mode:'real Electron/CDP 3D playlist unified-provider state, isolation and interaction audit',
    runId,
    origin,
    evidenceDir,
    providers:PROVIDERS,
    checks,
    providerResults,
    liveSessionEvidence:live,
    deterministicFixtureDisclaimer:
      '受控歌曲只验证loading/ready/empty/error/login/竞态/缓存/交互状态机，不冒充真实平台歌曲或真实Session验收。',
    screenshots,
    rendererErrors,
    appLogTail:appLog.join('').slice(-16000),
    completedAt:new Date().toISOString(),
  };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok:true,
    problem:15,
    resultFile,
    checks:Object.keys(checks).length,
    liveSamples:liveSamples.length,
    screenshots:screenshots.length,
    rendererErrors:rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  const failure = {
    ok:false,
    problem:15,
    runId,
    origin,
    evidenceDir,
    error:String(error && error.stack || error).slice(0, 16000),
    checkSummary:{ passed:Object.keys(checks).length, names:Object.keys(checks) },
    deterministicFixtureDisclaimer:
      '受控歌曲只验证状态机，不冒充真实平台歌曲或真实Session验收。',
    screenshots,
    rendererErrors,
    appLogTail:appLog.join('').slice(-16000),
    completedAt:new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  } catch (_) {}
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
});
