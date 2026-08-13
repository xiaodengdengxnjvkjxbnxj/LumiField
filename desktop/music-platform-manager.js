'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const QISHUI_OFFICIAL_DOWNLOAD_URL = 'https://www.qishui.com/download';
const ACCOUNT_SCOPE_VERSION = 1;
const ACCOUNT_SCOPE_DIRECTORY = 'music-platform-accounts-v1';
const ACCOUNT_SCOPE_MARKER = 'music-platform-account-owner-v1.json';
const ACCOUNT_PREFERENCES_VERSION = 1;
const ACCOUNT_PREFERENCES_FILE = 'preferences.json';
const ACCOUNT_PREFERENCES_MAX_BYTES = 2048;
const ACCOUNT_PREFERENCES_REQUEST_MAX_BYTES = 4096;
const ACCOUNT_PREFERENCES_MAX_FUTURE_MS = 5 * 60 * 1000;
const ACCOUNT_PREFERENCE_FIELDS = Object.freeze(['activeProvider', 'mode', 'playlistProvider', 'updatedAt']);
const MANUAL_COOKIE_MAX_BYTES = 16 * 1024;
const MANUAL_COOKIE_MAX_PAIRS = 64;
const COOKIE_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PUBLIC_COOKIE_IMPORT_ERRORS = new Set([
  'FORBIDDEN', 'UNSUPPORTED_PROVIDER', 'UNSUPPORTED_COOKIE_IMPORT_PROVIDER',
  'EMPTY_COOKIE', 'COOKIE_TOO_LARGE', 'INVALID_COOKIE_CONTROL_CHARACTER',
  'INVALID_COOKIE_PAIR', 'COOKIE_NAME_NOT_ALLOWED', 'INVALID_COOKIE_VALUE',
  'DUPLICATE_COOKIE_NAME', 'TOO_MANY_COOKIES', 'INVALID_QQ_COOKIE',
  'INVALID_NETEASE_COOKIE', 'INVALID_QR_KEY', 'NETEASE_QR_CREDENTIAL_MISSING',
  'NETEASE_QR_SESSION_INVALID', 'NETEASE_QR_CHECK_FAILED',
  'COOKIE_IMPORT_VERIFY_FAILED', 'COOKIE_REVALIDATION_FAILED', 'STALE_ACCOUNT_SCOPE',
]);

const PLATFORM_CONFIGS = Object.freeze({
  kugou: Object.freeze({
    label: '酷狗音乐',
    partition: 'persist:lumifield-kugou-standard',
    loginUrl: 'https://www.kugou.com/',
    backendPrefix: '/api/kugou',
    loginPage: '/kugou-login.html',
    accountKind: 'kugou',
    cookieUrl: 'https://www.kugou.com/',
    loginCookies: [/^userid$/i, /^token$/i],
    cookieAllowlist: /^(?:userid|token|vip_token|vip_type|dfid|KUGOU_API_MID|KugooID|KuGoo|nickname|pic)$/i,
    allowedHost: host => officialHost(host, ['kugou.com', 'kgimg.com', 'qq.com', 'weixin.qq.com']),
  }),
  kugou_concept: Object.freeze({
    label: '酷狗概念版',
    partition: 'persist:lumifield-kugou-concept',
    loginUrl: 'https://www.kugou.com/',
    backendPrefix: '/api/kugou-concept',
    loginPage: '/kugou-login.html?provider=kugou_concept',
    accountKind: 'kugou',
    cookieUrl: 'https://www.kugou.com/',
    loginCookies: [/^userid$/i, /^token$/i],
    cookieAllowlist: /^(?:userid|token|vip_token|vip_type|dfid|KUGOU_API_MID|KugooID|KuGoo|nickname|pic)$/i,
    allowedHost: host => officialHost(host, ['kugou.com', 'kgimg.com', 'qq.com', 'weixin.qq.com']),
  }),
  qishui: Object.freeze({
    label: '汽水音乐',
    partition: 'persist:lumifield-qishui',
    loginUrl: 'https://api.qishui.com/',
    backendPrefix: '/api/qishui',
    loginPage: '/qishui-login.html',
    accountKind: 'backend',
    cookieUrl: 'https://api.qishui.com/',
    loginCookies: [/^sessionid(?:_ss)?$/i],
    cookieAllowlist: /^(?:sessionid|sessionid_ss|sid_guard|sid_tt|sid_tt_ss|uid_tt|uid_tt_ss|passport_csrf_token|passport_csrf_token_default|odin_tt|ttwid|s_v_web_id|store-region|store-region-src|reg-store-region|install_id|tt-target-idc)$/i,
    allowedHost: host => officialHost(host, ['qishui.com']),
  }),
  netease: Object.freeze({
    label: '网易云音乐',
    partition: 'persist:lumifield-netease-login',
    loginUrl: 'https://music.163.com/#/login',
    cookieUrl: 'https://music.163.com/',
    loginCookies: [/^MUSIC_U$/],
    cookieAllowlist: /^(?:MUSIC_U|MUSIC_A|__csrf|NMTID|__remember_me|_ntes_nuid|_ntes_nnid|WEVNSM|WNMCID|JSESSIONID-WYYY)$/,
    allowedHost: host => officialHost(host, ['163.com', 'netease.com']),
  }),
  qq: Object.freeze({
    label: 'QQ音乐',
    partition: 'persist:lumifield-qqmusic-login',
    loginUrl: 'https://y.qq.com/n/ryqq/profile',
    cookieUrl: 'https://y.qq.com/',
    loginCookies: [/^(?:uin|qqmusic_uin|wxuin|p_uin)$/i, /^(?:qm_keyst|qqmusic_key|music_key|p_skey|skey|wxskey)$/i],
    cookieAllowlist: /^(?:uin|qqmusic_uin|wxuin|login_type|qm_keyst|qqmusic_key|music_key|p_skey|skey|psrf_qqopenid|psrf_qqunionid|psrf_qqaccess_token|psrf_qqrefresh_token|wxopenid|wxunionid|wxrefresh_token|wxskey|p_uin|ptcz|RK)$/i,
    allowedHost: host => officialHost(host, ['qq.com', 'qqmusic.qq.com', 'weixin.qq.com']),
  }),
});

function officialHost(hostname, roots) {
  const host = String(hostname || '').toLowerCase();
  return roots.some(root => host === root || host.endsWith('.' + root));
}

function normalizeProvider(value) {
  const provider = String(value || '').toLowerCase();
  return PLATFORM_CONFIGS[provider] ? provider : '';
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = expected.slice().sort();
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index]);
}

function jsonBytes(value, errorCode, maximum) {
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch (_) { throw new Error(errorCode); }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > maximum) throw new Error(errorCode);
  return encoded;
}

function normalizeAccountPreferences(input) {
  if (!hasExactKeys(input, ACCOUNT_PREFERENCE_FIELDS)) throw new Error('INVALID_ACCOUNT_PREFERENCES');
  jsonBytes(input, 'ACCOUNT_PREFERENCES_TOO_LARGE', ACCOUNT_PREFERENCES_MAX_BYTES);
  if (input.mode !== 'provider' && input.mode !== 'multi') throw new Error('INVALID_ACCOUNT_PREFERENCES');
  const activeProvider = typeof input.activeProvider === 'string' &&
    Object.prototype.hasOwnProperty.call(PLATFORM_CONFIGS, input.activeProvider) ? input.activeProvider : '';
  const playlistProvider = typeof input.playlistProvider === 'string' &&
    Object.prototype.hasOwnProperty.call(PLATFORM_CONFIGS, input.playlistProvider) ? input.playlistProvider : '';
  if (!activeProvider || !playlistProvider || typeof input.updatedAt !== 'number' ||
      !Number.isSafeInteger(input.updatedAt) || input.updatedAt <= 0 ||
      input.updatedAt > Date.now() + ACCOUNT_PREFERENCES_MAX_FUTURE_MS) {
    throw new Error('INVALID_ACCOUNT_PREFERENCES');
  }
  return {
    mode: input.mode,
    activeProvider,
    playlistProvider,
    updatedAt: input.updatedAt,
  };
}

function normalizeAccountPreferencesWriteRequest(input) {
  if (!hasExactKeys(input, ['generation', 'preferences'])) throw new Error('INVALID_ACCOUNT_PREFERENCES_REQUEST');
  jsonBytes(input, 'ACCOUNT_PREFERENCES_REQUEST_TOO_LARGE', ACCOUNT_PREFERENCES_REQUEST_MAX_BYTES);
  if (typeof input.generation !== 'number' || !Number.isSafeInteger(input.generation) || input.generation < 0) {
    throw new Error('INVALID_ACCOUNT_PREFERENCES_REQUEST');
  }
  return { generation: input.generation, preferences: normalizeAccountPreferences(input.preferences) };
}

function publicAccountPreferencesError(error, fallback) {
  const code = String(error && error.message || '');
  return [
    'INVALID_ACCOUNT_PREFERENCES', 'ACCOUNT_PREFERENCES_TOO_LARGE',
    'INVALID_ACCOUNT_PREFERENCES_REQUEST', 'ACCOUNT_PREFERENCES_REQUEST_TOO_LARGE',
  ].includes(code) ? code : fallback;
}

function parseManualCookieHeader(config, input, missingCredentialCode) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('EMPTY_COOKIE');
  if (Buffer.byteLength(input, 'utf8') > MANUAL_COOKIE_MAX_BYTES) throw new Error('COOKIE_TOO_LARGE');
  if (/[\u0000-\u001f\u007f]/.test(input)) throw new Error('INVALID_COOKIE_CONTROL_CHARACTER');
  const parsed = [];
  const seen = new Set();
  for (const part of input.split(';')) {
    const raw = part.trim();
    if (!raw) continue;
    const separator = raw.indexOf('=');
    if (separator <= 0) throw new Error('INVALID_COOKIE_PAIR');
    const name = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    const key = name.toLowerCase();
    if (!COOKIE_NAME_TOKEN.test(name) || !config.cookieAllowlist.test(name)) throw new Error('COOKIE_NAME_NOT_ALLOWED');
    if (!value || value.length > 4096 || /[^\x21-\x7e]/.test(value)) throw new Error('INVALID_COOKIE_VALUE');
    if (seen.has(key)) throw new Error('DUPLICATE_COOKIE_NAME');
    seen.add(key);
    parsed.push({ name, value });
    if (parsed.length > MANUAL_COOKIE_MAX_PAIRS) throw new Error('TOO_MANY_COOKIES');
  }
  if (!parsed.length) throw new Error('EMPTY_COOKIE');
  if (!config.loginCookies.every(pattern => parsed.some(cookie => pattern.test(cookie.name) && cookie.value))) {
    throw new Error(missingCredentialCode || 'INVALID_QQ_COOKIE');
  }
  return parsed;
}

function isBackendAccount(config) {
  return !!(config && (config.accountKind === 'kugou' || config.accountKind === 'backend'));
}

function existingFile(value) {
  try { return value && fs.statSync(value).isFile() ? value : ''; }
  catch (_) { return ''; }
}

function findQishuiExecutable() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Soda Music'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'SodaMusic'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Soda Music'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Soda Music'),
  ].filter(Boolean);
  const names = ['Soda Music.exe', 'SodaMusic.exe', '汽水音乐.exe'];
  for (const root of roots) {
    for (const name of names) {
      const direct = existingFile(path.join(root, name));
      if (direct) return direct;
    }
    let versions = [];
    try { versions = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse(); }
    catch (_) {}
    for (const version of versions.slice(0, 20)) {
      for (const name of names) {
        const nested = existingFile(path.join(root, version, name));
        if (nested) return nested;
      }
    }
  }
  return '';
}

function qishuiDeviceInfo(basePath) {
  try {
    const raw = fs.readFileSync(path.join(basePath, 'DeviceV1'));
    let parsed;
    try { parsed = JSON.parse(zlib.gunzipSync(raw).toString('utf8')); }
    catch (_) { parsed = JSON.parse(raw.toString('utf8')); }
    return {
      deviceId: String(parsed && (parsed.did || parsed.device_id) || '').replace(/\D/g, '').slice(0, 64),
      installId: String(parsed && (parsed.iid || parsed.install_id) || '').replace(/\D/g, '').slice(0, 64),
    };
  } catch (_) {
    return { deviceId: '', installId: '' };
  }
}

function publicQishuiImportError(error) {
  const message = String(error && error.message || 'QISHUI_OFFICIAL_IMPORT_FAILED');
  const known = [
    'QISHUI_OFFICIAL_PROFILE_NOT_FOUND',
    'QISHUI_OFFICIAL_COOKIE_STORE_NOT_FOUND',
    'QISHUI_OFFICIAL_SESSION_COOKIE_MISSING',
    'QISHUI_OFFICIAL_DEVICE_MISSING',
    'QISHUI_OFFICIAL_SESSION_INVALID',
    'QISHUI_OFFICIAL_CLIENT_RUNNING',
    'QISHUI_OFFICIAL_COOKIE_DECRYPT_FAILED',
  ];
  return known.includes(message) ? message : 'QISHUI_OFFICIAL_IMPORT_FAILED';
}

function safeProfile(provider, input) {
  const source = input && typeof input === 'object' ? input : {};
  const avatar = String(source.avatar || source.avatarUrl || '').trim();
  return {
    provider,
    userId: String(source.userId || source.id || '').replace(/[\r\n\t]/g, '').slice(0, 96),
    nickname: String(source.nickname || source.name || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 128),
    avatar: /^https:\/\//i.test(avatar) ? avatar.slice(0, 2048) : '',
    vipType: Math.max(0, Number(source.vipType) || 0),
    vipLevel: String(source.vipLevel || '').slice(0, 24),
    isVip: source.isVip === true,
    membershipLabel: String(source.membershipLabel || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 64),
    membershipVerified: source.membershipVerified === true,
    profileVerified: source.profileVerified === true,
    profileSource: String(source.profileSource || '').slice(0, 64),
    playlistsVerified: source.playlistsVerified === true,
    playlistCount: Math.max(0, Number(source.playlistCount) || 0),
    deviceId: String(source.deviceId || '').replace(/\D/g, '').slice(0, 64),
    installId: String(source.installId || '').replace(/\D/g, '').slice(0, 64),
    updatedAt: Math.max(0, Number(source.updatedAt) || 0) || Date.now(),
  };
}

function accountScopeHash(owner) {
  return crypto.createHash('sha256')
    .update('lumifield-music-platform-account-v1\0' + (String(owner || '').trim() || 'anonymous'))
    .digest('hex');
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = filePath + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const previous = filePath + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.invalid';
  let movedPrevious = false;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(temporary, filePath);
    } catch (replaceError) {
      let targetExists = false;
      try { fs.lstatSync(filePath); targetExists = true; }
      catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
      if (!targetExists) throw replaceError;
      fs.renameSync(filePath, previous);
      movedPrevious = true;
      try { fs.renameSync(temporary, filePath); }
      catch (error) {
        try { if (!fs.existsSync(filePath)) fs.renameSync(previous, filePath); } catch (_) {}
        movedPrevious = false;
        throw error;
      }
    }
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    if (movedPrevious) {
      try {
        const stat = fs.lstatSync(previous);
        if (stat.isDirectory()) fs.rmdirSync(previous);
        else fs.unlinkSync(previous);
      } catch (_) {}
    }
  }
}

function requestJSON(target, options, payload) {
  options = options || {};
  const body = payload == null ? '' : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    if (!/^https?:$/.test(url.protocol)) return reject(new Error('INVALID_BACKEND_PROTOCOL'));
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) req.destroy(new Error('BACKEND_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch (_) { return reject(new Error('BACKEND_INVALID_JSON')); }
        if ((response.statusCode || 500) >= 400) {
          const error = new Error(result.error || 'BACKEND_HTTP_' + response.statusCode);
          error.response = result;
          return reject(error);
        }
        resolve(result);
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('BACKEND_TIMEOUT')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

class MusicPlatformManager {
  constructor(options) {
    options = options || {};
    const electron = options.electron || require('electron');
    this.app = options.app || electron.app;
    this.BrowserWindow = options.BrowserWindow || electron.BrowserWindow;
    this.session = options.session || electron.session;
    this.shell = options.shell || electron.shell;
    this.backendBaseUrl = options.backendBaseUrl || 'http://127.0.0.1:3000';
    this.sessionSecret = String(options.sessionSecret || process.env.LUMIFIELD_MUSIC_SESSION_SECRET || '');
    this.iconPath = options.iconPath || '';
    this.onState = typeof options.onState === 'function' ? options.onState : null;
    this.trustedSender = typeof options.trustedSender === 'function' ? options.trustedSender : null;
    this.qishuiLoginPreload = options.qishuiLoginPreload || path.join(__dirname, 'qishui-login-preload.js');
    this.qishuiOfficialProfileOverride = String(options.qishuiOfficialProfilePath || process.env.QISHUI_APPDATA_DIR || '');
    this.windows = new Map();
    this.stateTargets = new Set();
    this.statusRequests = new Map();
    this.cookieImportSerial = new Map();
    this.cookieImportOperations = new Map();
    this.revalidatedProviders = new Set();
    this.qishuiImportSnapshots = [];
    this.loginImportProviders = new Map();
    this.accountAuthenticated = false;
    this.accountScopeHash = accountScopeHash('');
    this.accountScopeEpoch = 0;
    this.accountScopeReady = true;
    this.accountScopeTransitionSerial = 0;
    this.accountScopeTransition = Promise.resolve();
    this.scopedAccountOperations = new Set();
    this.providerOperationQueues = new Map();
  }

  backend(pathname) {
    const base = typeof this.backendBaseUrl === 'function' ? this.backendBaseUrl() : this.backendBaseUrl;
    return new URL(pathname, String(base || 'http://127.0.0.1:3000')).toString();
  }

  legacyProfilePath() {
    return path.join(this.app.getPath('userData'), 'music-platform-profiles.json');
  }

  profilePath(provider, scopeHash) {
    provider = this.config(provider).provider;
    const hash = String(scopeHash || this.accountScopeHash);
    return path.join(this.app.getPath('userData'), ACCOUNT_SCOPE_DIRECTORY, hash, provider + '.json');
  }

  accountPreferencesPath(scopeHash) {
    const hash = String(scopeHash || this.accountScopeHash);
    return path.join(this.app.getPath('userData'), ACCOUNT_SCOPE_DIRECTORY, hash, ACCOUNT_PREFERENCES_FILE);
  }

  accountPreferencesGate() {
    return {
      scopeHash: this.accountScopeHash,
      generation: this.accountScopeTransitionSerial,
      ready: this.accountScopeReady === true,
    };
  }

  isAccountPreferencesGateCurrent(gate) {
    return !!(gate && gate.ready === true && this.accountScopeReady === true &&
      gate.scopeHash === this.accountScopeHash && gate.generation === this.accountScopeTransitionSerial);
  }

  staleAccountPreferences(generation) {
    return {
      ok: false,
      stale: true,
      generation: Number.isSafeInteger(generation) ? generation : this.accountScopeTransitionSerial,
      error: 'STALE_ACCOUNT_SCOPE',
    };
  }

  readAccountPreferences() {
    const gate = this.accountPreferencesGate();
    if (!gate.ready) return Object.assign(this.staleAccountPreferences(gate.generation), { error:'ACCOUNT_SCOPE_NOT_READY' });
    const filePath = this.accountPreferencesPath(gate.scopeHash);
    let preferences = null;
    try {
      let stat;
      try { stat = fs.lstatSync(filePath); }
      catch (error) {
        if (error && error.code === 'ENOENT') {
          return this.isAccountPreferencesGateCurrent(gate)
            ? { ok:true, found:false, preferences:null, generation:gate.generation }
            : this.staleAccountPreferences(gate.generation);
        }
        throw error;
      }
      if (!stat.isFile() || stat.size <= 0 || stat.size > ACCOUNT_PREFERENCES_MAX_BYTES) {
        throw new Error('INVALID_ACCOUNT_PREFERENCES_FILE');
      }
      const raw = fs.readFileSync(filePath);
      if (!raw.length || raw.length > ACCOUNT_PREFERENCES_MAX_BYTES) throw new Error('INVALID_ACCOUNT_PREFERENCES_FILE');
      let record;
      try { record = JSON.parse(raw.toString('utf8')); }
      catch (_) { throw new Error('INVALID_ACCOUNT_PREFERENCES_FILE'); }
      if (!hasExactKeys(record, ['preferences', 'version']) || record.version !== ACCOUNT_PREFERENCES_VERSION) {
        throw new Error('INVALID_ACCOUNT_PREFERENCES_FILE');
      }
      preferences = normalizeAccountPreferences(record.preferences);
    } catch (error) {
      const code = String(error && error.message || '');
      const publicError = code === 'INVALID_ACCOUNT_PREFERENCES_FILE' || code === 'INVALID_ACCOUNT_PREFERENCES' ||
        code === 'ACCOUNT_PREFERENCES_TOO_LARGE' ? 'INVALID_ACCOUNT_PREFERENCES_FILE' : 'ACCOUNT_PREFERENCES_READ_FAILED';
      return { ok:false, found:false, preferences:null, generation:gate.generation, error:publicError };
    }
    if (!this.isAccountPreferencesGateCurrent(gate)) return this.staleAccountPreferences(gate.generation);
    return { ok:true, found:true, preferences, generation:gate.generation };
  }

  writeAccountPreferences(input) {
    const gate = this.accountPreferencesGate();
    if (!gate.ready) return Object.assign(this.staleAccountPreferences(gate.generation), { error:'ACCOUNT_SCOPE_NOT_READY' });
    let request;
    try { request = normalizeAccountPreferencesWriteRequest(input); }
    catch (error) {
      return { ok:false, generation:gate.generation, error:publicAccountPreferencesError(error, 'INVALID_ACCOUNT_PREFERENCES_REQUEST') };
    }
    if (request.generation !== gate.generation || !this.isAccountPreferencesGateCurrent(gate)) {
      return this.staleAccountPreferences(request.generation);
    }
    const existing = this.readAccountPreferences();
    if (existing.ok !== true && existing.error === 'ACCOUNT_PREFERENCES_READ_FAILED') {
      return { ok:false, generation:gate.generation, error:'ACCOUNT_PREFERENCES_READ_FAILED' };
    }
    if (!this.isAccountPreferencesGateCurrent(gate)) return this.staleAccountPreferences(request.generation);
    if (existing.ok === true && existing.found === true && existing.preferences) {
      if (request.preferences.updatedAt < existing.preferences.updatedAt ||
          (request.preferences.updatedAt === existing.preferences.updatedAt &&
           JSON.stringify(request.preferences) !== JSON.stringify(existing.preferences))) {
        return {
          ok:false,
          stale:true,
          preferences:existing.preferences,
          generation:gate.generation,
          error:'STALE_ACCOUNT_PREFERENCES',
        };
      }
      if (request.preferences.updatedAt === existing.preferences.updatedAt) {
        return { ok:true, preferences:existing.preferences, generation:gate.generation };
      }
    }
    try {
      writeJsonAtomic(this.accountPreferencesPath(gate.scopeHash), {
        version: ACCOUNT_PREFERENCES_VERSION,
        preferences: request.preferences,
      });
    } catch (_) {
      return { ok:false, generation:gate.generation, error:'ACCOUNT_PREFERENCES_WRITE_FAILED' };
    }
    if (!this.isAccountPreferencesGateCurrent(gate)) return this.staleAccountPreferences(request.generation);
    return { ok:true, preferences:request.preferences, generation:gate.generation };
  }

  readProfile(provider, scopeHash) {
    try {
      const value = JSON.parse(fs.readFileSync(this.profilePath(provider, scopeHash), 'utf8'));
      return value && typeof value === 'object' ? safeProfile(provider, value) : null;
    } catch (_) { return null; }
  }

  readProfiles(scopeHash) {
    const profiles = {};
    for (const provider of Object.keys(PLATFORM_CONFIGS)) {
      const profile = this.readProfile(provider, scopeHash);
      if (profile) profiles[provider] = profile;
    }
    return profiles;
  }

  saveProfile(provider, value, epoch) {
    provider = this.config(provider).provider;
    if (epoch != null && epoch !== this.accountScopeEpoch) return null;
    const profile = safeProfile(provider, value);
    try { writeJsonAtomic(this.profilePath(provider), profile); }
    catch (_) {}
    return profile;
  }

  deleteProfile(provider, epoch) {
    provider = this.config(provider).provider;
    if (epoch != null && epoch !== this.accountScopeEpoch) return false;
    try { fs.unlinkSync(this.profilePath(provider)); } catch (_) {}
    return true;
  }

  config(provider) {
    provider = normalizeProvider(provider);
    if (!provider) throw new Error('UNSUPPORTED_PROVIDER');
    return { provider, ...PLATFORM_CONFIGS[provider] };
  }

  providerSession(provider) {
    return this.session.fromPartition(this.providerPartition(provider));
  }

  providerPartition(provider, scopeHash) {
    const config = this.config(provider);
    return config.partition + '-account-' + String(scopeHash || this.accountScopeHash);
  }

  accountScopeMarkerPath() {
    return path.join(this.app.getPath('userData'), ACCOUNT_SCOPE_MARKER);
  }

  readAccountScopeMarker() {
    try {
      const marker = JSON.parse(fs.readFileSync(this.accountScopeMarkerPath(), 'utf8'));
      return marker && marker.version === ACCOUNT_SCOPE_VERSION && /^[a-f0-9]{64}$/.test(String(marker.scopeHash || ''))
        ? marker
        : null;
    } catch (_) { return null; }
  }

  readLegacyProfiles() {
    try {
      const value = JSON.parse(fs.readFileSync(this.legacyProfilePath(), 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
  }

  cookieWriteDetails(config, cookie) {
    const name = String(cookie && cookie.name || '');
    const value = String(cookie && cookie.value || '');
    if (!name || !value || !config.cookieAllowlist.test(name)) return null;
    const domain = cookie.hostOnly === true ? '' : String(cookie.domain || '').trim();
    const host = domain.replace(/^\./, '') || new URL(config.cookieUrl || config.loginUrl).hostname;
    const cookiePath = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : '/';
    const details = {
      url: (cookie.secure === false ? 'http://' : 'https://') + host + cookiePath,
      name,
      value,
      path: cookiePath,
      secure: cookie.secure !== false,
      httpOnly: cookie.httpOnly === true,
    };
    if (domain) details.domain = domain;
    if (Number.isFinite(Number(cookie.expirationDate)) && Number(cookie.expirationDate) > 0) {
      details.expirationDate = Number(cookie.expirationDate);
    }
    if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) {
      details.sameSite = cookie.sameSite;
    }
    return details;
  }

  async claimLegacyAccountScope(scopeHash) {
    let marker = this.readAccountScopeMarker();
    if (marker && marker.scopeHash !== scopeHash) return false;
    if (marker && marker.state === 'claimed') return false;
    if (!marker) {
      marker = {
        version: ACCOUNT_SCOPE_VERSION,
        scopeHash,
        state: 'claiming',
        claimedAt: Date.now(),
      };
      let descriptor;
      try {
        descriptor = fs.openSync(this.accountScopeMarkerPath(), 'wx', 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(marker, null, 2), 'utf8');
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        marker = this.readAccountScopeMarker();
        if (!marker || marker.scopeHash !== scopeHash || marker.state === 'claimed') return false;
      } finally {
        try { if (descriptor != null) fs.closeSync(descriptor); } catch (_) {}
      }
    }

    const legacyProfiles = this.readLegacyProfiles();
    for (const provider of Object.keys(PLATFORM_CONFIGS)) {
      const config = this.config(provider);
      const source = this.session.fromPartition(config.partition);
      const target = this.session.fromPartition(this.providerPartition(provider, scopeHash));
      const sourceValues = await source.cookies.get({});
      for (const value of sourceValues) {
        const details = this.cookieWriteDetails(config, value);
        if (details) await target.cookies.set(details);
      }
      if (typeof target.cookies.flushStore === 'function') await target.cookies.flushStore();
      if (!this.readProfile(provider, scopeHash) && legacyProfiles[provider]) {
        writeJsonAtomic(this.profilePath(provider, scopeHash), safeProfile(provider, legacyProfiles[provider]));
      }
    }

    for (const provider of Object.keys(PLATFORM_CONFIGS)) {
      const config = this.config(provider);
      await this.session.fromPartition(config.partition).clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
      });
    }
    if (fs.existsSync(this.legacyProfilePath())) writeJsonAtomic(this.legacyProfilePath(), {});
    writeJsonAtomic(this.accountScopeMarkerPath(), {
      version: ACCOUNT_SCOPE_VERSION,
      scopeHash,
      state: 'claimed',
      claimedAt: Number(marker.claimedAt) || Date.now(),
      completedAt: Date.now(),
    });
    return true;
  }

  clearQishuiImportSnapshots() {
    for (const item of this.qishuiImportSnapshots) {
      try {
        const closed = item.session && typeof item.session.closeAllConnections === 'function'
          ? item.session.closeAllConnections()
          : Promise.resolve();
        Promise.resolve(closed).finally(() => fs.rmSync(item.path, { recursive: true, force: true })).catch(() => {});
      } catch (_) {}
    }
    this.qishuiImportSnapshots = [];
  }

  closeAccountScopeWindows() {
    for (const win of this.windows.values()) {
      try { if (win && !win.isDestroyed()) win.close(); } catch (_) {}
    }
    this.windows.clear();
  }

  runScopedAccountOperation(epoch, provider, task) {
    const gate = this.accountScopeTransition.catch(() => {});
    const providerGate = (this.providerOperationQueues.get(provider) || Promise.resolve()).catch(() => {});
    const operation = Promise.all([gate, providerGate]).then(() => {
      if (!this.accountScopeReady || !this.isCurrentScope(epoch)) return this.staleStatus(provider);
      return task();
    });
    this.providerOperationQueues.set(provider, operation);
    this.scopedAccountOperations.add(operation);
    operation.finally(() => {
      this.scopedAccountOperations.delete(operation);
      if (this.providerOperationQueues.get(provider) === operation) this.providerOperationQueues.delete(provider);
    }).catch(() => {});
    return operation;
  }

  async clearBackendScopeState() {
    if (this.sessionSecret.length < 32) throw new Error('MUSIC_SESSION_SECRET_NOT_CONFIGURED');
    const backendClears = ['kugou', 'kugou_concept', 'qishui'].map(provider => {
      const config = this.config(provider);
      return requestJSON(this.backend(config.backendPrefix + '/session'), {
        headers: { 'x-lumifield-session-secret': this.sessionSecret },
      }, { clear: true }).then(result => {
        if (!result || result.ok === false || result.error) throw new Error('BACKEND_SCOPE_CLEAR_FAILED');
        return result;
      });
    });
    backendClears.push(requestJSON(this.backend('/api/platform/session/clear'), {
      headers: { 'x-lumifield-session-secret': this.sessionSecret },
    }, { clear: true }).then(result => {
      if (!result || result.ok === false || result.error) throw new Error('BACKEND_SCOPE_CLEAR_FAILED');
      return result;
    }));
    await Promise.all(backendClears);
  }

  setAccountScope(owner) {
    const normalizedOwner = String(owner || '').trim();
    const nextHash = accountScopeHash(normalizedOwner);
    const authenticated = !!normalizedOwner;
    const requestedScopeDiffers = nextHash !== this.accountScopeHash || authenticated !== this.accountAuthenticated;
    const transitionSerial = ++this.accountScopeTransitionSerial;
    this.accountScopeReady = false;
    if (requestedScopeDiffers) this.closeAccountScopeWindows();
    const pendingOperations = Array.from(this.scopedAccountOperations);
    const transition = this.accountScopeTransition.catch(() => {}).then(async () => {
      await Promise.allSettled(pendingOperations);
      if (nextHash !== this.accountScopeHash || authenticated !== this.accountAuthenticated) {
        await this.clearBackendScopeState();
        if (authenticated) await this.claimLegacyAccountScope(nextHash);
        this.accountScopeEpoch += 1;
        this.statusRequests.clear();
        this.cookieImportSerial.clear();
        this.cookieImportOperations.clear();
        this.revalidatedProviders.clear();
        this.loginImportProviders.clear();
        this.clearQishuiImportSnapshots();
        this.accountScopeHash = nextHash;
        this.accountAuthenticated = authenticated;
      }
      if (transitionSerial === this.accountScopeTransitionSerial) this.accountScopeReady = true;
      return this.getAccountScopeDebug();
    });
    this.accountScopeTransition = transition.catch(() => {});
    return transition;
  }

  isCurrentScope(epoch) {
    return epoch === this.accountScopeEpoch;
  }

  isScopeOperational(epoch) {
    return this.accountScopeReady && this.isCurrentScope(epoch);
  }

  staleStatus(provider) {
    return { ok: false, provider, loggedIn: false, sessionValid: false, profile: null, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
  }

  validatedLoginState(state) {
    return !!(state && state.loggedIn === true && state.sessionValid === true
      && state.ok !== false && !state.error && state.stale !== true
      && state.profileUnavailable !== true && state.pendingProfile !== true
      && state.ignoredStaleSession !== true);
  }

  async getAccountScopeDebug() {
    const epoch = this.accountScopeEpoch;
    const scopeHash = this.accountScopeHash;
    const providers = {};
    for (const provider of Object.keys(PLATFORM_CONFIGS)) {
      const config = this.config(provider);
      const partition = this.providerPartition(provider, scopeHash);
      let credentialPresent = false;
      try {
        const values = await this.session.fromPartition(partition).cookies.get({});
        const allowed = values
          .filter(value => config.cookieAllowlist.test(String(value && value.name || '')) && value.value)
          .map(value => ({ name: String(value.name), value: String(value.value) }));
        credentialPresent = this.cookieLoginState(provider, allowed);
      } catch (_) {}
      if (!this.isCurrentScope(epoch)) return this.getAccountScopeDebug();
      const win = this.windows.get(provider);
      providers[provider] = {
        partition,
        profilePath: this.profilePath(provider, scopeHash),
        credentialPresent: !!credentialPresent,
        sessionValid: !!(credentialPresent && this.revalidatedProviders.has(provider)),
        profilePresent: !!this.readProfile(provider, scopeHash),
        loginWindowOpen: !!(win && !win.isDestroyed()),
      };
    }
    return {
      ok: true,
      scopeHash,
      epoch,
      anonymous: !this.accountAuthenticated,
      providers,
    };
  }

  async safeCookies(provider, epoch, scopedSession) {
    const config = this.config(provider);
    const cookies = await (scopedSession || this.providerSession(provider)).cookies.get({});
    if (epoch != null && !this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
    return cookies.filter(cookie => this.scopedCookieAllowed(config, cookie) && cookie.value)
      .map(cookie => ({ name: String(cookie.name), value: String(cookie.value) }));
  }

  scopedCookieAllowed(config, cookie) {
    const name = String(cookie && cookie.name || '');
    const host = String(cookie && cookie.domain || new URL(config.cookieUrl || config.loginUrl).hostname)
      .replace(/^\./, '').toLowerCase();
    return !!(name && config.cookieAllowlist.test(name) && config.allowedHost(host));
  }

  cookieRemovalUrl(config, cookie) {
    const fallback = new URL(config.cookieUrl || config.loginUrl);
    const host = String(cookie && cookie.domain || fallback.hostname).replace(/^\./, '').toLowerCase();
    if (!config.allowedHost(host)) throw new Error('COOKIE_DOMAIN_NOT_ALLOWED');
    const cookiePath = String(cookie && cookie.path || '/');
    const pathname = cookiePath.startsWith('/') ? cookiePath : '/';
    return (cookie && cookie.secure === false ? 'http://' : 'https://') + host + pathname;
  }

  async removeScopedAuthCookies(config, target) {
    const values = await target.cookies.get({});
    const allowed = values.filter(cookie => this.scopedCookieAllowed(config, cookie));
    for (const cookie of allowed) {
      await target.cookies.remove(this.cookieRemovalUrl(config, cookie), String(cookie.name));
    }
    return allowed;
  }

  async restoreScopedAuthCookies(config, target, snapshot) {
    await this.removeScopedAuthCookies(config, target);
    for (const cookie of snapshot) {
      const details = this.cookieWriteDetails(config, cookie);
      if (!details || !this.scopedCookieAllowed(config, cookie)) continue;
      await target.cookies.set(details);
    }
    if (typeof target.cookies.flushStore === 'function') await target.cookies.flushStore();
  }

  cookieLoginState(provider, cookies) {
    const config = this.config(provider);
    return config.loginCookies.every(pattern => cookies.some(cookie => pattern.test(cookie.name) && cookie.value));
  }

  manualCookieFailure(provider, error, extra) {
    const rawCode = String(error && error.message || error || 'COOKIE_IMPORT_FAILED');
    const code = PUBLIC_COOKIE_IMPORT_ERRORS.has(rawCode) ? rawCode : 'COOKIE_IMPORT_FAILED';
    return Object.assign({
      ok: false,
      provider,
      loggedIn: false,
      sessionValid: false,
      error: code,
    }, extra || {});
  }

  async restoreManualCookieBackend(provider, snapshot) {
    try {
      const cookies = snapshot
        .filter(cookie => cookie && cookie.name && cookie.value)
        .map(cookie => ({ name: String(cookie.name), value: String(cookie.value) }));
      if (this.cookieLoginState(provider, cookies)) {
        const restored = await this.syncBackend(provider, cookies, { revalidate: true });
        return !!(restored && restored.loggedIn === true && restored.ok !== false
          && restored.sessionValid === true && !restored.error && restored.profileUnavailable !== true
          && restored.pendingProfile !== true && restored.ignoredStaleSession !== true);
      }
      if (this.sessionSecret.length < 32) return false;
      const cleared = await requestJSON(this.backend(provider === 'netease' ? '/api/logout' : '/api/qq/logout'), {
        headers: { 'x-lumifield-session-secret': this.sessionSecret },
      }, { clear: true });
      return !!(cleared && cleared.ok !== false && !cleared.error);
    } catch (_) {
      return false;
    }
  }

  restoreProfileSnapshot(provider, snapshot, epoch) {
    if (!this.isCurrentScope(epoch)) return false;
    try {
      if (snapshot) writeJsonAtomic(this.profilePath(provider), snapshot);
      else if (fs.existsSync(this.profilePath(provider))) fs.unlinkSync(this.profilePath(provider));
      const restored = snapshot ? this.readProfileSnapshot(provider) : null;
      return snapshot ? JSON.stringify(restored) === JSON.stringify(snapshot) : !restored;
    } catch (_) {
      return false;
    }
  }

  readProfileSnapshot(provider) {
    try {
      const value = JSON.parse(fs.readFileSync(this.profilePath(provider), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  async importManualCookieAtScope(provider, parsed, epoch, serial) {
    const config = this.config(provider);
    const current = () => this.isScopeOperational(epoch) && this.cookieImportSerial.get(provider) === serial;
    if (!current()) return this.manualCookieFailure(provider, 'STALE_ACCOUNT_SCOPE', { stale: true });
    const target = this.providerSession(provider);
    let snapshot = [];
    const profileSnapshot = this.readProfileSnapshot(provider);
    let mutated = false;
    try {
      const pendingStatus = this.statusRequests.get(provider);
      if (pendingStatus && pendingStatus.epoch === epoch) await pendingStatus.request.catch(() => {});
      if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
      this.statusRequests.delete(provider);
      const values = await target.cookies.get({});
      snapshot = values.filter(cookie => this.scopedCookieAllowed(config, cookie));
      if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
      mutated = true;
      await this.removeScopedAuthCookies(config, target);
      const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      for (const cookie of parsed) {
        if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
        await target.cookies.set({
          url: config.cookieUrl,
          path: '/',
          secure: true,
          httpOnly: true,
          expirationDate: expires,
          name: cookie.name,
          value: cookie.value,
        });
      }
      if (typeof target.cookies.flushStore === 'function') await target.cookies.flushStore();
      if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
      const importedCookies = await this.safeCookies(provider, epoch, target);
      const importedByName = new Map(importedCookies.map(cookie => [cookie.name.toLowerCase(), cookie.value]));
      if (importedCookies.length !== parsed.length || importedByName.size !== parsed.length
          || !parsed.every(cookie => importedByName.get(cookie.name.toLowerCase()) === cookie.value)
          || !this.cookieLoginState(provider, importedCookies)) throw new Error('COOKIE_IMPORT_VERIFY_FAILED');
      const remote = await this.syncBackend(provider, importedCookies, { revalidate: true });
      if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
      if (!remote || remote.ok === false || remote.loggedIn !== true || remote.sessionValid !== true || remote.error
          || remote.profileUnavailable === true || remote.pendingProfile === true || remote.ignoredStaleSession === true) {
        throw new Error(remote && (remote.error || remote.message) || 'COOKIE_REVALIDATION_FAILED');
      }
      this.statusRequests.delete(provider);
      const state = await this.readLoginStatus(provider, epoch);
      if (!current()) throw new Error('STALE_ACCOUNT_SCOPE');
      if (!this.validatedLoginState(state)) throw new Error(state && state.error || 'COOKIE_REVALIDATION_FAILED');
      this.publishState(state);
      return Object.assign({}, state, {
        ok: true,
        provider,
        loggedIn: true,
        sessionValid: true,
        imported: parsed.length,
        scopeEpoch: epoch,
      });
    } catch (error) {
      let rollbackOk = true;
      if (mutated) {
        try { await this.restoreScopedAuthCookies(config, target, snapshot); }
        catch (_) { rollbackOk = false; }
        rollbackOk = this.restoreProfileSnapshot(provider, profileSnapshot, epoch) && rollbackOk;
        if (this.isCurrentScope(epoch)) rollbackOk = await this.restoreManualCookieBackend(provider, snapshot) && rollbackOk;
      }
      this.statusRequests.delete(provider);
      const stale = !current() || String(error && error.message || error) === 'STALE_ACCOUNT_SCOPE';
      return this.manualCookieFailure(provider, stale ? 'STALE_ACCOUNT_SCOPE' : error, {
        ...(stale ? { stale: true } : {}),
        ...(rollbackOk ? {} : { rollbackFailed: true }),
      });
    }
  }

  importCookie(provider, cookieText) {
    try { provider = this.config(provider).provider; }
    catch (error) { return Promise.resolve(this.manualCookieFailure(String(provider || ''), error)); }
    if (provider !== 'qq') return Promise.resolve(this.manualCookieFailure(provider, 'UNSUPPORTED_COOKIE_IMPORT_PROVIDER'));
    let parsed;
    try { parsed = parseManualCookieHeader(this.config(provider), cookieText); }
    catch (error) { return Promise.resolve(this.manualCookieFailure(provider, error)); }
    const epoch = this.accountScopeEpoch;
    const serial = (this.cookieImportSerial.get(provider) || 0) + 1;
    this.cookieImportSerial.set(provider, serial);
    const operation = this.runScopedAccountOperation(epoch, provider, () => (
      this.importManualCookieAtScope(provider, parsed, epoch, serial)
    )).catch(error => this.manualCookieFailure(provider, error));
    const trackedOperation = operation.finally(() => {
      if (this.cookieImportOperations.get(provider) === trackedOperation) this.cookieImportOperations.delete(provider);
    });
    this.cookieImportOperations.set(provider, trackedOperation);
    return trackedOperation;
  }

  checkNeteaseQr(key) {
    const normalizedKey = String(key || '').trim();
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(normalizedKey)) {
      return Promise.resolve(this.manualCookieFailure('netease', 'INVALID_QR_KEY'));
    }
    const epoch = this.accountScopeEpoch;
    return this.runScopedAccountOperation(epoch, 'netease', () => (
      this.checkNeteaseQrAtScope(normalizedKey, epoch)
    )).catch(() => this.manualCookieFailure('netease', 'NETEASE_QR_CHECK_FAILED'));
  }

  async checkNeteaseQrAtScope(key, epoch) {
    if (this.sessionSecret.length < 32) return this.manualCookieFailure('netease', 'NETEASE_QR_CHECK_FAILED');
    let remote;
    try {
      remote = await requestJSON(this.backend('/api/login/qr/check'), {
        headers: { 'x-lumifield-session-secret': this.sessionSecret },
      }, { key });
    } catch (_) {
      return this.manualCookieFailure('netease', 'NETEASE_QR_CHECK_FAILED');
    }
    if (!this.isScopeOperational(epoch)) return this.staleStatus('netease');
    const code = Number(remote && remote.code) || 0;
    const message = String(remote && remote.message || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160);
    if (code !== 803) {
      return {
        ok: !!(remote && remote.ok !== false && !remote.error),
        provider: 'netease',
        code,
        message,
        loggedIn: false,
        sessionValid: false,
        ...(remote && remote.error ? { error: String(remote.error).slice(0, 80) } : {}),
      };
    }
    const credential = String(remote && remote.credential || '');
    if (!credential || !remote || remote.loggedIn !== true || remote.sessionValid !== true
        || remote.ok === false || remote.error || remote.profileUnavailable === true
        || remote.pendingProfile === true || remote.ignoredStaleSession === true) {
      return Object.assign(this.manualCookieFailure('netease', credential
        ? 'NETEASE_QR_SESSION_INVALID'
        : 'NETEASE_QR_CREDENTIAL_MISSING'), { code, message });
    }
    let parsed;
    try { parsed = parseManualCookieHeader(this.config('netease'), credential, 'INVALID_NETEASE_COOKIE'); }
    catch (_) { return Object.assign(this.manualCookieFailure('netease', 'NETEASE_QR_CREDENTIAL_MISSING'), { code, message }); }
    const serial = (this.cookieImportSerial.get('netease') || 0) + 1;
    this.cookieImportSerial.set('netease', serial);
    const state = await this.importManualCookieAtScope('netease', parsed, epoch, serial);
    if (!this.isScopeOperational(epoch) || state.stale) return this.staleStatus('netease');
    return Object.assign({}, state, { code, message });
  }

  qishuiOfficialFiles() {
    const basePath = path.resolve(this.qishuiOfficialProfileOverride || path.join(this.app.getPath('appData'), 'SodaMusic'));
    const profiles = [basePath, path.join(basePath, 'Default')];
    const cookieProfilePath = profiles.find(candidate => existingFile(path.join(candidate, 'Network', 'Cookies'))) || '';
    return {
      basePath,
      cookieProfilePath,
      cookiePath: cookieProfilePath ? path.join(cookieProfilePath, 'Network', 'Cookies') : '',
    };
  }

  qishuiOfficialStatus() {
    const files = this.qishuiOfficialFiles();
    const executable = findQishuiExecutable();
    const profileAvailable = !!files.cookiePath;
    return {
      ok: true,
      provider: 'qishui',
      installed: !!executable,
      profileAvailable,
      canImport: profileAvailable,
      nextAction: executable ? 'open-client' : 'download-client',
    };
  }

  async openQishuiOfficialClient() {
    const executable = findQishuiExecutable();
    if (executable) {
      const error = await this.shell.openPath(executable);
      if (error) throw new Error('QISHUI_OFFICIAL_CLIENT_OPEN_FAILED');
      return { ok: true, provider: 'qishui', opened: true, action: 'open-client' };
    }
    await this.shell.openExternal(QISHUI_OFFICIAL_DOWNLOAD_URL);
    return { ok: true, provider: 'qishui', opened: true, action: 'download-client' };
  }

  qishuiImportSnapshot(files) {
    const snapshotRoot = path.join(this.app.getPath('userData'), 'qishui-official-import', String(Date.now()) + '-' + String(this.qishuiImportSnapshots.length + 1));
    const networkDir = path.join(snapshotRoot, 'Network');
    try {
      fs.mkdirSync(networkDir, { recursive: true, mode: 0o700 });
      for (const name of ['Cookies', 'Cookies-journal', 'Cookies-wal', 'Cookies-shm']) {
        const source = path.join(files.cookieProfilePath, 'Network', name);
        if (existingFile(source)) fs.copyFileSync(source, path.join(networkDir, name));
      }
      for (const source of [path.join(files.cookieProfilePath, 'Local State'), path.join(files.basePath, 'Local State')]) {
        if (existingFile(source)) {
          fs.copyFileSync(source, path.join(snapshotRoot, 'Local State'));
          break;
        }
      }
      for (const name of ['Preferences', 'Secure Preferences']) {
        const source = path.join(files.cookieProfilePath, name);
        if (existingFile(source)) fs.copyFileSync(source, path.join(snapshotRoot, name));
      }
    } catch (error) {
      try { fs.rmSync(snapshotRoot, { recursive: true, force: true }); } catch (_) {}
      throw new Error('QISHUI_OFFICIAL_CLIENT_RUNNING', { cause: error });
    }
    return snapshotRoot;
  }

  qishuiPlainCookies(cookiePath) {
    let db;
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(cookiePath, { readOnly: true });
      const rows = db.prepare("select host_key, name, value, path, is_secure, is_httponly, expires_utc, samesite from cookies where host_key = 'qishui.com' or host_key = '.qishui.com' or host_key like '%.qishui.com'").all();
      return rows.filter(row => row && row.value).map(row => {
        const chromiumExpiry = Number(row.expires_utc) || 0;
        const expirationDate = chromiumExpiry > 11644473600000000
          ? chromiumExpiry / 1000000 - 11644473600
          : undefined;
        return {
          domain: String(row.host_key || ''),
          name: String(row.name || ''),
          value: String(row.value || ''),
          path: String(row.path || '/'),
          secure: !!row.is_secure,
          httpOnly: !!row.is_httponly,
          expirationDate,
          sameSite: Number(row.samesite) === 2 ? 'strict' : (Number(row.samesite) === 1 ? 'lax' : 'unspecified'),
        };
      });
    } catch (_) {
      return [];
    } finally {
      try { if (db) db.close(); } catch (_) {}
    }
  }

  normalizeQishuiImportedCookies(cookies) {
    const config = this.config('qishui');
    const now = Date.now() / 1000;
    const result = new Map();
    for (const cookie of Array.isArray(cookies) ? cookies : []) {
      const domain = String(cookie && cookie.domain || '').replace(/^\./, '').toLowerCase();
      const name = String(cookie && cookie.name || '');
      const value = String(cookie && cookie.value || '');
      if (!officialHost(domain, ['qishui.com']) || !config.cookieAllowlist.test(name) || !value) continue;
      if (Number(cookie.expirationDate) > 0 && Number(cookie.expirationDate) <= now) continue;
      const score = domain === 'qishui.com' ? 3 : (domain === 'api.qishui.com' ? 2 : 1);
      const previous = result.get(name.toLowerCase());
      if (!previous || score > previous.score) result.set(name.toLowerCase(), { ...cookie, name, value, domain: cookie.domain || '.' + domain, score });
    }
    return Array.from(result.values()).map(({ score, ...cookie }) => cookie);
  }

  async readQishuiOfficialCookies(files) {
    const snapshotPath = this.qishuiImportSnapshot(files);
    const sourceSession = this.session.fromPath(snapshotPath, { cache: false });
    this.qishuiImportSnapshots.push({ path: snapshotPath, session: sourceSession });
    let cookies = [];
    try { cookies = await sourceSession.cookies.get({}); }
    catch (_) {}
    let normalized = this.normalizeQishuiImportedCookies(cookies);
    if (!normalized.length) normalized = this.normalizeQishuiImportedCookies(this.qishuiPlainCookies(path.join(snapshotPath, 'Network', 'Cookies')));
    if (!normalized.length) throw new Error('QISHUI_OFFICIAL_COOKIE_DECRYPT_FAILED');
    if (!normalized.some(cookie => /^sessionid(?:_ss)?$/i.test(cookie.name))) throw new Error('QISHUI_OFFICIAL_SESSION_COOKIE_MISSING');
    return normalized;
  }

  async writeQishuiImportedCookies(cookies, target, epoch) {
    target = target || this.providerSession('qishui');
    const now = Date.now() / 1000;
    if (epoch != null && !this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
    await target.clearStorageData({ storages: ['cookies'] });
    for (const cookie of cookies) {
      if (epoch != null && !this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
      const domain = String(cookie.domain || '.qishui.com').toLowerCase();
      const host = domain.replace(/^\./, '') || 'qishui.com';
      const cookiePath = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : '/';
      const details = {
        url: 'https://' + host + cookiePath,
        name: String(cookie.name),
        value: String(cookie.value),
        domain,
        path: cookiePath,
        secure: true,
        httpOnly: cookie.httpOnly !== false,
        expirationDate: Number(cookie.expirationDate) > now ? Number(cookie.expirationDate) : now + 30 * 24 * 60 * 60,
      };
      if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) details.sameSite = cookie.sameSite;
      await target.cookies.set(details);
    }
    if (typeof target.cookies.flushStore === 'function') await target.cookies.flushStore();
    if (typeof target.flushStorageData === 'function') target.flushStorageData();
  }

  importQishuiOfficialSession() {
    const epoch = this.accountScopeEpoch;
    return this.runScopedAccountOperation(epoch, 'qishui', () => this.importQishuiOfficialSessionAtScope(epoch));
  }

  async importQishuiOfficialSessionAtScope(epoch) {
    const target = this.providerSession('qishui');
    const files = this.qishuiOfficialFiles();
    if (!fs.existsSync(files.basePath)) throw new Error('QISHUI_OFFICIAL_PROFILE_NOT_FOUND');
    if (!files.cookiePath) throw new Error('QISHUI_OFFICIAL_COOKIE_STORE_NOT_FOUND');
    const device = qishuiDeviceInfo(files.basePath);
    if (device.deviceId.length < 8 || device.installId.length < 8) throw new Error('QISHUI_OFFICIAL_DEVICE_MISSING');
    const cookies = await this.readQishuiOfficialCookies(files);
    if (this.sessionSecret.length < 32) throw new Error('MUSIC_SESSION_SECRET_NOT_CONFIGURED');
    const remote = await requestJSON(this.backend('/api/qishui/session'), {
      headers: { 'x-lumifield-session-secret': this.sessionSecret },
    }, { cookies, device, revalidate: true, preserveExistingOnFailure: true });
    if (!this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
    if (!remote || remote.loggedIn !== true || remote.sessionValid !== true || !remote.profile || !remote.profile.userId) {
      throw new Error('QISHUI_OFFICIAL_SESSION_INVALID');
    }
    await this.writeQishuiImportedCookies(cookies, target, epoch);
    this.saveProfile('qishui', { ...remote.profile, ...device }, epoch);
    this.statusRequests.delete('qishui');
    this.revalidatedProviders.add('qishui');
    const state = await this.readLoginStatus('qishui', epoch);
    if (!this.validatedLoginState(state)) throw new Error('QISHUI_OFFICIAL_SESSION_INVALID');
    this.publishState(state);
    return {
      ok: !!(state && state.loggedIn),
      provider: 'qishui',
      loggedIn: !!(state && state.loggedIn),
      profile: state && state.profile || remote.profile,
    };
  }

  async importBackendSession(provider, epoch) {
    epoch = epoch == null ? this.accountScopeEpoch : epoch;
    const config = this.config(provider);
    if (!isBackendAccount(config)) return false;
    if (this.loginImportProviders.get(provider) !== epoch || !this.isScopeOperational(epoch)) return false;
    if (this.sessionSecret.length < 32) return false;
    const target = this.providerSession(provider);
    const snapshot = await requestJSON(this.backend(config.backendPrefix + '/session/export'), {
      headers: { 'x-lumifield-session-secret': this.sessionSecret },
    });
    if (!this.isScopeOperational(epoch) || this.loginImportProviders.get(provider) !== epoch) return false;
    if (!snapshot || snapshot.ok === false || snapshot.loggedIn !== true || snapshot.sessionValid !== true
        || snapshot.error || snapshot.stale === true || snapshot.profileUnavailable === true
        || snapshot.pendingProfile === true || snapshot.ignoredStaleSession === true
        || !snapshot.cookies || typeof snapshot.cookies !== 'object') return false;
    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const cookieEntries = Array.isArray(snapshot.cookies)
      ? snapshot.cookies.map(cookie => [cookie && cookie.name, cookie && cookie.value])
      : Object.entries(snapshot.cookies);
    const writes = cookieEntries
      .filter(([name, value]) => config.cookieAllowlist.test(String(name)) && String(value || ''))
      .map(([name, value]) => target.cookies.set({
        url: config.cookieUrl,
        name: String(name),
        value: String(value),
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: expires,
      }));
    await Promise.all(writes);
    if (!this.isScopeOperational(epoch)) return false;
    if (snapshot.profile) this.saveProfile(provider, { ...snapshot.profile, ...(snapshot.device || {}) }, epoch);
    return writes.length > 0;
  }

  async syncBackend(provider, cookies, options) {
    options = options || {};
    const profile = this.readProfiles()[provider] || null;
    const config = this.config(provider);
    if (isBackendAccount(config)) {
      if (this.sessionSecret.length < 32) throw new Error('MUSIC_SESSION_SECRET_NOT_CONFIGURED');
      return requestJSON(this.backend(config.backendPrefix + '/session'), {
        headers: { 'x-lumifield-session-secret': this.sessionSecret },
      }, {
        cookies,
        profile,
        device: profile ? { deviceId: profile.deviceId, installId: profile.installId } : null,
        revalidate: options.revalidate === true,
      });
    }
    if (this.sessionSecret.length < 32) throw new Error('MUSIC_SESSION_SECRET_NOT_CONFIGURED');
    return requestJSON(this.backend(provider === 'netease' ? '/api/login/cookie' : '/api/qq/login/cookie'), {
      headers: { 'x-lumifield-session-secret': this.sessionSecret },
    }, { cookie: cookies });
  }

  statusPath(provider) {
    if (provider === 'netease') return '/api/login/status';
    if (provider === 'qq') return '/api/qq/login/status';
    const config = this.config(provider);
    if (isBackendAccount(config)) return config.backendPrefix + '/login/status';
    throw new Error('UNSUPPORTED_PROVIDER');
  }

  async getLoginStatus(provider) {
    provider = this.config(provider).provider;
    const cookieImport = this.cookieImportOperations.get(provider);
    if (cookieImport) {
      await cookieImport.catch(() => {});
      return this.getLoginStatus(provider);
    }
    const epoch = this.accountScopeEpoch;
    const pending = this.statusRequests.get(provider);
    if (pending && pending.epoch === epoch) return pending.request;
    const request = this.runScopedAccountOperation(epoch, provider, () => this.readLoginStatus(provider, epoch)).finally(() => {
      const current = this.statusRequests.get(provider);
      if (current && current.request === request) this.statusRequests.delete(provider);
    });
    this.statusRequests.set(provider, { epoch, request });
    return request;
  }

  async readLoginStatus(provider, epoch) {
    const config = this.config(provider);
    const scopedSession = this.providerSession(provider);
    if (isBackendAccount(config)) {
      try { await this.importBackendSession(provider, epoch); } catch (_) {}
    }
    if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
    const cookies = await this.safeCookies(provider, epoch, scopedSession);
    const loggedIn = this.cookieLoginState(provider, cookies);
    if (!loggedIn) {
      this.revalidatedProviders.delete(provider);
      return { ok: true, provider, loggedIn: false, sessionValid: false, profile: null };
    }
    let remote = {};
    try {
      const revalidate = isBackendAccount(config) && !this.revalidatedProviders.has(provider);
      remote = await this.syncBackend(provider, cookies, { revalidate });
      if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
      const syncRejected = !remote || remote.ok === false || remote.sessionValid !== true
        || remote.loggedIn !== true || !!remote.error || remote.profileUnavailable === true
        || remote.pendingProfile === true || remote.ignoredStaleSession === true;
      if (!syncRejected && !remote.profile) remote = await requestJSON(this.backend(this.statusPath(provider)));
    } catch (error) {
      if (!this.isScopeOperational(epoch) || error.message === 'STALE_ACCOUNT_SCOPE') return this.staleStatus(provider);
      this.revalidatedProviders.delete(provider);
      const saved = this.readProfiles()[provider] || null;
      return Object.assign({ ok: false, provider, loggedIn: true, sessionValid: false }, saved || {}, { profile: saved, error: error.message || 'SESSION_SYNC_FAILED' });
    }
    if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
    if (!remote || remote.loggedIn !== true || remote.ok === false || remote.sessionValid !== true || remote.error
        || remote.profileUnavailable === true || remote.pendingProfile === true || remote.ignoredStaleSession === true) {
      this.revalidatedProviders.delete(provider);
      if (remote && remote.loggedIn === false) {
        await scopedSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
        if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
        this.deleteProfile(provider, epoch);
      }
      const saved = remote && remote.loggedIn === false ? null : (this.readProfiles()[provider] || null);
      return Object.assign({
        ok: !!(remote && remote.loggedIn === false && remote.ok !== false && !remote.error),
        provider,
        loggedIn: false,
        sessionValid: false,
      }, saved || {}, {
        profile: saved,
        ...(remote && (remote.error || remote.message) ? { error: String(remote.error || remote.message) } : {}),
      });
    }
    this.revalidatedProviders.add(provider);
    const profile = safeProfile(provider, remote.profile || remote);
    if (profile.userId || profile.nickname || profile.avatar) this.saveProfile(provider, profile, epoch);
    const saved = this.readProfiles()[provider] || profile;
    return Object.assign({ ok: true, provider, loggedIn: true, sessionValid: true }, saved, { profile: saved });
  }

  publishState(state) {
    if (this.onState) this.onState(state);
    for (const target of this.stateTargets) {
      if (target && !target.isDestroyed()) target.webContents.send('music-platform-login-state', state);
    }
    return state;
  }

  async emitState(provider, epoch) {
    epoch = epoch == null ? this.accountScopeEpoch : epoch;
    const state = await this.getLoginStatus(provider);
    if (!this.isScopeOperational(epoch) || state.stale) return this.staleStatus(provider);
    return this.publishState(state);
  }

  validNavigation(provider, value) {
    try {
      const url = new URL(value);
      const config = this.config(provider);
      if (isBackendAccount(config)) {
        const local = new URL(this.backend(config.loginPage));
        const expectedProvider = local.searchParams.get('provider');
        if (url.origin === local.origin && url.pathname === local.pathname
          && (!expectedProvider || url.searchParams.get('provider') === expectedProvider)) return true;
      }
      return url.protocol === 'https:' && config.allowedHost(url.hostname);
    } catch (_) { return false; }
  }

  async prepareBackendLogin(provider, epoch) {
    const config = this.config(provider);
    if (!isBackendAccount(config)) return;
    if (this.sessionSecret.length < 32) throw new Error('MUSIC_SESSION_SECRET_NOT_CONFIGURED');
    const scopedSession = this.providerSession(provider);
    const values = await this.safeCookies(provider, epoch, scopedSession);
    if (this.cookieLoginState(provider, values)) {
      const validated = await this.syncBackend(provider, values, { revalidate: true });
      if (!this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
      if (validated && validated.ok !== false && validated.loggedIn === true && validated.sessionValid === true
          && !validated.error && validated.stale !== true && validated.profileUnavailable !== true
          && validated.pendingProfile !== true && validated.ignoredStaleSession !== true) {
        this.revalidatedProviders.add(provider);
      } else {
        this.revalidatedProviders.delete(provider);
      }
      return;
    }
    await requestJSON(this.backend(config.backendPrefix + '/session'), {
      headers: { 'x-lumifield-session-secret': this.sessionSecret },
    }, { clear: true });
    if (!this.isScopeOperational(epoch)) throw new Error('STALE_ACCOUNT_SCOPE');
  }

  openLogin(provider, owner) {
    provider = this.config(provider).provider;
    const epoch = this.accountScopeEpoch;
    return this.runScopedAccountOperation(epoch, provider, () => this.openLoginAtScope(provider, owner, epoch));
  }

  async openLoginAtScope(provider, owner, epoch) {
    const config = this.config(provider);
    const existing = this.windows.get(provider);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { ok: true, provider, opened: true, reused: true };
    }
    await this.prepareBackendLogin(provider, epoch);
    if (!this.isScopeOperational(epoch)) return { ok: false, provider, opened: false, stale: true, error: 'STALE_ACCOUNT_SCOPE' };
    if (isBackendAccount(config)) this.loginImportProviders.set(provider, epoch);
    const partition = this.providerPartition(provider);
    const win = new this.BrowserWindow({
      width: 960,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: config.label + '登录',
      backgroundColor: '#050817',
      ...(this.iconPath ? { icon: this.iconPath } : {}),
      webPreferences: {
        partition,
        ...(provider === 'qishui' ? { preload: this.qishuiLoginPreload } : {}),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.windows.set(provider, win);
    if (owner && !owner.isDestroyed()) this.stateTargets.add(owner);
    const providerSession = this.providerSession(provider);
    let timer = null;
    let closing = false;
    let checking = false;
    let checkAgain = false;
    const check = async () => {
      if (!this.isScopeOperational(epoch)) return;
      if (checking) { checkAgain = true; return; }
      checking = true;
      try {
        const state = await this.emitState(provider, epoch).catch(() => null);
        const profileReady = !isBackendAccount(config) || !!(state && state.profile && state.profile.userId);
        if (this.validatedLoginState(state) && profileReady && !closing) {
          closing = true;
          setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 1200);
        }
      } finally {
        checking = false;
        if (checkAgain && !closing) {
          checkAgain = false;
          setTimeout(check, 0);
        }
      }
    };
    const changed = () => check();
    providerSession.cookies.on('changed', changed);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (this.validNavigation(provider, url)) win.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!this.validNavigation(provider, url)) event.preventDefault();
    });
    win.webContents.on('did-finish-load', check);
    win.once('ready-to-show', () => win.show());
    win.once('closed', () => {
      if (timer) clearInterval(timer);
      providerSession.cookies.removeListener('changed', changed);
      if (this.windows.get(provider) === win) this.windows.delete(provider);
      if (this.loginImportProviders.get(provider) === epoch) this.loginImportProviders.delete(provider);
      if (this.accountScopeReady && this.isCurrentScope(epoch)) check();
    });
    timer = setInterval(check, 1200);
    if (timer.unref) timer.unref();
    const loginUrl = isBackendAccount(config) ? this.backend(config.loginPage) : config.loginUrl;
    try {
      await win.loadURL(loginUrl);
    } catch (error) {
      if (!win.isDestroyed()) win.close();
      throw error;
    }
    if (!this.isScopeOperational(epoch) && !win.isDestroyed()) win.close();
    return { ok: true, provider, opened: true };
  }

  logout(provider) {
    provider = this.config(provider).provider;
    const epoch = this.accountScopeEpoch;
    return this.runScopedAccountOperation(epoch, provider, () => this.logoutAtScope(provider, epoch));
  }

  async logoutAtScope(provider, epoch) {
    const config = this.config(provider);
    const scopedSession = this.providerSession(provider);
    const win = this.windows.get(provider);
    if (win && !win.isDestroyed()) win.close();
    this.statusRequests.delete(provider);
    this.revalidatedProviders.delete(provider);
    this.loginImportProviders.delete(provider);
    await scopedSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] });
    if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
    this.deleteProfile(provider, epoch);
    let backendCleared = false;
    if (this.sessionSecret.length >= 32) {
      for (let attempt = 0; attempt < 2 && !backendCleared; attempt += 1) {
        try {
          const result = isBackendAccount(config)
            ? await requestJSON(this.backend(config.backendPrefix + '/session'), {
              headers: { 'x-lumifield-session-secret': this.sessionSecret },
            }, { clear: true })
            : await requestJSON(this.backend(provider === 'netease' ? '/api/logout' : '/api/qq/logout'), {
              headers: { 'x-lumifield-session-secret': this.sessionSecret },
            }, { clear: true });
          backendCleared = !!(result && result.ok !== false && !result.error);
        } catch (_) {}
      }
    }
    if (!this.isScopeOperational(epoch)) return this.staleStatus(provider);
    if (!backendCleared) {
      return this.publishState({
        ok: false,
        provider,
        loggedIn: false,
        sessionValid: false,
        profile: null,
        localCleared: true,
        backendCleared: false,
        error: 'BACKEND_SESSION_CLEAR_FAILED',
        message: '本地登录已清除，但音乐服务会话清理失败，请稍后重试',
      });
    }
    const state = await this.readLoginStatus(provider, epoch);
    if (!this.isScopeOperational(epoch) || state.stale) return this.staleStatus(provider);
    return this.publishState(Object.assign({}, state, { localCleared: true, backendCleared: true }));
  }

  async getProfile(provider) {
    const status = await this.getLoginStatus(provider);
    return { ok: status.ok, provider: status.provider, loggedIn: status.loggedIn, profile: status.profile || null, error: status.error };
  }

  getPlaylists(provider) {
    const config = this.config(provider);
    provider = config.provider;
    const epoch = this.accountScopeEpoch;
    return this.runScopedAccountOperation(epoch, provider, () => this.getPlaylistsAtScope(config, provider, epoch));
  }

  async getPlaylistsAtScope(config, provider, epoch) {
    const status = await this.readLoginStatus(provider, epoch);
    if (!this.isScopeOperational(epoch) || status.stale) return { ok: false, provider, playlists: [], stale: true, error: 'STALE_ACCOUNT_SCOPE' };
    if (!this.validatedLoginState(status)) {
      return { ok: false, provider, loggedIn: false, sessionValid: false, playlists: [], error: status.error || 'NOT_LOGGED_IN' };
    }
    const endpoint = provider === 'netease'
      ? '/api/user/playlists'
      : (provider === 'qq' ? '/api/qq/user/playlists' : config.backendPrefix + '/user/playlists');
    const result = await requestJSON(this.backend(endpoint));
    if (!this.isScopeOperational(epoch)) return { ok: false, provider, playlists: [], stale: true, error: 'STALE_ACCOUNT_SCOPE' };
    return result;
  }

  search(keywords, limit) {
    const url = new URL(this.backend('/api/platform/search'));
    url.searchParams.set('keywords', String(keywords || ''));
    url.searchParams.set('limit', String(limit || 18));
    return requestJSON(url.toString());
  }

  resolve(song, quality, force) {
    return requestJSON(this.backend('/api/platform/resolve'), {}, { song, quality: quality || '', force: !!force });
  }

  lyrics(song) {
    const provider = normalizeProvider(song && (song.provider || song.source)) || 'netease';
    const endpoint = /^kugou(?:_concept)?$/.test(provider) ? '/api/kugou/lyric' : (provider === 'qq' ? '/api/qq/lyric' : '/api/lyric');
    const url = new URL(this.backend(endpoint));
    Object.entries(song || {}).forEach(([key, value]) => {
      if (value != null && typeof value !== 'object' && String(value).length < 2048) url.searchParams.set(key, String(value));
    });
    return requestJSON(url.toString());
  }

  async loggedInPlatforms() {
    const statuses = await Promise.all(Object.keys(PLATFORM_CONFIGS).map(provider => this.getLoginStatus(provider)));
    return statuses.filter(status => this.validatedLoginState(status)).map(status => status.provider);
  }

  registerIpc(ipcMain) {
    const register = (channel, handler) => {
      if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    };
    const trustedOwner = event => {
      const owner = event && event.sender ? this.BrowserWindow.fromWebContents(event.sender) : null;
      let trusted = false;
      try { trusted = !!(owner && !owner.isDestroyed() && this.trustedSender && this.trustedSender(event.sender)); } catch (_) {}
      return trusted ? owner : null;
    };
    const forbidden = provider => ({
      ok: false,
      provider: String(provider || ''),
      loggedIn: false,
      sessionValid: false,
      error: 'FORBIDDEN',
    });
    register('music-platform-open-login', (event, provider) => {
      const owner = trustedOwner(event);
      return owner ? this.openLogin(provider, owner) : forbidden(provider);
    });
    register('music-platform-login-status', (event, provider) => {
      const owner = trustedOwner(event);
      if (!owner) return forbidden(provider);
      this.stateTargets.add(owner);
      return this.getLoginStatus(provider);
    });
    register('music-platform-profile', (event, provider) => trustedOwner(event) ? this.getProfile(provider) : forbidden(provider));
    register('music-platform-playlists', (event, provider) => trustedOwner(event) ? this.getPlaylists(provider) : Object.assign(forbidden(provider), { playlists: [] }));
    register('music-platform-clear-login', (event, provider) => trustedOwner(event) ? this.logout(provider) : forbidden(provider));
    register('music-platform-account-preferences-read', event => trustedOwner(event)
      ? this.readAccountPreferences()
      : { ok:false, found:false, preferences:null, error:'FORBIDDEN' });
    register('music-platform-account-preferences-write', (event, input) => trustedOwner(event)
      ? this.writeAccountPreferences(input)
      : { ok:false, error:'FORBIDDEN' });
    register('music-platform-import-cookie', (event, provider, cookieText) => {
      const owner = trustedOwner(event);
      if (!owner) return forbidden(provider);
      this.stateTargets.add(owner);
      return this.importCookie(provider, cookieText);
    });
    register('music-platform-check-netease-qr', (event, key) => {
      const owner = trustedOwner(event);
      if (!owner) return forbidden('netease');
      this.stateTargets.add(owner);
      return this.checkNeteaseQr(key);
    });
    const qishuiSender = event => {
      const win = this.windows.get('qishui');
      return !!(win && !win.isDestroyed() && win.webContents === event.sender);
    };
    register('qishui-official-status', event => qishuiSender(event)
      ? this.qishuiOfficialStatus()
      : { ok: false, provider: 'qishui', error: 'FORBIDDEN' });
    register('qishui-official-open', async event => {
      if (!qishuiSender(event)) return { ok: false, provider: 'qishui', error: 'FORBIDDEN' };
      try { return await this.openQishuiOfficialClient(); }
      catch (error) { return { ok: false, provider: 'qishui', error: publicQishuiImportError(error) }; }
    });
    register('qishui-official-import', async event => {
      if (!qishuiSender(event)) return { ok: false, provider: 'qishui', error: 'FORBIDDEN' };
      try { return await this.importQishuiOfficialSession(); }
      catch (error) { return { ok: false, provider: 'qishui', loggedIn: false, error: publicQishuiImportError(error) }; }
    });
    return this;
  }

  dispose() {
    this.accountScopeEpoch += 1;
    this.stateTargets.clear();
    this.statusRequests.clear();
    this.cookieImportSerial.clear();
    this.cookieImportOperations.clear();
    this.revalidatedProviders.clear();
    this.loginImportProviders.clear();
    this.onState = null;
    this.clearQishuiImportSnapshots();
    this.closeAccountScopeWindows();
  }
}

module.exports = { MusicPlatformManager, PLATFORM_CONFIGS };
