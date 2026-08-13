'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { app, session, shell } = require('electron');
const { MusicPlatformManager } = require('../desktop/music-platform-manager');

const fixtureIndex = process.argv.indexOf('--write-official-fixture');
const fixtureProfile = fixtureIndex >= 0 ? String(process.argv[fixtureIndex + 1] || '') : '';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-qishui-import-'));
const appData = path.join(root, 'appdata');
const userData = path.join(root, 'lf-userdata');
const officialProfile = path.join(appData, 'SodaMusic');
const secret = 'qishui-import-smoke-secret-000000000000000000';
let server;
let manager;

app.disableHardwareAcceleration();
app.setPath('userData', fixtureProfile ? path.join(root, 'fixture-userdata') : userData);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function send(res, value, status) {
  const body = JSON.stringify(value);
  res.writeHead(status || 200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

(async () => {
  await app.whenReady();
  if (fixtureProfile) {
    fs.mkdirSync(fixtureProfile, { recursive: true });
    fs.writeFileSync(path.join(fixtureProfile, 'DeviceV1'), zlib.gzipSync(JSON.stringify({
      did: '7331000000000000001',
      iid: '7331000000000000002',
    })));
    const fixtureSession = session.fromPath(fixtureProfile, { cache: false });
    await fixtureSession.cookies.set({
      url: 'https://api.qishui.com/',
      name: 'sessionid_ss',
      value: 'real-local-session-fixture',
      domain: '.qishui.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: Date.now() / 1000 + 86400,
    });
    await fixtureSession.cookies.flushStore();
    fixtureSession.flushStorageData();
    return;
  }

  fs.mkdirSync(officialProfile, { recursive: true });
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const fixture = spawnSync(process.execPath, [__filename, '--write-official-fixture', officialProfile], {
    env: childEnv,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout || 'fixture failed');
  assert(fs.existsSync(path.join(officialProfile, 'Network', 'Cookies')));

  let backend = { loggedIn: false, cookies: {}, profile: null, device: null };
  server = http.createServer(async (req, res) => {
    if (req.headers['x-lumifield-session-secret'] !== secret) return send(res, { error: 'FORBIDDEN' }, 403);
    if (req.method === 'POST' && req.url === '/api/qishui/session') {
      const payload = await readBody(req);
      const cookies = Array.isArray(payload.cookies)
        ? Object.fromEntries(payload.cookies.map(cookie => [cookie.name, cookie.value]))
        : (payload.cookies || {});
      if (!cookies.sessionid_ss || !payload.device || payload.device.deviceId !== '7331000000000000001') {
        return send(res, { ok: true, provider: 'qishui', loggedIn: false, profile: null });
      }
      backend = {
        loggedIn: true,
        cookies,
        device: payload.device,
        profile: {
          provider: 'qishui',
          userId: '99887766',
          nickname: '汽水导入测试',
          avatar: 'https://p3.qishui.com/avatar.png',
          profileVerified: true,
          playlistsVerified: true,
          playlistCount: 3,
          deviceId: payload.device.deviceId,
          installId: payload.device.installId,
        },
      };
      return send(res, { ok: true, provider: 'qishui', loggedIn: true, profile: backend.profile });
    }
    if (req.method === 'GET' && req.url === '/api/qishui/session/export') {
      return send(res, { ok: true, provider: 'qishui', ...backend });
    }
    if (req.method === 'GET' && req.url === '/api/qishui/login/status') {
      return send(res, { ok: true, provider: 'qishui', loggedIn: backend.loggedIn, profile: backend.profile });
    }
    send(res, { error: 'NOT_FOUND' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  manager = new MusicPlatformManager({
    app: { getPath: name => name === 'appData' ? appData : userData },
    BrowserWindow: { fromWebContents: () => null },
    session,
    shell,
    sessionSecret: secret,
    backendBaseUrl: origin,
    qishuiOfficialProfilePath: officialProfile,
  });

  const before = manager.qishuiOfficialStatus();
  assert.equal(before.profileAvailable, true);
  assert.equal(before.canImport, true);
  const imported = await manager.importQishuiOfficialSession();
  assert.equal(imported.loggedIn, true);
  assert.equal(imported.profile.nickname, '汽水导入测试');
  assert.equal(imported.profile.playlistCount, 3);
  const persisted = await manager.safeCookies('qishui');
  assert(persisted.some(cookie => cookie.name === 'sessionid_ss' && cookie.value === 'real-local-session-fixture'));
  console.log(JSON.stringify({ ok: true, profile: imported.profile.nickname, playlistCount: imported.profile.playlistCount, persistedSession: true }));
})().catch(error => {
  console.error(error && error.stack || error);
  if (error && error.cause) console.error(error.cause.stack || error.cause);
  process.exitCode = 1;
}).finally(async () => {
  try { if (manager) manager.dispose(); } catch (_) {}
  try { if (server) await new Promise(resolve => server.close(resolve)); } catch (_) {}
  app.exit(process.exitCode || 0);
});
