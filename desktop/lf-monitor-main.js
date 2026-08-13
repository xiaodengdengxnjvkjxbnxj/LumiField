const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { LFBackend } = require('./lf-backend');
const { LFServiceClient } = require('./lf-service-client');
const { loadLFEnvironment } = require('./lf-env');

app.setName('LF后台监控');
if (process.platform === 'win32') app.setAppUserModelId('com.lumifield.monitor');
const gotLock = app.requestSingleInstanceLock();
let window = null;
let backend = null;
let remote = null;
let session = { token: '', refreshToken: '' };
let sessionLoaded = false;

function sharedUserData() {
  const configured = String(process.env.LF_SHARED_USER_DATA_DIR || '').trim();
  return configured && path.isAbsolute(configured) ? path.resolve(configured) : path.join(app.getPath('appData'), 'LumiField');
}
function sessionPath() { return path.join(app.getPath('userData'), 'lf-monitor-session.bin'); }
function loadEnvironment() {
  loadLFEnvironment({ packaged: app.isPackaged, exePath: process.execPath, appPath: app.getAppPath(), userData: sharedUserData() });
  let directory = path.dirname(process.execPath);
  for (let index = 0; index < 4; index += 1) { loadLFEnvironment({ appPath: directory }); directory = path.dirname(directory); }
}
function loadSession() {
  if (sessionLoaded) return session;
  sessionLoaded = true;
  try {
    if (safeStorage.isEncryptionAvailable()) session = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionPath())));
  } catch (_) { session = { token: '', refreshToken: '' }; }
  return session;
}
function saveSession(token, refreshToken) {
  sessionLoaded = true; session = { token: String(token || ''), refreshToken: String(refreshToken || '') };
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const target = sessionPath();
    const nonce = crypto.randomBytes(8).toString('hex');
    const temporary = `${target}.${process.pid}.${nonce}.tmp`;
    const backup = `${target}.${process.pid}.${nonce}.bak`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600, flag: 'wx' });
    let movedPrevious = false;
    try {
      if (fs.existsSync(target)) { fs.renameSync(target, backup); movedPrevious = true; }
      fs.renameSync(temporary, target);
      if (movedPrevious) { try { fs.unlinkSync(backup); } catch (_) {} }
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
      try { if (movedPrevious && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target); } catch (_) {}
      throw error;
    }
  } catch (_) {}
}
function clearSession() {
  sessionLoaded = true; session = { token: '', refreshToken: '' };
  try { if (fs.existsSync(sessionPath())) fs.unlinkSync(sessionPath()); } catch (_) {}
}
function service() {
  const endpoint = String(process.env.LF_REMOTE_API_URL || '').trim();
  if (endpoint) {
    if (!remote) remote = new LFServiceClient(endpoint);
    return { remote };
  }
  if (!backend) backend = new LFBackend({ dbPath: path.join(sharedUserData(), 'lf-backend.sqlite3'), appVersion: app.getVersion(), allowLocalCodes: false });
  return { backend };
}
async function call(method, pathname, payload, localCall, token = loadSession().token) {
  const target = service();
  if (target.remote) return method === 'GET' ? target.remote.get(pathname, token) : target.remote.post(pathname, token, payload || {});
  return localCall(target.backend, token);
}
function safeAuthResult(result) {
  if (result && result.ok && result.token) saveSession(result.token, result.refreshToken);
  if (!result || typeof result !== 'object') return result;
  const copy = { ...result }; delete copy.token; delete copy.refreshToken;
  if (copy.ok && loadSession().token) copy.sessionHandle = 'monitor-main-process';
  return copy;
}
async function requireAdmin() {
  const token = loadSession().token;
  if (!token) return { ok: false, authenticated: false, error: 'INVALID_SESSION' };
  let result = await call('GET', '/v1/admin/dashboard', null, (local, value) => local.adminDashboard(value), token);
  if (!result.ok && loadSession().refreshToken) {
    const refreshed = await call('POST', '/v1/auth/refresh', { refreshToken: loadSession().refreshToken }, local => local.refreshSession(loadSession().refreshToken), '');
    if (refreshed.ok) { saveSession(refreshed.token, refreshed.refreshToken); result = await call('GET', '/v1/admin/dashboard', null, (local, value) => local.adminDashboard(value)); }
  }
  if (!result.ok) clearSession();
  return result;
}
async function dashboardForRenderer() {
  const result = await requireAdmin();
  if (!result.ok) return result;
  result.loginServices = { email: result.loginServices && result.loginServices.email || {} };
  delete result.loginServiceConfigWritable;
  return result;
}

ipcMain.handle('monitor-auth-login', async (_event, payload) => {
  const safe = { account: String(payload && payload.account || ''), password: String(payload && payload.password || ''), deviceType: 'pc', deviceName: 'LF后台监控', method: 'password' };
  const result = await call('POST', '/v1/auth/login', safe, local => local.login(safe), '');
  if (!result.ok) return result;
  const token = result.token;
  const access = await call('GET', '/v1/admin/dashboard', null, local => local.adminDashboard(token), token);
  if (!access.ok) {
    await call('POST', '/v1/auth/logout', {}, local => local.logout(token), token);
    return { ok: false, error: 'FORBIDDEN', message: '只有 LF 管理员可以登录后台监控。' };
  }
  return safeAuthResult(result);
});
ipcMain.handle('monitor-auth-status', async () => {
  const result = await requireAdmin();
  return result.ok ? { ok: true, authenticated: true, user: result.users && result.users.find(user => user.role === 'admin') || null } : result;
});
ipcMain.handle('monitor-auth-logout', async () => {
  const token = loadSession().token;
  if (token) await call('POST', '/v1/auth/logout', {}, local => local.logout(token), token);
  clearSession(); return { ok: true };
});
ipcMain.handle('monitor-dashboard', async () => dashboardForRenderer());
ipcMain.handle('monitor-backend-status', async () => {
  const target = service();
  if (target.remote) return { ...(await target.remote.get('/health', '')), mode: 'remote' };
  return { ok: true, mode: 'shared-local', database: 'sqlite', databasePath: 'shared LumiField userData', appVersion: app.getVersion() };
});
ipcMain.handle('monitor-set-user-flag', async (_event, payload) => call('POST', '/v1/admin/user-flag', payload, (local, token) => local.setUserFlag(token, payload)));
ipcMain.handle('monitor-create-release', async (_event, payload) => call('POST', '/v1/admin/releases', payload, (local, token) => local.createRelease(token, payload)));
ipcMain.handle('monitor-decide-release', async (_event, payload) => call('POST', '/v1/admin/releases/decision', payload, (local, token) => local.decideRelease(token, payload)));
ipcMain.handle('monitor-attachment-status', async (_event, payload) => call('POST', '/v1/admin/feedback-attachment-status', payload, (local, token) => local.setFeedbackAttachmentStatus(token, payload)));
ipcMain.handle('monitor-retry-notifications', async () => {
  return call('POST', '/v1/admin/feedback-notifications/retry', { limit: 20 }, (local, token) => local.adminRetryFeedbackNotifications(token, 20));
});
ipcMain.handle('monitor-test-login-service', async (_event, payload) => {
  const request = { service: String(payload && payload.service || ''), action: String(payload && payload.action || '') };
  if (request.service !== 'email' || !['validate', 'send-test'].includes(request.action)) return { ok: false, error: 'LOGIN_PROVIDER_REMOVED' };
  return call('POST', '/v1/admin/login-services/test', request, (local, token) => local.testLoginService(token, request));
});
ipcMain.handle('monitor-open-attachment', async (_event, attachmentId) => {
  const target = service();
  if (target.backend) {
    const result = target.backend.feedbackAttachment(loadSession().token, String(attachmentId || ''));
    if (!result.ok) return result;
    const error = await shell.openPath(result.filePath); return { ok: !error, error: error || '', name: result.name };
  }
  const grant = await target.remote.post('/v1/admin/feedback-download-grant', loadSession().token, { attachmentId: String(attachmentId || '') });
  if (!grant.ok) return grant;
  const base = String(process.env.LF_REMOTE_API_URL || '').replace(/\/+$/, '');
  const url = `${base}/v1/admin/feedback-download?attachment=${encodeURIComponent(grant.attachmentId)}&grant=${encodeURIComponent(grant.grant)}`;
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url)) return { ok: false, error: 'INSECURE_DOWNLOAD_URL' };
  await shell.openExternal(url); return { ok: true, name: grant.name };
});
ipcMain.handle('monitor-window-close', () => { if (window) window.close(); return { ok: true }; });

async function createWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
  window = new BrowserWindow({ width: 1320, height: 840, minWidth: 980, minHeight: 640, show: false, title: 'LF后台监控', icon: path.join(__dirname, '..', 'build', 'icon.ico'), autoHideMenuBar: true, backgroundColor: '#071019', webPreferences: { preload: path.join(__dirname, 'lf-monitor-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window && window.show());
  window.on('closed', () => { window = null; });
  await window.loadFile(path.join(__dirname, '..', 'public', 'lf-monitor.html'));
  return window;
}

if (!gotLock) app.quit();
else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(() => { loadEnvironment(); service(); return createWindow(); });
  app.on('activate', () => createWindow());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (backend) backend.close(); backend = null; });
}
