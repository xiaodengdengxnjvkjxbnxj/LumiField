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
const evidenceDir = path.resolve(process.env.LF_MASTER_PROBLEM13_OUT ||
  path.join(repo, 'test-results', 'lf-master-problem13-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem13-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

const USER_A = 'lf-problem13-user-a';
const USER_B = 'lf-problem13-user-b';
const PROVIDERS = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
const LABELS = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  qishui: '汽水音乐',
};
const LINK_CASES = [
  {
    provider: 'netease',
    id: '5103375927',
    direct: 'https://music.163.com/#/playlist?id=5103375927',
    canonical: 'https://music.163.com/playlist?id=5103375927',
    short: 'https://163cn.tv/AbC1',
  },
  {
    provider: 'qq',
    id: '8844556677',
    direct: 'https://y.qq.com/n/ryqq/playlist/8844556677',
    canonical: 'https://y.qq.com/n/ryqq/playlist/8844556677',
    short: 'https://y.qq.com/base/fcgi-bin/u?__=QqAb1',
  },
  {
    provider: 'kugou',
    id: '99221144',
    direct: 'https://www.kugou.com/yy/special/single/99221144.html',
    canonical: 'https://www.kugou.com/yy/special/single/99221144.html',
    short: 'https://t.kugou.com/KgAb1',
  },
  {
    provider: 'kugou_concept',
    id: '33112244',
    direct: 'https://www.kugou.com/yy/special/single/33112244.html?appid=3116',
    canonical: 'https://www.kugou.com/yy/special/single/33112244.html?appid=3116',
    short: 'https://t.kugou.com/KgcAb1?appid=3116',
  },
  {
    provider: 'qishui',
    id: '7366554433221100',
    direct: 'https://www.qishui.com/playlist/7366554433221100',
    canonical: 'https://www.qishui.com/playlist/7366554433221100',
    short: 'https://qishui.douyin.com/s/QsAb1/',
  },
];
const ERROR_LINKS = Object.freeze({
  login: 'https://music.163.com/playlist?id=7000000001',
  deleted: 'https://music.163.com/playlist?id=7000000002',
  forbidden: 'https://music.163.com/playlist?id=7000000003',
});

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
  if (depth >= 5) return Array.isArray(value) ? `[Array(${value.length})]` : `{Object(${Object.keys(value).length})}`;
  if (Array.isArray(value)) {
    const result = value.slice(0, 24).map(item => compact(item, depth + 1));
    if (value.length > 24) result.push({ truncatedItems: value.length - 24 });
    return result;
  }
  if (typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value);
    keys.slice(0, 60).forEach(key => { result[key] = compact(value[key], depth + 1); });
    if (keys.length > 60) result.__truncatedKeys = keys.length - 60;
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

function importKey(value) {
  value = value || {};
  return String(value.sourceProvider || value.provider || value.metadata && value.metadata.provider || '') + ':' +
    String(value.sourcePlaylistId || value.playlistId || value.id || value.metadata && value.metadata.playlistId || '');
}

function getPath(value, paths) {
  for (const fieldPath of paths) {
    const result = String(fieldPath).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
    if (result !== undefined) return result;
  }
  return undefined;
}

function songsOf(value) {
  const songs = getPath(value, ['songs', 'tracks', 'playlist.songs', 'playlist.tracks']);
  return Array.isArray(songs) ? songs : [];
}

function metadataOf(value) {
  const metadata = getPath(value, ['metadata', 'playlist.metadata']);
  return metadata && typeof metadata === 'object' ? metadata : value || {};
}

function fixtureRecord(linkCase, version = 1) {
  const provider = linkCase.provider;
  const label = LABELS[provider];
  const secondId = version > 1 ? `${provider}-track-update` : `${provider}-track-2`;
  const metadata = {
    provider,
    playlistId: linkCase.id,
    name: `P13真值·${label}·v${version}`,
    cover: `https://fixture.invalid/p13/${provider}-cover-v${version}.png`,
    creator: `${label}真实创建者P13`,
    creatorId: `p13-${provider}-creator`,
    songCount: 2,
    trackCount: 2,
    description: `受控后端元数据-${provider}-v${version}`,
  };
  const songs = [
    {
      provider,
      source: provider,
      id: `${provider}-track-1`,
      name: `${label}真值歌曲一-v${version}`,
      artist: `${label}真值歌手甲`,
      album: `${label}真值专辑甲`,
      cover: `https://fixture.invalid/p13/${provider}-track-1-v${version}.png`,
      duration: 201000,
      playable: true,
    },
    {
      provider,
      source: provider,
      id: secondId,
      name: `${label}真值歌曲二-v${version}`,
      artist: `${label}真值歌手乙`,
      album: `${label}真值专辑乙`,
      cover: `https://fixture.invalid/p13/${provider}-${secondId}.png`,
      duration: 187000,
      playable: true,
    },
  ];
  return {
    ok: true,
    provider,
    playlistId: linkCase.id,
    normalizedUrl: linkCase.canonical,
    canonicalUrl: linkCase.canonical,
    private: false,
    requiresLogin: false,
    updatedAt: 1785300000000 + version,
    metadata,
    playlist: Object.assign({}, metadata, { id: linkCase.id, songs: clone(songs), tracks: clone(songs) }),
    songs,
    tracks: clone(songs),
  };
}

function errorCode(error) {
  return String(error && (error.code || error.error || error.message) || error || '');
}

async function expectReject(name, fn, expectedCode) {
  let caught = null;
  try { await fn(); } catch (error) { caught = error; }
  pass(name, !!caught && errorCode(caught).includes(expectedCode), {
    expectedCode,
    actualCode: errorCode(caught),
    message: caught && caught.message,
  });
  return caught;
}

async function verifyPureLinkParser() {
  const service = require(path.join(repo, 'music-platform-service.js'));
  pass('backend exports the official-link parser and controlled short-link resolver',
    typeof service.parseOfficialPlaylistLink === 'function' && typeof service.resolveOfficialPlaylistLink === 'function', {
      parse: typeof service.parseOfficialPlaylistLink,
      resolve: typeof service.resolveOfficialPlaylistLink,
    });

  LINK_CASES.forEach(linkCase => {
    const parsed = service.parseOfficialPlaylistLink(`分享“${LABELS[linkCase.provider]}”歌单：${linkCase.direct}。`);
    pass(`${linkCase.provider}: official playlist URL normalizes to the exact provider, ID and canonical HTTPS URL`,
      parsed.provider === linkCase.provider && parsed.playlistId === linkCase.id &&
      parsed.normalizedUrl === linkCase.canonical && parsed.shortLink === false && parsed.requiresRedirect === false,
      parsed);
    const short = service.parseOfficialPlaylistLink(linkCase.short);
    pass(`${linkCase.provider}: official short URL is recognized without inventing a playlist ID`,
      short.provider === linkCase.provider && short.playlistId === '' && short.shortLink === true && short.requiresRedirect === true,
      short);
  });

  const redirectMap = Object.fromEntries(LINK_CASES.map(linkCase => [linkCase.short, linkCase.direct]));
  for (const linkCase of LINK_CASES) {
    const resolved = await service.resolveOfficialPlaylistLink(linkCase.short, {
      readRedirect: async url => redirectMap[url],
    });
    pass(`${linkCase.provider}: controlled official short-link redirect resolves the real ID and canonical URL`,
      resolved.provider === linkCase.provider && resolved.playlistId === linkCase.id &&
      resolved.normalizedUrl === linkCase.canonical && resolved.requiresRedirect === false,
      resolved);
  }

  await expectReject('short links cannot redirect across music-platform trust boundaries',
    () => service.resolveOfficialPlaylistLink(LINK_CASES[0].short, {
      readRedirect: async () => LINK_CASES[1].direct,
    }), 'PLAYLIST_REDIRECT_PROVIDER_MISMATCH');

  const rejects = [
    ['unofficial host', 'https://evil.example/playlist?id=5103375927', 'PLAYLIST_HOST_UNSUPPORTED'],
    ['embedded credentials', 'https://user:password@music.163.com/playlist?id=5103375927', 'PLAYLIST_URL_CREDENTIALS_FORBIDDEN'],
    ['insecure HTTP', 'http://music.163.com/playlist?id=5103375927', 'PLAYLIST_URL_HTTPS_REQUIRED'],
    ['non-standard port', 'https://music.163.com:444/playlist?id=5103375927', 'PLAYLIST_URL_PORT_FORBIDDEN'],
    ['invalid numeric ID', 'https://music.163.com/playlist?id=not-a-number', 'PLAYLIST_ID_INVALID'],
    ['song URL is not a playlist', 'https://music.163.com/song?id=5103375927', 'PLAYLIST_ID_MISSING'],
    ['two links are ambiguous', `${LINK_CASES[0].direct} ${LINK_CASES[1].direct}`, 'PLAYLIST_URL_AMBIGUOUS'],
    ['overlong URL', `https://music.163.com/playlist?id=1&padding=${'x'.repeat(2100)}`, 'PLAYLIST_URL_TOO_LONG'],
    ['overlong pasted input', `文字${'x'.repeat(4100)} ${LINK_CASES[0].direct}`, 'PLAYLIST_URL_TOO_LONG'],
  ];
  for (const [label, input, code] of rejects) {
    await expectReject(`parser rejects ${label} with an accurate code`,
      async () => service.parseOfficialPlaylistLink(input), code);
  }
}

async function verifyBackendResolverContract() {
  const { createMusicPlatformService } = require(path.join(repo, 'music-platform-service.js'));
  const loader = provider => async id => ({
    ok: true,
    provider,
    loggedIn: false,
    playlist: { id, name: `P13 ${provider} public`, cover: 'https://fixture.invalid/cover.png', creator: 'P13 creator', songCount: 2 },
    tracks: [1, 2].map(index => ({ id: `${provider}-public-${index}`, name: `P13 ${provider} song ${index}`, artist: 'P13 artist', album: 'P13 album' })),
  });
  const publicService = createMusicPlatformService({
    playlistNetease: loader('netease'),
    playlistQQ: loader('qq'),
    playlistRequestJson: async url => {
      if (/\/api\/v3\/special\/info/.test(url) || /\/plist\/list\//.test(url)) {
        return { status: 1, data: { info: { specialid: '99221144', specialname: 'P13 Kugou public', imgurl: 'https://imge.kugou.com/stdmusic/150/fixture.jpg', nickname: 'P13 creator', song_count: 2 } } };
      }
      if (/\/api\/v3\/special\/song/.test(url)) {
        return { status: 1, data: { total: 2, info: [1, 2].map(index => ({ hash: String(index).repeat(32), filename: `P13 artist - P13 Kugou song ${index}`, album_name: 'P13 album', duration: 200 + index })) } };
      }
      throw new Error('UNEXPECTED_KUGOU_FIXTURE_URL');
    },
    qishuiPlaylistRequest: async () => ({
      status_code: 0,
      playlist: { id: '7366554433221100', title: 'P13 Qishui public', url_cover: 'https://p3.qishui.com/fixture.jpg', track_count: 2, owner: { nickname: 'P13 creator' } },
      media_resources: [1, 2].map(index => ({ id: `qishui-public-${index}`, name: `P13 Qishui song ${index}`, artists: [{ name: 'P13 artist' }], album: { name: 'P13 album' }, duration: 200000 + index })),
      has_more: false,
    }),
  });
  for (const linkCase of LINK_CASES) {
    const resolved = await publicService.resolvePlaylistLink(linkCase.direct);
    pass(`${linkCase.provider}: backend resolver imports anonymous public metadata and real tracks`,
      resolved.ok === true && resolved.provider === linkCase.provider && resolved.playlistId === linkCase.id &&
      resolved.loggedIn === false && resolved.playlist && resolved.playlist.name && resolved.tracks.length === 2 &&
      resolved.tracks.every(track => track.provider === linkCase.provider && track.id && track.name), resolved);
  }

  const loginRequired = () => {
    const error = new Error('PLAYLIST_LOGIN_REQUIRED');
    error.code = 'PLAYLIST_LOGIN_REQUIRED';
    error.statusCode = 401;
    throw error;
  };
  const privateService = createMusicPlatformService({
    playlistNetease: loginRequired,
    playlistQQ: loginRequired,
    playlistRequestJson: loginRequired,
    qishuiPlaylistRequest: loginRequired,
  });
  for (const linkCase of LINK_CASES) {
    const rejected = await privateService.resolvePlaylistLink(linkCase.direct);
    pass(`${linkCase.provider}: backend resolver requires matching login for a private playlist`,
      rejected.ok === false && rejected.code === 'PLAYLIST_LOGIN_REQUIRED' && rejected.status === 401 && rejected.provider === linkCase.provider,
      rejected);
  }
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 3000));
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params && message.params.entry || {};
        if (/^(?:error|assert)$/.test(String(entry.level || '')) && String(entry.source || '').toLowerCase() !== 'network') {
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
    return targets.find(target => target.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 60000, 160);
}

async function pageReady() {
  return waitFor(async () => {
    const first = await cdp.call(function (expectedOrigin) {
      if (!document.body || location.origin !== expectedOrigin) return null;
      const api = window.LumiFieldPlaylistLinkImport;
      const methods = ['parser', 'submit', 'confirm', 'cancel', 'getDebug', 'setTestUser', 'getImportedPlaylists'];
      const ready = document.readyState === 'complete' && api && methods.every(function (name) {
        return typeof api[name] === 'function';
      });
      return ready ? { timeOrigin: performance.timeOrigin, href: location.href } : null;
    }, [origin]);
    if (!first) return false;
    await delay(140);
    return cdp.call(function (expectedOrigin, marker) {
      const api = window.LumiFieldPlaylistLinkImport;
      return document.readyState === 'complete' && location.origin === expectedOrigin &&
        performance.timeOrigin === marker.timeOrigin && location.href === marker.href && api &&
        ['parser', 'submit', 'confirm', 'cancel', 'getDebug', 'setTestUser', 'getImportedPlaylists']
          .every(function (name) { return typeof api[name] === 'function'; });
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
    '--disable-gpu',
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
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  app = null;
  await delay(300);
}

async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
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

async function installFixtures(cases) {
  return cdp.call(function (payload) {
    const copy = function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
    const prior = window.__lfP13Harness;
    if (prior && prior.originals) {
      if (prior.originals.fetch) window.fetch = prior.originals.fetch;
      if (prior.originals.search) window.fetchMusicSearchResults = prior.originals.search;
      if (prior.originals.online && window.LFAuth) window.LFAuth.isOnline = prior.originals.online;
    }
    const harness = {
      cases: copy(payload.cases),
      versions: {},
      controls: { delay: 0, loggedIn: {} },
      calls: { resolve: [], tracks: [], search: [] },
      originals: {
        fetch: window.fetch,
        search: window.fetchMusicSearchResults,
        online: window.LFAuth && window.LFAuth.isOnline,
      },
    };
    payload.providers.forEach(function (provider) {
      harness.versions[provider] = 1;
      harness.controls.loggedIn[provider] = true;
      try {
        if (typeof applyMusicPlatformLoginState === 'function') {
          applyMusicPlatformLoginState({
            ok: true,
            provider: provider,
            loggedIn: true,
            sessionValid: true,
            userId: 'p13-' + provider + '-uid',
            nickname: payload.labels[provider] + 'P13账号',
          }, { source: 'p13-fixture', suppressDataRefresh: true, suppressModeChange: true });
        }
      } catch (_) {}
    });
    function response(body, status) {
      return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    function caseForUrl(value) {
      value = String(value || '');
      return harness.cases.find(function (entry) {
        return value === entry.direct || value === entry.short || value.indexOf(entry.direct) >= 0 || value.indexOf(entry.short) >= 0;
      }) || null;
    }
    function caseForProviderId(provider, id) {
      return harness.cases.find(function (entry) {
        return entry.provider === provider && String(entry.id) === String(id);
      }) || null;
    }
    function makeRecord(entry) {
      var version = Number(harness.versions[entry.provider] || 1);
      var label = payload.labels[entry.provider];
      var secondId = version > 1 ? entry.provider + '-track-update' : entry.provider + '-track-2';
      var metadata = {
        provider: entry.provider,
        playlistId: entry.id,
        name: 'P13真值·' + label + '·v' + version,
        cover: 'https://fixture.invalid/p13/' + entry.provider + '-cover-v' + version + '.png',
        creator: label + '真实创建者P13',
        creatorId: 'p13-' + entry.provider + '-creator',
        songCount: 2,
        trackCount: 2,
        description: '受控后端元数据-' + entry.provider + '-v' + version,
      };
      var songs = [
        {
          provider: entry.provider, source: entry.provider, id: entry.provider + '-track-1',
          name: label + '真值歌曲一-v' + version, artist: label + '真值歌手甲', album: label + '真值专辑甲',
          cover: 'https://fixture.invalid/p13/' + entry.provider + '-track-1-v' + version + '.png', duration: 201000, playable: true,
        },
        {
          provider: entry.provider, source: entry.provider, id: secondId,
          name: label + '真值歌曲二-v' + version, artist: label + '真值歌手乙', album: label + '真值专辑乙',
          cover: 'https://fixture.invalid/p13/' + entry.provider + '-' + secondId + '.png', duration: 187000, playable: true,
        },
      ];
      return {
        ok: true,
        provider: entry.provider,
        playlistId: entry.id,
        normalizedUrl: entry.canonical,
        canonicalUrl: entry.canonical,
        private: false,
        requiresLogin: false,
        updatedAt: 1785300000000 + version,
        metadata: metadata,
        playlist: Object.assign({}, metadata, { id: entry.id, songs: copy(songs), tracks: copy(songs) }),
        songs: songs,
        tracks: copy(songs),
      };
    }
    window.fetch = async function (input, init) {
      var raw = typeof input === 'string' ? input : input && input.url || '';
      var parsed;
      try { parsed = new URL(raw, location.origin); } catch (_) { return harness.originals.fetch.apply(this, arguments); }
      if (parsed.pathname === '/api/playlist-link/resolve') {
        var body = {};
        try { body = JSON.parse(init && init.body || '{}'); } catch (_) {}
        var submitted = String(body.url || body.link || body.input || '');
        harness.calls.resolve.push({ url: submitted, method: String(init && init.method || 'GET').toUpperCase(), at: Date.now() });
        if (harness.controls.delay) await new Promise(function (resolve) { setTimeout(resolve, harness.controls.delay); });
        if (submitted === payload.errors.login) {
          return response({ ok: false, code: 'PLAYLIST_LOGIN_REQUIRED', error: 'PLAYLIST_LOGIN_REQUIRED', message: '该私有歌单要求先登录网易云音乐' }, 401);
        }
        if (submitted === payload.errors.deleted) {
          return response({ ok: false, code: 'PLAYLIST_DELETED', error: 'PLAYLIST_DELETED', message: '该歌单已删除或不存在' }, 404);
        }
        if (submitted === payload.errors.forbidden) {
          return response({ ok: false, code: 'PLAYLIST_PERMISSION_DENIED', error: 'PLAYLIST_PERMISSION_DENIED', message: '当前账号无权访问该歌单' }, 403);
        }
        var entry = caseForUrl(submitted);
        if (!entry) return response({ ok: false, code: 'PLAYLIST_URL_INVALID', message: '未识别的受控链接' }, 422);
        if (!harness.controls.loggedIn[entry.provider] && /private/i.test(submitted)) {
          return response({ ok: false, code: 'PLAYLIST_LOGIN_REQUIRED', message: '私有歌单要求登录' }, 401);
        }
        return response(makeRecord(entry), 200);
      }
      var routeProviders = {
        '/api/playlist/tracks': 'netease',
        '/api/qq/playlist/tracks': 'qq',
        '/api/kugou/playlist/tracks': 'kugou',
        '/api/kugou-concept/playlist/tracks': 'kugou_concept',
        '/api/qishui/playlist/tracks': 'qishui',
      };
      if (routeProviders[parsed.pathname]) {
        var provider = routeProviders[parsed.pathname];
        var id = parsed.searchParams.get('id') || '';
        var selected = caseForProviderId(provider, id);
        harness.calls.tracks.push({ provider: provider, id: id, at: Date.now() });
        return selected ? response({ ok: true, provider: provider, playlistId: id, tracks: makeRecord(selected).songs }, 200)
          : response({ ok: false, code: 'PLAYLIST_NOT_FOUND', tracks: [] }, 404);
      }
      return harness.originals.fetch.apply(this, arguments);
    };
    window.fetchMusicSearchResults = async function (query, mode) {
      harness.calls.search.push({ query: String(query || ''), mode: String(mode || ''), at: Date.now() });
      return [{
        provider: 'netease', source: 'netease', id: 'p13-ordinary-search-song',
        name: 'P13普通搜索真值结果', artist: '普通搜索歌手', album: '普通搜索专辑', playable: true,
      }];
    };
    if (window.LFAuth) window.LFAuth.isOnline = function () { return true; };
    window.__lfP13Harness = harness;
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    document.querySelectorAll('.modal-mask.show').forEach(function (mask) { mask.classList.remove('show'); });
    return { installed: true, providers: harness.cases.map(function (entry) { return entry.provider; }) };
  }, [{ cases, providers: PROVIDERS, labels: LABELS, errors: ERROR_LINKS }]);
}

async function harnessSnapshot() {
  return cdp.call(function () {
    var h = window.__lfP13Harness;
    return h ? {
      versions: JSON.parse(JSON.stringify(h.versions)),
      controls: JSON.parse(JSON.stringify(h.controls)),
      calls: JSON.parse(JSON.stringify(h.calls)),
    } : null;
  });
}

async function setHarness(patch) {
  return cdp.call(function (next) {
    var h = window.__lfP13Harness;
    if (next.delay != null) h.controls.delay = Number(next.delay) || 0;
    if (next.provider && next.version != null) h.versions[next.provider] = Number(next.version) || 1;
    if (next.provider && next.loggedIn != null) h.controls.loggedIn[next.provider] = next.loggedIn === true;
    return { versions: JSON.parse(JSON.stringify(h.versions)), controls: JSON.parse(JSON.stringify(h.controls)) };
  }, [patch]);
}

async function apiDebug() {
  return cdp.call(function () { return window.LumiFieldPlaylistLinkImport.getDebug(); });
}

async function importedPlaylists() {
  return cdp.call(function () { return window.LumiFieldPlaylistLinkImport.getImportedPlaylists(); });
}

async function setUser(userId) {
  return cdp.call(async function (id) {
    return window.LumiFieldPlaylistLinkImport.setTestUser(id);
  }, [userId]);
}

async function configureQueueInvariant() {
  return cdp.call(function () {
    playQueue = [
      { id: 'p13-queue-1', provider: 'netease', source: 'netease', name: 'P13队列歌曲一', artist: 'P13' },
      { id: 'p13-queue-2', provider: 'qq', source: 'qq', name: 'P13队列歌曲二', artist: 'P13' },
    ];
    currentIdx = 1;
    if (!audio) audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    return {
      queue: playQueue.map(function (song) { return { id: song.id, provider: song.provider, name: song.name }; }),
      currentIdx: currentIdx,
      src: audio.src,
    };
  });
}

async function queueSnapshot() {
  return cdp.call(function () {
    return {
      queue: playQueue.map(function (song) { return { id: song.id, provider: song.provider, name: song.name }; }),
      currentIdx: currentIdx,
      src: audio && audio.src || '',
    };
  });
}

async function assertQueueUnchanged(name, before) {
  const after = await queueSnapshot();
  pass(name, deepEqual(after, before), { before, after });
}

async function submitLink(input, source = 'api') {
  return cdp.call(async function (url, sourceName) {
    try {
      var value = await window.LumiFieldPlaylistLinkImport.submit(url, { source: sourceName });
      return { threw: false, value: value, debug: window.LumiFieldPlaylistLinkImport.getDebug() };
    } catch (error) {
      return {
        threw: true,
        error: { name: error && error.name, message: error && error.message, code: error && (error.code || error.error) },
        debug: window.LumiFieldPlaylistLinkImport.getDebug(),
      };
    }
  }, [input, source]);
}

async function confirmImport() {
  return cdp.call(async function () {
    try {
      var value = await window.LumiFieldPlaylistLinkImport.confirm();
      return { threw: false, value: value, debug: window.LumiFieldPlaylistLinkImport.getDebug() };
    } catch (error) {
      return { threw: true, error: { message: error && error.message, code: error && (error.code || error.error) }, debug: window.LumiFieldPlaylistLinkImport.getDebug() };
    }
  });
}

async function cancelImport() {
  return cdp.call(function () {
    var value = window.LumiFieldPlaylistLinkImport.cancel();
    return { value: value, debug: window.LumiFieldPlaylistLinkImport.getDebug() };
  });
}

async function surfaceSnapshot() {
  return cdp.call(function () {
    var api = window.LumiFieldPlaylistLinkImport;
    var modal = document.getElementById('lf-playlist-import-modal');
    var progress = document.getElementById('lf-playlist-import-progress');
    var button = document.getElementById('search-submit-btn');
    return {
      methods: ['parser', 'submit', 'confirm', 'cancel', 'getDebug', 'setTestUser', 'getImportedPlaylists']
        .map(function (name) { return [name, typeof api[name]]; }),
      dom: {
        modal: !!modal,
        confirm: !!document.getElementById('lf-playlist-import-confirm'),
        cancel: !!document.getElementById('lf-playlist-import-cancel'),
        progress: !!progress,
        searchButton: !!button && button.tagName === 'BUTTON' && button.type === 'button',
      },
      modalVisible: !!modal && (modal.classList.contains('is-open') || modal.classList.contains('show') || modal.getAttribute('aria-hidden') === 'false'),
      progressText: progress && progress.textContent || '',
    };
  });
}

function pendingOf(debug) {
  return getPath(debug, ['pending', 'preview', 'confirmation', 'current.pending']) || null;
}

function phaseOf(debug) {
  return String(getPath(debug, ['phase', 'state', 'status']) || '');
}

function errorTextOf(value) {
  return JSON.stringify(value || {});
}

async function verifyUiContractAndUnifiedSubmit(queueBefore) {
  const surface = await surfaceSnapshot();
  pass('playlist-link importer exposes the complete API and accessible confirmation/progress controls',
    surface.methods.every(entry => entry[1] === 'function') && Object.values(surface.dom).every(Boolean), surface);

  const callsBefore = await harnessSnapshot();
  const enterLink = LINK_CASES[1];
  await cdp.call(function (value) {
    var input = document.getElementById('search-input');
    input.value = value;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return true;
  }, [enterLink.direct]);
  const enterDebug = await waitFor(async () => {
    const debug = await apiDebug();
    return pendingOf(debug) && importKey(pendingOf(debug)) === `${enterLink.provider}:${enterLink.id}` ? debug : null;
  }, 10000, 60);
  pass('Enter detects a playlist URL and reaches the unified importer instead of ordinary search',
    /enter/i.test(String(getPath(enterDebug, ['lastSubmitSource', 'submitSource', 'source']) || '')),
    enterDebug);
  await cancelImport();

  const buttonLink = LINK_CASES[0];
  await cdp.call(function (value) {
    var input = document.getElementById('search-input');
    input.value = value;
    document.getElementById('search-submit-btn').click();
    return true;
  }, [buttonLink.direct]);
  const buttonDebug = await waitFor(async () => {
    const debug = await apiDebug();
    return pendingOf(debug) && importKey(pendingOf(debug)) === `${buttonLink.provider}:${buttonLink.id}` ? debug : null;
  }, 10000, 60);
  pass('search button detects a playlist URL through the same importer path',
    /button|click/i.test(String(getPath(buttonDebug, ['lastSubmitSource', 'submitSource', 'source']) || '')),
    buttonDebug);
  await cancelImport();

  const afterLinks = await harnessSnapshot();
  const linkResolveCalls = afterLinks.calls.resolve.slice(callsBefore.calls.resolve.length);
  const linkSearchCalls = afterLinks.calls.search.slice(callsBefore.calls.search.length);
  pass('Enter and search button share confirmation-first routing and never dispatch playlist URLs as text search',
    linkResolveCalls.length === 0 && linkSearchCalls.length === 0,
    { resolve: linkResolveCalls, search: linkSearchCalls });

  const ordinaryEnter = 'P13普通文字搜索 Enter';
  await cdp.call(function (value) {
    var input = document.getElementById('search-input');
    input.value = value;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return true;
  }, [ordinaryEnter]);
  await waitFor(() => cdp.call(function (value) {
    return window.__lfP13Harness.calls.search.some(function (call) { return call.query === value; }) &&
      /P13普通搜索真值结果/.test(document.getElementById('search-results').textContent || '');
  }, [ordinaryEnter]), 10000, 60);

  const ordinaryButton = 'P13普通文字搜索 Button';
  await cdp.call(function (value) {
    var input = document.getElementById('search-input');
    input.value = value;
    document.getElementById('search-submit-btn').click();
    return true;
  }, [ordinaryButton]);
  await waitFor(() => cdp.call(function (value) {
    return window.__lfP13Harness.calls.search.some(function (call) { return call.query === value; });
  }, [ordinaryButton]), 10000, 60);
  const afterOrdinary = await harnessSnapshot();
  pass('ordinary text search remains functional for both Enter and the search button',
    afterOrdinary.calls.search.some(call => call.query === ordinaryEnter) &&
    afterOrdinary.calls.search.some(call => call.query === ordinaryButton) &&
    afterOrdinary.calls.resolve.length === afterLinks.calls.resolve.length,
    afterOrdinary.calls);
  await assertQueueUnchanged('link detection, cancel and ordinary search do not alter queue/currentIdx/audio.src', queueBefore);
}

async function verifyProgressAndCancel(queueBefore) {
  await setHarness({ delay: 280 });
  const preview = await submitLink(LINK_CASES[0].direct, 'api');
  const confirmingSurface = await surfaceSnapshot();
  pass('detected playlist opens confirmation before any backend request',
    !preview.threw && phaseOf(preview.debug) === 'confirming' && confirmingSurface.modalVisible &&
    /等待确认|确认/.test(confirmingSurface.progressText),
    { preview, surface: confirmingSurface });
  await cdp.evaluate('window.__lfP13SubmitPromise=window.LumiFieldPlaylistLinkImport.confirm(); true');
  const resolving = await waitFor(async () => {
    const debug = await apiDebug();
    return /resolv|load|fetch|inspect/i.test(phaseOf(debug)) ? debug : null;
  }, 5000, 30);
  const during = await surfaceSnapshot();
  pass('confirmation starts backend resolution and shows live progress before completion',
    during.modalVisible && !!String(during.progressText).trim() &&
    Number(getPath(resolving, ['progress', 'progress.value', 'percent']) || 0) > 0,
    { debug: resolving, surface: during });
  const cancelled = await cancelImport();
  const resolved = await cdp.evaluate('window.__lfP13SubmitPromise');
  const imported = await importedPlaylists();
  const surfaceAfter = await surfaceSnapshot();
  pass('cancel during resolution aborts the request, closes confirmation and persists nothing',
    imported.length === 0 && !pendingOf(cancelled.debug) && !surfaceAfter.modalVisible &&
    /CANCEL|取消/i.test(JSON.stringify(resolved || {})),
    { cancelled, resolved, imported, surface: surfaceAfter });
  await setHarness({ delay: 0 });
  await assertQueueUnchanged('resolving and cancelling an import preserves queue/currentIdx/audio.src', queueBefore);
}

function assertStoredRecord(linkCase, stored, version, namePrefix) {
  const expected = fixtureRecord(linkCase, version);
  const metadata = metadataOf(stored);
  const songs = songsOf(stored);
  const actualSongs = songs.map(song => ({
    provider: song.provider || song.source,
    id: String(song.id || ''),
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
  }));
  const expectedSongs = expected.songs.map(song => ({
    provider: song.provider,
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
  }));
  pass(namePrefix,
    importKey(stored) === `${linkCase.provider}:${linkCase.id}` &&
    String(stored.canonicalUrl || stored.normalizedUrl || '') === linkCase.canonical &&
    String(stored.sourceProvider || stored.provider || '') === linkCase.provider &&
    String(stored.sourcePlaylistId || stored.playlistId || stored.id || '') === linkCase.id &&
    String(metadata.name || stored.name || '') === expected.metadata.name &&
    String(metadata.cover || stored.cover || '') === expected.metadata.cover &&
    String(metadata.creator || stored.creator || '') === expected.metadata.creator &&
    Number(metadata.songCount || metadata.trackCount || stored.songCount || stored.trackCount) === 2 &&
    Number(stored.updatedAt) > 0 && deepEqual(actualSongs, expectedSongs),
    { stored, expected: { key: `${linkCase.provider}:${linkCase.id}`, canonical: linkCase.canonical, metadata: expected.metadata, songs: expectedSongs } });
}

async function importAndConfirm(linkCase, input, source, version = 1) {
  const submitted = await submitLink(input, source);
  const pending = pendingOf(submitted.debug);
  pass(`${linkCase.provider}: ${source} produces a confirmation for the exact backend playlist`,
    !submitted.threw && pending && String(pending.provider || pending.platform || '') === linkCase.provider &&
      (linkCase.short === input ? pending.isShortLink === true && !String(pending.playlistId || '')
        : importKey(pending) === `${linkCase.provider}:${linkCase.id}`),
    submitted);
  const confirmed = await confirmImport();
  pass(`${linkCase.provider}: explicit confirmation completes successfully`,
    !confirmed.threw && /complete|success|idle/i.test(phaseOf(confirmed.debug)), confirmed);
  const all = await importedPlaylists();
  const stored = all.find(item => importKey(item) === `${linkCase.provider}:${linkCase.id}`);
  assertStoredRecord(linkCase, stored, version,
    `${linkCase.provider}: persisted source, canonical URL, timestamp, real metadata and every real song are exact`);
  return stored;
}

async function verifyFiveImportsAndShortLinks(queueBefore) {
  for (const linkCase of LINK_CASES) {
    await importAndConfirm(linkCase, linkCase.direct, 'api-direct', 1);
    await assertQueueUnchanged(`${linkCase.provider}: direct import does not alter queue/currentIdx/audio.src`, queueBefore);
  }
  let all = await importedPlaylists();
  pass('five official platform links create exactly five provider+playlistId identities',
    all.length === 5 && deepEqual(all.map(importKey).sort(), LINK_CASES.map(item => `${item.provider}:${item.id}`).sort()),
    all.map(importKey));

  for (const linkCase of LINK_CASES) {
    await importAndConfirm(linkCase, linkCase.short, 'api-short', 1);
  }
  all = await importedPlaylists();
  const calls = await harnessSnapshot();
  pass('all five official short links resolve through the backend and update existing identities without duplicates',
    all.length === 5 && LINK_CASES.every(linkCase =>
      calls.calls.resolve.some(call => call.url === linkCase.short && call.method === 'POST')),
    { keys: all.map(importKey), resolveCalls: calls.calls.resolve });
  await assertQueueUnchanged('all five short-link updates preserve queue/currentIdx/audio.src', queueBefore);
}

async function viewSnapshot() {
  return cdp.call(function () {
    try {
      if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ reset: true });
      if (typeof safeShelfRebuild === 'function') safeShelfRebuild('p13-master-smoke', false);
    } catch (_) {}
    var debug = window.LumiFieldPlaylistLinkImport.getDebug();
    var imported = window.LumiFieldPlaylistLinkImport.getImportedPlaylists();
    return {
      debug: debug,
      imported: imported,
      userKeys: (window.userPlaylists || []).map(function (item) {
        return String(item.sourceProvider || item.provider || '') + ':' + String(item.sourcePlaylistId || item.playlistId || item.id || '');
      }).sort(),
      twoDKeys: Array.prototype.map.call(document.querySelectorAll('#pl-list [data-playlist-provider][data-playlist-id]'), function (node) {
        return node.getAttribute('data-playlist-provider') + ':' + node.getAttribute('data-playlist-id');
      }).sort(),
      shelfKeys: window.shelfManager && typeof shelfManager.getPlaylistKeys === 'function' ? shelfManager.getPlaylistKeys() : [],
    };
  });
}

async function verifyTwoAndThreeDimensionalViews(queueBefore) {
  await delay(450);
  const expectedKeys = LINK_CASES.map(item => `${item.provider}:${item.id}`).sort();
  const views = await viewSnapshot();
  const debug2d = getPath(views.debug, ['view2DKeys', 'views.2d.keys']);
  const debug3d = getPath(views.debug, ['view3DKeys', 'views.3d.keys']);
  const twoDKeys = Array.isArray(debug2d) ? debug2d.slice().sort() : views.twoDKeys;
  const threeDKeys = Array.isArray(debug3d) ? debug3d.slice().sort() : views.shelfKeys;
  pass('every imported playlist is visible in the real 2D playlist surface',
    expectedKeys.every(key => twoDKeys.includes(key) || views.userKeys.includes(key)),
    { expectedKeys, twoDKeys, userKeys: views.userKeys });
  pass('every imported playlist is visible in the real 3D shelf data source',
    expectedKeys.every(key => threeDKeys.includes(key)),
    { expectedKeys, threeDKeys });

  const target = LINK_CASES[4];
  const expectedSongs = fixtureRecord(target).songs.map(song => song.id);
  const twoD = await cdp.call(async function (provider, id, title) {
    await openPlaylistPanelDetail(provider, id, title);
    return {
      key: playlistPanelDetailState.key,
      loading: playlistPanelDetailState.loading,
      error: playlistPanelDetailState.error,
      songIds: playlistPanelDetailState.tracks.map(function (song) { return String(song.id || ''); }),
    };
  }, [target.provider, target.id, fixtureRecord(target).metadata.name]);
  pass('2D playlist detail loads the exact imported provider+ID and real backend song IDs',
    twoD.key === `${target.provider}:${target.id}` && twoD.loading === false && !twoD.error && deepEqual(twoD.songIds, expectedSongs),
    { twoD, expectedSongs });

  const threeDStarted = await cdp.call(function (provider, id) {
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('p13-open-3d', false);
    var cards = shelfManager && shelfManager.getCards ? shelfManager.getCards() : [];
    var card = cards.find(function (entry) {
      return entry && entry.item && entry.item.provider === provider && String(entry.item.rawPlaylistId || '') === String(id);
    });
    if (!card) return { found: false, cards: cards.map(function (entry) {
      return entry && entry.item && { provider: entry.item.provider, id: entry.item.rawPlaylistId, title: entry.item.title };
    }) };
    shelfManager.openContent(card.index);
    return { found: true, index: card.index, title: card.item.title };
  }, [target.provider, target.id]);
  pass('3D shelf exposes a real card for an imported playlist', threeDStarted.found === true, threeDStarted);
  const threeD = await waitFor(() => cdp.call(function (provider, id) {
    var content = shelfManager && shelfManager.getContentList ? shelfManager.getContentList() : null;
    var ref = content && content.getOpenPlaylistRef ? content.getOpenPlaylistRef() : null;
    var debug = content && content.getDebug ? content.getDebug() : null;
    var calls = window.__lfP13Harness.calls.tracks;
    var call = calls.find(function (entry) { return entry.provider === provider && String(entry.id) === String(id); });
    return ref && debug && debug.state === 'ready' ? {
      ref: ref,
      call: call || null,
      open: content.isOpen(),
      songIds: (debug.tracks || []).map(function (song) { return String(song.id || ''); })
    } : null;
  }, [target.provider, target.id]), 10000, 80);
  pass('3D detail loads the exact provider+playlistId and imported real songs',
    threeD.open === true && threeD.ref.provider === target.provider && threeD.ref.id === target.id &&
    deepEqual(threeD.songIds, expectedSongs) &&
    (!threeD.call || (threeD.call.provider === target.provider && threeD.call.id === target.id)),
    threeD);
  await screenshot('five-imported-playlists-and-3d-detail');
  await assertQueueUnchanged('opening imported 2D/3D details without choosing Play preserves queue/currentIdx/audio.src', queueBefore);
}

async function verifyDuplicateUpdate(queueBefore) {
  const target = LINK_CASES[0];
  const before = (await importedPlaylists()).find(item => importKey(item) === `${target.provider}:${target.id}`);
  await delay(20);
  await setHarness({ provider: target.provider, version: 2 });
  const updated = await importAndConfirm(target, `分享更新：${target.direct}`, 'api-update', 2);
  const all = await importedPlaylists();
  pass('re-import upserts provider+playlistId in place and advances updatedAt instead of appending',
    all.length === 5 && all.filter(item => importKey(item) === `${target.provider}:${target.id}`).length === 1 &&
    Number(updated.updatedAt) >= Number(before.updatedAt) && songsOf(updated).some(song => song.id === `${target.provider}-track-update`),
    { before, updated, keys: all.map(importKey) });
  await assertQueueUnchanged('duplicate update preserves queue/currentIdx/audio.src', queueBefore);
}

async function verifyAccurateErrors(queueBefore) {
  const before = await importedPlaylists();
  const cases = [
    ['private playlist without login', ERROR_LINKS.login, 'PLAYLIST_LOGIN_REQUIRED', /登录/],
    ['deleted playlist', ERROR_LINKS.deleted, 'PLAYLIST_DELETED', /删除|不存在/],
    ['permission denied playlist', ERROR_LINKS.forbidden, 'PLAYLIST_PERMISSION_DENIED', /无权|权限/],
  ];
  for (const [label, url, code, messagePattern] of cases) {
    const submitted = await submitLink(url, 'api');
    const result = await confirmImport();
    const debugText = errorTextOf({ submitted, result });
    const uiText = await cdp.call(function () {
      var modal = document.getElementById('lf-playlist-import-modal');
      return modal && modal.textContent || '';
    });
    pass(`${label} reports its exact backend error and a specific user message`,
      debugText.includes(code) && messagePattern.test(debugText + '\n' + uiText) && !pendingOf(result.debug),
      { submitted, result, uiText });
    await cancelImport();
  }

  const resolveBeforeInvalid = (await harnessSnapshot()).calls.resolve.length;
  const invalidInputs = [
    ['unofficial URL', 'https://evil.example/playlist?id=123', /不支持|官方|平台/, false],
    ['HTTP URL', 'http://music.163.com/playlist?id=5103375927', /HTTPS|安全|链接/, false],
    ['credential URL', 'https://u:p@music.163.com/playlist?id=5103375927', /凭据|链接|安全/, false],
    ['invalid playlist URL', 'https://music.163.com/song?id=5103375927', /歌单|链接|ID/, true],
    ['overlong URL', `https://music.163.com/playlist?id=1&x=${'a'.repeat(2100)}`, /过长|链接/, false],
  ];
  for (const [label, input, pattern, mayNeedBackend] of invalidInputs) {
    const submitted = await submitLink(input, 'api');
    const result = pendingOf(submitted.debug) && mayNeedBackend ? await confirmImport() : submitted;
    const uiText = await cdp.call(function () {
      var modal = document.getElementById('lf-playlist-import-modal');
      return modal && modal.textContent || '';
    });
    pass(`${label} is rejected before import with an accurate visible error`,
      /false|error|invalid|forbidden|required|unsupported|missing|long|http|凭据|不支持|无效|过长/i.test(errorTextOf(result)) &&
      pattern.test(errorTextOf(result) + '\n' + uiText) && !pendingOf(result.debug),
      { submitted, result, uiText });
    await cancelImport();
  }
  const resolveAfterInvalid = (await harnessSnapshot()).calls.resolve.length;
  pass('unofficial, credential-bearing, HTTP and overlong URLs never reach the backend resolver',
    resolveAfterInvalid - resolveBeforeInvalid <= 1,
    { before: resolveBeforeInvalid, after: resolveAfterInvalid, allowedBackendOnlyForOfficialInvalidRoute: 1 });
  const after = await importedPlaylists();
  pass('failed, deleted, private and forbidden imports mutate no playlist data', deepEqual(after, before), { before, after });
  await assertQueueUnchanged('all import errors preserve queue/currentIdx/audio.src', queueBefore);
}

async function storageSnapshot() {
  return cdp.call(function () {
    var result = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (/playlist|import|lumifield/i.test(key)) result[key] = localStorage.getItem(key);
    }
    return result;
  });
}

async function verifyPersistenceAndUserIsolation() {
  const aBefore = await importedPlaylists();
  const storage = await storageSnapshot();
  const raw = JSON.stringify(storage);
  pass('persistent user-scoped storage contains every imported source/canonical/timestamp/song field and no credential material',
    LINK_CASES.every(linkCase => raw.includes(linkCase.id) && raw.includes(linkCase.provider)) &&
    /canonicalUrl/.test(raw) && /sourceProvider/.test(raw) && /sourcePlaylistId/.test(raw) && /updatedAt/.test(raw) &&
    /songs/.test(raw) && !/(?:cookie|authorization|password|bearer|refresh_token|access_token)/i.test(raw),
    { keys: Object.keys(storage), bytes: raw.length });

  await reloadPage();
  await installFixtures(LINK_CASES);
  await setUser(USER_A);
  const aReloaded = await importedPlaylists();
  pass('page reload restores all five imported playlists and their real songs for LF user A',
    aReloaded.length === 5 && LINK_CASES.every(linkCase => {
      const record = aReloaded.find(item => importKey(item) === `${linkCase.provider}:${linkCase.id}`);
      return record && songsOf(record).length === 2;
    }), aReloaded.map(item => ({ key: importKey(item), songs: songsOf(item).map(song => song.id) })));

  const aDebug = await apiDebug();
  await setUser(USER_B);
  const bEmpty = await importedPlaylists();
  const bDebug = await apiDebug();
  pass('switching to LF user B starts with an empty isolated import archive and a distinct scope hash',
    bEmpty.length === 0 && String(getPath(aDebug, ['scopeHash', 'scope.hash']) || '') &&
    String(getPath(aDebug, ['scopeHash', 'scope.hash']) || '') !== String(getPath(bDebug, ['scopeHash', 'scope.hash']) || ''),
    { aDebug, bDebug, bEmpty });

  const bTarget = LINK_CASES[1];
  await importAndConfirm(bTarget, bTarget.direct, 'api-user-b', 1);
  const bOnly = await importedPlaylists();
  pass('LF user B owns only the playlist explicitly imported by B',
    bOnly.length === 1 && importKey(bOnly[0]) === `${bTarget.provider}:${bTarget.id}`, bOnly);

  await setUser(USER_A);
  const aRestored = await importedPlaylists();
  pass('switching back to LF user A restores A without leaking B records',
    aRestored.length === 5 && LINK_CASES.every(linkCase => aRestored.some(item => importKey(item) === `${linkCase.provider}:${linkCase.id}`)),
    aRestored.map(importKey));
  await setUser(USER_B);
  pass('switching again to LF user B restores only B data',
    (await importedPlaylists()).length === 1 && importKey((await importedPlaylists())[0]) === `${bTarget.provider}:${bTarget.id}`,
    await importedPlaylists());

  await reloadPage();
  await installFixtures(LINK_CASES);
  await setUser(USER_B);
  const bReloaded = await importedPlaylists();
  await setUser(USER_A);
  const aAfterSecondReload = await importedPlaylists();
  pass('reload preserves both LF user archives with no cross-user leakage',
    bReloaded.length === 1 && importKey(bReloaded[0]) === `${bTarget.provider}:${bTarget.id}` &&
    aAfterSecondReload.length === 5,
    { b: bReloaded.map(importKey), a: aAfterSecondReload.map(importKey) });
}

async function run() {
  await verifyPureLinkParser();
  await verifyBackendResolverContract();
  await startApp();
  const installed = await installFixtures(LINK_CASES);
  pass('controlled playlist backend fixture installs in the real Electron renderer for all five providers',
    installed.installed === true && deepEqual(installed.providers.sort(), PROVIDERS.slice().sort()), installed);
  await setUser(USER_A);
  const queueBefore = await configureQueueInvariant();
  await verifyUiContractAndUnifiedSubmit(queueBefore);
  await verifyProgressAndCancel(queueBefore);
  await verifyFiveImportsAndShortLinks(queueBefore);
  await verifyTwoAndThreeDimensionalViews(queueBefore);
  await verifyDuplicateUpdate(queueBefore);
  await verifyAccurateErrors(queueBefore);
  await verifyPersistenceAndUserIsolation();

  pass('real Electron renderer has zero uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    problem: 13,
    mode: 'real Electron/CDP official playlist-link parser, import, persistence and 2D/3D integration audit',
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
    problem: 13,
    resultFile,
    checks: Object.keys(checks).length,
    screenshots: screenshots.length,
    rendererErrors: rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  const failure = {
    ok: false,
    problem: 13,
    runId,
    origin,
    evidenceDir,
    error: String(error && error.stack || error).slice(0, 16000),
    checkSummary: { passed: Object.keys(checks).length, names: Object.keys(checks) },
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-16000),
    completedAt: new Date().toISOString(),
  };
  try { fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`); } catch (_) {}
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
