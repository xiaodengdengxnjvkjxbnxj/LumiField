const assert = require('assert');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const https = require('https');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new3-'));
const cookieFile = path.join(tempRoot, '.cookie');
const qqCookieFile = path.join(tempRoot, '.qq-cookie');
fs.writeFileSync(cookieFile, 'MUSIC_U=lf-new3-fixture', 'utf8');
fs.writeFileSync(qqCookieFile, 'uin=o70; qm_keyst=lf-qq-fixture', 'utf8');

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.COOKIE_FILE = cookieFile;
process.env.QQ_COOKIE_FILE = qqCookieFile;

const neteaseApi = require('NeteaseCloudMusicApi');
const originalApi = {};
const calls = {
  userPlaylist: 0,
  delete: [],
  unsubscribe: [],
};
let neteaseAccountId = 7;
let switchNeteaseAccountDuringList = false;
const playlists = [
  { id: 101, name: 'Owned', userId: 7, subscribed: false, specialType: 0, creator: { userId: 7, nickname: 'Fixture' } },
  { id: 102, name: 'Subscribed', userId: 8, subscribed: true, specialType: 0, creator: { userId: 8, nickname: 'Other' } },
  { id: 103, name: 'Protected', userId: 7, subscribed: false, specialType: 5, creator: { userId: 7, nickname: 'Fixture' } },
  { id: 104, name: 'Concurrent', userId: 7, subscribed: false, specialType: 0, creator: { userId: 7, nickname: 'Fixture' } },
  { id: 105, name: 'Remote failure', userId: 7, subscribed: false, specialType: 0, creator: { userId: 7, nickname: 'Fixture' } },
  { id: 106, name: 'Foreign', userId: 8, subscribed: false, specialType: 0, creator: { userId: 8, nickname: 'Other' } },
  { id: 107, name: 'Permission denied', userId: 7, subscribed: false, specialType: 0, creator: { userId: 7, nickname: 'Fixture' } },
];

function replaceApi(name, implementation) {
  originalApi[name] = neteaseApi[name];
  neteaseApi[name] = implementation;
}

replaceApi('login_status', async () => ({
  status: 200,
  body: { code: 200, data: { profile: { userId: neteaseAccountId, nickname: 'Fixture' }, account: { id: neteaseAccountId } } },
}));
replaceApi('user_account', async () => ({
  status: 200,
  body: { code: 200, profile: { userId: neteaseAccountId, nickname: 'Fixture' }, account: { id: neteaseAccountId } },
}));
replaceApi('user_playlist', async () => {
  calls.userPlaylist += 1;
  if (switchNeteaseAccountDuringList) {
    switchNeteaseAccountDuringList = false;
    neteaseAccountId = 77;
  }
  return { status: 200, body: { code: 200, playlist: playlists.map(item => ({ ...item, creator: { ...item.creator } })) } };
});
replaceApi('playlist_delete', async params => {
  calls.delete.push({ id: String(params.id), cookie: params.cookie });
  if (String(params.id) === '104') await new Promise(resolve => setTimeout(resolve, 120));
  if (String(params.id) === '105') return { status: 200, body: { code: 500, message: 'fixture remote rejection' } };
  if (String(params.id) === '107') return { status: 200, body: { code: 403, message: 'permission denied' } };
  return { status: 200, body: { code: 200 } };
});

const originalHttpsRequest = https.request;
let qqListDelayMs = 0;
let qqListRequestCount = 0;
https.request = function fixtureHttpsRequest(target, options, callback) {
  const parsed = target instanceof URL ? target : new URL(String(target));
  if (!/(?:^|\.)y\.qq\.com$/i.test(parsed.hostname)) {
    return originalHttpsRequest.call(this, target, options, callback);
  }
  let payload = { code: 1000 };
  if (/fcg_user_created_diss/.test(parsed.pathname)) {
    payload = { code: 0, data: { disslist: [{ dissid: 'qq-owned', diss_name: 'QQ Owned', uin: '70' }] } };
  } else if (/fcg_get_profile_order_asset/.test(parsed.pathname)) {
    payload = { code: 0, data: { cdlist: [{ dissid: 'qq-collected', diss_name: 'QQ Collected', uin: '700' }] } };
  }
  const isPlaylistRequest = /fcg_user_created_diss|fcg_get_profile_order_asset/.test(parsed.pathname);
  if (isPlaylistRequest) qqListRequestCount += 1;
  const request = new EventEmitter();
  request.setTimeout = () => request;
  request.write = () => true;
  request.destroy = error => { if (error) queueMicrotask(() => request.emit('error', error)); };
  request.end = () => setTimeout(() => {
    const response = new PassThrough();
    response.statusCode = 200;
    callback(response);
    response.end(JSON.stringify(payload));
  }, isPlaylistRequest ? qqListDelayMs : 0);
  return request;
};

const platformServiceModule = require('../music-platform-service');
const originalCreateMusicPlatformService = platformServiceModule.createMusicPlatformService;
let kugouAccountId = '71';
let kugouConceptAccountId = '73';
let qishuiAccountId = '72';
let switchAccountDuringList = '';
platformServiceModule.createMusicPlatformService = function fixtureMusicPlatformService(deps) {
  const service = originalCreateMusicPlatformService(deps);
  return Object.assign(service, {
    exportKugouSession: () => ({ loggedIn: true, profile: { userId: kugouAccountId }, cookies: { userid: kugouAccountId } }),
    getKugouPlaylists: async () => {
      const result = { ok: true, loggedIn: true, playlists: [{ provider: 'kugou', id: 'kg-list', ownerId: '', ownership: 'unknown' }] };
      if (switchAccountDuringList === 'kugou') { switchAccountDuringList = ''; kugouAccountId = '171'; }
      return result;
    },
    exportKugouConceptSession: () => ({ loggedIn: true, profile: { userId: kugouConceptAccountId }, cookies: { userid: kugouConceptAccountId } }),
    getKugouConceptPlaylists: async () => {
      const result = { ok: true, loggedIn: true, playlists: [{ provider: 'kugou_concept', id: 'kgc-list', ownerId: '', ownership: 'unknown' }] };
      if (switchAccountDuringList === 'kugou_concept') { switchAccountDuringList = ''; kugouConceptAccountId = '173'; }
      return result;
    },
    exportQishuiSession: () => ({ loggedIn: true, profile: { userId: qishuiAccountId }, cookies: {} }),
    getQishuiPlaylists: async () => {
      const result = { ok: true, loggedIn: true, playlists: [{ provider: 'qishui', id: 'qs-list', ownerId: '72', ownership: 'owned' }] };
      if (switchAccountDuringList === 'qishui') { switchAccountDuringList = ''; qishuiAccountId = '172'; }
      return result;
    },
  });
};
replaceApi('playlist_subscribe', async params => {
  calls.unsubscribe.push({ id: String(params.id), t: params.t, cookie: params.cookie });
  return { status: 200, body: { code: 200 } };
});

let server;

function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.once('listening', resolve);
    target.once('error', reject);
  });
}

function closeServer(target) {
  return new Promise(resolve => {
    if (!target || !target.listening) resolve();
    else target.close(() => resolve());
  });
}

async function request(origin, route, options) {
  const response = await fetch(origin + route, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  return { status: response.status, body };
}

function post(origin, provider, id, context) {
  return request(origin, '/api/playlist/mutate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, id, ...(context || {}) }),
  });
}

function mutationContext(currentAccount, owner, ownership, operation) {
  return { currentAccount: String(currentAccount), owner: String(owner || ''), ownership, operation };
}

(async () => {
  const { playlistOwnershipMetadata } = require('../music-platform-service');
  assert.deepEqual(playlistOwnershipMetadata('owned', { deleteSupported: true }), {
    ownership: 'owned', owned: true, subscribed: false,
    canDelete: true, canUnsubscribe: false, mutationReason: '',
  });
  assert.equal(playlistOwnershipMetadata('unknown').mutationReason, 'PLAYLIST_OWNERSHIP_UNKNOWN');

  server = require('../server');
  await waitForListening(server);
  const origin = `http://127.0.0.1:${server.address().port}`;

  const wrongMethod = await request(origin, '/api/playlist/mutate');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.code, 'METHOD_NOT_ALLOWED');

  const listed = await request(origin, '/api/user/playlists');
  assert.equal(listed.status, 200);
  const byId = new Map(listed.body.playlists.map(item => [String(item.id), item]));
  assert.equal(byId.get('101').ownership, 'owned');
  assert.equal(byId.get('101').canDelete, true);
  assert.equal(byId.get('102').ownership, 'subscribed');
  assert.equal(byId.get('102').canUnsubscribe, true);
  assert.equal(byId.get('103').mutationReason, '');
  assert.equal(byId.get('103').canDelete, true);
  assert.equal(byId.get('106').ownership, 'unknown');

  const missingContext = await post(origin, 'netease', '101');
  assert.equal(missingContext.status, 400);
  assert.equal(missingContext.body.code, 'PLAYLIST_MUTATION_CONTEXT_REQUIRED');

  const localOnlyCases = [
    ['qq', 'qq-owned', mutationContext('70', '70', 'owned', 'remove-local')],
    ['kugou', 'kg-list', mutationContext('71', '', 'unknown', 'remove-local')],
    ['kugou_concept', 'kgc-list', mutationContext('73', '', 'unknown', 'remove-local')],
    ['qishui', 'qs-list', mutationContext('72', '72', 'owned', 'remove-local')],
  ];
  for (const [provider, id, context] of localOnlyCases) {
    const result = await post(origin, provider, id, context);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
    assert.equal(result.body.currentAccountId, context.currentAccount);
    assert.equal(result.body.operation, 'remove-local');
    assert.equal(result.body.localOnly, true);
    assert.equal(result.body.remoteMutated, false);
    assert.equal(result.body.platformUnchanged, true);
    assert.equal(result.body.notice, '仅从LF移除，平台端未删除');
  }

  const misleadingOperation = await post(origin, 'qishui', 'qs-list', mutationContext('72', '72', 'owned', 'delete'));
  assert.equal(misleadingOperation.status, 409);
  assert.equal(misleadingOperation.body.code, 'PLAYLIST_OPERATION_MISMATCH');
  assert.equal(misleadingOperation.body.operation, 'remove-local');

  for (const [provider, id, context] of localOnlyCases.filter(item => item[0] !== 'qq')) {
    switchAccountDuringList = provider;
    const switched = await post(origin, provider, id, context);
    assert.equal(switched.status, 409, JSON.stringify(switched.body));
    assert.equal(switched.body.code, 'PLAYLIST_ACCOUNT_CHANGED');
    assert.equal(switched.body.ok, false);
    if (provider === 'kugou') kugouAccountId = '71';
    if (provider === 'kugou_concept') kugouConceptAccountId = '73';
    if (provider === 'qishui') qishuiAccountId = '72';
  }

  qqListDelayMs = 80;
  const listRequestsBeforeSwitch = qqListRequestCount;
  const qqSwitchPending = post(origin, 'qq', 'qq-owned', mutationContext('70', '70', 'owned', 'remove-local'));
  for (let attempt = 0; attempt < 50 && qqListRequestCount < listRequestsBeforeSwitch + 2; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert(qqListRequestCount >= listRequestsBeforeSwitch + 2);
  const qqRelogin = await request(origin, '/api/qq/login/cookie', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie: 'uin=o170; qm_keyst=lf-qq-switched' }),
  });
  assert.equal(qqRelogin.status, 200);
  const qqSwitched = await qqSwitchPending;
  assert.equal(qqSwitched.status, 409, JSON.stringify(qqSwitched.body));
  assert.equal(qqSwitched.body.code, 'PLAYLIST_ACCOUNT_CHANGED');
  assert.equal(qqSwitched.body.currentAccountId, '170');
  qqListDelayMs = 0;
  const qqRestore = await request(origin, '/api/qq/login/cookie', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie: 'uin=o70; qm_keyst=lf-qq-fixture' }),
  });
  assert.equal(qqRestore.status, 200);

  const accountMismatch = await post(origin, 'qishui', 'qs-list', mutationContext('999', '72', 'owned', 'remove-local'));
  assert.equal(accountMismatch.status, 409);
  assert.equal(accountMismatch.body.code, 'PLAYLIST_ACCOUNT_MISMATCH');
  assert.equal(accountMismatch.body.currentAccountId, '72');

  const ownershipMismatch = await post(origin, 'qq', 'qq-owned', mutationContext('70', '70', 'subscribed', 'remove-local'));
  assert.equal(ownershipMismatch.status, 409);
  assert.equal(ownershipMismatch.body.code, 'PLAYLIST_OWNERSHIP_MISMATCH');

  const local = await post(origin, 'local', 'fixture');
  assert.equal(local.status, 409);
  assert.equal(local.body.code, 'LOCAL_PLAYLIST_STORE_UNAVAILABLE');

  const owned = await post(origin, 'netease', '101', mutationContext('7', '7', 'owned', 'delete'));
  assert.equal(owned.status, 200);
  assert.equal(owned.body.operation, 'delete');
  assert.equal(owned.body.remoteMutated, true);
  assert.equal(owned.body.currentAccountId, '7');
  assert.equal(calls.delete.filter(item => item.id === '101').length, 1);

  const subscribed = await post(origin, 'netease', '102', mutationContext('7', '8', 'subscribed', 'unsubscribe'));
  assert.equal(subscribed.status, 200);
  assert.equal(subscribed.body.operation, 'unsubscribe');
  assert.equal(subscribed.body.remoteMutated, true);
  assert.equal(calls.unsubscribe.filter(item => item.id === '102').length, 1);
  assert.equal(calls.unsubscribe.at(-1).t, 0);

  const specialPlaylist = await post(origin, 'netease', '103', mutationContext('7', '7', 'owned', 'delete'));
  assert.equal(specialPlaylist.status, 200);
  assert.equal(specialPlaylist.body.remoteMutated, true);
  assert.equal(calls.delete.some(item => item.id === '103'), true);

  const foreign = await post(origin, 'netease', '106', mutationContext('7', '8', 'unknown', 'remove-local'));
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'PLAYLIST_OWNERSHIP_UNKNOWN');
  assert.equal(calls.delete.some(item => item.id === '106'), false);

  const missing = await post(origin, 'netease', '999', mutationContext('7', '', 'unknown', 'remove-local'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'PLAYLIST_NOT_FOUND');

  const remoteFailure = await post(origin, 'netease', '105', mutationContext('7', '7', 'owned', 'delete'));
  assert.equal(remoteFailure.status, 502);
  assert.equal(remoteFailure.body.code, 'PLATFORM_MUTATION_FAILED');
  assert.equal(remoteFailure.body.message, 'fixture remote rejection');

  const permissionFallback = await post(origin, 'netease', '107', mutationContext('7', '7', 'owned', 'delete'));
  assert.equal(permissionFallback.status, 200);
  assert.equal(permissionFallback.body.operation, 'remove-local');
  assert.equal(permissionFallback.body.localOnly, true);
  assert.equal(permissionFallback.body.remoteMutated, false);
  assert.equal(permissionFallback.body.platformUnchanged, true);
  assert.equal(permissionFallback.body.reason, 'PLATFORM_PERMISSION_DENIED');

  neteaseAccountId = 7;
  switchNeteaseAccountDuringList = true;
  const deletesBeforeAccountSwitch = calls.delete.length;
  const neteaseSwitched = await post(origin, 'netease', '101', mutationContext('7', '7', 'owned', 'delete'));
  assert.equal(neteaseSwitched.status, 409, JSON.stringify(neteaseSwitched.body));
  assert.equal(neteaseSwitched.body.code, 'PLAYLIST_ACCOUNT_CHANGED');
  assert.equal(neteaseSwitched.body.currentAccountId, '77');
  assert.equal(calls.delete.length, deletesBeforeAccountSwitch);
  neteaseAccountId = 7;

  const concurrentContext = mutationContext('7', '7', 'owned', 'delete');
  const firstConcurrent = post(origin, 'netease', '104', concurrentContext);
  await new Promise(resolve => setTimeout(resolve, 15));
  const secondConcurrent = post(origin, 'netease', '104', concurrentContext);
  const concurrent = await Promise.all([firstConcurrent, secondConcurrent]);
  assert.deepEqual(concurrent.map(item => item.status).sort((a, b) => a - b), [200, 409]);
  assert.equal(concurrent.find(item => item.status === 409).body.code, 'PLAYLIST_MUTATION_IN_PROGRESS');
  assert.equal(calls.delete.filter(item => item.id === '104').length, 1);

  assert(calls.userPlaylist >= 7);
  console.log(JSON.stringify({
    ok: true,
    listMetadata: ['owned', 'subscribed', 'special-not-preblocked', 'unknown'],
    mutations: { delete: calls.delete.length, unsubscribe: calls.unsubscribe.length },
    localOnlyProviders: ['qq', 'kugou', 'kugou_concept', 'qishui'],
    permissionFallback: true,
    accountContextValidated: true,
    accountSwitchBlocked: ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'],
    duplicatePrevented: true,
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  await closeServer(server);
  Object.keys(originalApi).forEach(name => { neteaseApi[name] = originalApi[name]; });
  https.request = originalHttpsRequest;
  platformServiceModule.createMusicPlatformService = originalCreateMusicPlatformService;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
