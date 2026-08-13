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
const evidenceDir = path.resolve(process.env.LF_MASTER_PROBLEM12_OUT ||
  path.join(repo, 'test-results', 'lf-master-problem12-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem12-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

const PROVIDERS = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
const LABELS = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  qishui: '汽水音乐',
};
const USER_A = 'lf-problem12-user-a';
const USER_B = 'lf-problem12-user-b';

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function compact(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 1800 ? `${value.slice(0, 1800)}…` : value;
  if (value instanceof Error) return compact({ name: value.name, message: value.message, code: value.code }, depth);
  if (depth >= 5) {
    return Array.isArray(value) ? `[Array(${value.length})]` : `{Object(${Object.keys(value).length})}`;
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, 20).map(item => compact(item, depth + 1));
    if (value.length > 20) result.push({ truncatedItems: value.length - 20 });
    return result;
  }
  if (typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value);
    keys.slice(0, 50).forEach(key => { result[key] = compact(value[key], depth + 1); });
    if (keys.length > 50) result.__truncatedKeys = keys.length - 50;
    return result;
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
  const result = {};
  Object.keys(value).sort().forEach(key => { result[key] = stableJson(value[key]); });
  return result;
}

function deepEqual(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function fixtureBundle() {
  const statuses = {};
  const playlists = {};
  PROVIDERS.forEach((provider, index) => {
    const label = LABELS[provider];
    const membershipLabel = provider === 'netease'
      ? '网易云 SVIP'
      : (provider === 'qq' ? 'QQ VIP 会员' : `${label}尊享会员P12`);
    const profile = {
      provider,
      userId: `p12-${provider}-uid-80${index + 1}`,
      nickname: `${label}P12真实账号`,
      avatar: `https://fixture.invalid/p12/${provider}-avatar.png`,
      vipType: index + 1,
      vipLevel: index === 0 ? 'svip' : 'vip',
      isVip: true,
      isSvip: index === 0,
      membershipLabel,
      membershipVerified: true,
      profileVerified: true,
      playlistsVerified: true,
      playlistCount: 2,
      sessionValid: true,
    };
    statuses[provider] = Object.assign({
      ok: true,
      loggedIn: true,
      sessionState: 'valid',
      playlists: [],
    }, profile, { profile: clone(profile) });
    playlists[provider] = [1, 2].map(number => ({
      id: `${provider}-playlist-${number}`,
      playlistId: `${provider}-playlist-${number}`,
      provider,
      name: `${label}P12歌单${number}`,
      cover: `https://fixture.invalid/p12/${provider}-playlist-${number}.png`,
      songCount: number + 2,
      trackCount: number + 2,
      playCount: number * 100,
      creator: `${label}P12真实账号`,
      subscribed: false,
      songs: [{
        id: `${provider}-song-${number}`,
        provider,
        source: provider,
        name: `${label}歌曲${number}`,
        artist: `${label}歌手`,
      }],
    }));
  });
  return { statuses, playlists };
}

function playlistKeys(provider) {
  return [1, 2].map(number => `${provider}:${provider}-playlist-${number}`).sort();
}

function getPath(value, paths) {
  for (const fieldPath of paths) {
    const result = String(fieldPath).split('.').reduce((current, key) =>
      current == null ? undefined : current[key], value);
    if (result !== undefined) return result;
  }
  return undefined;
}

function modeOf(debug) {
  if (debug && debug.multiProviderMode === true) return 'multi';
  const mode = String(getPath(debug, ['mode', 'accountMode']) || '');
  if (mode === 'multi') return 'multi';
  return String(getPath(debug, ['activeProvider', 'provider', 'accountProvider']) || mode);
}

function playlistProviderOf(debug) {
  return String(getPath(debug, ['playlistProvider', 'selectedPlaylistProvider', 'playlist.provider']) || '');
}

function providerDetailsOf(debug) {
  const raw = getPath(debug, ['providers', 'platforms', 'details', 'platformDetails']);
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map(item => [String(item && item.provider || ''), item]));
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function keyListOf(value, paths) {
  const list = getPath(value, paths);
  return Array.isArray(list) ? list.map(String).sort() : null;
}

function partitionMapOf(debug) {
  const raw = getPath(debug, ['providers', 'partitions', 'platforms', 'sessions']);
  const result = {};
  if (Array.isArray(raw)) {
    raw.forEach(item => {
      const provider = String(item && item.provider || '');
      if (provider) result[provider] = item;
    });
  } else if (raw && typeof raw === 'object') {
    PROVIDERS.forEach(provider => {
      if (raw[provider]) result[provider] = raw[provider];
    });
  }
  return result;
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
        rendererErrors.push(String(detail.exception && detail.exception.description ||
          detail.text || 'Renderer exception').slice(0, 3000));
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
    const first = await cdp.call(function (expectedOrigin) {
      if (!document.body || location.origin !== expectedOrigin) return null;
      const hub = window.LumiFieldMultiPlatform;
      const desktop = window.desktopWindow;
      const methods = ['getDebug', 'setMode', 'setPlaylistProvider', 'refreshDetails', 'setTestUser'];
      const ready = document.readyState === 'complete' && hub &&
        methods.every(function (name) { return typeof hub[name] === 'function'; }) &&
        window.LumiFieldMusicPlatformManager &&
        typeof window.LumiFieldMusicPlatformManager.status === 'function' &&
        typeof window.LumiFieldMusicPlatformManager.playlists === 'function' &&
        desktop && typeof desktop.setMusicPlatformAccountScope === 'function' &&
        typeof desktop.getMusicPlatformAccountScopeDebug === 'function';
      return ready ? { timeOrigin: performance.timeOrigin, href: location.href } : null;
    }, [origin]);
    if (!first) return false;
    await delay(180);
    return cdp.call(function (expectedOrigin, marker) {
      if (!document.body || location.origin !== expectedOrigin ||
          performance.timeOrigin !== marker.timeOrigin || location.href !== marker.href) return false;
      const hub = window.LumiFieldMultiPlatform;
      const desktop = window.desktopWindow;
      return document.readyState === 'complete' && hub &&
        ['getDebug', 'setMode', 'setPlaylistProvider', 'refreshDetails', 'setTestUser']
          .every(function (name) { return typeof hub[name] === 'function'; }) &&
        desktop && typeof desktop.setMusicPlatformAccountScope === 'function' &&
        typeof desktop.getMusicPlatformAccountScopeDebug === 'function';
    }, [origin, first]);
  }, 70000, 80);
}

async function startApp() {
  const port = await freePort();
  app = spawn(electron, [
    '.',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920',
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
  await delay(300);
}

async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(evidenceDir, `${String(screenshots.length + 1).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function reloadPage() {
  const before = await cdp.call(function () { return performance.timeOrigin; });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => cdp.call(function (marker) {
    return document.readyState === 'complete' && performance.timeOrigin !== marker;
  }, [before]), 60000, 100);
  await pageReady();
}

async function installFixtures(bundle) {
  return cdp.call(function (payload) {
    const manager = window.LumiFieldMusicPlatformManager;
    if (!manager) throw new Error('LumiFieldMusicPlatformManager missing');
    const copy = function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
    const prior = window.__lfP12Harness;
    if (prior && prior.originals) {
      if (prior.originals.status) manager.status = prior.originals.status;
      if (prior.originals.playlists) manager.playlists = prior.originals.playlists;
      if (prior.originals.logout) manager.logout = prior.originals.logout;
    }
    const harness = {
      statuses: copy(payload.statuses),
      playlists: copy(payload.playlists),
      controls: {},
      calls: { status: [], playlists: [], logout: [] },
      originals: {
        status: manager.status,
        playlists: manager.playlists,
        logout: manager.logout,
      },
    };
    payload.providers.forEach(function (provider) {
      harness.controls[provider] = { delay: 0, error: '' };
    });
    manager.status = function (provider) {
      provider = String(provider || '');
      harness.calls.status.push({ provider: provider, at: Date.now() });
      return Promise.resolve(copy(harness.statuses[provider]));
    };
    manager.playlists = function (provider) {
      provider = String(provider || '');
      const control = copy(harness.controls[provider] || {});
      const response = copy(harness.playlists[provider] || []);
      harness.calls.playlists.push({ provider: provider, at: Date.now(), control: control });
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (control.error) {
            const error = new Error(control.error);
            error.code = control.error;
            reject(error);
          } else {
            resolve({
              ok: true,
              provider: provider,
              playlists: response,
              playlistsVerified: true,
            });
          }
        }, Math.max(0, Number(control.delay) || 0));
      });
    };
    manager.logout = function (provider) {
      harness.calls.logout.push({ provider: String(provider || ''), at: Date.now() });
      return Promise.resolve({ ok: true });
    };
    window.__lfP12Harness = harness;
    document.querySelectorAll('.modal-mask.show').forEach(function (mask) { mask.classList.remove('show'); });
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    return {
      providers: Object.keys(harness.statuses),
      managerMethods: {
        status: typeof manager.status,
        playlists: typeof manager.playlists,
        logout: typeof manager.logout,
      },
    };
  }, [Object.assign({ providers: PROVIDERS }, bundle)]);
}

async function setHarnessStatus(provider, patch) {
  return cdp.call(function (name, next) {
    const harness = window.__lfP12Harness;
    if (!harness) throw new Error('fixture harness missing');
    harness.statuses[name] = Object.assign({}, harness.statuses[name] || {}, next || {});
    if (next && next.profile && typeof next.profile === 'object') {
      harness.statuses[name].profile = Object.assign({}, harness.statuses[name].profile || {}, next.profile);
    }
    return JSON.parse(JSON.stringify(harness.statuses[name]));
  }, [provider, patch]);
}

async function setHarnessControl(provider, control) {
  return cdp.call(function (name, next) {
    const harness = window.__lfP12Harness;
    harness.controls[name] = Object.assign({ delay: 0, error: '' }, next || {});
    return JSON.parse(JSON.stringify(harness.controls[name]));
  }, [provider, control]);
}

async function callsSnapshot() {
  return cdp.call(function () {
    const calls = window.__lfP12Harness && window.__lfP12Harness.calls;
    return calls ? JSON.parse(JSON.stringify(calls)) : null;
  });
}

async function hubDebug() {
  return cdp.call(function () {
    return window.LumiFieldMultiPlatform.getDebug();
  });
}

async function configureQueueInvariant() {
  return cdp.call(function () {
    playQueue = [
      { id: 'p12-queue-1', provider: 'netease', source: 'netease', name: '队列保留歌曲一', artist: 'P12' },
      { id: 'p12-queue-2', provider: 'qq', source: 'qq', name: '队列保留歌曲二', artist: 'P12' },
    ];
    currentIdx = 1;
    if (!audio) audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    return {
      queue: playQueue.map(function (song) {
        return { id: song.id, provider: song.provider, name: song.name };
      }),
      currentIdx: currentIdx,
      src: audio.src,
    };
  });
}

async function queueSnapshot() {
  return cdp.call(function () {
    return {
      queue: playQueue.map(function (song) {
        return { id: song.id, provider: song.provider, name: song.name };
      }),
      currentIdx: currentIdx,
      src: audio && audio.src || '',
    };
  });
}

async function verifyApiAndDetails(bundle) {
  const surface = await cdp.call(function () {
    const hub = window.LumiFieldMultiPlatform;
    const desktop = window.desktopWindow;
    return {
      hub: ['getDebug', 'setMode', 'setPlaylistProvider', 'refreshDetails', 'setTestUser']
        .map(function (name) { return [name, typeof hub[name]]; }),
      desktop: ['setMusicPlatformAccountScope', 'getMusicPlatformAccountScopeDebug']
        .map(function (name) { return [name, typeof desktop[name]]; }),
    };
  });
  pass('problem 12 exposes the exact renderer and desktop debug API contract',
    surface.hub.every(entry => entry[1] === 'function') &&
    surface.desktop.every(entry => entry[1] === 'function'), surface);

  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  }, [USER_A]);
  const debug = await hubDebug();
  const details = providerDetailsOf(debug);
  pass('multi-platform debug contains all five formal providers',
    PROVIDERS.every(provider => details[provider] && typeof details[provider] === 'object'), Object.keys(details));

  PROVIDERS.forEach(provider => {
    const expected = bundle.statuses[provider];
    const detail = details[provider];
    const label = String(getPath(detail, ['label', 'platformName', 'name']) || '');
    const playlistCount = Number(getPath(detail, ['playlistCount', 'playlistsCount']));
    const sessionValid = getPath(detail, ['sessionValid', 'session.valid']);
    pass(`${provider}: real account detail exposes platform, nickname, UID, membership, login, playlist count and session`,
      label === LABELS[provider] &&
      String(detail.nickname || '') === expected.nickname &&
      String(detail.userId || '') === expected.userId &&
      String(detail.membershipLabel || '') === expected.membershipLabel &&
      detail.loggedIn === true &&
      playlistCount === 2 &&
      sessionValid === true, {
        label,
        nickname: detail.nickname,
        userId: detail.userId,
        membershipLabel: detail.membershipLabel,
        loggedIn: detail.loggedIn,
        playlistCount,
        sessionValid,
      });
  });
  const calls = await callsSnapshot();
  pass('details refresh queries all five platform sessions through the unified manager',
    PROVIDERS.every(provider => calls.status.some(call => call.provider === provider)), calls.status);
}

async function verifyMultiMode(bundle) {
  await cdp.call(async function () {
    await window.LumiFieldMultiPlatform.setMode('multi');
    if (typeof renderUserBtn === 'function') renderUserBtn();
    document.body.classList.remove('immersive-mode');
    return true;
  });
  const main = await cdp.call(function () {
    const button = document.getElementById('user-btn');
    return {
      text: button ? button.textContent.trim() : '',
      images: button ? button.querySelectorAll('img').length : -1,
      html: button ? button.innerHTML : '',
      title: button ? button.title : '',
    };
  });
  pass('main interface multi mode top account is strict pure text with no avatar',
    main.text === '多平台登录' &&
    main.images === 0 &&
    !PROVIDERS.some(provider => main.text.includes(bundle.statuses[provider].nickname)) &&
    !Object.values(LABELS).some(label => main.text.includes(label)), main);

  const secondary = await cdp.call(function () {
    document.body.classList.add('immersive-mode');
    if (typeof renderUserBtn === 'function') renderUserBtn();
    const button = document.getElementById('user-btn');
    const result = {
      text: button ? button.textContent.trim() : '',
      images: button ? button.querySelectorAll('img').length : -1,
      html: button ? button.innerHTML : '',
    };
    document.body.classList.remove('immersive-mode');
    return result;
  });
  pass('secondary interface multi mode top account is strict pure text with no avatar',
    secondary.text === '多平台登录' && secondary.images === 0, secondary);

  const modal = await cdp.call(function () {
    const button = document.getElementById('user-btn');
    if (button) button.click();
    const mask = document.getElementById('user-modal');
    const rows = Array.from(document.querySelectorAll('#multi-platform-account-list .multi-platform-account-row'));
    return {
      visible: !!(mask && mask.classList.contains('show')),
      rowCount: rows.length,
      rows: rows.map(function (row) {
        return {
          provider: row.getAttribute('data-provider') || row.getAttribute('data-account-provider') || '',
          text: row.textContent.replace(/\s+/g, ' ').trim(),
        };
      }),
      text: mask ? mask.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  });
  pass('clicking multi top account opens exactly five platform detail rows',
    modal.visible && modal.rowCount === 5 &&
    PROVIDERS.every(provider => modal.rows.filter(row => row.provider === provider).length === 1), modal);
  PROVIDERS.forEach(provider => {
    const row = modal.rows.find(item => item.provider === provider);
    const expected = bundle.statuses[provider];
    pass(`${provider}: modal row shows all seven required true fields`,
      !!row &&
      row.text.includes(LABELS[provider]) &&
      row.text.includes(expected.nickname) &&
      row.text.includes(expected.userId) &&
      row.text.includes(expected.membershipLabel) &&
      row.text.includes('已登录') &&
      /(?:歌单\s*[:：]?\s*2|2\s*个歌单)/.test(row.text) &&
      /会话\s*[:：]?\s*有效/.test(row.text), row);
  });
  await screenshot('multi-platform-account-details');
  await cdp.call(function () {
    const mask = document.getElementById('user-modal');
    if (typeof closeUserModal === 'function') closeUserModal();
    else if (mask) mask.classList.remove('show');
    return true;
  });
}

async function verifyUserModePersistence(bundle) {
  await cdp.call(async function (userId) {
    const hub = window.LumiFieldMultiPlatform;
    await hub.setTestUser(userId);
    await hub.refreshDetails();
    await hub.setMode('multi');
    await hub.setPlaylistProvider('qq', { refresh: true, force: true });
    return true;
  }, [USER_A]);
  let debug = await hubDebug();
  pass('LF user A stores multi mode and QQ playlist selection',
    modeOf(debug) === 'multi' && playlistProviderOf(debug) === 'qq', debug);

  await cdp.call(async function (userId) {
    const hub = window.LumiFieldMultiPlatform;
    await hub.setTestUser(userId);
    await hub.refreshDetails();
    await hub.setMode('qishui');
    await hub.setPlaylistProvider('kugou', { refresh: true, force: true });
    return true;
  }, [USER_B]);
  debug = await hubDebug();
  pass('LF user B stores independent Qishui single mode and Kugou playlist selection',
    modeOf(debug) === 'qishui' && playlistProviderOf(debug) === 'kugou', debug);

  const preReloadCalls = await callsSnapshot();
  pass('pre-reload account mode and LF-user switches never log out a platform',
    preReloadCalls.logout.length === 0, preReloadCalls.logout);

  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    return true;
  }, [USER_A]);
  debug = await hubDebug();
  pass('switching back to LF user A restores only A mode and selection',
    modeOf(debug) === 'multi' && playlistProviderOf(debug) === 'qq', debug);

  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    return true;
  }, [USER_B]);
  debug = await hubDebug();
  pass('switching back to LF user B restores only B mode and selection',
    modeOf(debug) === 'qishui' && playlistProviderOf(debug) === 'kugou', debug);

  const beforeReloadOrigin = await cdp.call(function () { return performance.timeOrigin; });
  await reloadPage();
  const afterReloadOrigin = await cdp.call(function () { return performance.timeOrigin; });
  pass('mode persistence is verified across a real renderer reload',
    afterReloadOrigin !== beforeReloadOrigin, { beforeReloadOrigin, afterReloadOrigin });
  await installFixtures(bundle);

  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  }, [USER_A]);
  const aReloaded = await hubDebug();
  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  }, [USER_B]);
  const bReloaded = await hubDebug();
  pass('LF user A multi mode and playlist provider survive restart',
    modeOf(aReloaded) === 'multi' &&
    playlistProviderOf(aReloaded) === 'qq' &&
    deepEqual(keyListOf(aReloaded, ['playlistKeys']), playlistKeys('qq')), aReloaded);
  pass('LF user B single mode and playlist provider survive restart without crossing A',
    modeOf(bReloaded) === 'qishui' &&
    playlistProviderOf(bReloaded) === 'kugou' &&
    deepEqual(keyListOf(bReloaded, ['playlistKeys']), playlistKeys('kugou')), bReloaded);

  const calls = await callsSnapshot();
  pass('mode switching and restore never logs out any platform session',
    calls.logout.length === 0, calls.logout);

  await setHarnessStatus('qishui', {
    ok: true,
    loggedIn: false,
    sessionValid: false,
    sessionState: 'invalid',
    userId: '',
    nickname: '汽水音乐',
    avatar: '',
    playlistCount: 0,
    playlists: [],
    profile: null,
  });
  const invalidRestore = await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser('lf-problem12-user-a');
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    const toast = document.getElementById('toast');
    return {
      debug: window.LumiFieldMultiPlatform.getDebug(),
      toastText: toast ? toast.textContent.trim() : '',
      toastVisible: !!(toast && toast.classList.contains('show')),
    };
  }, [USER_B]);
  const invalidDetails = providerDetailsOf(invalidRestore.debug);
  pass('expired saved single-platform session is revalidated and precisely requests relogin',
    invalidDetails.qishui &&
    invalidDetails.qishui.loggedIn === false &&
    invalidDetails.qishui.sessionValid === false &&
    invalidRestore.toastVisible &&
    invalidRestore.toastText.includes('汽水音乐') &&
    invalidRestore.toastText.includes('会话') &&
    /失效|重新登录/.test(invalidRestore.toastText), invalidRestore);
  await setHarnessStatus('qishui', bundle.statuses.qishui);

  await cdp.call(async function (userId) {
    await window.LumiFieldMultiPlatform.setTestUser(userId);
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  }, [USER_A]);
}

async function verifyEverySingleModePersistence(bundle) {
  for (const provider of PROVIDERS) {
    await cdp.call(async function (userId, selectedProvider) {
      const hub = window.LumiFieldMultiPlatform;
      await hub.setTestUser(userId);
      await hub.refreshDetails();
      await hub.setMode(selectedProvider);
      await hub.setPlaylistProvider(selectedProvider, { refresh: true, force: true });
      return true;
    }, [USER_A, provider]);
    const before = await hubDebug();
    pass(`${provider}: single account mode is selected with its own playlist source before restart`,
      modeOf(before) === provider &&
      playlistProviderOf(before) === provider &&
      deepEqual(keyListOf(before, ['playlistKeys']), playlistKeys(provider)), before);

    const marker = await cdp.call(function () { return performance.timeOrigin; });
    await reloadPage();
    await installFixtures(bundle);
    await cdp.call(async function (userId) {
      await window.LumiFieldMultiPlatform.setTestUser(userId);
      await window.LumiFieldMultiPlatform.refreshDetails();
      return true;
    }, [USER_A]);
    const restored = await hubDebug();
    const restoredTimeOrigin = await cdp.call(function () { return performance.timeOrigin; });
    pass(`${provider}: exact single account mode, profile and playlists survive a real restart`,
      restoredTimeOrigin !== marker &&
      modeOf(restored) === provider &&
      playlistProviderOf(restored) === provider &&
      providerDetailsOf(restored)[provider] &&
      providerDetailsOf(restored)[provider].loggedIn === true &&
      deepEqual(keyListOf(restored, ['playlistKeys']), playlistKeys(provider)), {
        marker,
        restoredTimeOrigin,
        restored,
      });
    const calls = await callsSnapshot();
    pass(`${provider}: single mode restoration never logs out another provider`,
      calls.logout.length === 0, calls.logout);
  }
  await cdp.call(async function (userId) {
    const hub = window.LumiFieldMultiPlatform;
    await hub.setTestUser(userId);
    await hub.refreshDetails();
    await hub.setMode('multi');
    await hub.setPlaylistProvider('qq', { refresh: true, force: true });
    return true;
  }, [USER_A]);
}

async function beginPlaylistSwitch(provider, delayMs = 180) {
  await setHarnessControl(provider, { delay: delayMs, error: '' });
  return cdp.call(function (name) {
    const hub = window.LumiFieldMultiPlatform;
    const previous = Array.isArray(userPlaylists) ? userPlaylists.map(function (playlist) {
      return { provider: playlist.provider, id: String(playlist.id || playlist.playlistId || '') };
    }) : [];
    window.__lfP12PendingSwitch = Promise.resolve(
      hub.setPlaylistProvider(name, { refresh: true, force: true })
    ).then(function (result) {
      window.__lfP12PendingSwitchResult = { ok: true, result: result };
      return window.__lfP12PendingSwitchResult;
    }, function (error) {
      window.__lfP12PendingSwitchResult = {
        ok: false,
        error: String(error && (error.code || error.message) || error),
      };
      return window.__lfP12PendingSwitchResult;
    });
    const list = document.getElementById('pl-list');
    return {
      previous: previous,
      immediate: Array.isArray(userPlaylists) ? userPlaylists.map(function (playlist) {
        return { provider: playlist.provider, id: String(playlist.id || playlist.playlistId || '') };
      }) : null,
      text: list ? list.textContent.replace(/\s+/g, ' ').trim() : '',
      cards: list ? Array.from(list.querySelectorAll('.pl-card')).map(function (card) {
        return {
          provider: card.getAttribute('data-playlist-provider') || '',
          id: card.getAttribute('data-playlist-id') || '',
        };
      }) : [],
      debug: hub.getDebug(),
    };
  }, [provider]);
}

async function finishPlaylistSwitch() {
  return cdp.call(async function () {
    const pending = window.__lfP12PendingSwitch;
    if (!pending) throw new Error('pending playlist switch missing');
    const result = await pending;
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    const hub = window.LumiFieldMultiPlatform;
    const list = document.getElementById('pl-list');
    const debug = hub.getDebug();
    return {
      result: result,
      userPlaylists: Array.isArray(userPlaylists) ? userPlaylists.map(function (playlist) {
        return {
          provider: playlist.provider,
          id: String(playlist.id || playlist.playlistId || ''),
          name: String(playlist.name || ''),
        };
      }) : null,
      cards: list ? Array.from(list.querySelectorAll('.pl-card')).map(function (card) {
        return {
          provider: card.getAttribute('data-playlist-provider') || '',
          id: card.getAttribute('data-playlist-id') || '',
          title: card.getAttribute('data-playlist-title') || '',
        };
      }) : [],
      text: list ? list.textContent.replace(/\s+/g, ' ').trim() : '',
      debug: debug,
      playlistKeys: debug && debug.playlistKeys,
      shelfPlaylistKeys: debug && (debug.shelfPlaylistKeys ||
        (debug.shelf && debug.shelf.playlistKeys)),
      actualShelfKeys: window.shelfManager && typeof window.shelfManager.getCards === 'function'
        ? window.shelfManager.getCards().map(function (card) {
          const item = card && card.item || {};
          if (item.type !== 'playlist') return '';
          const provider = String(item.provider || '');
          let id = String(item.playlistId || '');
          if (provider && id.indexOf(provider + ':') === 0) id = id.slice(provider.length + 1);
          return provider && id ? provider + ':' + id : '';
        }).filter(Boolean).sort()
        : null,
    };
  });
}

async function verifyFivePlaylistSwitches(queueBefore) {
  await cdp.call(function () {
    if (typeof window.openPlaylistPanelTab === 'function') window.openPlaylistPanelTab('playlists', true);
    if (typeof window.togglePlaylistPanel === 'function') window.togglePlaylistPanel(true);
    return document.getElementById('playlist-panel').classList.contains('show');
  });
  await delay(800);
  for (const provider of PROVIDERS) {
    const callsBefore = await callsSnapshot();
    const immediate = await beginPlaylistSwitch(provider, 190);
    const oldProviders = [...new Set((immediate.previous || []).map(item => item.provider))];
    pass(`${provider}: provider switch clears previous playlists synchronously`,
      Array.isArray(immediate.immediate) && immediate.immediate.length === 0 &&
      immediate.cards.length === 0 &&
      oldProviders.every(old => !immediate.text.includes(LABELS[old] + 'P12歌单')), immediate);

    const final = await finishPlaylistSwitch();
    const expectedKeys = playlistKeys(provider);
    const converged = await waitFor(async () => {
      const candidate = await cdp.call(function () {
        const debug = window.LumiFieldMultiPlatform.getDebug();
        const actualShelfKeys = window.shelfManager && typeof window.shelfManager.getCards === 'function'
          ? window.shelfManager.getCards().map(function (card) {
            const item = card && card.item || {};
            if (item.type !== 'playlist') return '';
            const provider = String(item.provider || '');
            let id = String(item.playlistId || '');
            if (provider && id.indexOf(provider + ':') === 0) id = id.slice(provider.length + 1);
            return provider && id ? provider + ':' + id : '';
          }).filter(Boolean).sort()
          : null;
        return { debug: debug, actualShelfKeys: actualShelfKeys };
      });
      const debug = candidate.debug;
      const panel = keyListOf(debug, ['playlistKeys']);
      const shelf = keyListOf(debug, ['shelfPlaylistKeys', 'shelf.playlistKeys']);
      return deepEqual(panel, expectedKeys) &&
        deepEqual(shelf, expectedKeys) &&
        deepEqual(candidate.actualShelfKeys, expectedKeys) ? candidate : null;
    }, 5000, 60);
    final.debug = converged.debug;
    final.actualShelfKeys = converged.actualShelfKeys;
    const actualKeys = (final.userPlaylists || []).map(item => `${item.provider}:${item.id}`).sort();
    const cardKeys = final.cards.map(item => `${item.provider}:${item.id}`).sort();
    pass(`${provider}: only the selected platform's two real playlists render`,
      final.result && final.result.ok === true &&
      playlistProviderOf(final.debug) === provider &&
      deepEqual(actualKeys, expectedKeys) &&
      deepEqual(cardKeys, expectedKeys) &&
      final.userPlaylists.every(item => item.provider === provider) &&
      final.cards.every(item => item.provider === provider), final);

    const callsAfter = await callsSnapshot();
    const delta = callsAfter.playlists.slice(callsBefore.playlists.length).map(call => call.provider);
    pass(`${provider}: playlist switch requests only its selected provider`,
      delta.length === 1 && delta[0] === provider, delta);

    const debugKeys = keyListOf(final.debug, ['playlistKeys']);
    const shelfKeys = keyListOf(final.debug, ['shelfPlaylistKeys', 'shelf.playlistKeys']);
    pass(`${provider}: 2D panel debug keys exactly match selected userPlaylists`,
      deepEqual(debugKeys, expectedKeys), { debugKeys, expectedKeys });
    pass(`${provider}: 3D shelf consumes the same selected playlist keys`,
      deepEqual(shelfKeys, expectedKeys) &&
      deepEqual(final.actualShelfKeys, expectedKeys), {
        shelfKeys,
        actualShelfKeys: final.actualShelfKeys,
        expectedKeys,
      });

    const queueAfter = await queueSnapshot();
    pass(`${provider}: playlist switching does not mutate queue, currentIdx or audio.src`,
      deepEqual(queueAfter, queueBefore), { before: queueBefore, after: queueAfter });
    await screenshot(`playlist-provider-${provider}`);
  }
}

async function verifyLoggedOutAndError(queueBefore, bundle) {
  const original = bundle.statuses.qishui;
  await setHarnessStatus('qishui', {
    ok: true,
    loggedIn: false,
    sessionValid: false,
    sessionState: 'invalid',
    userId: '',
    nickname: '汽水音乐',
    avatar: '',
    playlistCount: 0,
    playlists: [],
    profile: null,
  });
  await cdp.call(async function () {
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  });
  const callsBefore = await callsSnapshot();
  const loggedOut = await cdp.call(async function () {
    const result = await window.LumiFieldMultiPlatform.setPlaylistProvider(
      'qishui', { refresh: true, force: true }
    );
    const list = document.getElementById('pl-list');
    const button = list && list.querySelector('button');
    return {
      result: result,
      text: list ? list.textContent.replace(/\s+/g, ' ').trim() : '',
      buttonText: button ? button.textContent.trim() : '',
      buttonOnclick: button ? button.getAttribute('onclick') || '' : '',
      cards: list ? list.querySelectorAll('.pl-card').length : -1,
      debug: window.LumiFieldMultiPlatform.getDebug(),
    };
  });
  const callsAfter = await callsSnapshot();
  pass('unlogged selected provider shows the exact platform login entrance and no playlists',
    loggedOut.text.includes('汽水音乐') &&
    loggedOut.text.includes('登录') &&
    loggedOut.buttonText.includes('登录') &&
    /qishui/.test(loggedOut.buttonOnclick) &&
    loggedOut.cards === 0 &&
    playlistProviderOf(loggedOut.debug) === 'qishui', loggedOut);
  pass('unlogged provider does not call its protected playlist endpoint',
    callsAfter.playlists.length === callsBefore.playlists.length, {
      before: callsBefore.playlists.length,
      after: callsAfter.playlists.length,
    });

  await setHarnessStatus('qishui', original);
  await cdp.call(async function () {
    await window.LumiFieldMultiPlatform.refreshDetails();
    return true;
  });
  await setHarnessControl('kugou', { delay: 20, error: 'KG_REAL_PLAYLISTS_TIMEOUT_504' });
  const failed = await cdp.call(async function () {
    const result = await window.LumiFieldMultiPlatform.setPlaylistProvider(
      'kugou', { refresh: true, force: true }
    );
    const list = document.getElementById('pl-list');
    return {
      result: result,
      text: list ? list.textContent.replace(/\s+/g, ' ').trim() : '',
      cards: list ? list.querySelectorAll('.pl-card').length : -1,
      debug: window.LumiFieldMultiPlatform.getDebug(),
    };
  });
  pass('real provider failure exposes platform name and original error code without stale cards',
    failed.text.includes('酷狗音乐') &&
    failed.text.includes('KG_REAL_PLAYLISTS_TIMEOUT_504') &&
    failed.cards === 0 &&
    playlistProviderOf(failed.debug) === 'kugou', failed);
  const queueAfter = await queueSnapshot();
  pass('logged-out and failed playlist requests preserve playback state',
    deepEqual(queueAfter, queueBefore), { before: queueBefore, after: queueAfter });
  await screenshot('playlist-real-error');
  await setHarnessControl('kugou', { delay: 0, error: '' });
}

async function verifyLateResponseIsolation(queueBefore) {
  await setHarnessControl('netease', { delay: 850, error: '' });
  await setHarnessControl('qishui', { delay: 35, error: '' });
  const started = await cdp.call(function () {
    const hub = window.LumiFieldMultiPlatform;
    window.__lfP12LateA = Promise.resolve(
      hub.setPlaylistProvider('netease', { refresh: true, force: true })
    ).then(function (result) { return { ok: true, result: result }; },
      function (error) { return { ok: false, error: String(error && error.message || error) }; });
    return {
      provider: hub.getDebug().playlistProvider,
      playlists: userPlaylists.map(function (playlist) { return playlist.provider; }),
    };
  });
  await delay(45);
  const second = await cdp.call(function () {
    const hub = window.LumiFieldMultiPlatform;
    window.__lfP12LateB = Promise.resolve(
      hub.setPlaylistProvider('qishui', { refresh: true, force: true })
    ).then(function (result) { return { ok: true, result: result }; },
      function (error) { return { ok: false, error: String(error && error.message || error) }; });
    return {
      provider: hub.getDebug().playlistProvider,
      playlists: userPlaylists.map(function (playlist) { return playlist.provider; }),
    };
  });
  const final = await cdp.call(async function () {
    const results = await Promise.all([window.__lfP12LateB, window.__lfP12LateA]);
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
    const debug = window.LumiFieldMultiPlatform.getDebug();
    const list = document.getElementById('pl-list');
    return {
      results: results,
      debug: debug,
      userPlaylists: userPlaylists.map(function (playlist) {
        return { provider: playlist.provider, id: String(playlist.id || playlist.playlistId || '') };
      }),
      cards: Array.from(list.querySelectorAll('.pl-card')).map(function (card) {
        return {
          provider: card.getAttribute('data-playlist-provider') || '',
          id: card.getAttribute('data-playlist-id') || '',
        };
      }),
      text: list.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  const expected = playlistKeys('qishui');
  const converged = await waitFor(async () => {
    const candidate = await cdp.call(function () {
      const debug = window.LumiFieldMultiPlatform.getDebug();
      const actualShelfKeys = window.shelfManager && typeof window.shelfManager.getCards === 'function'
        ? window.shelfManager.getCards().map(function (card) {
          const item = card && card.item || {};
          if (item.type !== 'playlist') return '';
          const provider = String(item.provider || '');
          let id = String(item.playlistId || '');
          if (provider && id.indexOf(provider + ':') === 0) id = id.slice(provider.length + 1);
          return provider && id ? provider + ':' + id : '';
        }).filter(Boolean).sort()
        : null;
      return { debug: debug, actualShelfKeys: actualShelfKeys };
    });
    const panel = keyListOf(candidate.debug, ['playlistKeys']);
    const shelf = keyListOf(candidate.debug, ['shelfPlaylistKeys', 'shelf.playlistKeys']);
    return playlistProviderOf(candidate.debug) === 'qishui' &&
      deepEqual(panel, expected) &&
      deepEqual(shelf, expected) &&
      deepEqual(candidate.actualShelfKeys, expected) ? candidate : null;
  }, 5000, 60);
  final.debug = converged.debug;
  final.actualShelfKeys = converged.actualShelfKeys;
  const actual = final.userPlaylists.map(item => `${item.provider}:${item.id}`).sort();
  const cards = final.cards.map(item => `${item.provider}:${item.id}`).sort();
  const debugKeys = keyListOf(final.debug, ['playlistKeys']);
  const shelfKeys = keyListOf(final.debug, ['shelfPlaylistKeys', 'shelf.playlistKeys']);
  pass('late response isolation starts with immediate clearing on both switches',
    started.playlists.length === 0 && second.playlists.length === 0, { started, second });
  pass('late NetEase response cannot overwrite later Qishui selection in state, 2D or 3D',
    playlistProviderOf(final.debug) === 'qishui' &&
    deepEqual(actual, expected) &&
    deepEqual(cards, expected) &&
    deepEqual(debugKeys, expected) &&
    deepEqual(shelfKeys, expected) &&
    deepEqual(final.actualShelfKeys, expected) &&
    !final.text.includes('网易云音乐P12歌单'), final);
  const queueAfter = await queueSnapshot();
  pass('late response race preserves queue, currentIdx and audio.src',
    deepEqual(queueAfter, queueBefore), { before: queueBefore, after: queueAfter });
  await screenshot('late-response-isolated');
}

async function verifyDesktopSessionIsolation() {
  async function scope(userId) {
    return cdp.call(async function (id) {
      // Production setMusicPlatformAccountScope accepts only an LF auth token.
      // The renderer's explicit test hook drives the controlled test identity.
      await window.LumiFieldMultiPlatform.setTestUser(id);
      return window.desktopWindow.getMusicPlatformAccountScopeDebug();
    }, [userId]);
  }
  const a1 = await scope(USER_A);
  const b = await scope(USER_B);
  const a2 = await scope(USER_A);
  const aProviders = partitionMapOf(a1);
  const bProviders = partitionMapOf(b);
  const aScopeHash = String(getPath(a1, ['scopeHash', 'scope.hash']) || '');
  const bScopeHash = String(getPath(b, ['scopeHash', 'scope.hash']) || '');
  const aJson = JSON.stringify(a1);
  const bJson = JSON.stringify(b);
  const allowedTopKeys = new Set(['ok', 'scopeHash', 'providers']);
  const allowedProviderKeys = new Set(['partition', 'sessionValid']);
  pass('desktop scope debug is a minimal redacted view only',
    Object.keys(a1 || {}).every(key => allowedTopKeys.has(key)) &&
    Object.keys(b || {}).every(key => allowedTopKeys.has(key)) &&
    PROVIDERS.every(provider =>
      Object.keys(aProviders[provider] || {}).every(key => allowedProviderKeys.has(key)) &&
      Object.keys(bProviders[provider] || {}).every(key => allowedProviderKeys.has(key))), {
        aTopKeys: Object.keys(a1 || {}),
        bTopKeys: Object.keys(b || {}),
        aProviderKeys: Object.fromEntries(PROVIDERS.map(provider =>
          [provider, Object.keys(aProviders[provider] || {})])),
        bProviderKeys: Object.fromEntries(PROVIDERS.map(provider =>
          [provider, Object.keys(bProviders[provider] || {})])),
      });
  pass('desktop scope debug exposes only an opaque stable scope hash',
    /^[a-f0-9]{16,}$/i.test(aScopeHash) &&
    /^[a-f0-9]{16,}$/i.test(bScopeHash) &&
    aScopeHash !== bScopeHash &&
    !aJson.includes(USER_A) && !bJson.includes(USER_B), {
      aScopeHash,
      bScopeHash,
      aLeaksRawUser: aJson.includes(USER_A),
      bLeaksRawUser: bJson.includes(USER_B),
    });
  pass('desktop scope debug contains all five provider partitions',
    PROVIDERS.every(provider => aProviders[provider] && bProviders[provider]), {
      a: Object.keys(aProviders),
      b: Object.keys(bProviders),
    });
  PROVIDERS.forEach(provider => {
    const aPartition = String(getPath(aProviders[provider], ['partition', 'sessionPartition']) || '');
    const bPartition = String(getPath(bProviders[provider], ['partition', 'sessionPartition']) || '');
    const aValid = getPath(aProviders[provider], ['sessionValid', 'valid']);
    const bValid = getPath(bProviders[provider], ['sessionValid', 'valid']);
    pass(`${provider}: LF users receive isolated persistent Electron partitions with boolean validity`,
      aPartition.startsWith('persist:') &&
      bPartition.startsWith('persist:') &&
      aPartition !== bPartition &&
      typeof aValid === 'boolean' &&
      typeof bValid === 'boolean' &&
      !aPartition.includes(USER_A) &&
      !bPartition.includes(USER_B), {
        aPartition,
        bPartition,
        aValid,
        bValid,
      });
  });
  const aPartitions = PROVIDERS.map(provider =>
    String(getPath(aProviders[provider], ['partition', 'sessionPartition']) || ''));
  pass('all five providers have mutually isolated partitions within one LF user',
    new Set(aPartitions).size === PROVIDERS.length, aPartitions);
  pass('switching back to LF user A restores the exact same hash and partitions',
    String(getPath(a2, ['scopeHash', 'scope.hash']) || '') === aScopeHash &&
    PROVIDERS.every(provider =>
      String(getPath(partitionMapOf(a2)[provider], ['partition', 'sessionPartition']) || '') ===
      String(getPath(aProviders[provider], ['partition', 'sessionPartition']) || '')), {
        first: a1,
        restored: a2,
      });
  pass('desktop debug never exposes cookies, tokens or raw session credentials',
    !/(?:cookie|token|credential|authorization|password)/i.test(
      Object.keys(a1 || {}).concat(Object.keys(b || {})).join('|')
    ) && !/(?:cookie|token|credential|authorization|password)/i.test(aJson + bJson), {
      aKeys: Object.keys(a1 || {}),
      bKeys: Object.keys(b || {}),
    });
}

async function run() {
  const bundle = fixtureBundle();
  await startApp();
  const installed = await installFixtures(bundle);
  pass('five-provider fixture manager installs inside real Electron renderer',
    deepEqual(installed.providers.sort(), PROVIDERS.slice().sort()) &&
    Object.values(installed.managerMethods).every(value => value === 'function'), installed);

  await verifyApiAndDetails(bundle);
  await verifyMultiMode(bundle);
  await verifyUserModePersistence(bundle);
  await verifyEverySingleModePersistence(bundle);
  const queueBefore = await configureQueueInvariant();
  await verifyFivePlaylistSwitches(queueBefore);
  await verifyLoggedOutAndError(queueBefore, bundle);
  await verifyLateResponseIsolation(queueBefore);
  await verifyDesktopSessionIsolation();

  const finalCalls = await callsSnapshot();
  pass('all account mode and playlist tests preserve all platform sessions',
    finalCalls.logout.length === 0, finalCalls.logout);
  pass('real Electron renderer has zero uncaught exceptions',
    rendererErrors.length === 0, rendererErrors);

  const result = {
    ok: true,
    problem: 12,
    mode: 'real Electron/CDP five-platform account state, playlist isolation and LF-user session partition audit',
    runId,
    origin,
    evidenceDir,
    providers: PROVIDERS,
    users: [USER_A, USER_B],
    checks,
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-16000),
    completedAt: new Date().toISOString(),
  };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    problem: 12,
    resultFile,
    checks: Object.keys(checks).length,
    screenshots: screenshots.length,
    rendererErrors: rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  const failure = {
    ok: false,
    problem: 12,
    runId,
    origin,
    evidenceDir,
    error: String(error && error.stack || error).slice(0, 16000),
    checkSummary: {
      passed: Object.keys(checks).length,
      names: Object.keys(checks),
    },
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-16000),
    completedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  } catch (_) {}
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
