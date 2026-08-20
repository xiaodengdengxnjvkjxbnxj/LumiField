const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog, safeStorage, nativeImage } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { pathToFileURL } = require('url');
const { LFBackend } = require('./lf-backend');
const { createLFAPIServer } = require('./lf-api-server');
const { LFServiceClient } = require('./lf-service-client');
const { WallpaperImportService } = require('./wallpaper-import-service');
const { createWallpaperVideoOptimizer } = require('./lf-wallpaper-video-optimizer');
const { loadSecureLoginConfig } = require('./lf-secure-login-config');
const { LFStemService, AUDIO_EXTENSIONS } = require('./lf-stem-service');
const { loadLFEnvironment } = require('./lf-env');
const { createIntegrityVerifier, createIntegrityStatusHook } = require('./lf-integrity');
const { createWindowStateCoordinator } = require('./lf-window-state-coordinator');
const { createVoiceAssistantController } = require('./lf-voice-assistant-main');
const { createAIAssistantController } = require('./lf-ai-provider-main');
const { createSplashController } = require('./lf-splash-main');
const QRCode = require('qrcode');

const BRAND = require(path.join(__dirname, '..', 'brand.config.json'));
const APP_NAME = BRAND.name || 'LumiField';
const APP_USER_MODEL_ID = BRAND.appId || 'com.lumifield.desktop';
app.setName(APP_NAME);

loadLFEnvironment({ packaged: app.isPackaged, exePath: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData') });

const allowPackagedCdpTest = app.isPackaged && process.env.LF_ALLOW_PACKAGED_CDP_TEST === '1';
if (app.isPackaged && !allowPackagedCdpTest) {
  app.commandLine.removeSwitch('remote-debugging-port');
  app.commandLine.removeSwitch('remote-debugging-pipe');
  app.commandLine.removeSwitch('remote-allow-origins');
}

let mainWindow = null;
let splashController = null;
let localServer = null;
let mainServerPort = 0;
let musicPlatformManager = null;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperWindow = null;
let wallpaperState = {};
let voiceAssistantController = null;
let aiAssistantController = null;
let windowStateCoordinator = null;
let windowStateDisplayEventsBound = false;
let mainWindowStateTimer = null;
let playbackWindowCloseReady = false;
let playbackWindowClosePending = false;
let playbackAppQuitting = false;
let playbackSaveRequestSerial = 0;
const playbackSaveWaiters = new Map();
let lfBackend = null;
let lfApiServer = null;
let lfApiStatus = { ok: false, error: 'NOT_STARTED' };
let lfRemoteClient = null;
const lfFeedbackUploads = new Map();
let wallpaperImportService = null;
let wallpaperVideoOptimizer = null;
const wallpaperVideoTaskOwners = new Map();
let lfStemService = null;
const lfStemTaskOwners = new Map();
let lfLoginConfigFile = '';
let lfSecureSession = { token: '', refreshToken: '' };
let lfSecureSessionLoaded = false;
let lfSecureSessionLoadWarning = '';
let lfIntegrityVerifier = null;
let lfIntegrityPendingStatus = null;
let lfIntegrityReportPromise = null;
let lfIntegrityEnforcement = null;
let lfIntegrityDeviceId = '';
let lfIntegrityLastVerifiedManifestId = '';
let lfIntegrityRuntimePromise = null;
let lfIntegrityRuntimeTimer = null;
let lfIntegrityRuntimeDebounce = null;
const lfIntegrityWatchedFiles = new Map();
let lfDeveloperShortcutPromise = null;
const registeredGlobalHotkeys = new Map();
const taskbarPlaybackState = {
  playing: false,
  canPrevious: false,
  canNext: false,
};
let taskbarToolbarState = {
  supported: process.platform === 'win32',
  applied: false,
  buttonCount: 0,
  buttons: [],
  playing: false,
  canPrevious: false,
  canNext: false,
};
const taskbarIcons = new Map();
const auxMusicLoginWindows = new Set();
const STARTUP_TIMEOUT_MS = 12000;
const LOCAL_SERVER_PORT_MIN = 3000;
const LOCAL_SERVER_PORT_MAX = 3031;
const LOCAL_SERVER_PORT_STATE_FILE = 'lf-local-server-port.json';
const WALLPAPER_EXTERNAL_PROVIDERS = Object.freeze({
  wallpaper_engine: {
    label: 'Wallpaper Engine',
    officialUrl: 'https://www.wallpaperengine.io/',
    exeNames: ['wallpaper64.exe', 'wallpaper32.exe', 'launcher.exe'],
    relativeDirs: [
      path.join('steamapps', 'common', 'wallpaper_engine'),
      path.join('SteamLibrary', 'steamapps', 'common', 'wallpaper_engine'),
    ],
  },
  qianqian: {
    label: '网易千千壁纸',
    officialUrl: 'https://qianqian.163.com/',
    exeNames: ['QianQianWallpaper.exe', 'QianqianWallpaper.exe', 'NeteaseWallpaper.exe', 'NeteaseCloudWallpaper.exe'],
    relativeDirs: [
      path.join('NetEase', 'QianQianWallpaper'),
      path.join('Netease', 'QianQianWallpaper'),
      path.join('QianQianWallpaper'),
    ],
  },
});

function writeStartupLog(message, error) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const detail = error && (error.stack || error.message || String(error));
    fs.appendFileSync(path.join(dir, 'startup.log'), `[${new Date().toISOString()}] ${message}${detail ? `\n${detail}` : ''}\n`);
  } catch (_) {}
}

function parseLegacyCookieHeader(raw) {
  const cookies = [];
  const seen = new Set();
  for (const part of String(raw || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    cookies.push({ name, value });
  }
  return cookies;
}

async function migrateLegacyPlaintextCookies() {
  const userDataPath = app.getPath('userData');
  const migrationsDir = path.join(userDataPath, 'migrations');
  const receiptPath = path.join(migrationsDir, 'legacy-plaintext-cookie-v1.json');
  const providers = [
    { provider:'netease', file:'.cookie', partition:NETEASE_LOGIN_PARTITION, url:'https://music.163.com/', domain:'.music.163.com' },
    { provider:'qq', file:'.qq-cookie', partition:QQ_LOGIN_PARTITION, url:'https://y.qq.com/', domain:'.qq.com' },
    { provider:'qq-project-legacy', filePath:path.join(__dirname, '..', '.qq-cookie'), partition:QQ_LOGIN_PARTITION, url:'https://y.qq.com/', domain:'.qq.com' },
  ];
  const results = [];
  for (const descriptor of providers) {
    const filePath = descriptor.filePath || path.join(userDataPath, descriptor.file);
    if (!fs.existsSync(filePath)) {
      results.push({ provider:descriptor.provider, status:'absent' });
      continue;
    }
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('INVALID_COOKIE_FILE');
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseLegacyCookieHeader(raw);
      if (raw.trim() && !parsed.length) throw new Error('INVALID_COOKIE_HEADER');
      const scopedSession = session.fromPartition(descriptor.partition, { cache:true });
      const existing = await scopedSession.cookies.get({ domain:descriptor.domain });
      const existingNames = new Set(existing.map(cookie => cookie.name));
      const imported = [];
      for (const cookie of parsed) {
        if (existingNames.has(cookie.name)) continue;
        await scopedSession.cookies.set({
          url:descriptor.url,
          domain:descriptor.domain,
          path:'/',
          secure:true,
          name:cookie.name,
          value:cookie.value,
        });
        imported.push(cookie);
      }
      const verified = await scopedSession.cookies.get({ domain:descriptor.domain });
      const verifiedByName = new Map(verified.map(cookie => [cookie.name, cookie.value]));
      if (!imported.every(cookie => verifiedByName.get(cookie.name) === cookie.value)) throw new Error('COOKIE_IMPORT_VERIFY_FAILED');
      fs.writeFileSync(filePath, '', { encoding:'utf8', mode:0o600 });
      fs.unlinkSync(filePath);
      results.push({ provider:descriptor.provider, status:'migrated', imported:imported.length, preserved:parsed.length - imported.length });
    } catch (error) {
      results.push({ provider:descriptor.provider, status:'preserved', error:String(error && error.message || error) });
    }
  }
  fs.mkdirSync(migrationsDir, { recursive:true });
  const temporary = `${receiptPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version:1, completedAt:new Date().toISOString(), results }, null, 2), { encoding:'utf8', mode:0o600 });
  fs.renameSync(temporary, receiptPath);
  return results;
}

function existingFile(filePath) {
  try { return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile(); } catch (_) { return false; }
}

function existingDir(dirPath) {
  try { return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory(); } catch (_) { return false; }
}

function openSafeExternal(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') return false;
    shell.openExternal(parsed.href).catch(() => {});
    return true;
  } catch (_) { return false; }
}

function isOfficialOAuthUrl(provider, input) {
  try {
    const url = new URL(String(input || ''));
    if (url.protocol !== 'https:') return false;
    return provider === 'wechat'
      ? url.hostname === 'open.weixin.qq.com' && url.pathname.startsWith('/connect/qrconnect')
      : provider === 'qq' && url.hostname === 'graph.qq.com' && url.pathname.startsWith('/oauth2.0/authorize');
  } catch (_) { return false; }
}

function lfSecureSessionPath() { return path.join(app.getPath('userData'), 'lf-auth-session.bin'); }

function loadLFSecureSession() {
  if (lfSecureSessionLoaded) return lfSecureSession;
  const filePath = lfSecureSessionPath();
  if (!existingFile(filePath)) {
    lfSecureSessionLoaded = true;
    return lfSecureSession;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      if (lfSecureSessionLoadWarning !== 'ENCRYPTION_UNAVAILABLE') {
        lfSecureSessionLoadWarning = 'ENCRYPTION_UNAVAILABLE';
        writeStartupLog('LF secure session load deferred: ENCRYPTION_UNAVAILABLE');
      }
      return lfSecureSession;
    }
    const encrypted = fs.readFileSync(filePath);
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    if (parsed && typeof parsed.token === 'string' && typeof parsed.refreshToken === 'string') {
      lfSecureSession = { token: parsed.token, refreshToken: parsed.refreshToken };
      lfSecureSessionLoaded = true;
      lfSecureSessionLoadWarning = '';
    } else if (lfSecureSessionLoadWarning !== 'INVALID_SESSION_FILE') {
      lfSecureSessionLoadWarning = 'INVALID_SESSION_FILE';
      writeStartupLog('LF secure session load deferred: INVALID_SESSION_FILE');
    }
  } catch (error) {
    const code = String(error && (error.code || error.name) || 'DECRYPT_FAILED').replace(/[^A-Z0-9_-]/gi, '').slice(0, 48) || 'DECRYPT_FAILED';
    if (lfSecureSessionLoadWarning !== code) {
      lfSecureSessionLoadWarning = code;
      writeStartupLog(`LF secure session load deferred: ${code}`);
    }
  }
  return lfSecureSession;
}

async function waitForLFSecureSession(field) {
  let stored = loadLFSecureSession();
  if (stored[field] || lfSecureSessionLoaded || !existingFile(lfSecureSessionPath())) return stored;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    stored = loadLFSecureSession();
    if (stored[field] || lfSecureSessionLoaded) break;
  }
  return stored;
}

function saveLFSecureSession(token, refreshToken) {
  lfSecureSessionLoaded = true;
  lfSecureSession = { token: String(token || ''), refreshToken: String(refreshToken || '') };
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const filePath = lfSecureSessionPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const nonce = crypto.randomBytes(8).toString('hex');
    const tempPath = `${filePath}.${process.pid}.${nonce}.tmp`;
    const backupPath = `${filePath}.${process.pid}.${nonce}.bak`;
    fs.writeFileSync(tempPath, safeStorage.encryptString(JSON.stringify(lfSecureSession)), { flag: 'wx', mode: 0o600 });
    let movedPrevious = false;
    try {
      if (fs.existsSync(filePath)) { fs.renameSync(filePath, backupPath); movedPrevious = true; }
      fs.renameSync(tempPath, filePath);
      if (movedPrevious) { try { fs.unlinkSync(backupPath); } catch (_) {} }
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      try { if (movedPrevious && !fs.existsSync(filePath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, filePath); } catch (_) {}
      throw error;
    }
  } catch (error) { writeStartupLog('Unable to persist encrypted LF session', error); }
}

function clearLFSecureSession() {
  lfSecureSessionLoaded = true;
  lfSecureSession = { token: '', refreshToken: '' };
  try { if (fs.existsSync(lfSecureSessionPath())) fs.unlinkSync(lfSecureSessionPath()); } catch (_) {}
}

const LF_DEV_WARNING = '您没有权限对此软件进行开发，如若继续您的账户将会被自动拉黑。';
const LF_DEV_CONTACT = '如执意开发/进行二创，请联系作者：3599284614@qq.com / 15037841583@139.com。';
const LF_BLOCKED_MESSAGE = '您的账户已被限制使用，请通过应用内反馈联系 LumiField 管理员。';

function getLFIntegrityDeviceId() {
  if (lfIntegrityDeviceId) return lfIntegrityDeviceId;
  const filePath = path.join(app.getPath('userData'), 'lf-device-id');
  try {
    const stored = fs.readFileSync(filePath, 'utf8').trim();
    if (/^device-[a-f0-9]{32}$/.test(stored)) {
      lfIntegrityDeviceId = stored;
      return stored;
    }
  } catch (_) {}
  const generated = `device-${crypto.randomBytes(16).toString('hex')}`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, generated, { flag: 'wx', mode: 0o600 });
    lfIntegrityDeviceId = generated;
  } catch (_) {
    try {
      const raced = fs.readFileSync(filePath, 'utf8').trim();
      lfIntegrityDeviceId = /^device-[a-f0-9]{32}$/.test(raced) ? raced : generated;
    } catch (_) { lfIntegrityDeviceId = generated; }
  }
  return lfIntegrityDeviceId;
}

function publicIntegrityStatus(status) {
  if (!status || typeof status !== 'object') return null;
  return {
    ok: status.ok === true,
    enforced: status.enforced === true,
    reason: String(status.reason || ''),
    checkedAt: String(status.checkedAt || ''),
    fileId: String(status.fileId || ''),
    product: String(status.product || ''),
    version: String(status.version || ''),
    files: Array.isArray(status.files) ? status.files.map(file => ({
      id: String(file && file.id || ''),
      size: Number(file && file.size) || 0,
      passes: Number(file && file.passes) || 0,
    })) : [],
  };
}

function ensureLFIntegrityVerifier() {
  if (lfIntegrityVerifier) return lfIntegrityVerifier;
  const publish = createIntegrityStatusHook(() => mainWindow);
  lfIntegrityVerifier = createIntegrityVerifier({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    appVersion: app.getVersion(),
    onStatus: status => publish(publicIntegrityStatus(status)),
  });
  return lfIntegrityVerifier;
}

function integrityEvidence(status) {
  if (!status || typeof status !== 'object') return null;
  const reason = String(status.reason || '');
  if (![
    'HASH_MISMATCH',
    'FILE_MISSING',
    'MANIFEST_MISSING',
    'MANIFEST_INVALID',
    'MANIFEST_SIGNATURE_INVALID',
    'UNEXPECTED_SCRIPT',
    'UNAUTHORIZED_MODULE',
  ].includes(reason)) return null;
  const expected = status.expected && typeof status.expected === 'object' ? status.expected : {};
  const actual = status.actual && typeof status.actual === 'object' ? status.actual : {};
  const expectedHash = String(status.expectedHash || expected.sha256 || '').toLowerCase();
  const actualHash = String(status.actualHash || actual.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return null;
  const missing = reason === 'FILE_MISSING' || reason === 'MANIFEST_MISSING';
  if (!missing && !/^[a-f0-9]{64}$/.test(actualHash)) return null;
  const fileId = String(status.fileId || '');
  if (!['app.asar', 'executable', 'ffmpeg', 'integrity-manifest', 'unexpected-script', 'install-module'].includes(fileId)) return null;
  const isManifest = fileId === 'integrity-manifest';
  const isInstallModule = fileId === 'unexpected-script' || fileId === 'install-module';
  const changedFileId = isManifest
    ? 'integrity-manifest'
    : isInstallModule
      ? fileId
      : fileId === 'app.asar'
        ? 'app-asar'
        : fileId === 'ffmpeg'
          ? 'ffmpeg'
          : 'lumifield-exe';
  const relativePath = isManifest
    ? 'resources/lf-integrity-manifest.json'
    : isInstallModule
      ? String(status.path || status.relativePath || '').replace(/\\/g, '/')
      : fileId === 'app.asar'
        ? 'resources/app.asar'
        : fileId === 'ffmpeg'
          ? 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'
          : 'LumiField.exe';
  if (
    isInstallModule &&
    (
      !relativePath ||
      relativePath.length > 240 ||
      relativePath.startsWith('/') ||
      /^[A-Za-z]:/.test(relativePath) ||
      relativePath.split('/').includes('..') ||
      !/\.(?:js|cjs|mjs|node|asar)$/i.test(relativePath)
    )
  ) return null;
  return {
    deviceId: getLFIntegrityDeviceId(),
    manifestId: String(
      status.manifestId ||
      (isManifest && lfIntegrityLastVerifiedManifestId) ||
      (isManifest ? `policy-${expectedHash}` : status.version) ||
      'signed-install-manifest'
    ).slice(0, 160),
    appVersion: String(status.appVersion || status.version || app.getVersion()),
    fileId,
    changedFileId,
    path: relativePath,
    expectedHash,
    actualHash: missing ? 'missing' : actualHash,
    eventType: missing
      ? 'file_missing'
      : isManifest
        ? 'integrity_bypass'
        : fileId === 'unexpected-script'
          ? 'unexpected_script'
          : fileId === 'install-module'
            ? 'unauthorized_module'
            : 'hash_mismatch',
    observedAt: Number.isFinite(Date.parse(status.checkedAt)) ? Date.parse(status.checkedAt) : Date.now(),
    confirmed: true,
  };
}

function integrityEnforcementState(result) {
  if (!result || typeof result !== 'object') return '';
  const source = result.enforcement && typeof result.enforcement === 'object'
    ? result.enforcement
    : result.integrity && typeof result.integrity === 'object'
      ? result.integrity
      : result;
  return String(source.state || source.status || result.action || '').toLowerCase();
}

function isIntegrityBlocked(result) {
  const state = integrityEnforcementState(result);
  return !!(result && (result.error === 'BLACKLISTED' || result.blocked === true || state === 'blocked' || state === 'blacklisted'));
}

function isIntegrityWarningPending(result) {
  if (!result || typeof result !== 'object') return false;
  const source = result.enforcement && typeof result.enforcement === 'object' ? result.enforcement : result;
  const state = integrityEnforcementState(result);
  return state === 'warned_pending_ack' ||
    !!(result.warning && result.warning.requiresAcknowledgement === true) ||
    result.warningRequired === true || result.warningPending === true ||
    source.warningRequired === true || source.warningPending === true ||
    (state === 'warned' && source.warningAckAt == null && source.warningAcknowledged === false);
}

function sendIntegrityRendererEvent(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload || {});
}

function lockForIntegrity(result) {
  clearLFSecureSession();
  lfIntegrityEnforcement = result || { ok: false, error: 'BLACKLISTED' };
  sendIntegrityRendererEvent('lf-integrity-locked', {
    ok: false,
    error: 'BLACKLISTED',
    message: String(result && result.message || LF_BLOCKED_MESSAGE),
  });
}

function applyIntegrityEnforcement(result) {
  if (!result || typeof result !== 'object') return result;
  lfIntegrityEnforcement = result;
  if (isIntegrityBlocked(result)) {
    lockForIntegrity(result);
  } else if (isIntegrityWarningPending(result)) {
    sendIntegrityRendererEvent('lf-integrity-warning', {
      warning: LF_DEV_WARNING,
      contact: LF_DEV_CONTACT,
    });
  }
  return result;
}

async function reportPendingIntegrityEvidence() {
  if (lfIntegrityReportPromise) return lfIntegrityReportPromise;
  const status = lfIntegrityPendingStatus;
  const evidence = integrityEvidence(status);
  const token = loadLFSecureSession().token;
  if (!evidence || !token) return null;
  lfIntegrityReportPromise = callLFService(
    'POST',
    '/v1/integrity/report',
    token,
    evidence,
    () => ensureLFBackend().reportIntegrityEvent(token, evidence)
  ).then(result => {
    if (lfIntegrityPendingStatus === status && result && result.ok) lfIntegrityPendingStatus = null;
    return applyIntegrityEnforcement(result);
  }).catch(error => {
    writeStartupLog('LF integrity report deferred', error);
    return { ok: false, error: 'INTEGRITY_REPORT_FAILED' };
  }).finally(() => {
    lfIntegrityReportPromise = null;
  });
  return lfIntegrityReportPromise;
}

function lfPendingIntegrityUpdatePath() {
  return path.join(app.getPath('userData'), 'lf-integrity-pending-update.json');
}

function readPendingLFIntegrityUpdate() {
  try {
    const value = JSON.parse(fs.readFileSync(lfPendingIntegrityUpdatePath(), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const pending = {
      windowId: String(value.windowId || ''),
      targetManifestId: String(value.targetManifestId || ''),
      toVersion: String(value.toVersion || ''),
      expiresAt: Number(value.expiresAt) || 0,
    };
    if (
      !/^[0-9A-Za-z._:-]{8,160}$/.test(pending.windowId) ||
      !/^[0-9A-Za-z._:-]{8,160}$/.test(pending.targetManifestId) ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pending.toVersion)
    ) return null;
    return pending;
  } catch (_) {
    return null;
  }
}

function savePendingLFIntegrityUpdate(pending) {
  const filePath = lfPendingIntegrityUpdatePath();
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, JSON.stringify(pending), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
  }
}

function clearPendingLFIntegrityUpdate() {
  try {
    const filePath = lfPendingIntegrityUpdatePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

async function completePendingLFIntegrityUpdate(status) {
  if (!status || status.reason !== 'VERIFIED') return null;
  const pending = readPendingLFIntegrityUpdate();
  if (!pending) return null;
  if (pending.expiresAt && pending.expiresAt <= Date.now()) {
    clearPendingLFIntegrityUpdate();
    return { ok: false, error: 'UPDATE_WINDOW_EXPIRED' };
  }
  if (pending.toVersion !== app.getVersion() || String(status.appVersion || status.version || '') !== app.getVersion()) {
    return { ok: false, error: 'UPDATE_NOT_INSTALLED' };
  }
  const token = loadLFSecureSession().token;
  if (!token) return { ok: false, error: 'INVALID_SESSION' };
  const payload = {
    deviceId: getLFIntegrityDeviceId(),
    windowId: pending.windowId,
    installedVersion: app.getVersion(),
    targetManifestId: pending.targetManifestId,
  };
  const result = await callLFService(
    'POST',
    '/v1/integrity/update/complete',
    token,
    payload,
    () => ensureLFBackend().completeIntegrityUpdateWindow(token, payload)
  );
  if (result && result.ok) clearPendingLFIntegrityUpdate();
  else if (result && ['UPDATE_WINDOW_EXPIRED', 'UPDATE_WINDOW_NOT_FOUND', 'UPDATE_TARGET_MISMATCH'].includes(result.error)) {
    clearPendingLFIntegrityUpdate();
  }
  return result;
}

async function runLFIntegrityCheck() {
  if (lfIntegrityRuntimePromise) return lfIntegrityRuntimePromise;
  lfIntegrityRuntimePromise = ensureLFIntegrityVerifier().verify().then(async status => {
    if (status && status.reason === 'VERIFIED' && /^[a-f0-9]{64}$/.test(String(status.manifestId || ''))) {
      lfIntegrityLastVerifiedManifestId = String(status.manifestId);
    }
    if (integrityEvidence(status)) {
      lfIntegrityPendingStatus = status;
      await reportPendingIntegrityEvidence();
    } else if (status && status.reason === 'VERIFIED') {
      await completePendingLFIntegrityUpdate(status);
    }
    return status;
  }).finally(() => {
    lfIntegrityRuntimePromise = null;
  });
  return lfIntegrityRuntimePromise;
}

function scheduleLFIntegrityRuntimeCheck() {
  if (!app.isPackaged || lfIntegrityRuntimeDebounce) return;
  lfIntegrityRuntimeDebounce = setTimeout(() => {
    lfIntegrityRuntimeDebounce = null;
    runLFIntegrityCheck().catch(error => writeStartupLog('LF runtime integrity check failed', error));
  }, 1200);
  if (lfIntegrityRuntimeDebounce.unref) lfIntegrityRuntimeDebounce.unref();
}

function startLFIntegrityRuntimeMonitor() {
  if (!app.isPackaged || lfIntegrityRuntimeTimer) return;
  lfIntegrityRuntimeTimer = setInterval(scheduleLFIntegrityRuntimeCheck, 10 * 60 * 1000);
  if (lfIntegrityRuntimeTimer.unref) lfIntegrityRuntimeTimer.unref();
  const watched = [
    process.execPath,
    path.join(process.resourcesPath, 'app.asar'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.resourcesPath, 'lf-integrity-manifest.json'),
  ];
  watched.forEach(filePath => {
    const listener = (current, previous) => {
      if (current.size !== previous.size || current.mtimeMs !== previous.mtimeMs || current.ctimeMs !== previous.ctimeMs) {
        scheduleLFIntegrityRuntimeCheck();
      }
    };
    lfIntegrityWatchedFiles.set(filePath, listener);
    fs.watchFile(filePath, { interval: 15000, persistent: false }, listener);
  });
}

function stopLFIntegrityRuntimeMonitor() {
  if (lfIntegrityRuntimeTimer) clearInterval(lfIntegrityRuntimeTimer);
  lfIntegrityRuntimeTimer = null;
  if (lfIntegrityRuntimeDebounce) clearTimeout(lfIntegrityRuntimeDebounce);
  lfIntegrityRuntimeDebounce = null;
  lfIntegrityWatchedFiles.forEach((listener, filePath) => fs.unwatchFile(filePath, listener));
  lfIntegrityWatchedFiles.clear();
}

async function runStartupIntegrityCheck() {
  return runLFIntegrityCheck();
}

function lfAccessToken(rendererValue) {
  const stored = loadLFSecureSession();
  return stored.token || (/^(?:main-process|active)$/i.test(String(rendererValue || '')) ? '' : String(rendererValue || ''));
}

function lfRefreshToken(rendererValue) {
  const stored = loadLFSecureSession();
  return stored.refreshToken || (/^(?:main-process|active)$/i.test(String(rendererValue || '')) ? '' : String(rendererValue || ''));
}

function secureAuthResult(result, fallbackToken, fallbackRefreshToken) {
  if (!result || typeof result !== 'object') return result;
  if (result.ok) {
    const token = String(result.token || fallbackToken || loadLFSecureSession().token || '');
    const refreshToken = String(result.refreshToken || fallbackRefreshToken || loadLFSecureSession().refreshToken || '');
    if (token || refreshToken) {
      saveLFSecureSession(token, refreshToken);
      if (lfIntegrityPendingStatus) setImmediate(() => { reportPendingIntegrityEvidence().catch(() => {}); });
      const verifiedStatus = ensureLFIntegrityVerifier().getStatus();
      if (verifiedStatus && verifiedStatus.reason === 'VERIFIED') {
        setImmediate(() => { completePendingLFIntegrityUpdate(verifiedStatus).catch(() => {}); });
      }
    }
  }
  const safe = Object.assign({}, result);
  delete safe.token;
  delete safe.refreshToken;
  if (safe.ok && loadLFSecureSession().token) safe.sessionHandle = 'main-process';
  return safe;
}

function lockWindowNavigation(window, allowNavigation) {
  if (!window || window.isDestroyed()) return;
  const allowed = url => {
    try { return !!allowNavigation(String(url || '')); } catch (_) { return false; }
  };
  window.webContents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    openSafeExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: 'deny' };
  });
}

function candidateInstallRoots() {
  const roots = new Set();
  [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'D:\\Program Files',
    'D:\\Program Files (x86)',
    'D:\\SteamLibrary',
  ].filter(Boolean).forEach((p) => roots.add(path.resolve(p)));
  const steamRoots = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'D:\\Steam',
  ].filter(Boolean);
  try {
    const output = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8', windowsHide: true, timeout: 2500,
    });
    const match = output.match(/SteamPath\s+REG_\w+\s+(.+)$/im);
    if (match && match[1]) steamRoots.push(match[1].trim().replace(/\//g, '\\'));
  } catch (_) {}
  steamRoots.forEach((root) => {
    roots.add(path.resolve(root));
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      const matches = text.matchAll(/"path"\s+"([^"]+)"/g);
      for (const match of matches) roots.add(path.resolve(match[1].replace(/\\\\/g, '\\')));
    } catch (_) {}
  });
  return Array.from(roots);
}

function steamLibraryRoots() {
  const roots = new Set();
  candidateInstallRoots().forEach((root) => {
    const resolved = path.resolve(root);
    if (existingDir(path.join(resolved, 'steamapps'))) roots.add(resolved);
    if (existingDir(path.join(resolved, 'Steam', 'steamapps'))) roots.add(path.join(resolved, 'Steam'));
    if (existingDir(path.join(resolved, 'steam', 'steamapps'))) roots.add(path.join(resolved, 'steam'));
  });
  return Array.from(roots);
}

function qianqianContentRoots() {
  const candidates = [];
  [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Pictures')]
    .filter(Boolean)
    .forEach((root) => {
      ['QianQianWallpaper', 'QianqianWallpaper', 'NetEase\\QianQianWallpaper', 'Netease\\QianQianWallpaper', '千千壁纸']
        .forEach(rel => candidates.push(path.join(root, rel)));
    });
  const status = detectWallpaperProvider('qianqian');
  if (status.installed && status.appPath) candidates.push(path.dirname(status.appPath));
  return candidates.filter(existingDir);
}

function ensureWallpaperImportService() {
  if (!wallpaperImportService) {
    wallpaperImportService = new WallpaperImportService({
      storageDir: path.join(app.getPath('userData'), 'wallpapers'),
      steamRoots: steamLibraryRoots(),
      qianqianRoots: qianqianContentRoots(),
    });
  }
  return wallpaperImportService;
}

function ensureWallpaperVideoOptimizer() {
  if (!wallpaperVideoOptimizer) {
    const configuredCacheBytes = Number(process.env.LF_WALLPAPER_VIDEO_MAX_CACHE_BYTES);
    wallpaperVideoOptimizer = createWallpaperVideoOptimizer({
      cacheDir: path.join(app.getPath('userData'), 'wallpapers'),
      maxCacheBytes: Number.isFinite(configuredCacheBytes) && configuredCacheBytes > 0
        ? Math.max(512 * 1024, Math.min(8 * 1024 * 1024 * 1024, Math.floor(configuredCacheBytes)))
        : 2 * 1024 * 1024 * 1024,
      onProgress(payload) {
        const ownerId = wallpaperVideoTaskOwners.get(String(payload && payload.taskId || ''));
        if (!ownerId || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== ownerId) return;
        mainWindow.webContents.send('lf-wallpaper-video-progress', payload || {});
      },
    });
  }
  return wallpaperVideoOptimizer;
}

function wallpaperVideoDisplayBudget(owner, requested) {
  const bounds = owner && !owner.isDestroyed() ? owner.getBounds() : { x:0, y:0, width:1920, height:1080 };
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
  const size = display && (display.size || display.workAreaSize) || {};
  requested = requested && typeof requested === 'object' ? requested : {};
  return {
    width: Math.max(640, Number(requested.width) || Number(size.width) || bounds.width || 1920),
    height: Math.max(360, Number(requested.height) || Number(size.height) || bounds.height || 1080),
    dpr: Math.max(1, Math.min(4, Number(requested.dpr) || Number(display && display.scaleFactor) || 1)),
    refreshRate: Math.max(30, Math.min(240, Number(requested.refreshRate) || 60)),
  };
}

function publicWallpaperVideoResult(value) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  delete result.path;
  delete result.outputPath;
  delete result.cachePath;
  delete result.directory;
  if (result.original && typeof result.original === 'object') {
    result.original = { ...result.original };
    delete result.original.path;
  }
  result.sourceName = String(result.sourceName || result.original && result.original.name || result.title || '');
  return result;
}

function lfStemCacheDir() { return path.join(app.getPath('userData'), 'lf-stem-cache'); }
const MAX_DECODED_STEM_BYTES = 512 * 1024 * 1024;

function validateDecodedStemWav(value) {
  let bytes;
  try {
    if (Buffer.isBuffer(value)) bytes = value;
    else if (value instanceof Uint8Array) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  } catch (_) {}
  if (!bytes || bytes.length < 44 || bytes.length > MAX_DECODED_STEM_BYTES) {
    return { ok: false, error: 'AUDIO_SIZE_INVALID', message: '解码后的歌曲大小无效或超过 512 MB 限制。' };
  }
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
      || bytes.toString('ascii', 12, 16) !== 'fmt ' || bytes.toString('ascii', 36, 40) !== 'data') {
    return { ok: false, error: 'SOURCE_NOT_DECODABLE', message: '解码结果不是标准 PCM WAV。' };
  }
  const format = bytes.readUInt16LE(20);
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bits = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  if (format !== 1 || channels !== 2 || sampleRate !== 44100 || bits !== 16
      || dataBytes < 4 || dataBytes > bytes.length - 44 || dataBytes % 4 !== 0) {
    return { ok: false, error: 'SOURCE_NOT_DECODABLE', message: '伴唱引擎只接受 44.1 kHz、双声道、16 位 PCM WAV。' };
  }
  return { ok: true, bytes: bytes.subarray(0, 44 + dataBytes) };
}

async function persistDecodedStemWav(value) {
  const validated = validateDecodedStemWav(value);
  if (!validated.ok) return validated;
  const sha256 = crypto.createHash('sha256').update(validated.bytes).digest('hex');
  const directory = path.join(app.getPath('userData'), 'lf-stem-source-cache', 'decoded');
  const destination = path.join(directory, `${sha256}.wav`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    if (fs.statSync(destination).isFile() && fs.statSync(destination).size === validated.bytes.length) {
      return { ok: true, inputPath: destination, cached: true, sha256 };
    }
  } catch (_) {}
  const temporary = path.join(directory, `.${sha256}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.part`);
  try {
    await fs.promises.writeFile(temporary, validated.bytes, { flag: 'wx', mode: 0o600 });
    try {
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      if (!existingFile(destination)) throw error;
      try { await fs.promises.unlink(temporary); } catch (_) {}
    }
    return { ok: true, inputPath: destination, cached: false, sha256 };
  } catch (error) {
    try { await fs.promises.unlink(temporary); } catch (_) {}
    return { ok: false, error: 'AUDIO_CACHE_WRITE_FAILED', message: '无法保存本地伴唱解码缓存。' };
  }
}

function ensureLFStemService() {
  if (!lfStemService) {
    lfStemService = new LFStemService({
      cacheDir: lfStemCacheDir(),
      resourcesPath: process.resourcesPath,
      sourceMaterializer: (sourceRef, options) => materializeCurrentAudioForStem(sourceRef.currentAudioUrl, {
        ...options,
        sourceKey: sourceRef.sourceKey,
      }),
      preparedValidator: validatePreparedStemAudio,
    });
    lfStemService.on('progress', (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lf-stem-progress', payload);
    });
  }
  return lfStemService;
}

function publicStemResult(value) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  if (result.result) result.result = publicStemResult(result.result);
  if (result.ok && result.vocalPath && result.noVocalsPath) {
    const root = path.resolve(lfStemCacheDir());
    const vocalPath = path.resolve(result.vocalPath);
    const noVocalsPath = path.resolve(result.noVocalsPath);
    const inside = candidate => candidate.startsWith(`${root}${path.sep}`) && existingFile(candidate);
    if (!inside(vocalPath) || !inside(noVocalsPath) || path.dirname(vocalPath) !== path.dirname(noVocalsPath)) return { ok: false, error: 'INVALID_STEM_OUTPUT' };
    const cacheKey = path.basename(path.dirname(vocalPath));
    if (!/^[a-f0-9]{64}$/i.test(cacheKey)) return { ok: false, error: 'INVALID_STEM_CACHE_KEY' };
    result.vocalUrl = `/api/local-stem/${cacheKey}/vocals.wav`;
    result.noVocalsUrl = `/api/local-stem/${cacheKey}/no_vocals.wav`;
  }
  delete result.vocalPath;
  delete result.noVocalsPath;
  delete result.manifestPath;
  return result;
}

function stemSourceExtension(contentType, upstreamUrl) {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  const byMime = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/flac': '.flac', 'audio/x-flac': '.flac',
    'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac',
    'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'audio/opus': '.opus',
    'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/vnd.wave': '.wav',
    'audio/x-ms-wma': '.wma', 'audio/aiff': '.aiff', 'audio/x-aiff': '.aiff',
  };
  if (byMime[mime]) return byMime[mime];
  try {
    const candidate = path.extname(new URL(String(upstreamUrl || '')).pathname).toLowerCase();
    if (AUDIO_EXTENSIONS.has(candidate)) return candidate;
  } catch (_) {}
  return '.mp3';
}

function normalizedStemRemoteUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { return ''; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateV4 = /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0';
  const privateV6 = host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe8[0-9a-f]:/i.test(host);
  if (!host || host === 'localhost' || host.endsWith('.local') || privateV4 || privateV6) return '';
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

function platformStemRemoteAllowed(provider, remoteUrl) {
  let host = '';
  try { host = new URL(remoteUrl).hostname.toLowerCase(); } catch (_) { return false; }
  const suffix = value => host === value || host.endsWith(`.${value}`);
  if (provider === 'netease') return suffix('music.163.com') || suffix('music.126.net');
  if (provider === 'qq') return suffix('qq.com') || suffix('gtimg.cn') || suffix('qpic.cn');
  if (provider === 'kugou' || provider === 'kugou_concept') {
    return suffix('kugou.com') || suffix('kgimg.com') || suffix('kugoucdn.com');
  }
  if (provider === 'qishui') {
    return ['qishui.com', 'douyinvod.com', 'douyin.com', 'byteimg.com', 'bytedance.com',
      'bytecdn.cn', 'ibytedtos.com', 'bytedanceapi.com', 'pstatp.com', 'volccdn.com'].some(suffix);
  }
  return false;
}

function normalizePlatformStemUrl(value, provider, allowCurrentSource = false) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 16384 || !mainServerPort) return '';
  const localBase = `http://127.0.0.1:${mainServerPort}`;
  let parsed;
  try { parsed = new URL(raw, localBase); } catch (_) { return ''; }
  if (parsed.origin === localBase && parsed.pathname === '/api/audio') {
    const upstream = normalizedStemRemoteUrl(parsed.searchParams.get('url'));
    return upstream && (allowCurrentSource || platformStemRemoteAllowed(provider, upstream))
      ? `/api/audio?url=${encodeURIComponent(upstream)}`
      : '';
  }
  const remote = normalizedStemRemoteUrl(parsed.href);
  return remote && (allowCurrentSource || platformStemRemoteAllowed(provider, remote))
    ? `/api/audio?url=${encodeURIComponent(remote)}`
    : '';
}

function platformStemInput(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const nested = payload.platformStem && typeof payload.platformStem === 'object' ? payload.platformStem : {};
  const provider = String(nested.provider || payload.provider || '').slice(0, 32);
  const accompanimentUrl = normalizePlatformStemUrl(
    nested.noVocalsUrl || nested.accompanimentUrl || nested.instrumentalUrl
      || payload.platformNoVocalsUrl || payload.platformAccompanimentUrl || payload.platformInstrumentalUrl,
    provider
  );
  if (!accompanimentUrl) return null;
  const vocalUrl = normalizePlatformStemUrl(nested.vocalUrl || payload.platformVocalUrl, provider);
  const originalUrl = normalizePlatformStemUrl(nested.originalUrl || payload.currentAudioUrl, provider, true);
  if (!vocalUrl && !originalUrl) return null;
  return {
    vocalUrl: vocalUrl || originalUrl,
    noVocalsUrl: accompanimentUrl,
    originalUrl: originalUrl || vocalUrl,
    stemLayout: vocalUrl ? 'separated-pair' : 'original-plus-accompaniment',
    provider,
    sourceKey: String(nested.sourceKey || payload.sourceKey || '').slice(0, 512),
  };
}

async function validatePreparedStemAudio(prepared, options = {}) {
  if (!prepared || prepared.vocalUrl === prepared.noVocalsUrl) {
    return { ok: false, error: 'INVALID_PLATFORM_STEMS', message: '平台返回的人声与伴奏轨道无效。' };
  }
  const entries = [
    ['vocal', prepared.vocalUrl],
    ['accompaniment', prepared.noVocalsUrl],
  ];
  for (let index = 0; index < entries.length; index += 1) {
    const [label, relativeUrl] = entries[index];
    let response;
    try {
      response = await fetch(new URL(relativeUrl, `http://127.0.0.1:${mainServerPort}`).href, {
        headers: { Range: 'bytes=0-4095' },
        redirect: 'error',
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal && options.signal.aborted) return { ok: false, error: 'CANCELLED' };
      return { ok: false, error: 'PLATFORM_STEM_NETWORK_FAILED', message: `平台${label === 'vocal' ? '人声' : '伴奏'}轨道读取失败。` };
    }
    const upstreamStatus = Number(response.headers.get('x-lumifield-upstream-status') || response.status || 0);
    if (!response.ok || !response.body) {
      try { if (response.body) await response.body.cancel(); } catch (_) {}
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        return { ok: false, error: 'SOURCE_ACCESS_DENIED_OR_DRM', message: '平台伴奏需要额外权限或受 DRM 保护。' };
      }
      if (upstreamStatus === 404 || upstreamStatus === 410) {
        return { ok: false, error: 'SOURCE_URL_EXPIRED', message: '平台伴奏地址已失效。' };
      }
      return { ok: false, error: `PLATFORM_STEM_HTTP_${upstreamStatus || response.status}`, message: `平台伴奏读取失败（HTTP ${upstreamStatus || response.status}）。` };
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (contentType && !/^audio\//i.test(contentType) && !/^(?:application\/(?:octet-stream|ogg))\b/i.test(contentType)) {
      try { await response.body.cancel(); } catch (_) {}
      return { ok: false, error: 'SOURCE_NOT_DECODABLE', message: `平台伴奏返回 ${contentType.split(';', 1)[0]}，不是可解码音频。` };
    }
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (bytes < 64) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch (_) {}
    }
    if (bytes < 44) return { ok: false, error: 'PLATFORM_STEM_EMPTY', message: '平台伴奏轨道没有有效音频数据。' };
    if (typeof options.onProgress === 'function') options.onProgress((index + 1) / entries.length);
  }
  return { ok: true };
}

async function materializeCurrentAudioForStem(inputUrl, options = {}) {
  let parsed;
  try { parsed = new URL(String(inputUrl || '')); } catch (_) { return { ok: false, error: 'INVALID_AUDIO_URL' }; }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || Number(parsed.port) !== Number(mainServerPort) || parsed.pathname !== '/api/audio') {
    return { ok: false, error: 'UNTRUSTED_AUDIO_URL', message: '只允许处理 LF 当前已解析的本地音频代理。' };
  }
  let upstream;
  try { upstream = new URL(parsed.searchParams.get('url') || ''); }
  catch (_) { return { ok: false, error: 'INVALID_UPSTREAM_AUDIO_URL', message: '当前歌曲没有有效的真实播放源。' }; }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    return { ok: false, error: 'UNTRUSTED_UPSTREAM_AUDIO_URL' };
  }
  const sourceDir = path.join(app.getPath('userData'), 'lf-stem-source-cache');
  fs.mkdirSync(sourceDir, { recursive: true });
  const identity = String(options.sourceKey || '').trim() || parsed.href;
  const key = crypto.createHash('sha256').update(identity).digest('hex');
  for (const extension of AUDIO_EXTENSIONS) {
    const existing = path.join(sourceDir, `${key}${extension}`);
    try {
      if (fs.statSync(existing).isFile() && fs.statSync(existing).size > 44) {
        if (typeof options.onProgress === 'function') options.onProgress(1);
        return { ok: true, inputPath: existing, cached: true };
      }
    } catch (_) {}
  }
  const temp = path.join(sourceDir, `.${key}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.part`);
  const timeoutSignal = AbortSignal.timeout(30 * 60 * 1000);
  const signal = options.signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([options.signal, timeoutSignal])
    : options.signal || timeoutSignal;
  try {
    const response = await fetch(parsed.href, { redirect: 'error', signal });
    if (!response.ok || !response.body) {
      const upstreamStatus = Number(response.headers.get('x-lumifield-upstream-status') || response.status || 0);
      try { if (response.body) await response.body.cancel(); } catch (_) {}
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        return { ok: false, error: 'SOURCE_ACCESS_DENIED_OR_DRM', message: '播放源拒绝解码访问，可能需要会员权限或受 DRM 保护。' };
      }
      if (upstreamStatus === 404 || upstreamStatus === 410) {
        return { ok: false, error: 'SOURCE_URL_EXPIRED', message: '歌曲播放地址已失效，请重新播放后再启用伴唱。' };
      }
      return { ok: false, error: `SOURCE_HTTP_${upstreamStatus || response.status}`, message: `读取歌曲播放源失败（HTTP ${upstreamStatus || response.status}）。` };
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (contentType && !/^audio\//i.test(contentType) && !/^(?:application\/(?:octet-stream|ogg))\b/i.test(contentType)) {
      try { await response.body.cancel(); } catch (_) {}
      return { ok: false, error: 'SOURCE_NOT_DECODABLE', message: `播放源返回 ${contentType.split(';', 1)[0]}，不是可解码音频。` };
    }
    const announced = Number(response.headers.get('content-length') || 0);
    const maximum = 20 * 1024 * 1024 * 1024;
    if (announced > maximum) {
      try { await response.body.cancel(); } catch (_) {}
      return { ok: false, error: 'AUDIO_SIZE_INVALID', message: '音频文件超过 20 GB 限制。' };
    }
    let received = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (typeof options.onProgress === 'function' && announced > 0) options.onProgress(Math.min(0.995, received / announced));
      callback(received > maximum ? Object.assign(new Error('音频文件超过 20 GB 限制。'), { code: 'AUDIO_SIZE_INVALID' }) : null, chunk);
    } });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      { signal }
    );
    if (received <= 44) throw Object.assign(new Error('播放源未返回有效音频数据。'), { code: 'SOURCE_EMPTY' });
    const extension = stemSourceExtension(contentType, upstream.href);
    const target = path.join(sourceDir, `${key}${extension}`);
    try { fs.renameSync(temp, target); }
    catch (error) {
      try {
        if (fs.statSync(target).isFile() && fs.statSync(target).size > 44) {
          fs.unlinkSync(temp);
          if (typeof options.onProgress === 'function') options.onProgress(1);
          return { ok: true, inputPath: target, cached: true };
        }
      } catch (_) {}
      throw error;
    }
    if (typeof options.onProgress === 'function') options.onProgress(1);
    return { ok: true, inputPath: target, cached: false, bytes: received, contentType };
  } catch (error) {
    try { if (path.resolve(temp).startsWith(`${path.resolve(sourceDir)}${path.sep}`) && fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
    if (options.signal && options.signal.aborted) return { ok: false, error: 'CANCELLED' };
    if (error && error.name === 'AbortError') return { ok: false, error: 'SOURCE_TIMEOUT', message: '读取歌曲播放源超时。' };
    return {
      ok: false,
      error: error && error.code || 'SOURCE_MATERIALIZE_FAILED',
      message: error && error.message || '读取歌曲播放源失败。',
    };
  }
}

function detectWallpaperProvider(providerId) {
  const provider = WALLPAPER_EXTERNAL_PROVIDERS[providerId];
  if (!provider) return { ok: false, provider: providerId, installed: false, error: 'UNKNOWN_PROVIDER' };
  const roots = candidateInstallRoots();
  const candidates = [];
  roots.forEach((root) => {
    provider.relativeDirs.forEach((rel) => {
      const dir = path.isAbsolute(rel) ? rel : path.join(root, rel);
      provider.exeNames.forEach((exe) => candidates.push(path.join(dir, exe)));
    });
    if (providerId === 'wallpaper_engine') {
      provider.exeNames.forEach((exe) => candidates.push(path.join(root, 'steamapps', 'common', 'wallpaper_engine', exe)));
    }
  });
  const appPath = candidates.find(existingFile) || '';
  return {
    ok: true,
    provider: providerId,
    label: provider.label,
    installed: !!appPath,
    appPath,
    officialUrl: provider.officialUrl,
    limitation: '当前只使用本机应用或官方页面；没有公开可嵌入 API 时，需要用户在外部软件导出图片/视频后手动导入。',
  };
}

function getWallpaperProviderStatus() {
  return Object.keys(WALLPAPER_EXTERNAL_PROVIDERS).map(detectWallpaperProvider);
}

async function openWallpaperProvider(providerId) {
  const status = detectWallpaperProvider(providerId);
  if (!status.ok) return status;
  try {
    if (status.installed && existingFile(status.appPath)) {
      const error = await shell.openPath(status.appPath);
      return Object.assign({}, status, { opened: !error, error: error || '', mode: 'local-app' });
    }
    await shell.openExternal(status.officialUrl);
    return Object.assign({}, status, { opened: true, mode: 'official-page' });
  } catch (e) {
    return Object.assign({}, status, { opened: false, error: e.message || 'OPEN_FAILED' });
  }
}

function ensureLFBackend() {
  if (!lfBackend) {
    lfBackend = new LFBackend({
      dbPath: path.join(app.getPath('userData'), 'lf-backend.sqlite3'),
      appVersion: app.getVersion(),
      updatePublicKey: loadLFUpdatePublicKey(),
      allowLocalCodes: (!app.isPackaged || allowPackagedCdpTest) && process.env.LF_ALLOW_LOCAL_CODES === '1',
    });
  }
  return lfBackend;
}

function configureLFRemoteClient() {
  const url = String(process.env.LF_REMOTE_API_URL || '').trim();
  if (!url) return null;
  if (lfRemoteClient) return lfRemoteClient;
  try { lfRemoteClient = new LFServiceClient(url); }
  catch (error) { writeStartupLog('Invalid LF remote API configuration', error); }
  return lfRemoteClient;
}

async function callLFService(method, pathname, token, payload, localCall) {
  const remote = configureLFRemoteClient();
  if (remote) return method === 'GET' ? remote.get(pathname, token) : remote.post(pathname, token, payload || {});
  return localCall();
}

async function callLFPresetShareService(method, pathname, payload, localCall) {
  const token = loadLFSecureSession().token;
  if (!token) return { ok: false, error: 'INVALID_SESSION', message: '请先登录 LF 账号。' };
  const remote = configureLFRemoteClient();
  if (remote) {
    return method === 'GET'
      ? remote.get(pathname, token)
      : remote.post(pathname, token, payload || {});
  }
  if (process.env.LF_PRESET_SHARE_ALLOW_LOCAL_TEST !== '1') {
    return {
      ok: false,
      error: 'PRESET_SHARE_REMOTE_REQUIRED',
      message: '预设分享需要连接 LF 官方分享服务。',
    };
  }
  return localCall(token);
}

async function startLFAPIServer() {
  if (lfApiServer) return lfApiStatus;
  lfApiServer = createLFAPIServer(ensureLFBackend());
  try {
    lfApiStatus = await lfApiServer.start();
  } catch (error) {
    lfApiStatus = { ok: false, error: error.message || 'LF_API_START_FAILED' };
    writeStartupLog('LF API server failed to start', error);
  }
  return lfApiStatus;
}

function sendLFUpdateProgress(owner, payload) {
  if (owner && !owner.isDestroyed()) owner.webContents.send('lf-update-progress', payload || {});
}

function loadLFUpdatePublicKey() {
  let key = String(process.env.LF_UPDATE_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
  if (key && existingFile(key)) key = fs.readFileSync(key, 'utf8').trim();
  if (key) return key;
  const packagedKey = path.join(__dirname, '..', 'build', 'lf-update-public.pem');
  return existingFile(packagedKey) ? fs.readFileSync(packagedKey, 'utf8').trim() : '';
}

function verifyLFUpdateSignature(release, digest) {
  const publicKey = loadLFUpdatePublicKey();
  if (!publicKey) throw new Error('UPDATE_SIGNING_NOT_CONFIGURED');
  const signature = String(release && release.signature || '').trim();
  if (!signature) throw new Error('UPDATE_SIGNATURE_MISSING');
  let valid = false;
  try {
    valid = crypto.verify('sha256', Buffer.from(`${release.version}:${digest}`), publicKey, Buffer.from(signature, 'base64'));
  } catch (_) { valid = false; }
  if (!valid) throw new Error('UPDATE_SIGNATURE_INVALID');
}

async function downloadAndOpenLFUpdate(owner, token, currentVersion) {
  const available = await callLFService('POST', '/v1/updates/available', token, { currentVersion }, () => ensureLFBackend().availableUpdate(token, currentVersion));
  if (!available.ok || !available.update) return available.ok ? { ok: false, error: 'NO_UPDATE', message: '没有已发布更新。' } : available;
  const release = available.update;
  const source = String(release.package_path || '').trim();
  if (!source) return { ok: false, error: 'PACKAGE_PATH_MISSING', message: '发布记录没有更新包地址。' };
  let filePath = '';
  let tempPath = '';
  try {
    if (existingFile(source)) {
      filePath = source;
      sendLFUpdateProgress(owner, { status: 'verifying', progress: 70, message: '正在验证本地更新包' });
    } else {
      if (!/^https:\/\//i.test(source)) return { ok: false, error: 'INSECURE_UPDATE_URL', message: '更新包必须使用 HTTPS 地址。' };
      const dir = getUpdateDownloadDir();
      fs.mkdirSync(dir, { recursive: true });
      const safeVersion = String(release.version || 'update').replace(/[^0-9A-Za-z._-]+/g, '-');
      filePath = path.join(dir, `LumiField-${safeVersion}-Setup.exe`);
      tempPath = `${filePath}.download`;
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      sendLFUpdateProgress(owner, { status: 'downloading', progress: 1, message: '正在下载已签名更新包' });
      const response = await fetch(source, { headers: { 'User-Agent': `LumiField/${app.getVersion()}` } });
      if (!response.ok || !response.body) throw new Error(`UPDATE_HTTP_${response.status}`);
      const total = Number(response.headers.get('content-length') || 0);
      if (total > 1536 * 1024 * 1024) throw new Error('UPDATE_PACKAGE_TOO_LARGE');
      const writer = fs.createWriteStream(tempPath, { flags: 'wx' });
      let received = 0;
      try {
        for await (const chunkValue of response.body) {
          const chunk = Buffer.from(chunkValue);
          received += chunk.length;
          if (received > 1536 * 1024 * 1024) throw new Error('UPDATE_PACKAGE_TOO_LARGE');
          if (!writer.write(chunk)) await new Promise(resolve => writer.once('drain', resolve));
          const progress = total > 0 ? Math.min(68, Math.max(1, Math.round(received / total * 68))) : Math.min(60, Math.round(Math.log10(received / 1024 + 1) * 18));
          sendLFUpdateProgress(owner, { status: 'downloading', progress, received, total, message: '正在下载已签名更新包' });
        }
        writer.end();
        await new Promise((resolve, reject) => { writer.once('finish', resolve); writer.once('error', reject); });
      } catch (error) {
        writer.destroy();
        throw error;
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (digest !== String(release.package_sha256 || '').toLowerCase()) throw new Error('UPDATE_SHA256_MISMATCH');
    verifyLFUpdateSignature(release, digest);
    const currentIntegrity = await runLFIntegrityCheck();
    if (app.isPackaged && (!currentIntegrity || currentIntegrity.reason !== 'VERIFIED')) {
      throw new Error('CURRENT_INSTALL_INTEGRITY_FAILED');
    }
    const sourceManifestId = String(
      currentIntegrity && currentIntegrity.manifestId ||
      crypto.createHash('sha256').update(`development:${app.getVersion()}`).digest('hex')
    );
    const updateWindowPayload = {
      deviceId: getLFIntegrityDeviceId(),
      releaseId: String(release.id || release.version || ''),
      fromVersion: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(currentVersion || ''))
        ? String(currentVersion)
        : app.getVersion(),
      toVersion: String(release.version || ''),
      targetManifestId: digest,
      sourceManifestId,
    };
    const updateWindow = await callLFService(
      'POST',
      '/v1/integrity/update/start',
      token,
      updateWindowPayload,
      () => ensureLFBackend().startIntegrityUpdateWindow(token, updateWindowPayload)
    );
    if (!updateWindow || !updateWindow.ok || !updateWindow.id) {
      throw new Error(String(updateWindow && updateWindow.error || 'UPDATE_INTEGRITY_WINDOW_FAILED'));
    }
    savePendingLFIntegrityUpdate({
      windowId: String(updateWindow.id),
      targetManifestId: digest,
      toVersion: String(release.version || ''),
      expiresAt: Number(updateWindow.expiresAt) || 0,
    });
    sendLFUpdateProgress(owner, { status: 'ready', progress: 100, message: '签名与哈希验证通过，正在打开安装程序' });
    const openError = await shell.openPath(filePath);
    if (openError) throw new Error(openError);
    if (!lfRemoteClient) ensureLFBackend().audit(null, 'update_installer_opened', null, release.version);
    return { ok: true, version: release.version, filePath, sessionPreserved: true, message: '安装程序已打开；LF 登录状态将保留。' };
  } catch (error) {
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    sendLFUpdateProgress(owner, { status: 'error', progress: 0, message: '更新失败，当前版本保持不变。' });
    return { ok: false, error: error.message || 'UPDATE_FAILED', message: '更新失败，当前版本保持不变。' };
  }
}

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const NETEASE_LOGIN_PARTITION = 'persist:lumifield-netease-login';
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
const QQ_LOGIN_PARTITION = 'persist:lumifield-qqmusic-login';
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile';
const AUX_MUSIC_PROVIDERS = Object.freeze({});

function auxProfilePath() {
  return path.join(app.getPath('userData'), 'music-platform-profiles.json');
}

function sanitizeAuxProfile(provider, value) {
  const source = value && typeof value === 'object' ? value : {};
  const nickname = String(source.nickname || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 80);
  const avatarValue = String(source.avatar || '').trim();
  const avatar = /^https:\/\//i.test(avatarValue) ? avatarValue.slice(0, 2048) : '';
  return { provider, nickname, avatar, updatedAt: Number(source.updatedAt) || Date.now() };
}

function readAuxProfiles() {
  try {
    const parsed = JSON.parse(fs.readFileSync(auxProfilePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeAuxProfiles(profiles) {
  try {
    fs.writeFileSync(auxProfilePath(), JSON.stringify(profiles, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    writeStartupLog('AUX_PROFILE_WRITE_FAILED', error);
  }
}

function persistAuxProfile(provider, profile) {
  const profiles = readAuxProfiles();
  profiles[provider] = sanitizeAuxProfile(provider, profile);
  writeAuxProfiles(profiles);
  return profiles[provider];
}

function deleteAuxProfile(provider) {
  const profiles = readAuxProfiles();
  delete profiles[provider];
  writeAuxProfiles(profiles);
}

async function extractAuxProfileFromWindow(loginWindow, provider) {
  if (!loginWindow || loginWindow.isDestroyed()) return null;
  try {
    const result = await loginWindow.webContents.executeJavaScript(`(() => {
      const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const textSelectors = ['[class*=nickname]','[class*=userName]','[class*=username]','[class*=user-name]','[class*=user_name]','a[href*=user]','a[href*=profile]'];
      const imageSelectors = ['img[class*=avatar]','img[src*=avatar]','img[class*=user]','header img','nav img'];
      let nickname = '';
      for (const selector of textSelectors) {
        for (const el of document.querySelectorAll(selector)) {
          const value = String(el.textContent || el.getAttribute('title') || '').replace(/\\s+/g,' ').trim();
          if (visible(el) && value.length >= 1 && value.length <= 80 && !/登录|login|注册/i.test(value)) { nickname = value; break; }
        }
        if (nickname) break;
      }
      let avatar = '';
      for (const selector of imageSelectors) {
        for (const el of document.querySelectorAll(selector)) {
          const src = String(el.currentSrc || el.src || '');
          if (visible(el) && /^https:\\/\\//i.test(src)) { avatar = src; break; }
        }
        if (avatar) break;
      }
      const inspectProfileObject = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 3) return;
        for (const [key, item] of Object.entries(value)) {
          if (!nickname && /^(nickname|nick_name|userName|user_name|displayName)$/i.test(key) && typeof item === 'string') {
            const text = item.replace(/\\s+/g,' ').trim();
            if (text && text.length <= 80) nickname = text;
          }
          if (!avatar && /^(avatar|avatarUrl|avatar_url|headUrl|head_url)$/i.test(key) && typeof item === 'string' && /^https:\\/\\//i.test(item)) avatar = item;
          if (item && typeof item === 'object') inspectProfileObject(item, depth + 1);
        }
      };
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length && (!nickname || !avatar); i += 1) {
          const key = storage.key(i) || '';
          if (!/(user|profile|account)/i.test(key)) continue;
          const raw = storage.getItem(key) || '';
          if (!raw || raw.length > 200000) continue;
          try { inspectProfileObject(JSON.parse(raw)); } catch (_) {}
        }
      }
      return { nickname, avatar };
    })()`, true);
    if (!result || (!result.nickname && !result.avatar)) return null;
    return sanitizeAuxProfile(provider, result);
  } catch (_) {
    return null;
  }
}

const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-oop-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['force_high_performance_gpu'],
  ['use-angle', 'd3d11'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
];
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];

function validLocalServerPort(port) {
  return typeof port === 'number' && Number.isInteger(port) &&
    port >= LOCAL_SERVER_PORT_MIN && port <= LOCAL_SERVER_PORT_MAX;
}

function localServerPortStatePath() {
  return path.join(app.getPath('userData'), LOCAL_SERVER_PORT_STATE_FILE);
}

function readRememberedLocalServerPort() {
  const filePath = localServerPortStatePath();
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 1024) throw new Error('INVALID_LOCAL_SERVER_PORT_STATE_FILE');
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!state || state.version !== 1 || !validLocalServerPort(state.port)) throw new Error('INVALID_LOCAL_SERVER_PORT_STATE');
    return state.port;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') writeStartupLog('Remembered local server port ignored', error);
    return null;
  }
}

function rememberLocalServerPort(port) {
  if (!validLocalServerPort(port)) {
    writeStartupLog('Local server port was not persisted', new Error('INVALID_LOCAL_SERVER_PORT'));
    return false;
  }
  const filePath = localServerPortStatePath();
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ version:1, port })}\n`, {
      encoding:'utf8', mode:0o600, flag:'wx',
    });
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (_) {}
    writeStartupLog('Local server port persistence failed', error);
    return false;
  }
}

function localServerPortCandidates(preferredPort) {
  const candidates = [];
  if (validLocalServerPort(preferredPort)) candidates.push(preferredPort);
  for (let port = LOCAL_SERVER_PORT_MIN; port <= LOCAL_SERVER_PORT_MAX; port += 1) {
    if (port !== preferredPort) candidates.push(port);
  }
  return candidates;
}

function localServerPortIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    tester.once('listening', () => {
      tester.close(error => error ? reject(error) : resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function findOpenPort(preferredPort) {
  for (const port of localServerPortCandidates(preferredPort)) {
    if (await localServerPortIsAvailable(port)) return port;
  }
  throw new Error('NO_AVAILABLE_LOCAL_PORT');
}

function waitForServer(server, timeoutMs = STARTUP_TIMEOUT_MS) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onListening = () => finish();
    const onError = (error) => finish(error);
    const timer = setTimeout(() => finish(new Error('LOCAL_SERVER_START_TIMEOUT')), timeoutMs);
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendWindowModeExitRequest(win, mode, reason) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send('desktop-window-mode-exit-request', {
    mode: String(mode || ''),
    reason: String(reason || 'system'),
  });
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('lumifield-global-hotkey', { action });
}

function getTaskbarIcon(name) {
  if (taskbarIcons.has(name)) return taskbarIcons.get(name);
  const filePath = path.join(__dirname, 'assets', 'thumbar', `${name}.png.b64`);
  let icon = nativeImage.createEmpty();
  try {
    icon = nativeImage.createFromBuffer(Buffer.from(fs.readFileSync(filePath, 'utf8').trim(), 'base64'));
    if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16, quality: 'best' });
  } catch (_) {}
  taskbarIcons.set(name, icon);
  return icon;
}

function applyWindowsTaskbarToolbar() {
  const supported = process.platform === 'win32';
  if (!supported || !mainWindow || mainWindow.isDestroyed()) {
    taskbarToolbarState = {
      supported,
      applied: false,
      buttonCount: 0,
      buttons: [],
      ...taskbarPlaybackState,
    };
    return taskbarToolbarState;
  }

  const buttons = [
    {
      tooltip: '上一首',
      icon: getTaskbarIcon('previous'),
      flags: taskbarPlaybackState.canPrevious ? [] : ['disabled'],
      click: () => sendGlobalHotkeyAction('prevTrack'),
    },
    {
      tooltip: taskbarPlaybackState.playing ? '暂停' : '播放',
      icon: getTaskbarIcon(taskbarPlaybackState.playing ? 'pause' : 'play'),
      flags: [],
      click: () => sendGlobalHotkeyAction('togglePlay'),
    },
    {
      tooltip: '下一首',
      icon: getTaskbarIcon('next'),
      flags: taskbarPlaybackState.canNext ? [] : ['disabled'],
      click: () => sendGlobalHotkeyAction('nextTrack'),
    },
  ];

  let applied = false;
  try {
    if (buttons.every(button => button.icon && !button.icon.isEmpty())) {
      applied = mainWindow.setThumbarButtons(buttons);
    }
  } catch (error) {
    writeStartupLog('Windows taskbar toolbar setup failed', error);
  }
  taskbarToolbarState = {
    supported,
    applied: !!applied,
    buttonCount: applied ? buttons.length : 0,
    buttons: [
      { action: 'prevTrack', tooltip: '上一首', enabled: taskbarPlaybackState.canPrevious, iconReady: !buttons[0].icon.isEmpty() },
      { action: 'togglePlay', tooltip: taskbarPlaybackState.playing ? '暂停' : '播放', enabled: true, iconReady: !buttons[1].icon.isEmpty() },
      { action: 'nextTrack', tooltip: '下一首', enabled: taskbarPlaybackState.canNext, iconReady: !buttons[2].icon.isEmpty() },
    ],
    ...taskbarPlaybackState,
  };
  return taskbarToolbarState;
}

function updateTaskbarPlaybackState(payload = {}) {
  taskbarPlaybackState.playing = payload.playing === true;
  taskbarPlaybackState.canPrevious = payload.canPrevious === true;
  taskbarPlaybackState.canNext = payload.canNext === true;
  return applyWindowsTaskbarToolbar();
}

function unregisterLumiFieldGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureLumiFieldGlobalHotkeys(bindings = []) {
  unregisterLumiFieldGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
    windowMode: 'normal',
    bounds: null,
    normalBounds: null,
    displayId: null,
    activeModes: [],
    baselineWindowState: null,
    transitioning: false,
    generation: 0,
  };
  const coordinated = windowStateCoordinator
    ? windowStateCoordinator.getState(win)
    : {
      windowMode: win.isFullScreen() ? 'fullscreen' : (win.isMaximized() ? 'maximized' : 'normal'),
      bounds: win.getBounds(),
      normalBounds: typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds(),
      activeModes: [],
      baselineWindowState: null,
      transitioning: false,
      generation: 0,
      isManagedFullScreen: false,
      nativeFullscreenObserved: false,
      isHtmlFullScreen: false,
    };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen() || !!coordinated.nativeFullscreenObserved,
    isHtmlFullScreen: !!coordinated.isHtmlFullScreen,
    isWindowFullScreen: !!coordinated.isManagedFullScreen,
    isFullScreen: win.isFullScreen() || !!coordinated.nativeFullscreenObserved || !!coordinated.isHtmlFullScreen || !!coordinated.isManagedFullScreen,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
    ...coordinated,
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (splashController && !splashController.isRevealed()) splashController.focus();
    return false;
  }
  if (splashController && !splashController.isRevealed()) {
    splashController.focus();
    return true;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (!mainWindow.isFocused()) {
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setAlwaysOnTop(false);
  }
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.LUMIFIELD_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.LUMIFIELD_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'LumiField immersive music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
          : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || '网易云登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openQQMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  const initialCookie = await readQQLoginCookieHeader(cookieSession);
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let warmupStarted = false;

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'QQ 音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie });
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.loadURL('https://y.qq.com/n/ryqq/player').catch((e) => console.warn('QQ login warmup navigation failed:', e.message));
            }
          }, 900);
        }
      } catch (e) {
        console.warn('QQ login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        resolve(qqCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'QQ 登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'QQ 登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function clearQQMusicLoginSession() {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function openAuxMusicLoginWindow(owner, providerName) {
  const normalizedProvider = String(providerName || '').toLowerCase();
  const provider = AUX_MUSIC_PROVIDERS[normalizedProvider];
  if (!provider) return { ok: false, error: 'UNSUPPORTED_PROVIDER' };
  const loginWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    parent: owner && !owner.isDestroyed() ? owner : undefined,
    modal: false,
    show: false,
    autoHideMenuBar: true,
    title: provider.title,
    backgroundColor: '#050817',
    icon: APP_ICON_ICO,
    webPreferences: {
      partition: provider.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  auxMusicLoginWindows.add(loginWindow);
  const providerSession = session.fromPartition(provider.partition);
  let lastStateSignature = '';
  let wasLoggedIn = false;
  let stateTimer = null;
  const publishLoginState = async () => {
    let state = await getAuxMusicLoginStatus(normalizedProvider);
    if (state.loggedIn) {
      const profile = await extractAuxProfileFromWindow(loginWindow, normalizedProvider);
      if (profile) persistAuxProfile(normalizedProvider, profile);
      state = await getAuxMusicLoginStatus(normalizedProvider);
    }
    const signature = JSON.stringify([state.loggedIn, state.profile && state.profile.nickname, state.profile && state.profile.avatar]);
    if (lastStateSignature === signature) return state;
    lastStateSignature = signature;
    if (owner && !owner.isDestroyed()) owner.webContents.send('music-platform-login-state', state);
    if (state.loggedIn && !wasLoggedIn) {
      wasLoggedIn = true;
      setTimeout(() => {
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      }, 900);
    }
    return state;
  };
  const cookieChangeListener = (_event, cookie) => {
    if (cookie && provider.loginCookiePattern.test(String(cookie.name || ''))) publishLoginState().catch(() => {});
  };
  providerSession.cookies.on('changed', cookieChangeListener);
  loginWindow.once('closed', () => {
    auxMusicLoginWindows.delete(loginWindow);
    if (stateTimer) clearInterval(stateTimer);
    providerSession.cookies.removeListener('changed', cookieChangeListener);
    publishLoginState().catch(() => {});
  });
  const navigate = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && provider.host.test(parsed.hostname);
    } catch (_) {
      return false;
    }
  };
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (navigate(url)) loginWindow.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (!navigate(url)) event.preventDefault();
  });
  loginWindow.webContents.on('did-finish-load', () => publishLoginState().catch(() => {}));
  loginWindow.once('ready-to-show', () => loginWindow.show());
  stateTimer = setInterval(() => publishLoginState().catch(() => {}), 1200);
  await loginWindow.loadURL(provider.url);
  return { ok: true, opened: true, provider: normalizedProvider };
}

async function getAuxMusicLoginStatus(providerName) {
  const normalizedProvider = String(providerName || '').toLowerCase();
  const provider = AUX_MUSIC_PROVIDERS[normalizedProvider];
  if (!provider) return { ok: false, error: 'UNSUPPORTED_PROVIDER', provider: normalizedProvider, loggedIn: false };
  try {
    const cookies = await session.fromPartition(provider.partition).cookies.get({});
    const loggedIn = cookies.some((cookie) => provider.loginCookiePattern.test(String(cookie.name || '')) && !!cookie.value);
    const cached = readAuxProfiles()[normalizedProvider];
    const profile = loggedIn ? sanitizeAuxProfile(normalizedProvider, cached || {
      nickname: '音乐平台用户',
      avatar: '',
    }) : null;
    return {
      ok: true,
      provider: normalizedProvider,
      loggedIn,
      profile,
      playlistSync: {
        available: false,
        code: 'LEGAL_API_UNAVAILABLE',
        message: '官方未提供可供第三方桌面客户端使用的公开歌单同步接口；当前仅保留官方登录会话与账号状态。',
      },
    };
  } catch (error) {
    return { ok: false, provider: normalizedProvider, loggedIn: false, error: error.message || 'LOGIN_STATUS_FAILED' };
  }
}

async function clearAuxMusicLoginSession(providerName) {
  const normalizedProvider = String(providerName || '').toLowerCase();
  const provider = AUX_MUSIC_PROVIDERS[normalizedProvider];
  if (!provider) return { ok: false, error: 'UNSUPPORTED_PROVIDER' };
  await session.fromPartition(provider.partition).clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  deleteAuxProfile(normalizedProvider);
  return { ok: true, provider: normalizedProvider, loggedIn: false };
}

async function getAuxMusicPlaylists(providerName) {
  const status = await getAuxMusicLoginStatus(providerName);
  if (!status.ok || !status.loggedIn) return { ok: false, provider: status.provider, loggedIn: false, playlists: [], error: 'NOT_LOGGED_IN' };
  return {
    ok: true,
    provider: status.provider,
    loggedIn: true,
    available: false,
    playlists: [],
    code: 'LEGAL_API_UNAVAILABLE',
    message: status.playlistSync.message,
  };
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function ensureWindowStateCoordinator(win) {
  if (!windowStateCoordinator) {
    windowStateCoordinator = createWindowStateCoordinator({
      screen,
      onState: target => sendWindowState(target),
    });
  }
  if (win && !win.isDestroyed()) windowStateCoordinator.attach(win);
  return windowStateCoordinator;
}

function setWindowMode(win, mode, enabled) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'NO_WINDOW' });
  return ensureWindowStateCoordinator(win).setMode(win, mode, enabled);
}

function toggleWindowMode(win, mode = 'player-fullscreen') {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'NO_WINDOW' });
  return ensureWindowStateCoordinator(win).toggleMode(win, mode);
}

function exitWindowModes(win) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'NO_WINDOW' });
  return ensureWindowStateCoordinator(win).exitAll(win);
}

async function toggleMaximize(win) {
  if (!win || win.isDestroyed()) return;
  const coordinator = ensureWindowStateCoordinator(win);
  const state = coordinator.getState(win);
  if (state.activeModes.length || win.isFullScreen()) {
    await coordinator.exitAll(win);
    return;
  }
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LumiFieldMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([LumiFieldMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lumifield-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lumifield-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('lumifield-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'LumiField Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

function attachWallpaperToWorkerW(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("LumiFieldNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LumiFieldNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [LumiFieldNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[LumiFieldNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [LumiFieldNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [LumiFieldNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [LumiFieldNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[LumiFieldNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[LumiFieldNativeWin]::SetParent($target, $script:workerw) | Out-Null
[LumiFieldNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error) => {
    if (error) console.warn('Wallpaper WorkerW attach failed:', error.message);
  });
}

function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow.setBounds(bounds, false);
}

function sendWallpaperState() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('lumifield-wallpaper-state', wallpaperState);
}

function createWallpaperWindow(payload = {}) {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow();
    sendWallpaperState();
    return wallpaperWindow;
  }
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#050608',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'LumiField Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });
  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    positionWallpaperWindow();
    wallpaperWindow.showInactive();
    attachWallpaperToWorkerW(wallpaperWindow);
    sendWallpaperState();
  });
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState);
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
  });
  wallpaperWindow.loadURL(overlayUrl('wallpaper.html')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  return wallpaperWindow;
}

function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    wallpaperWindow.close();
  }
  wallpaperWindow = null;
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
  if (voiceAssistantController) voiceAssistantController.stopRuntime();
}

ipcMain.handle('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  return toggleMaximize(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  return toggleWindowMode(getSenderWindow(event), 'player-fullscreen');
});

ipcMain.handle('desktop-window-set-fullscreen', (event, enabled) => {
  return setWindowMode(getSenderWindow(event), 'player-fullscreen', !!enabled);
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  return exitWindowModes(getSenderWindow(event));
});

ipcMain.handle('desktop-window-set-mode', (event, mode, enabled) => {
  return setWindowMode(getSenderWindow(event), String(mode || ''), !!enabled);
});

ipcMain.handle('desktop-window-toggle-mode', (event, mode) => {
  return toggleWindowMode(getSenderWindow(event), String(mode || 'player-fullscreen'));
});

ipcMain.handle('desktop-window-exit-modes', (event, source) => {
  return exitWindowModes(getSenderWindow(event)).catch(error => {
    error.message = `${error.message} [source=${String(source || 'renderer').slice(0, 80)}]`;
    throw error;
  });
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-set-background-keep', (event, enabled) => {
  const contents = event.sender;
  if (!contents || contents.isDestroyed()) return { ok: false, error: 'NO_WEB_CONTENTS' };
  const keep = enabled === true;
  contents.setBackgroundThrottling(!keep);
  return {
    ok: true,
    keep,
    backgroundThrottling: typeof contents.getBackgroundThrottling === 'function'
      ? contents.getBackgroundThrottling()
      : !keep,
  };
});

ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

function requestPlaybackStateSave(win, reason) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve(false);
  const requestId = `playback-save-${Date.now()}-${++playbackSaveRequestSerial}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      playbackSaveWaiters.delete(requestId);
      resolve(false);
    }, 650);
    playbackSaveWaiters.set(requestId, { resolve, timer, senderId: win.webContents.id });
    try {
      win.webContents.send('lumifield-playback-save-request', { requestId, reason: String(reason || 'main-process-exit') });
    } catch (_) {
      clearTimeout(timer);
      playbackSaveWaiters.delete(requestId);
      resolve(false);
    }
  });
}

ipcMain.on('lumifield-playback-save-complete', (event, payload) => {
  const requestId = String(payload && payload.requestId || '');
  const waiter = playbackSaveWaiters.get(requestId);
  if (!waiter || waiter.senderId !== event.sender.id) return;
  clearTimeout(waiter.timer);
  playbackSaveWaiters.delete(requestId);
  try { event.sender.session.flushStorageData(); } catch (_) {}
  waiter.resolve(payload && payload.ok === true);
});

ipcMain.handle('lumifield-hotkeys-configure-global', (_event, bindings) => {
  return configureLumiFieldGlobalHotkeys(bindings);
});

ipcMain.handle('lumifield-taskbar-playback-state', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { ok: false, error: 'INVALID_SENDER' };
  }
  return { ok: true, ...updateTaskbarPlaybackState(payload) };
});

ipcMain.handle('lumifield-taskbar-toolbar-state', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { ok: false, error: 'INVALID_SENDER' };
  }
  return { ok: true, ...taskbarToolbarState };
});

ipcMain.handle('lumifield-taskbar-test-click', (event, action) => {
  if (process.env.LF_ALLOW_PACKAGED_CDP_TEST !== '1') {
    return { ok: false, error: 'TEST_DISABLED' };
  }
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { ok: false, error: 'INVALID_SENDER' };
  }
  const safeAction = String(action || '');
  if (!['prevTrack', 'togglePlay', 'nextTrack'].includes(safeAction)) {
    return { ok: false, error: 'INVALID_ACTION' };
  }
  sendGlobalHotkeyAction(safeAction);
  return { ok: true, action: safeAction };
});

ipcMain.handle('lumifield-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'lumifield-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 LumiField 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('lumifield-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 LumiField 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('lumifield-wallpaper-providers', async () => {
  return { ok: true, providers: getWallpaperProviderStatus() };
});

ipcMain.handle('lumifield-wallpaper-open-provider', async (_event, providerId) => {
  return openWallpaperProvider(String(providerId || ''));
});

ipcMain.handle('lumifield-wallpaper-projects', async (_event, providerId) => {
  return ensureWallpaperImportService().scan(String(providerId || ''));
});

ipcMain.handle('lumifield-wallpaper-select-provider-resource', async (event, payload) => {
  const provider = String(payload && payload.provider || '');
  if (!Object.prototype.hasOwnProperty.call(WALLPAPER_EXTERNAL_PROVIDERS, provider)) return { ok: false, error: 'UNKNOWN_PROVIDER' };
  const owner = getSenderWindow(event);
  const folderMode = !!(payload && payload.folderMode);
  const result = await dialog.showOpenDialog(owner, {
    title: provider === 'wallpaper_engine' ? '选择 Wallpaper Engine 项目或已导出壁纸' : '选择网易千千壁纸本地资源',
    properties: folderMode ? ['openDirectory'] : ['openFile'],
    filters: folderMode ? undefined : [
      { name: '壁纸资源', extensions: ['json', 'html', 'htm', 'mp4', 'webm', 'mov', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] },
    ],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
  return ensureWallpaperImportService().registerSelection(provider, result.filePaths[0]);
});

ipcMain.handle('lumifield-wallpaper-import-project', async (_event, payload) => {
  return ensureWallpaperImportService().import(String(payload && payload.provider || ''), String(payload && payload.projectId || ''));
});

function wallpaperVideoOwner(event) {
  return event && event.sender && !event.sender.isDestroyed() && mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    ? event.sender.id : 0;
}

ipcMain.handle('lf-wallpaper-video-start', async (event, payload = {}) => {
  const ownerId = wallpaperVideoOwner(event);
  if (!ownerId) return { ok:false, error:'INVALID_SENDER' };
  const optimizer = ensureWallpaperVideoOptimizer();
  const inputPath = String(payload.inputPath || '');
  const owner = getSenderWindow(event);
  const started = await optimizer.start({
    inputPath,
    target: String(payload.target || 'global') === 'weather' ? 'weather' : 'global',
    title: path.basename(inputPath),
    display: wallpaperVideoDisplayBudget(owner, payload.display),
  });
  const startedTaskId = String(started && started.taskId || '');
  for (const [taskId, taskOwner] of wallpaperVideoTaskOwners) {
    if (taskOwner === ownerId && taskId !== startedTaskId) {
      await optimizer.cancel(taskId).catch(() => {});
      wallpaperVideoTaskOwners.delete(taskId);
    }
  }
  if (startedTaskId) wallpaperVideoTaskOwners.set(startedTaskId, ownerId);
  return publicWallpaperVideoResult(started);
});

ipcMain.handle('lf-wallpaper-video-status', async (event, taskId) => {
  const ownerId = wallpaperVideoOwner(event);
  taskId = String(taskId || '');
  if (!ownerId || wallpaperVideoTaskOwners.get(taskId) !== ownerId) return { ok:false, error:'STALE_WALLPAPER_VIDEO_TASK' };
  return publicWallpaperVideoResult(ensureWallpaperVideoOptimizer().status(taskId));
});

ipcMain.handle('lf-wallpaper-video-wait', async (event, taskId) => {
  const ownerId = wallpaperVideoOwner(event);
  taskId = String(taskId || '');
  if (!ownerId || wallpaperVideoTaskOwners.get(taskId) !== ownerId) return { ok:false, error:'STALE_WALLPAPER_VIDEO_TASK' };
  try { return publicWallpaperVideoResult(await ensureWallpaperVideoOptimizer().wait(taskId)); }
  finally { wallpaperVideoTaskOwners.delete(taskId); }
});

ipcMain.handle('lf-wallpaper-video-cancel', async (event, taskId) => {
  const ownerId = wallpaperVideoOwner(event);
  taskId = String(taskId || '');
  if (!ownerId || wallpaperVideoTaskOwners.get(taskId) !== ownerId) return { ok:false, error:'STALE_WALLPAPER_VIDEO_TASK' };
  try { return publicWallpaperVideoResult(await ensureWallpaperVideoOptimizer().cancel(taskId)); }
  finally { wallpaperVideoTaskOwners.delete(taskId); }
});

function wallpaperVideoCacheReference(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const reference = payload.reference && typeof payload.reference === 'object' ? payload.reference : payload;
  return {
    id: String(reference.id || '').slice(0, 128),
    importId: String(reference.importId || '').slice(0, 128),
    cacheKey: String(reference.cacheKey || '').slice(0, 256),
    projectId: String(reference.projectId || '').slice(0, 256),
  };
}

ipcMain.handle('lf-wallpaper-video-pin', async (event, payload = {}) => {
  if (!wallpaperVideoOwner(event)) return { ok:false, error:'INVALID_SENDER' };
  return publicWallpaperVideoResult(await ensureWallpaperVideoOptimizer().pin(
    wallpaperVideoCacheReference(payload),
    String(payload.ownerKey || '').slice(0, 512),
  ));
});

ipcMain.handle('lf-wallpaper-video-unpin', async (event, payload = {}) => {
  if (!wallpaperVideoOwner(event)) return { ok:false, error:'INVALID_SENDER' };
  return publicWallpaperVideoResult(await ensureWallpaperVideoOptimizer().unpin(
    wallpaperVideoCacheReference(payload),
    String(payload.ownerKey || '').slice(0, 512),
  ));
});

function lfStemOwner(event) {
  return event && event.sender && !event.sender.isDestroyed() ? String(event.sender.id) : '';
}

ipcMain.handle('lf-stem-status', async (event, taskId) => {
  const service = ensureLFStemService();
  const id = String(taskId || '');
  if (!id) return publicStemResult(service.status());
  const owner = lfStemOwner(event);
  if (!owner || lfStemTaskOwners.get(owner) !== id) {
    return { ok: false, error: 'STALE_STEM_TASK', message: '该伴唱任务已被更新的歌曲替代。' };
  }
  return publicStemResult(service.getTask(id));
});

ipcMain.handle('lf-stem-start', async (event, payload) => {
  payload = payload || {};
  const owner = lfStemOwner(event);
  if (!owner) return { ok: false, error: 'STEM_OWNER_GONE' };
  const service = ensureLFStemService();
  const previous = lfStemTaskOwners.get(owner);
  if (previous) service.cancel(previous);
  lfStemTaskOwners.delete(owner);
  const prepared = platformStemInput(payload);
  let inputPath = String(payload.inputPath || '');
  if (!prepared && payload.decodedWav) {
    const decoded = await persistDecodedStemWav(payload.decodedWav);
    if (!decoded.ok) return decoded;
    inputPath = decoded.inputPath;
  }
  const request = prepared
    ? { prepared, quality: payload.quality, model: payload.model }
    : inputPath
      ? { inputPath, quality: payload.quality, model: payload.model }
      : {
          sourceRef: {
            currentAudioUrl: String(payload.currentAudioUrl || ''),
            sourceKey: String(payload.sourceKey || ''),
          },
          quality: payload.quality,
          model: payload.model,
        };
  const queued = service.enqueue(request);
  if (queued.ok && queued.taskId) {
    lfStemTaskOwners.set(owner, queued.taskId);
  }
  return publicStemResult(queued);
});

ipcMain.handle('lf-stem-wait', async (event, taskId) => {
  const owner = lfStemOwner(event);
  const id = String(taskId || '');
  if (!owner || !id || lfStemTaskOwners.get(owner) !== id) {
    return { ok: false, error: 'STALE_STEM_TASK', message: '该伴唱任务已被更新的歌曲替代。' };
  }
  const result = await ensureLFStemService().wait(id);
  return publicStemResult(result);
});
ipcMain.handle('lf-stem-cancel', async (event, taskId) => {
  const owner = lfStemOwner(event);
  const id = String(taskId || '');
  if (!owner || !id || lfStemTaskOwners.get(owner) !== id) {
    return { ok: false, error: 'STALE_STEM_TASK', message: '该伴唱任务已结束或已被替代。' };
  }
  lfStemTaskOwners.delete(owner);
  return publicStemResult(ensureLFStemService().cancel(id));
});

ipcMain.handle('lf-auth-send-code', async (_event, payload) => {
  const safePayload = Object.assign({}, payload || {}, { requestIp: 'electron-ipc' });
  return callLFService('POST', '/v1/auth/code', '', payload, () => ensureLFBackend().sendVerificationCode(safePayload));
});

ipcMain.handle('lf-auth-register', async (_event, payload) => {
  return callLFService('POST', '/v1/auth/register', '', payload, () => ensureLFBackend().register(payload || {}));
});

ipcMain.handle('lf-auth-login', async (_event, payload) => {
  const safePayload = Object.assign({}, payload || {}, { requestIp: 'electron-ipc' });
  const result = await callLFService('POST', '/v1/auth/login', '', payload, () => ensureLFBackend().login(safePayload));
  return secureAuthResult(result);
});

function trustedMusicPlatformScopeSender(event) {
  const owner = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return !!(owner && mainWindow && owner === mainWindow && !owner.isDestroyed());
}

function forbiddenMusicPlatform(provider) {
  return { ok: false, provider: String(provider || ''), loggedIn: false, sessionValid: false, error: 'FORBIDDEN' };
}

function publicMusicPlatformScopeDebug(value) {
  const source = value && typeof value === 'object' ? value : {};
  const providers = {};
  for (const provider of ['kugou', 'kugou_concept', 'qishui', 'netease', 'qq']) {
    const detail = source.providers && source.providers[provider] || {};
    providers[provider] = {
      partition: String(detail.partition || ''),
      sessionValid: detail.sessionValid === true,
    };
  }
  return { ok: source.ok === true, scopeHash: String(source.scopeHash || ''), providers };
}

let musicPlatformScopeRequestSerial = 0;

function staleMusicPlatformScopeRequest(requestSerial) {
  return requestSerial !== musicPlatformScopeRequestSerial;
}

async function setValidatedMusicPlatformAccountScope(token, requestSerial) {
  if (!musicPlatformManager) return { ok: false, error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  if (staleMusicPlatformScopeRequest(requestSerial)) return { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
  const supplied = String(token || '').trim();
  if (!supplied) {
    const scope = await musicPlatformManager.setAccountScope('');
    return staleMusicPlatformScopeRequest(requestSerial)
      ? { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' }
      : publicMusicPlatformScopeDebug(scope);
  }
  if (/^(?:main-process|active)$/i.test(supplied)) await waitForLFSecureSession('token');
  if (staleMusicPlatformScopeRequest(requestSerial)) return { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
  const actualToken = lfAccessToken(supplied);
  if (!actualToken) return { ok: false, error: 'INVALID_SESSION' };
  const status = await callLFService(
    'POST',
    '/v1/auth/status',
    actualToken,
    {},
    () => ensureLFBackend().authStatus(actualToken, {})
  );
  if (staleMusicPlatformScopeRequest(requestSerial)) return { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
  const userId = String(status && status.user && status.user.id || '').trim();
  if (!status || status.ok !== true || status.authenticated !== true || !userId) {
    return { ok: false, error: 'INVALID_SESSION' };
  }
  const scope = await musicPlatformManager.setAccountScope(userId);
  return staleMusicPlatformScopeRequest(requestSerial)
    ? { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' }
    : publicMusicPlatformScopeDebug(scope);
}

ipcMain.handle('music-platform-set-account-scope', async (event, token) => {
  if (!trustedMusicPlatformScopeSender(event)) return { ok: false, error: 'FORBIDDEN' };
  const requestSerial = ++musicPlatformScopeRequestSerial;
  try { return await setValidatedMusicPlatformAccountScope(token, requestSerial); }
  catch (error) { return { ok: false, error: error.message || 'ACCOUNT_SCOPE_FAILED' }; }
});

ipcMain.handle('music-platform-account-scope-debug', async event => {
  if (!trustedMusicPlatformScopeSender(event)) return { ok: false, error: 'FORBIDDEN' };
  if (!musicPlatformManager) return { ok: false, error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  return publicMusicPlatformScopeDebug(await musicPlatformManager.getAccountScopeDebug());
});

ipcMain.handle('music-platform-set-test-account-scope', async (event, userId) => {
  const enabled = process.env.LF_MASTER_TEST === '1' || process.env.LUMIFIELD_E2E_TEST === '1';
  if (!enabled || !trustedMusicPlatformScopeSender(event)) return { ok: false, error: 'FORBIDDEN' };
  const controlledId = String(userId || '').trim().slice(0, 256);
  if (!controlledId || !musicPlatformManager) return { ok: false, error: 'INVALID_TEST_SCOPE' };
  const requestSerial = ++musicPlatformScopeRequestSerial;
  try {
    const scope = await musicPlatformManager.setAccountScope(controlledId);
    return staleMusicPlatformScopeRequest(requestSerial)
      ? { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' }
      : publicMusicPlatformScopeDebug(scope);
  }
  catch (error) { return { ok: false, error: error.message || 'ACCOUNT_SCOPE_FAILED' }; }
});

ipcMain.handle('lf-auth-status', async (_event, token, payload) => {
  if (/^(?:main-process|active)$/i.test(String(token || ''))) await waitForLFSecureSession('token');
  const actualToken = lfAccessToken(token);
  const result = await callLFService('POST', '/v1/auth/status', actualToken, payload, () => ensureLFBackend().authStatus(actualToken, payload || {}));
  return secureAuthResult(result, actualToken);
});

ipcMain.handle('lf-auth-refresh', async (_event, refreshToken) => {
  if (/^(?:main-process|active)$/i.test(String(refreshToken || ''))) await waitForLFSecureSession('refreshToken');
  const actualRefreshToken = lfRefreshToken(refreshToken);
  const result = await callLFService('POST', '/v1/auth/refresh', '', { refreshToken: actualRefreshToken }, () => ensureLFBackend().refreshSession(actualRefreshToken));
  return secureAuthResult(result);
});

ipcMain.handle('lf-auth-logout', async (_event, token) => {
  const actualToken = lfAccessToken(token);
  const result = await callLFService('POST', '/v1/auth/logout', actualToken, {}, () => ensureLFBackend().logout(actualToken));
  clearLFSecureSession();
  if (musicPlatformManager) await musicPlatformManager.setAccountScope('').catch(() => {});
  return result;
});

ipcMain.handle('lf-auth-set-online', async (_event, token, online) => {
  const actualToken = lfAccessToken(token);
  return callLFService('POST', '/v1/me/online', actualToken, { online: !!online }, () => ensureLFBackend().setOnline(actualToken, !!online));
});

ipcMain.handle('lf-auth-reset-password', async (_event, payload) => {
  return callLFService('POST', '/v1/auth/reset-password', '', payload, () => ensureLFBackend().resetPassword(payload || {}));
});

ipcMain.handle('lf-auth-change-password', async (_event, payload) => {
  const token = lfAccessToken('');
  return callLFService('POST', '/v1/auth/change-password', token, payload, () => ensureLFBackend().changePassword(token, payload || {}));
});

ipcMain.handle('lf-auth-verify-reset', async (_event, payload) => {
  return callLFService('POST', '/v1/auth/verify-reset', '', payload, () => ensureLFBackend().verifyResetCode(payload || {}));
});

ipcMain.handle('lf-auth-create-qr', async () => {
  const result = await callLFService('POST', '/v1/auth/qr/create', '', {}, () => ensureLFBackend().createQrToken());
  if (!result.ok) return result;
  try {
    result.dataUrl = await QRCode.toDataURL(result.qrContent, { width: 260, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#071019', light: '#f4fbff' } });
  } catch (error) {
    result.qrRenderError = error.message || 'QR_RENDER_FAILED';
  }
  return result;
});
ipcMain.handle('lf-auth-poll-qr', async (_event, token) => {
  token = String(token || '');
  const result = await callLFService('POST', '/v1/auth/qr/poll', '', { token }, () => ensureLFBackend().pollQr(token));
  return secureAuthResult(result);
});
ipcMain.handle('lf-auth-confirm-qr', async (_event, payload) => {
  payload = payload || {};
  const token = lfAccessToken(payload.sessionToken);
  return callLFService('POST', '/v1/auth/qr/confirm', token, { qrToken: payload.qrToken }, () => ensureLFBackend().confirmQr({ ...payload, sessionToken: token }));
});

ipcMain.handle('lf-auth-oauth-start', async (_event, input) => {
  const payload = typeof input === 'object' && input ? input : { provider: input };
  const provider = String(payload.provider || '').toLowerCase();
  const token = payload.bind ? lfAccessToken('') : '';
  const oauthPayload = {
    provider,
    intent: payload.bind ? 'bind' : 'login',
    currentPassword: String(payload.currentPassword || '').slice(0, 128),
    verificationTicket: String(payload.verificationTicket || '').slice(0, 500),
  };
  const result = await callLFService('POST', '/v1/auth/oauth/start', token, oauthPayload, () => ensureLFBackend().oauthStart({ ...oauthPayload, sessionToken: token }));
  if (result.ok && result.authorizationUrl) {
    if (!isOfficialOAuthUrl(provider, result.authorizationUrl)) return { ok: false, error: 'OAUTH_URL_REJECTED', message: '授权地址未通过官方域名校验。' };
    try { await shell.openExternal(result.authorizationUrl); }
    catch (error) { return { ok: false, error: 'OAUTH_OPEN_FAILED', message: error.message }; }
  }
  return result;
});
ipcMain.handle('lf-auth-oauth-poll', async (_event, pollToken) => {
  const result = await callLFService('POST', '/v1/auth/oauth/poll', '', { pollToken: String(pollToken || '') }, () => ensureLFBackend().oauthPoll(String(pollToken || '')));
  return result && result.bound ? result : secureAuthResult(result);
});

ipcMain.handle('lf-profile', async (_event, token) => {
  token = lfAccessToken(token);
  return callLFService('GET', '/v1/me', token, null, () => ensureLFBackend().profile(token));
});
ipcMain.handle('lf-identities', async (_event, token) => {
  token = lfAccessToken(token);
  return callLFService('GET', '/v1/me/identities', token, null, () => ensureLFBackend().userIdentities(token));
});
ipcMain.handle('lf-bind-email', async (_event, token, payload) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/me/identities/email', token, payload, () => ensureLFBackend().bindEmail(token, payload || {}));
});
ipcMain.handle('lf-unbind-identity', async (_event, token, payload) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/me/identities/unbind', token, payload, () => ensureLFBackend().unbindIdentity(token, payload || {}));
});
function feedbackUploadKey(event, clientId) {
  return `${event.sender.id}:${String(clientId || '')}`;
}

function feedbackUploadPhase(value, fallback = 'UPLOADING') {
  const phase = String(value || '').trim().toUpperCase();
  if (['COMPLETE', 'DONE', 'READY'].includes(phase)) return 'UPLOADED';
  return ['SELECTED', 'QUEUED', 'UPLOADING', 'VERIFYING', 'UPLOADED', 'FAILED', 'CANCELLED'].includes(phase) ? phase : fallback;
}

ipcMain.handle('lf-feedback-draft', async (_event, token, payload) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/feedback/draft', token, payload || {}, () => ensureLFBackend().createFeedbackDraft(token, payload || {}));
});
ipcMain.handle('lf-feedback-submit', async (_event, token, payload) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/feedback', token, payload, () => ensureLFBackend().submitFeedback(token, payload || {}));
});
ipcMain.handle('lf-feedback-upload-status', async (_event, token, uploadId) => {
  token = lfAccessToken(token);
  const id = String(uploadId || '');
  return callLFService('GET', `/v1/feedback/upload/status?uploadId=${encodeURIComponent(id)}`, token, null, () => ensureLFBackend().feedbackUploadStatus(token, id));
});
ipcMain.handle('lf-feedback-upload-file', async (event, token, feedbackId, clientId, filePath, metadata, resumeState) => {
  token = lfAccessToken(token);
  const sender = event.sender;
  const key = feedbackUploadKey(event, clientId);
  const active = { cancelled: false, uploadId: String(resumeState && resumeState.uploadId || '') };
  const previous = lfFeedbackUploads.get(key);
  if (previous) previous.cancelled = true;
  lfFeedbackUploads.set(key, active);
  const notify = payload => {
    if (!sender.isDestroyed()) sender.send('lf-feedback-upload-progress', {
      clientId: String(clientId || ''),
      uploadId: active.uploadId,
      ...(payload || {}),
    });
  };
  const source = path.resolve(String(filePath || ''));
  try {
    notify({ status: 'SELECTED', progress: 0 });
    notify({ status: 'QUEUED', progress: 0 });
    if (!existingFile(source)) {
      const missing = { ok: false, error: 'FILE_NOT_FOUND', status: 'FAILED' };
      notify({ status: 'FAILED', progress: 0, error: missing.error });
      return missing;
    }
    const stat = fs.statSync(source);
    const meta = {
      name: path.basename(String(metadata && metadata.name || source)),
      type: String(metadata && metadata.type || ''),
      size: Number(metadata && metadata.size || stat.size),
      feedbackId: String(feedbackId || ''),
    };
    if (meta.size !== stat.size) {
      const changed = { ok: false, error: 'FILE_CHANGED', status: 'FAILED' };
      notify({ status: 'FAILED', progress: 0, error: changed.error });
      return changed;
    }

    let upload = null;
    if (active.uploadId) {
      const status = await callLFService(
        'GET',
        `/v1/feedback/upload/status?uploadId=${encodeURIComponent(active.uploadId)}`,
        token,
        null,
        () => ensureLFBackend().feedbackUploadStatus(token, active.uploadId)
      );
      if (!status.ok) {
        const unavailable = { ...status, ok: false, uploadId: active.uploadId, resumable: false, status: 'FAILED' };
        notify({ status: 'FAILED', progress: 0, error: status.message || status.error || 'UPLOAD_RESUME_UNAVAILABLE' });
        return unavailable;
      }
      if (Number(status.expectedSize) !== stat.size) {
        const mismatch = { ok: false, error: 'RESUME_FILE_MISMATCH', uploadId: active.uploadId, resumable: false, status: 'FAILED' };
        notify({ status: 'FAILED', progress: 0, error: mismatch.error });
        return mismatch;
      }
      const phase = feedbackUploadPhase(status.status);
      if (phase === 'CANCELLED') {
        const cancelled = { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
        notify({ status: 'CANCELLED', progress: Number(status.progress) || 0 });
        return cancelled;
      }
      if (phase === 'UPLOADED') {
        const completed = { ...status, ok: true, uploadId: active.uploadId, resumed: true, status: 'UPLOADED' };
        notify({ status: 'UPLOADED', progress: 100, attachmentId: status.attachmentId || '' });
        return completed;
      }
      upload = { ...status, uploadId: active.uploadId, chunkSize: Number(status.chunkSize) || 4 * 1024 * 1024, resumed: true };
    } else {
      upload = await callLFService('POST', '/v1/feedback/upload/create', token, meta, () => ensureLFBackend().createFeedbackUpload(token, meta.feedbackId, meta));
      if (!upload.ok) {
        notify({ status: 'FAILED', progress: 0, error: upload.message || upload.error });
        return { ...upload, status: 'FAILED' };
      }
      active.uploadId = String(upload.uploadId || '');
    }
    if (active.cancelled) {
      if (active.uploadId) {
        await callLFService('POST', '/v1/feedback/upload/cancel', token, { uploadId: active.uploadId }, () => ensureLFBackend().cancelFeedbackUpload(token, active.uploadId));
      }
      notify({ status: 'CANCELLED', progress: 0 });
      return { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
    }

    const chunkSize = Math.max(256 * 1024, Math.min(4 * 1024 * 1024, Number(upload.chunkSize) || 4 * 1024 * 1024));
    let offset = Number(upload.receivedSize) || 0;
    let chunkIndex = Number(upload.nextChunk) || 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
      const invalid = { ok: false, error: 'INVALID_RESUME_STATE', uploadId: active.uploadId, resumable: false, status: 'FAILED' };
      notify({ status: 'FAILED', progress: 0, error: invalid.error });
      return invalid;
    }
    notify({ status: 'UPLOADING', progress: stat.size ? Math.round(offset / stat.size * 10000) / 100 : 0, receivedSize: offset, totalSize: stat.size, resumed: !!upload.resumed });
    const handle = await fs.promises.open(source, 'r');
    try {
    while (offset < stat.size) {
      if (active.cancelled) return { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
      const size = Math.min(chunkSize, stat.size - offset);
      const buffer = Buffer.allocUnsafe(size);
      const read = await handle.read(buffer, 0, size, offset);
      if (!read.bytesRead) throw new Error('FILE_READ_FAILED');
      const chunk = buffer.subarray(0, read.bytesRead);
      let result = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (active.cancelled) break;
        result = await callLFService('POST', '/v1/feedback/upload/chunk', token, { uploadId: active.uploadId, chunkIndex, dataBase64: chunk.toString('base64') }, () => ensureLFBackend().appendFeedbackUpload(token, active.uploadId, { chunkIndex, data: chunk }));
        if (result.ok) break;
        if (result.error === 'CHUNK_OUT_OF_ORDER' && Number(result.nextChunk) === chunkIndex + 1) { result = { ok: true, receivedSize: result.receivedSize, nextChunk: result.nextChunk }; break; }
        await new Promise(resolve => setTimeout(resolve, 250 * Math.pow(2, attempt)));
      }
      if (active.cancelled) return { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
      if (!result || !result.ok) throw new Error(result && (result.message || result.error) || 'UPLOAD_CHUNK_FAILED');
      offset = Number(result.receivedSize) || (offset + read.bytesRead);
      chunkIndex = Number(result.nextChunk);
      notify({ status: 'UPLOADING', progress: Math.round(offset / stat.size * 10000) / 100, receivedSize: offset, totalSize: stat.size });
    }
    } catch (error) {
      if (active.cancelled) {
        notify({ status: 'CANCELLED', progress: stat.size ? Math.round(offset / stat.size * 10000) / 100 : 0 });
        return { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
      }
      notify({ status: 'FAILED', progress: stat.size ? Math.round(offset / stat.size * 10000) / 100 : 0, error: error.message || 'UPLOAD_FAILED' });
      return { ok: false, error: error.message || 'UPLOAD_FAILED', uploadId: active.uploadId, resumable: true, receivedSize: offset, nextChunk: chunkIndex, status: 'FAILED' };
    } finally { await handle.close(); }

    if (active.cancelled) {
      notify({ status: 'CANCELLED', progress: 100 });
      return { ok: false, cancelled: true, error: 'UPLOAD_CANCELLED', uploadId: active.uploadId, status: 'CANCELLED' };
    }
    notify({ status: 'VERIFYING', progress: 100, receivedSize: offset, totalSize: stat.size });
    const finalized = await callLFService('POST', '/v1/feedback/upload/finalize', token, { uploadId: active.uploadId }, () => ensureLFBackend().finalizeFeedbackUpload(token, active.uploadId));
    if (!finalized.ok) {
      const phase = active.cancelled || feedbackUploadPhase(finalized.status, 'FAILED') === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      notify({ status: phase, progress: 100, error: phase === 'CANCELLED' ? '' : finalized.message || finalized.error });
      return { ...finalized, uploadId: active.uploadId, resumable: phase === 'FAILED', receivedSize: offset, nextChunk: chunkIndex, status: phase };
    }
    notify({ status: 'UPLOADED', progress: 100, attachmentId: finalized.attachmentId || '', error: '' });
    return { ...finalized, uploadId: active.uploadId, resumed: !!upload.resumed, status: 'UPLOADED' };
  } catch (error) {
    const phase = active.cancelled ? 'CANCELLED' : 'FAILED';
    notify({ status: phase, progress: 0, error: phase === 'FAILED' ? error.message || 'UPLOAD_FAILED' : '' });
    return { ok: false, cancelled: active.cancelled, error: active.cancelled ? 'UPLOAD_CANCELLED' : error.message || 'UPLOAD_FAILED', uploadId: active.uploadId, resumable: !!active.uploadId && !active.cancelled, status: phase };
  } finally {
    if (lfFeedbackUploads.get(key) === active) lfFeedbackUploads.delete(key);
  }
});
ipcMain.handle('lf-feedback-upload-cancel', async (event, token, clientId, uploadId) => {
  token = lfAccessToken(token);
  const key = feedbackUploadKey(event, clientId);
  const active = lfFeedbackUploads.get(key);
  if (active) active.cancelled = true;
  const id = String(uploadId || active && active.uploadId || '');
  let result = { ok: true, cancelled: true, uploadId: id, status: 'CANCELLED' };
  if (id) result = await callLFService('POST', '/v1/feedback/upload/cancel', token, { uploadId: id }, () => ensureLFBackend().cancelFeedbackUpload(token, id));
  if (!event.sender.isDestroyed()) event.sender.send('lf-feedback-upload-progress', { clientId: String(clientId || ''), uploadId: id, status: 'CANCELLED', progress: 0, error: '' });
  return result && result.ok ? { ...result, cancelled: true, uploadId: id, status: 'CANCELLED' } : result;
});
ipcMain.handle('lf-feedback-attachment-delete', async (_event, token, attachmentId) => {
  token = lfAccessToken(token);
  const id = String(attachmentId || '');
  return callLFService('POST', '/v1/feedback/attachment/delete', token, { attachmentId: id }, () => ensureLFBackend().deleteFeedbackAttachment(token, id));
});
ipcMain.handle('lf-feedback-finalize', async (_event, token, feedbackId) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/feedback/finalize', token, { feedbackId: String(feedbackId || '') }, () => ensureLFBackend().finalizeFeedback(token, String(feedbackId || '')));
});
ipcMain.handle('lf-privacy-notice', async () => callLFService('GET', '/v1/privacy', '', null, () => ensureLFBackend().privacyNotice()));
ipcMain.handle('lf-backend-status', async () => {
  const remote = configureLFRemoteClient();
  if (remote) {
    const health = await remote.get('/health', '');
    return Object.assign({ mode: 'remote', appVersion: app.getVersion(), developmentMode: false }, health);
  }
  return Object.assign({ mode: 'local', database: 'sqlite', appVersion: app.getVersion(), developmentMode: (!app.isPackaged || allowPackagedCdpTest) && process.env.LF_ALLOW_LOCAL_CODES === '1' }, lfApiStatus);
});
ipcMain.handle('lf-integrity-status', async () => {
  const local = publicIntegrityStatus(ensureLFIntegrityVerifier().getStatus());
  if (lfIntegrityPendingStatus) await reportPendingIntegrityEvidence();
  const token = loadLFSecureSession().token;
  if (!token) {
    if (isIntegrityBlocked(lfIntegrityEnforcement)) {
      return { ok: false, error: 'BLACKLISTED', state: 'blocked', blacklisted: true, message: LF_BLOCKED_MESSAGE, local };
    }
    return { ok: false, error: 'INVALID_SESSION', state: 'signed_out', local };
  }
  const deviceId = getLFIntegrityDeviceId();
  const result = await callLFService(
    'GET',
    `/v1/integrity/status?deviceId=${encodeURIComponent(deviceId)}`,
    token,
    null,
    () => ensureLFBackend().integrityStatus(token, { deviceId })
  );
  applyIntegrityEnforcement(result);
  return {
    ok: result && result.ok === true,
    error: String(result && result.error || ''),
    state: String(result && result.state || ''),
    developerPermission: !!(result && result.developerPermission),
    blacklisted: !!(result && result.blacklisted),
    warningIssuedAt: result && result.warningIssuedAt || null,
    warningAckAt: result && result.warningAckAt || null,
    warning: result && result.warning ? {
      message: String(result.warning.message || LF_DEV_WARNING),
      contact: String(result.warning.contact || LF_DEV_CONTACT),
      requiresAcknowledgement: result.warning.requiresAcknowledgement === true,
    } : null,
    local,
  };
});
ipcMain.handle('lf-integrity-warning-ack', async () => {
  const token = loadLFSecureSession().token;
  if (!token) return { ok: false, error: 'INVALID_SESSION' };
  const deviceId = getLFIntegrityDeviceId();
  const status = await callLFService(
    'GET',
    `/v1/integrity/status?deviceId=${encodeURIComponent(deviceId)}`,
    token,
    null,
    () => ensureLFBackend().integrityStatus(token, { deviceId })
  );
  if (!status || !status.ok) return applyIntegrityEnforcement(status);
  if (isIntegrityBlocked(status)) return applyIntegrityEnforcement(status);
  if (String(status.state || '') !== 'warned_pending_ack' || !status.firstEventId) {
    return { ok: false, error: 'WARNING_NOT_PENDING' };
  }
  const acknowledgement = {
    deviceId,
    eventId: String(status.firstEventId),
    generation: Number(status.generation) || 0,
  };
  const result = await callLFService(
    'POST',
    '/v1/integrity/warning/ack',
    token,
    acknowledgement,
    () => ensureLFBackend().ackIntegrityWarning(token, acknowledgement)
  );
  return applyIntegrityEnforcement(result);
});
ipcMain.handle('lf-preset-share-create', async (_event, canonical) => {
  const payload = {
    canonical: canonical && typeof canonical === 'object' && !Array.isArray(canonical) ? canonical : {},
    requestIp: 'electron-ipc',
  };
  return callLFPresetShareService(
    'POST',
    '/v1/preset-share/create',
    { canonical: payload.canonical },
    token => ensureLFBackend().createPresetShare(token, payload)
  );
});
ipcMain.handle('lf-preset-share-redeem', async (_event, code) => {
  const payload = {
    code: String(code || '').trim().toUpperCase().slice(0, 64),
    requestIp: 'electron-ipc',
  };
  return callLFPresetShareService(
    'POST',
    '/v1/preset-share/redeem',
    { code: payload.code },
    token => ensureLFBackend().redeemPresetShare(token, payload)
  );
});
ipcMain.handle('lf-preset-share-mine', async () => {
  const payload = { requestIp: 'electron-ipc' };
  return callLFPresetShareService(
    'GET',
    '/v1/preset-share/mine',
    null,
    token => ensureLFBackend().listPresetShares(token, payload)
  );
});
ipcMain.handle('lf-preset-share-revoke', async (_event, shareId) => {
  const payload = {
    shareId: String(shareId || '').trim().slice(0, 160),
    requestIp: 'electron-ipc',
  };
  return callLFPresetShareService(
    'POST',
    '/v1/preset-share/revoke',
    { shareId: payload.shareId },
    token => ensureLFBackend().revokePresetShare(token, payload)
  );
});
ipcMain.handle('lf-dev-access-request', async (_event, token, payload) => {
  token = lfAccessToken(token);
  return callLFService('POST', '/v1/developer/access', token, payload, () => ensureLFBackend().requestDeveloperAccess(token, payload || {}));
});
ipcMain.handle('lf-update-available', async (_event, token, currentVersion) => {
  token = lfAccessToken(token); currentVersion = String(currentVersion || '');
  return callLFService('POST', '/v1/updates/available', token, { currentVersion }, () => ensureLFBackend().availableUpdate(token, currentVersion));
});
ipcMain.handle('lf-update-install', async (event, token, currentVersion) => downloadAndOpenLFUpdate(BrowserWindow.fromWebContents(event.sender), lfAccessToken(token), String(currentVersion || '')));

ipcMain.handle('netease-music-open-login', async (event) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform('netease');
  if (!musicPlatformManager) return { ok: false, provider: 'netease', error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  return musicPlatformManager.openLogin('netease', getSenderWindow(event));
});

ipcMain.handle('netease-music-clear-login', async (event) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform('netease');
  if (!musicPlatformManager) return { ok: false, provider: 'netease', error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  return musicPlatformManager.logout('netease');
});

ipcMain.handle('qq-music-open-login', async (event) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform('qq');
  if (!musicPlatformManager) return { ok: false, provider: 'qq', error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  return musicPlatformManager.openLogin('qq', getSenderWindow(event));
});

ipcMain.handle('qq-music-clear-login', async (event) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform('qq');
  if (!musicPlatformManager) return { ok: false, provider: 'qq', error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  return musicPlatformManager.logout('qq');
});

ipcMain.handle('music-platform-open-login', async (event, provider) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform(provider);
  if (!musicPlatformManager) return { ok: false, provider: String(provider || ''), error: 'MUSIC_PLATFORM_MANAGER_NOT_READY' };
  try {
    return await musicPlatformManager.openLogin(provider, BrowserWindow.fromWebContents(event.sender));
  } catch (e) {
    return { ok: false, error: e.message || 'LOGIN_WINDOW_FAILED' };
  }
});

ipcMain.handle('music-platform-login-status', async (event, provider) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform(provider);
  return getAuxMusicLoginStatus(provider);
});

ipcMain.handle('music-platform-profile', async (event, provider) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform(provider);
  const status = await getAuxMusicLoginStatus(provider);
  return { ok: status.ok, provider: status.provider, loggedIn: status.loggedIn, profile: status.profile || null };
});

ipcMain.handle('music-platform-playlists', async (event, provider) => {
  if (!trustedMusicPlatformScopeSender(event)) return Object.assign(forbiddenMusicPlatform(provider), { playlists: [] });
  return getAuxMusicPlaylists(provider);
});

ipcMain.handle('music-platform-clear-login', async (event, provider) => {
  if (!trustedMusicPlatformScopeSender(event)) return forbiddenMusicPlatform(provider);
  try {
    return await clearAuxMusicLoginSession(provider);
  } catch (error) {
    return { ok: false, error: error.message || 'CLEAR_LOGIN_FAILED' };
  }
});

ipcMain.handle('lumifield-restart-app', async (event) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { ok: false, error: 'INVALID_SENDER' };
    const saved = await requestPlaybackStateSave(mainWindow, 'app-restart');
    if (saved) playbackWindowCloseReady = true;
    app.relaunch();
    setImmediate(() => app.quit());
    return { ok: true };
  } catch (e) {
    playbackWindowCloseReady = false;
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('lumifield-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('lumifield-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

ipcMain.handle('lumifield-wallpaper-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) createWallpaperWindow(payload || {});
    else closeWallpaperWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

ipcMain.handle('lumifield-wallpaper-update', async (_event, payload) => {
  try {
    wallpaperState = { ...wallpaperState, ...(payload || {}) };
    if (wallpaperState.enabled) {
      createWallpaperWindow(wallpaperState);
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        positionWallpaperWindow();
        sendWallpaperState();
      }
    } else if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      sendWallpaperState();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_UPDATE_FAILED' };
  }
});

async function currentLFDeveloperAuthorization() {
  const token = loadLFSecureSession().token;
  if (!token) return { ok: false, allowed: false, error: 'INVALID_SESSION' };
  const result = await callLFService(
    'POST',
    '/v1/auth/status',
    token,
    {},
    () => ensureLFBackend().authStatus(token, {})
  );
  if (result && result.error === 'BLACKLISTED') lockForIntegrity(result);
  const user = result && result.user || {};
  return {
    ok: result && result.ok === true,
    allowed: !!(result && result.ok && (user.role === 'admin' || user.developerPermission === true)),
    error: String(result && result.error || ''),
  };
}

async function currentLFAIAssistantScope() {
  const capturedToken = String(loadLFSecureSession().token || '');
  if (!capturedToken) {
    return {
      ok: true,
      scopeHash: crypto.createHash('sha256').update('lumifield-ai-assistant:anonymous').digest('hex'),
      generation: 0,
    };
  }
  const result = await callLFService(
    'POST',
    '/v1/auth/status',
    capturedToken,
    {},
    () => ensureLFBackend().authStatus(capturedToken, {})
  );
  if (capturedToken !== String(loadLFSecureSession().token || '')) {
    return { ok: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
  }
  const userId = String(result && result.user && result.user.id || '').trim();
  if (!result || result.ok !== true || result.authenticated !== true || !userId) {
    return { ok: false, error: 'INVALID_SESSION' };
  }
  const tokenHash = crypto.createHash('sha256').update(capturedToken).digest('hex');
  return {
    ok: true,
    scopeHash: crypto.createHash('sha256').update(`lumifield-ai-assistant:${userId}`).digest('hex'),
    generation: Number.parseInt(tokenHash.slice(0, 12), 16),
  };
}

async function openAuthorizedAIDeveloperTools() {
  const authorization = await currentLFDeveloperAuthorization();
  if (!authorization.allowed) return { ok: false, error: authorization.error || 'DEVELOPMENT_PERMISSION_REQUIRED' };
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return { ok: false, error: 'MAIN_WINDOW_UNAVAILABLE' };
  mainWindow.webContents.openDevTools({ mode: 'detach', activate: true });
  return { ok: true };
}

async function handleLFDeveloperShortcut(targetWindow) {
  if (lfDeveloperShortcutPromise) return lfDeveloperShortcutPromise;
  lfDeveloperShortcutPromise = (async () => {
    const authorization = await currentLFDeveloperAuthorization();
    if (authorization.allowed) {
      if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
        targetWindow.webContents.openDevTools({ mode: 'detach', activate: true });
      }
      return { ok: true, allowed: true };
    }
    const token = loadLFSecureSession().token;
    let request = { ok: false, allowed: false, error: authorization.error || 'DEVELOPER_PERMISSION_REQUIRED' };
    if (token) {
      request = await callLFService(
        'POST',
        '/v1/developer/access',
        token,
        { context: 'DevTools shortcut' },
        () => ensureLFBackend().requestDeveloperAccess(token, { context: 'DevTools shortcut' })
      );
    }
    if (request && request.error === 'BLACKLISTED') lockForIntegrity(request);
    const payload = {
      ok: request && request.ok === true,
      allowed: request && request.allowed === true,
      error: String(request && request.error || 'DEVELOPER_PERMISSION_REQUIRED'),
      message: String(request && request.message || LF_DEV_WARNING),
      contact: String(request && request.contact || LF_DEV_CONTACT),
    };
    if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
      targetWindow.webContents.send('lf-developer-shortcut-blocked', payload);
    }
    return payload;
  })().catch(error => {
    writeStartupLog('LF developer shortcut authorization failed', error);
    const payload = {
      ok: false,
      allowed: false,
      error: 'DEVELOPER_AUTHORIZATION_FAILED',
      message: LF_DEV_WARNING,
      contact: LF_DEV_CONTACT,
    };
    if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
      targetWindow.webContents.send('lf-developer-shortcut-blocked', payload);
    }
    return payload;
  }).finally(() => {
    lfDeveloperShortcutPromise = null;
  });
  return lfDeveloperShortcutPromise;
}

async function createWindow() {
  if (focusMainWindow()) return mainWindow;
  windowStateCoordinator = null;
  const port = await findOpenPort(readRememberedLocalServerPort());
  mainServerPort = port;

  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.LUMIFIELD_BEAT_CACHE_DIR = path.join(app.getPath('userData'), 'beatmaps');
  process.env.LUMIFIELD_UPDATE_DIR = getUpdateDownloadDir();
  process.env.LUMIFIELD_WALLPAPER_DIR = path.join(app.getPath('userData'), 'wallpapers');
  process.env.LUMIFIELD_STEM_DIR = lfStemCacheDir();
  if (!process.env.LUMIFIELD_MUSIC_SESSION_SECRET) {
    process.env.LUMIFIELD_MUSIC_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  }
  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      devTools: true,
    },
  });
  ensureWindowStateCoordinator(mainWindow);
  if (!windowStateDisplayEventsBound) {
    windowStateDisplayEventsBound = true;
    ['display-added', 'display-removed', 'display-metrics-changed'].forEach(eventName => {
      screen.on(eventName, () => {
        if (mainWindow && !mainWindow.isDestroyed()) sendWindowState(mainWindow);
      });
    });
  }
  const mainStemOwner = String(mainWindow.webContents.id);
  playbackWindowCloseReady = false;
  playbackWindowClosePending = false;

  const bootUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'boot.html')).href;
  const appOrigin = `http://127.0.0.1:${port}`;
  lockWindowNavigation(mainWindow, url => {
    if (url === bootUrl) return true;
    try {
      const parsed = new URL(url);
      return parsed.origin === appOrigin && (parsed.pathname === '/' || parsed.pathname === '/index.html');
    } catch (_) { return false; }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
    applyWindowsTaskbarToolbar();
    if (lfIntegrityEnforcement) applyIntegrityEnforcement(lfIntegrityEnforcement);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const blockedDevShortcut = input.type === 'keyDown' && (
      input.key === 'F12' ||
      (input.control && input.shift && String(input.key || '').toLowerCase() === 'i') ||
      (input.control && input.shift && String(input.key || '').toLowerCase() === 'j')
    );
    if (blockedDevShortcut) {
      event.preventDefault();
      handleLFDeveloperShortcut(mainWindow).catch(() => {});
      return;
    }
    if (input.type === 'keyDown' && !input.isAutoRepeat && (input.key === 'F11' || input.code === 'F11')) {
      event.preventDefault();
      toggleWindowMode(mainWindow, 'player-fullscreen').catch(error => writeStartupLog('F11 fullscreen transition failed', error));
      return;
    }
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape')) {
      const coordinator = ensureWindowStateCoordinator(mainWindow);
      const mode = coordinator.escapeMode(mainWindow);
      if (mode) {
        event.preventDefault();
        sendWindowModeExitRequest(mainWindow, mode, 'escape');
        if (mode === 'html-fullscreen') {
          mainWindow.webContents.executeJavaScript('if (document.fullscreenElement) document.exitFullscreen().catch(function(){});').catch(() => {});
        } else {
          coordinator.setMode(mainWindow, mode, false).catch(error => writeStartupLog('Escape fullscreen transition failed', error));
        }
      }
    }
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('close', (event) => {
    const closingWindow = mainWindow;
    if (playbackWindowCloseReady || !closingWindow || closingWindow.isDestroyed() || closingWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (playbackWindowClosePending) return;
    playbackWindowClosePending = true;
    requestPlaybackStateSave(closingWindow, playbackAppQuitting ? 'before-quit' : 'window-close').finally(() => {
      playbackWindowClosePending = false;
      playbackWindowCloseReady = true;
      if (closingWindow && !closingWindow.isDestroyed()) closingWindow.close();
    });
  });
  mainWindow.on('closed', () => {
    const stemTaskId = lfStemTaskOwners.get(mainStemOwner);
    if (stemTaskId && lfStemService) lfStemService.cancel(stemTaskId);
    lfStemTaskOwners.delete(mainStemOwner);
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    taskbarToolbarState = {
      supported: process.platform === 'win32',
      applied: false,
      buttonCount: 0,
      buttons: [],
      ...taskbarPlaybackState,
    };
    if (windowStateCoordinator) windowStateCoordinator.dispose(mainWindow);
    windowStateCoordinator = null;
    mainWindow = null;
    playbackWindowCloseReady = false;
    playbackWindowClosePending = false;
  });
  mainWindow.on('enter-full-screen', () => {
    ensureWindowStateCoordinator(mainWindow).noteNativeFullscreen(mainWindow, true);
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    ensureWindowStateCoordinator(mainWindow).noteNativeFullscreen(mainWindow, false);
    sendWindowState(mainWindow);
  });
  mainWindow.on('enter-html-full-screen', () => {
    ensureWindowStateCoordinator(mainWindow).noteHtmlFullscreen(mainWindow, true).catch(error => writeStartupLog('HTML fullscreen enter sync failed', error));
  });
  mainWindow.on('leave-html-full-screen', () => {
    ensureWindowStateCoordinator(mainWindow).noteHtmlFullscreen(mainWindow, false).catch(error => writeStartupLog('HTML fullscreen leave sync failed', error));
  });

  try {
    await mainWindow.loadFile(path.join(__dirname, '..', 'public', 'boot.html'));
  } catch (error) {
    writeStartupLog('Failed to load local boot screen', error);
  }

  try {
    localServer = require(path.join(__dirname, '..', 'server.js'));
    await waitForServer(localServer, STARTUP_TIMEOUT_MS);
    rememberLocalServerPort(port);
    if (!musicPlatformManager) {
      const { MusicPlatformManager } = require('./music-platform-manager');
      musicPlatformManager = new MusicPlatformManager({
        app,
        BrowserWindow,
        session,
        shell,
        iconPath: APP_ICON_ICO,
        qishuiLoginPreload: path.join(__dirname, 'qishui-login-preload.js'),
        trustedSender: sender => !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents === sender),
        sessionSecret: process.env.LUMIFIELD_MUSIC_SESSION_SECRET,
        backendBaseUrl: () => `http://127.0.0.1:${mainServerPort}`,
      });
      musicPlatformManager.registerIpc(ipcMain);
    }
  } catch (error) {
    writeStartupLog('Local server failed to start', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const safeMessage = '本地音乐服务启动失败。请重启 LumiField；详细信息已写入 userData/logs/startup.log。';
      mainWindow.webContents.executeJavaScript(`window.showBootError(${JSON.stringify(safeMessage)})`).catch(() => {});
    }
    return mainWindow;
  }

  try {
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
    const loadedMainUrl = new URL(mainWindow.webContents.getURL());
    if (loadedMainUrl.origin !== appOrigin || (loadedMainUrl.pathname !== '/' && loadedMainUrl.pathname !== '/index.html')) {
      throw new Error(`Unexpected main page URL after load: ${loadedMainUrl.href}`);
    }
    const firstRouteReady = await mainWindow.webContents.executeJavaScript(
      'typeof window.LumiFieldPrepareFirstReveal === "function" ? window.LumiFieldPrepareFirstReveal() : false',
      true,
    );
    if (!firstRouteReady) throw new Error('Main route did not prepare before splash handoff');
    // loadURL resolves after the real document's load event. Only this point
    // may satisfy the splash controller's main-ready side of the entry gate.
    if (splashController) splashController.setMainReady(mainWindow);
    writeStartupLog(`Application ready on local port ${port}`);
  } catch (error) {
    writeStartupLog('Main page failed to load', error);
    throw error;
  }
  return mainWindow;
}

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  app.whenReady().then(async () => {
    const splashTestMode = process.env.LF_MASTER_TEST === '1';
    const splashTestBypass = splashTestMode && process.env.LUMIFIELD_SKIP_SPLASH === '1';
    splashController = createSplashController({
      app,
      BrowserWindow,
      ipcMain,
      publicDir: path.join(__dirname, '..', 'public'),
      preloadPath: path.join(__dirname, 'lf-splash-preload.js'),
      iconPath: APP_ICON_ICO,
      testMode: splashTestMode,
      testBypass: splashTestBypass,
      log: writeStartupLog,
      revealMain: win => {
        if (!win || win.isDestroyed()) return;
        win.show();
        win.focus();
        sendWindowState(win);
        applyWindowsTaskbarToolbar();
      },
    });
    const splashStartPromise = splashController.start().catch(error => {
      writeStartupLog('Independent splash failed to start', error);
      return null;
    });
    // The player is fully warmed behind the responsive splash. The entry click
    // never starts the server, navigation or shader bootstrap; the button is
    // enabled only after the hidden Home surface has been composited.
    const mainWindowPromise = splashStartPromise
      .then(() => new Promise(resolve => setImmediate(resolve)))
      .then(() => createWindow());
    // Attach a handler immediately because the remaining startup tasks may
    // still be awaiting migrations; this prevents a transient window/server
    // failure from becoming an unhandled rejection.
    mainWindowPromise.catch(error => writeStartupLog('Hidden main window startup failed', error));
    voiceAssistantController = createVoiceAssistantController({
      app,
      BrowserWindow,
      ipcMain,
      screen,
      session,
      shell,
      dialog,
      getMainWindow: () => mainWindow,
      getAppOrigin: () => mainServerPort ? `http://127.0.0.1:${mainServerPort}` : '',
      getOverlayUrl: () => overlayUrl('lf-voice-overlay.html'),
      log: writeStartupLog,
    });
    aiAssistantController = createAIAssistantController({
      app,
      ipcMain,
      BrowserWindow,
      safeStorage,
      shell,
      getMainWindow: () => mainWindow,
      resolveAccountScope: currentLFAIAssistantScope,
      authorizeDeveloperAccess: currentLFDeveloperAuthorization,
      openDeveloperTools: openAuthorizedAIDeveloperTools,
    });
    await migrateLegacyPlaintextCookies().catch(error => {
      writeStartupLog('LF legacy plaintext cookie migration failed; source data was preserved.', error);
    });
    lfLoginConfigFile = path.join(app.getPath('appData'), 'LumiField', 'lf-login-services.bin');
    loadSecureLoginConfig({
      safeStorage,
      filePath: lfLoginConfigFile,
      env: process.env,
    });
    fs.watchFile(lfLoginConfigFile, { interval: 1500, persistent: false }, () => {
      loadSecureLoginConfig({ safeStorage, filePath: lfLoginConfigFile, env: process.env });
    });
    // The local player HTTP server is started by createWindow(). Keep LF's
    // account API initialization off the critical path to first interaction.
    const lfApiInitialization = (async () => {
      if (configureLFRemoteClient()) {
        lfApiStatus = Object.assign({ mode: 'remote' }, await lfRemoteClient.get('/health', ''));
      } else {
        ensureLFBackend();
        await startLFAPIServer();
      }
    })().catch(error => writeStartupLog('LF account API initialization failed', error));
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow();
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => scheduleWindowStateSend(mainWindow));
    screen.on('display-removed', () => scheduleWindowStateSend(mainWindow));
    const createdWindow = await mainWindowPromise;
    await lfApiInitialization;
    await runStartupIntegrityCheck().catch(error => writeStartupLog('LF startup integrity check failed', error));
    startLFIntegrityRuntimeMonitor();
    if (process.argv.includes('--kugou-login-candidate4') && musicPlatformManager) {
      await musicPlatformManager.logout('kugou').catch(() => {});
      await musicPlatformManager.openLogin('kugou', createdWindow);
    }
    if (process.argv.includes('--kugou-concept-login') && musicPlatformManager) {
      await musicPlatformManager.logout('kugou_concept').catch(() => {});
      await musicPlatformManager.openLogin('kugou_concept', createdWindow);
    }
    if (process.argv.includes('--qishui-login') && musicPlatformManager) {
      await musicPlatformManager.openLogin('qishui', createdWindow);
    }
  }).catch((error) => {
    writeStartupLog('Application startup failed', error);
    console.error('LumiField startup failed:', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    try { session.defaultSession.flushStorageData(); } catch (_) {}
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    playbackAppQuitting = true;
    if (splashController) {
      splashController.dispose();
      splashController = null;
    }
    if (lfLoginConfigFile) fs.unwatchFile(lfLoginConfigFile);
    if (lfStemService) {
      for (const taskId of lfStemTaskOwners.values()) lfStemService.cancel(taskId);
      lfStemTaskOwners.clear();
    }
    if (wallpaperVideoOptimizer) {
      wallpaperVideoOptimizer.dispose().catch(() => {});
      wallpaperVideoOptimizer = null;
      wallpaperVideoTaskOwners.clear();
    }
    stopLFIntegrityRuntimeMonitor();
    unregisterLumiFieldGlobalHotkeys();
    closeOverlayWindows();
    if (voiceAssistantController) {
      voiceAssistantController.dispose();
      voiceAssistantController = null;
    }
    if (aiAssistantController) {
      aiAssistantController.dispose();
      aiAssistantController = null;
    }
    if (musicPlatformManager) {
      musicPlatformManager.dispose();
      musicPlatformManager = null;
    }
    if (localServer && localServer.close) localServer.close();
    if (lfApiServer) {
      lfApiServer.close().catch(() => {});
      lfApiServer = null;
    }
    if (lfBackend) {
      lfBackend.close();
      lfBackend = null;
    }
  });
}
