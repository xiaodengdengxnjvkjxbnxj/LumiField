'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_NEW3_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const skipScreenshots = process.env.LF_NEW3_SKIP_SCREENSHOTS === '1';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW3_OUT || path.join(repo, 'test-results', 'lf-new3-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new3-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(name, condition, detail) {
  assert.ok(condition, name + ': ' + JSON.stringify(detail));
  checks[name] = detail == null ? true : detail;
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
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        rendererErrors.push((message.params.args || []).map((arg) => String(arg.value || arg.description || '')).join(' ').slice(0, 1800));
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
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error((response.exceptionDetails.exception || {}).description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }

  call(fn, args) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')');
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function screenshot(name) {
  if (skipScreenshots) {
    appLog.push('[New3 screenshot skipped by LF_NEW3_SKIP_SCREENSHOTS] ' + name + '\n');
    return null;
  }
  try {
    const response = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    }, 12000);
    const file = path.join(evidenceDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
    screenshots.push(file);
    return file;
  } catch (error) {
    appLog.push('[New3 screenshot skipped] ' + name + ': ' + String(error && error.message || error) + '\n');
    return null;
  }
}

async function startApp() {
  const port = await freePort();
  const args = (installedExecutable ? [] : ['.']).concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920'
  ]);
  app = spawn(launchExecutable, args, {
    cwd: installedExecutable ? path.dirname(installedExecutable) : repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      LF_ALLOW_PACKAGED_CDP_TEST: installedExecutable ? '1' : '0',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' '
    })
  });
  const collect = (chunk) => {
    const value = String(chunk);
    appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) {
      rendererErrors.push(value.trim().slice(0, 1800));
    }
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find((item) => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 50000, 180);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false
  });
  await waitFor(() => cdp.call(function() {
    return document.readyState === 'complete' &&
      !!window.renderer &&
      !!window.shelfManager &&
      !!window.LumiFieldPlaylistMutation;
  }), 50000, 120);
  await delay(700);
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function() { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise((resolve) => app.once('exit', resolve)), delay(3500)]);
  }
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

function staticAudit() {
  const source = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const confirmStart = source.indexOf('async function confirmPlaylistDelete');
  const confirmEnd = source.indexOf('window.LumiFieldPlaylistMutation', confirmStart);
  const confirmSource = source.slice(confirmStart, confirmEnd);
  pass('delete control only draws for expanded playlists',
    /if\s*\(\s*open\s*&&\s*contentKind\s*===\s*['"]playlist['"]\s*&&\s*openPlaylistRef\s*\)[\s\S]{0,500}(?:fillText\(['"]×|drawCanvasClose)/.test(source),
    true);
  pass('delete hit is tested before song rows',
    source.indexOf('cl.isDeleteHit') > 0 &&
      source.indexOf('cl.isDeleteHit') < source.indexOf('cl.raycastRows', source.indexOf("renderer.domElement.addEventListener('click'")),
    true);
  pass('confirmation uses immutable provider account owner ownership and operation context',
    /Object\.freeze\s*\(\s*\{[\s\S]{0,900}currentAccountId:[\s\S]{0,300}ownership:[\s\S]{0,300}operation:/.test(source) &&
      /body:\s*JSON\.stringify\(\{[\s\S]{0,700}provider:\s*pending\.provider,[\s\S]{0,700}id:\s*pending\.id,[\s\S]{0,700}ownerId:\s*pending\.ownerId,[\s\S]{0,700}currentAccountId:\s*pending\.currentAccountId,[\s\S]{0,700}ownership:\s*pending\.ownership,[\s\S]{0,700}operation:\s*pending\.operation/.test(confirmSource),
    true);
  pass('failure removes nothing before confirmed ok',
    confirmStart >= 0 &&
      confirmSource.indexOf('if (!result || result.ok !== true)') >= 0 &&
      confirmSource.indexOf('if (!result || result.ok !== true)') < confirmSource.indexOf('applyConfirmedPlaylistRemoval(pending)'),
    true);
  pass('five cloud track endpoints exist',
    ['/api/playlist/tracks?id=', '/api/qq/playlist/tracks?id=', '/api/kugou/playlist/tracks?id=',
      '/api/kugou-concept/playlist/tracks?id=', '/api/qishui/playlist/tracks?id=']
      .every((endpoint) => source.includes(endpoint)),
    true);
}

async function prepare() {
  return cdp.call(function() {
    document.body.classList.remove('splash-active', 'empty-home-active', 'lf-auth-locked', 'immersive-mode');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var auth = document.getElementById('lf-auth-root');
    if (auth) auth.style.display = 'none';
    emptyHomeActive = false;
    homeForcedOpen = false;
    homeSuppressed = true;
    immersiveMode = false;
    window.hasAnyPlatformLogin = function() { return true; };
    window.__lfNew3Requests = [];
    window.__lfNew3Deferred = null;
    window.__lfNew3DeferredKey = '';
    window.__lfNew3OriginalApiJson = window.__lfNew3OriginalApiJson || window.apiJson;
    window.__lfNew3OriginalFetch = window.__lfNew3OriginalFetch || window.fetch;
    window.fetch = function(input, options) {
      var value = String(input && input.url || input || '');
      var endpoint = value.split('?')[0];
      if (/\/api\/(?:playlist|qq\/playlist|kugou\/playlist|kugou-concept\/playlist|qishui\/playlist)\/tracks$/.test(endpoint)) {
        window.__lfNew3Requests.push({ kind: 'tracks', url: value });
        return Promise.resolve(new Response(JSON.stringify({
          tracks: [
            { id: 'track-1', name: 'New 3 Track One', artist: 'LumiField QA', cover: '' },
            { id: 'track-2', name: 'New 3 Track Two', artist: 'LumiField QA', cover: '' }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return window.__lfNew3OriginalFetch.apply(this, arguments);
    };
    window.apiJson = function(url, options) {
      var value = String(url || '');
      if (value.indexOf('/api/playlist/mutate') >= 0) {
        var body = JSON.parse(options && options.body || '{}');
        window.__lfNew3Requests.push({
          kind: 'mutation',
          url: value,
          provider: body.provider,
          id: body.id,
          ownerId: body.ownerId,
          currentAccountId: body.currentAccountId,
          ownership: body.ownership,
          operation: body.operation,
          method: options && options.method
        });
        var key = String(body.provider) + ':' + String(body.id);
        if (window.__lfNew3DeferredKey === key) {
          return new Promise(function(resolve, reject) {
            window.__lfNew3Deferred = { resolve: resolve, reject: reject, key: key };
          });
        }
        if (body.provider !== 'netease') {
          return Promise.resolve({
            ok:true,
            provider:body.provider,
            playlistId:body.id,
            currentAccountId:body.currentAccountId,
            operation:'remove-local',
            localOnly:true,
            remoteMutated:false,
            platformUnchanged:true,
            notice:'仅从LF移除，平台端未删除'
          });
        }
        return Promise.resolve({
          ok:true,
          operation:body.operation,
          provider:body.provider,
          playlistId:body.id,
          localOnly:false,
          remoteMutated:true
        });
      }
      var endpoint = value.split('?')[0];
      if (/\/api\/(?:playlist|qq\/playlist|kugou\/playlist|kugou-concept\/playlist|qishui\/playlist)\/tracks$/.test(endpoint)) {
        window.__lfNew3Requests.push({ kind: 'tracks', url: value });
        return Promise.resolve({
          tracks: [
            { id: 'track-1', name: 'New 3 Track One', artist: 'LumiField QA', cover: '' },
            { id: 'track-2', name: 'New 3 Track Two', artist: 'LumiField QA', cover: '' }
          ]
        });
      }
      return window.__lfNew3OriginalApiJson.apply(this, arguments);
    };
    loginStatus.loggedIn = true;
    loginStatus.userId = 'new3-netease-account';
    qqLoginStatus.loggedIn = true;
    qqLoginStatus.userId = 'new3-qq-account';
    kugouLoginStatus.loggedIn = true;
    kugouLoginStatus.userId = 'new3-kugou-account';
    kugouConceptLoginStatus.loggedIn = true;
    kugouConceptLoginStatus.userId = 'new3-kugou-concept-account';
    qishuiLoginStatus.loggedIn = true;
    qishuiLoginStatus.userId = 'new3-qishui-account';
    return true;
  });
}

async function setPlaylists(items, mode) {
  return cdp.call(async function(nextItems, nextMode) {
    if (playlistMutationState.busy) throw new Error('mutation still busy');
    if (playlistMutationState.pending) cancelPlaylistDelete();
    if (shelfManager.hasOpenContent()) shelfManager.closeContent();
    document.body.classList.remove('immersive-mode');
    immersiveMode = false;
    userPlaylists = nextItems.map(function(item) {
      return Object.assign({
        trackCount: 2,
        songCount: 2,
        playCount: 12,
        subscribed: false,
        ownership: 'owned',
        ownerId: 'new3-owner',
        cover: ''
      }, item);
    });
    qqPlaylists = userPlaylists.filter(function(item) { return item.provider === 'qq'; }).slice();
    kugouPlaylists = userPlaylists.filter(function(item) { return item.provider === 'kugou'; }).slice();
    kugouConceptPlaylists = userPlaylists.filter(function(item) { return item.provider === 'kugou_concept'; }).slice();
    qishuiPlaylists = userPlaylists.filter(function(item) { return item.provider === 'qishui'; }).slice();
    [
      { provider:'netease', status:loginStatus },
      { provider:'qq', status:qqLoginStatus },
      { provider:'kugou', status:kugouLoginStatus },
      { provider:'kugou_concept', status:kugouConceptLoginStatus },
      { provider:'qishui', status:qishuiLoginStatus }
    ].forEach(function(entry) {
      entry.status.playlists = userPlaylists.filter(function(item) { return item.provider === entry.provider; }).slice();
    });
    homeDiscoverState.playlists = userPlaylists.slice();
    setShelfMode(nextMode);
    setShelfPinnedOpen(true, true);
    shelfManager.rebuild(false);
    await new Promise(function(resolve) { setTimeout(resolve, 650); });
    return {
      mode: shelfManager.getMode(),
      count: shelfManager.getCards().length,
      open: shelfManager.hasOpenContent(),
      deletePoint: shelfManager.getContentList() && shelfManager.getContentList().getDeleteScreenPoint()
    };
  }, [items, mode]);
}

async function openCard(index) {
  return cdp.call(async function(cardIndex) {
    shelfManager.openContent(cardIndex);
    await new Promise(function(resolve) { setTimeout(resolve, 850); });
    var list = shelfManager.getContentList();
    return {
      open: shelfManager.hasOpenContent(),
      ref: list && list.getOpenPlaylistRef(),
      point: list && list.getDeleteScreenPoint()
    };
  }, [index]);
}

async function clickDeletePoint() {
  return cdp.call(async function() {
    var list = shelfManager.getContentList();
    var point = list && list.getDeleteScreenPoint();
    if (!point) return { point: null, status: window.LumiFieldPlaylistMutation.status() };
    mouseDownAt.hadDrag = false;
    renderer.domElement.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0
    }));
    await new Promise(function(resolve) { setTimeout(resolve, 440); });
    var modal = document.getElementById('playlist-delete-modal');
    return {
      point: point,
      status: window.LumiFieldPlaylistMutation.status(),
      modal: !!(modal && modal.classList.contains('show')),
      display: modal && getComputedStyle(modal).display,
      visibility: modal && getComputedStyle(modal).visibility,
      pointerEvents: modal && getComputedStyle(modal).pointerEvents
    };
  });
}

async function testModeHit(mode, immersive) {
  const id = 'hit-' + mode + (immersive ? '-immersive' : '');
  const before = await setPlaylists([{ id, name: 'Hit ' + mode, provider: 'netease' }], mode);
  pass(mode + (immersive ? ' immersive' : '') + ' unexpanded has no delete target',
    !before.open && before.deletePoint == null,
    before);
  const opened = await openCard(0);
  pass(mode + (immersive ? ' immersive' : '') + ' expanded has exact X target',
    opened.open && opened.point && opened.ref && opened.ref.key === 'netease:' + id,
    opened);
  if (immersive) {
    await cdp.call(function() {
      immersiveMode = true;
      document.body.classList.add('immersive-mode');
      return true;
    });
  }
  const hit = await clickDeletePoint();
  pass(mode + (immersive ? ' immersive' : '') + ' real canvas X hit opens modal',
    hit.modal &&
      hit.display === 'flex' &&
      hit.visibility === 'visible' &&
      hit.pointerEvents !== 'none' &&
      hit.status.pending &&
      hit.status.pending.key === 'netease:' + id,
    hit);
  if (immersive) {
    pass('immersive delete modal remains visible and interactive',
      hit.display === 'flex' && hit.visibility === 'visible' && hit.pointerEvents !== 'none',
      hit);
    await screenshot('01-immersive-delete-confirmation');
  }
  const cancelled = await cdp.call(async function() {
    var beforeIds = userPlaylists.map(function(item) { return item.provider + ':' + item.id; });
    var requestCount = window.__lfNew3Requests.filter(function(item) { return item.kind === 'mutation'; }).length;
    window.LumiFieldPlaylistMutation.cancel();
    await new Promise(function(resolve) { setTimeout(resolve, 450); });
    return {
      beforeIds: beforeIds,
      afterIds: userPlaylists.map(function(item) { return item.provider + ':' + item.id; }),
      requestCountBefore: requestCount,
      requestCountAfter: window.__lfNew3Requests.filter(function(item) { return item.kind === 'mutation'; }).length,
      pending: window.LumiFieldPlaylistMutation.status().pending,
      modal: document.getElementById('playlist-delete-modal').classList.contains('show')
    };
  });
  pass(mode + (immersive ? ' immersive' : '') + ' No retains data and sends no request',
    JSON.stringify(cancelled.beforeIds) === JSON.stringify(cancelled.afterIds) &&
      cancelled.requestCountBefore === cancelled.requestCountAfter &&
      cancelled.pending == null &&
      cancelled.modal === false,
    cancelled);
}

async function testLocalPersistentDeletion() {
  const setup = await cdp.call(async function() {
    if (playlistMutationState.pending && !playlistMutationState.busy) cancelPlaylistDelete();
    if (shelfManager.hasOpenContent()) shelfManager.closeContent();
    var tracks = [{ id: 'local-song-1', provider: 'local', type: 'local', name: 'Local Track', artist: 'LF QA', localUrl: 'blob:lf-new3' }];
    localPlaylists = [
      normalizeUserPlaylist('local', { id: 'local-delete', name: 'Local Delete', songs: tracks, trackCount: 1, ownership: 'owned' }),
      normalizeUserPlaylist('local', { id: 'local-keep', name: 'Local Keep', songs: tracks, trackCount: 1, ownership: 'owned' })
    ];
    userPlaylists = localPlaylists.slice();
    if (!persistLocalPlaylists()) throw new Error('local fixture persistence failed');
    window.__lfNew3Requests = [];
    setShelfMode('side');
    setShelfPinnedOpen(true, true);
    shelfManager.rebuild(false);
    await new Promise(function(resolve) { setTimeout(resolve, 650); });
    return {
      cards: shelfManager.getCards().length,
      stored: JSON.parse(localStorage.getItem(LOCAL_PLAYLIST_STORE_KEY) || '[]').map(function(item) { return item.id; })
    };
  });
  pass('local playlist fixture is persisted and rendered',
    setup.cards === 2 && setup.stored.includes('local-delete') && setup.stored.includes('local-keep'),
    setup);
  const opened = await openCard(0);
  pass('local expanded playlist exposes exact X target',
    opened.open && opened.ref && opened.ref.key === 'local:local-delete' && opened.point,
    opened);
  const hit = await clickDeletePoint();
  pass('local X opens exact confirmation',
    hit.modal && hit.status.pending && hit.status.pending.key === 'local:local-delete',
    hit);
  const result = await cdp.call(async function() {
    var mutationRequestsBefore = window.__lfNew3Requests.filter(function(item) { return item.kind === 'mutation'; }).length;
    var ok = await window.LumiFieldPlaylistMutation.confirm();
    await new Promise(function(resolve) { setTimeout(resolve, 520); });
    var stored = JSON.parse(localStorage.getItem(LOCAL_PLAYLIST_STORE_KEY) || '[]');
    return {
      ok: ok,
      mutationRequestsBefore: mutationRequestsBefore,
      mutationRequestsAfter: window.__lfNew3Requests.filter(function(item) { return item.kind === 'mutation'; }).length,
      userIds: userPlaylists.map(function(item) { return item.provider + ':' + item.id; }),
      localIds: localPlaylists.map(function(item) { return item.provider + ':' + item.id; }),
      storedIds: stored.map(function(item) { return String(item.provider || '') + ':' + String(item.id || ''); }),
      open: shelfManager.hasOpenContent(),
      cards: shelfManager.getCards().length
    };
  });
  pass('local Yes deletes exact persistent record without cloud request',
    result.ok &&
      result.mutationRequestsBefore === result.mutationRequestsAfter &&
      !result.userIds.includes('local:local-delete') &&
      result.userIds.includes('local:local-keep') &&
      !result.localIds.includes('local:local-delete') &&
      result.localIds.includes('local:local-keep') &&
      !result.storedIds.includes('local:local-delete') &&
      result.storedIds.includes('local:local-keep') &&
      !result.open &&
      result.cards === 1,
    result);
}

async function testFivePlatformRouting() {
  const expected = {
    netease: '/api/playlist/tracks?id=route-netease',
    qq: '/api/qq/playlist/tracks?id=route-qq',
    kugou: '/api/kugou/playlist/tracks?id=route-kugou',
    kugou_concept: '/api/kugou-concept/playlist/tracks?id=route-kugou_concept',
    qishui: '/api/qishui/playlist/tracks?id=route-qishui'
  };
  const actual = await cdp.call(async function(providers) {
    window.__lfNew3Requests = [];
    var list = shelfManager.getContentList();
    var result = {};
    for (var i = 0; i < providers.length; i++) {
      var provider = providers[i];
      var id = 'route-' + provider;
      await list.open((provider === 'netease' ? '' : provider + ':') + id, 'Route ' + provider, null);
      var tracks = window.__lfNew3Requests.filter(function(item) { return item.kind === 'tracks'; });
      result[provider] = {
        ref: list.getOpenPlaylistRef(),
        url: tracks.length ? tracks[tracks.length - 1].url : ''
      };
    }
    list.close();
    return result;
  }, [Object.keys(expected)]);
  Object.keys(expected).forEach((provider) => {
    pass(provider + ' playlist track route is exact',
      actual[provider] &&
        actual[provider].ref &&
        actual[provider].ref.provider === provider &&
        actual[provider].ref.id === 'route-' + provider &&
        actual[provider].url === expected[provider],
      actual[provider]);
  });
}

async function testUnsupportedRetention() {
  const providers = ['qq', 'kugou', 'kugou_concept', 'qishui'];
  const result = await cdp.call(async function(items) {
    userPlaylists = items.map(function(provider, index) {
      var ownership = index % 2 ? 'subscribed' : 'owned';
      return {
        id:'remove-' + provider,
        name:'Remove ' + provider,
        provider:provider,
        trackCount:2,
        ownerId:'owner-' + provider,
        ownership:ownership,
        owned:ownership === 'owned',
        subscribed:ownership === 'subscribed'
      };
    });
    qqPlaylists = userPlaylists.filter(function(item) { return item.provider === 'qq'; }).slice();
    kugouPlaylists = userPlaylists.filter(function(item) { return item.provider === 'kugou'; }).slice();
    kugouConceptPlaylists = userPlaylists.filter(function(item) { return item.provider === 'kugou_concept'; }).slice();
    qishuiPlaylists = userPlaylists.filter(function(item) { return item.provider === 'qishui'; }).slice();
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var provider = items[i];
      var id = 'remove-' + provider;
      var record = userPlaylists.find(function(item) { return item.provider === provider && item.id === id; });
      window.LumiFieldPlaylistMutation.open({
        provider: provider,
        id: id,
        key: provider + ':' + id,
        title: 'Keep ' + provider
      });
      var ok = await window.LumiFieldPlaylistMutation.confirm();
      var statusText = document.getElementById('playlist-delete-status').textContent;
      var lastResult = window.LumiFieldPlaylistMutation.status().lastResult;
      var hidden = [];
      try { hidden = JSON.parse(localStorage.getItem('lumifield-hidden-playlists-v1') || '[]'); } catch (_) {}
      out.push({
        provider: provider,
        id: id,
        ok: ok,
        statusText: statusText,
        ownership:record.ownership,
        retained:userPlaylists.some(function(item) { return item.provider === provider && item.id === id; }),
        lastResult:lastResult,
        persisted:hidden.some(function(item) { return item && item.provider === provider && item.playlistId === id && item.operation === 'remove-local' && item.remoteMutated === false; }),
        request: window.__lfNew3Requests.filter(function(item) {
          return item.kind === 'mutation' && item.provider === provider && item.id === id;
        }).slice(-1)[0] || null
      });
      window.LumiFieldPlaylistMutation.cancel();
    }
    return out;
  }, [providers]);
  result.forEach((item) => {
    const accountId = item.provider === 'qq' ? 'new3-qq-account' : (item.provider === 'kugou' ? 'new3-kugou-account' : (item.provider === 'kugou_concept' ? 'new3-kugou-concept-account' : 'new3-qishui-account'));
    pass(item.provider + ' uses precise LF-only immutable-context contract',
      item.ok === true &&
        item.retained === false &&
        item.request &&
        item.request.method === 'POST' &&
        item.request.ownerId === 'owner-' + item.provider &&
        item.request.currentAccountId === accountId &&
        item.request.ownership === item.ownership &&
        item.request.operation === 'remove-local' &&
        item.lastResult && item.lastResult.localOnly === true && item.lastResult.remoteMutated === false &&
        item.lastResult.operation === 'remove-local' && item.lastResult.notice === '仅从LF移除，平台端未删除' &&
        item.persisted,
      item);
  });
}

async function testExactSuccess() {
  await setPlaylists([
    { id: 'delete-a', name: 'Delete A', provider: 'netease' },
    { id: 'keep-b', name: 'Keep B', provider: 'netease' }
  ], 'side');
  await openCard(0);
  const hit = await clickDeletePoint();
  pass('Yes test opens exact A confirmation', hit.status.pending && hit.status.pending.key === 'netease:delete-a', hit);
  const result = await cdp.call(async function() {
    var ok = await window.LumiFieldPlaylistMutation.confirm();
    await new Promise(function(resolve) { setTimeout(resolve, 520); });
    var request = window.__lfNew3Requests.filter(function(item) {
      return item.kind === 'mutation' && item.id === 'delete-a';
    }).slice(-1)[0] || null;
    return {
      ok: ok,
      request: request,
      ids: userPlaylists.map(function(item) { return item.provider + ':' + item.id; }),
      open: shelfManager.hasOpenContent(),
      pending: window.LumiFieldPlaylistMutation.status().pending,
      modal: document.getElementById('playlist-delete-modal').classList.contains('show')
    };
  });
  pass('Yes deletes exact playlist and refreshes 3D/main state',
    result.ok &&
      result.request &&
      result.request.provider === 'netease' &&
      result.request.id === 'delete-a' &&
      result.request.ownerId === 'new3-owner' &&
      result.request.currentAccountId === 'new3-netease-account' &&
      result.request.ownership === 'owned' &&
      result.request.operation === 'delete' &&
      !result.ids.includes('netease:delete-a') &&
      result.ids.includes('netease:keep-b') &&
      !result.open &&
      result.pending == null &&
      !result.modal,
    result);
}

async function testResponseRace() {
  await setPlaylists([
    { id: 'race-a', name: 'Race A', provider: 'netease' },
    { id: 'race-b', name: 'Race B', provider: 'netease' }
  ], 'stage');
  await openCard(0);
  await clickDeletePoint();
  const started = await cdp.call(function() {
    window.__lfNew3DeferredKey = 'netease:race-a';
    window.__lfNew3RacePromise = window.LumiFieldPlaylistMutation.confirm();
    return true;
  });
  pass('race mutation started', started, true);
  await waitFor(() => cdp.call(function() { return !!window.__lfNew3Deferred; }), 5000, 50);
  const switched = await cdp.call(async function() {
    var list = shelfManager.getContentList();
    await list.open('race-b', 'Race B', shelfManager.getCardAt(1));
    return { open: list.isOpen(), ref: list.getOpenPlaylistRef() };
  });
  pass('race switches detail to B while A waits',
    switched.open && switched.ref && switched.ref.key === 'netease:race-b',
    switched);
  const result = await cdp.call(async function() {
    window.__lfNew3Deferred.resolve({ ok:true, operation:'delete', localOnly:false, remoteMutated:true });
    var ok = await window.__lfNew3RacePromise;
    await new Promise(function(resolve) { setTimeout(resolve, 650); });
    var list = shelfManager.getContentList();
    return {
      ok: ok,
      ids: userPlaylists.map(function(item) { return item.provider + ':' + item.id; }),
      open: list && list.isOpen(),
      ref: list && list.getOpenPlaylistRef(),
      cards: shelfManager.getCards().length
    };
  });
  pass('late A response never removes or closes switched B',
    result.ok &&
      !result.ids.includes('netease:race-a') &&
      result.ids.includes('netease:race-b') &&
      result.open &&
      result.ref &&
      result.ref.key === 'netease:race-b' &&
      result.cards === 1,
    result);
}

async function run() {
  staticAudit();
  await startApp();
  await prepare();
  await testModeHit('side', false);
  await testModeHit('stage', false);
  await testModeHit('side', true);
  await cdp.call(function() {
    if (playlistMutationState.pending && !playlistMutationState.busy) cancelPlaylistDelete();
    immersiveMode = false;
    document.body.classList.remove('immersive-mode');
    return true;
  });
  await testFivePlatformRouting();
  await testUnsupportedRetention();
  await testExactSuccess();
  await testResponseRace();
  await testLocalPersistentDeletion();
  await screenshot('02-local-delete-complete');
  pass('rendererErrors=0', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    runId,
    launchMode,
    executable: installedExecutable || '',
    evidenceDir,
    checks,
    screenshots,
    rendererErrors
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    launchMode,
    evidenceDir,
    checkCount: Object.keys(checks).length,
    rendererErrors: rendererErrors.length
  }, null, 2));
}

run().catch((error) => {
  const failure = {
    ok: false,
    error: String(error && error.stack || error),
    evidenceDir,
    checks,
    screenshots,
    rendererErrors
  };
  try { fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2)); } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('')); } catch (_) {}
  await stopApp();
});
