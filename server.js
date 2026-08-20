// ====================================================================
//  粒子音乐可视化播放器 — Server v2
//  - 网易云搜索 / 歌曲URL / 封面/音频代理
//  - 扫码登录 (login_qr_*) + 进程内会话
//  - 试听检测 (freeTrialInfo) + 全 quality 探测
//  - 所有受保护 API 都会带上已登录用户的 cookie
// ====================================================================
const {
  search,
  cloudsearch,
  song_detail,
  song_url,
  song_url_v1,
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  logout,
  user_account,
  user_playlist,
  comment_music,
  artist_detail,
  artist_top_song,
  artist_songs,
  like: like_song,
  likelist,
  song_like_check,
  playlist_tracks,
  playlist_track_add,
  playlist_create,
  playlist_delete,
  playlist_detail,
  playlist_subscribe,
  playlist_track_all,
  personalized,
  recommend_resource,
  recommend_songs,
  dj_detail,
  dj_program,
  dj_hot,
  dj_sublist,
  user_audio,
  dj_paygift,
  record_recent_voice,
  sati_resource_sub_list,
  lyric,
  lyric_new,
} = require('NeteaseCloudMusicApi');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { once } = require('events');
const { analyzePodcastDjStream, analyzePodcastDjIntro } = require('./dj-analyzer');
const { createMusicPlatformService, playlistOwnershipMetadata } = require('./music-platform-service');
const localTranslationService = require('./desktop/lf-translation-service');
const SOUNDTOUCH_PROCESSOR_ROUTE = '/vendor/soundtouchjs/soundtouch-processor-2.1.0.js';
const SOUNDTOUCH_PROCESSOR_PATH = require.resolve('@soundtouchjs/audio-worklet/processor');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BEATMAP_CACHE_DIR = process.env.LUMIFIELD_BEAT_CACHE_DIR || 'D:\\LumiFieldCache\\beatmaps';
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.LUMIFIELD_VERSION || APP_PACKAGE.version || '1.1.42';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'https://ipwho.is/';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

const weatherCache = new Map();
const weatherRefreshInFlight = new Map();
const weatherLocationCache = new Map();
const weatherLocationInFlight = new Map();
let weatherIpLocationCache = null;
let weatherIpLocationInFlight = null;
const playlistMutationInFlight = new Map();
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEATHER_CACHE_MAX_ENTRIES = 64;

function setBoundedWeatherCache(map, key, value, maximum = WEATHER_CACHE_MAX_ENTRIES) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maximum) map.delete(map.keys().next().value);
}

function applySystemCertificateAuthorities() {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (!system.length) return;
    const seen = new Set();
    const merged = [];
    bundled.concat(system).forEach(cert => {
      if (!cert || seen.has(cert)) return;
      seen.add(cert);
      merged.push(cert);
    });
    if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
  } catch (e) {
    console.warn('[TLS] system CA merge skipped:', e.message);
  }
}

applySystemCertificateAuthorities();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ---------- 进程内 Cookie 会话（不落盘） ----------
const COOKIE_ATTRIBUTE_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly']);
function collectCookiePair(picked, key, value) {
  key = String(key || '').trim();
  if (!key || COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
  if (value === null || value === undefined) return;
  picked.set(key, String(value).trim());
}
function collectCookieInput(input, picked) {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    input.forEach(item => collectCookieInput(item, picked));
    return;
  }
  if (typeof input === 'object') {
    if (input.name && Object.prototype.hasOwnProperty.call(input, 'value')) {
      collectCookiePair(picked, input.name, input.value);
      return;
    }
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, value.value);
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
    });
  });
}
function normalizeCookieHeader(input) {
  const picked = new Map();
  collectCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}
function rawCookieFallback(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input) && input.every(item => typeof item === 'string')) return input.join('; ').trim();
  return '';
}
let userCookie = '';
function saveCookie(c) {
  userCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  return userCookie;
}

const NETEASE_QR_SESSION_TTL_MS = 5 * 60 * 1000;
let neteaseQrGeneration = 0;
const neteaseQrSessions = new Map();
function invalidateNeteaseQrSessions() {
  neteaseQrGeneration += 1;
  neteaseQrSessions.clear();
}
function pruneNeteaseQrSessions() {
  const now = Date.now();
  for (const [key, entry] of neteaseQrSessions) {
    if (!entry || entry.expiresAt <= now || entry.used) neteaseQrSessions.delete(key);
  }
}

let qqCookie = '';
function saveQQCookie(c) {
  qqCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  return qqCookie;
}

// ---------- 工具 ----------
function serveStatic(res, filePath, extraHeaders) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'text/plain' }, extraHeaders || {}));
    res.end(data);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(data));
}
function isAllowedBrowserOrigin(req) {
  if (process.env.LUMIFIELD_ALLOW_CROSS_ORIGIN === '1') return true;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return parsed.protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost') && port === String(PORT);
  } catch (_) { return false; }
}

const lyricTranslationRate = new Map();
const LOCAL_WALLPAPER_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LOCAL_STEM_ID_RE = /^[a-f0-9]{64}$/i;
const WALLPAPER_HTML_CSP = [
  "default-src 'self' data: blob:",
  "connect-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-pointer-lock',
].join('; ');

function readLimitedJSON(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let finished = false;
    const fail = (code) => {
      if (finished) return;
      finished = true;
      const error = new Error(code);
      error.code = code;
      reject(error);
    };
    req.on('data', chunk => {
      if (finished) return;
      received += chunk.length;
      if (received > maxBytes) {
        fail('REQUEST_BODY_TOO_LARGE');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) {
        const error = new Error('INVALID_JSON_BODY');
        error.code = 'INVALID_JSON_BODY';
        reject(error);
      }
    });
    req.on('error', () => fail('REQUEST_READ_FAILED'));
  });
}

function translationRateAllowed(req) {
  const now = Date.now();
  const key = String(req.socket && req.socket.remoteAddress || 'local');
  const recent = (lyricTranslationRate.get(key) || []).filter(time => now - time < 60000);
  if (recent.length >= 10) {
    lyricTranslationRate.set(key, recent);
    return false;
  }
  recent.push(now);
  lyricTranslationRate.set(key, recent);
  if (lyricTranslationRate.size > 128) {
    for (const [entry, times] of lyricTranslationRate) {
      if (!times.some(time => now - time < 60000)) lyricTranslationRate.delete(entry);
    }
  }
  return true;
}

function isPrivateNetworkAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (net.isIP(value) === 4) {
    const octets = value.split('.').map(Number);
    const [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIP(value) === 6) {
    if (/^::ffff:/i.test(value)) return isPrivateNetworkAddress(value.slice(7));
    return value === '::' || value === '::1' || /^f[cd]/i.test(value) || /^fe[89ab]/i.test(value) || /^2001:db8:/i.test(value);
  }
  return true;
}

async function resolveTranslationEndpoint() {
  const endpointText = String(process.env.LF_TRANSLATE_ENDPOINT || '').trim();
  const key = String(process.env.LF_TRANSLATE_API_KEY || '').trim();
  if (!endpointText || !key || key.length > 4096 || /[\r\n]/.test(key)) {
    const error = new Error('BLOCKED_EXTERNAL_CONFIG');
    error.code = 'BLOCKED_EXTERNAL_CONFIG';
    throw error;
  }
  let endpoint;
  try { endpoint = new URL(endpointText); } catch (_) {}
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !endpoint.hostname) {
    const error = new Error('BLOCKED_EXTERNAL_CONFIG');
    error.code = 'BLOCKED_EXTERNAL_CONFIG';
    throw error;
  }
  const records = await dns.promises.lookup(endpoint.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateNetworkAddress(record.address))) {
    const error = new Error('BLOCKED_EXTERNAL_CONFIG');
    error.code = 'BLOCKED_EXTERNAL_CONFIG';
    throw error;
  }
  return { endpoint, key, address: records[0].address, family: records[0].family };
}

function translationValues(payload, expectedLength) {
  let values = payload && (payload.translations || payload.lines || payload.data && (payload.data.translations || payload.data.lines));
  if (!Array.isArray(values) && payload && payload.choices && payload.choices[0]) {
    const content = payload.choices[0].message && payload.choices[0].message.content || payload.choices[0].text;
    try {
      const parsed = JSON.parse(String(content || '').replace(/^```(?:json)?\s*|\s*```$/gi, ''));
      values = parsed.translations || parsed.lines || parsed;
    } catch (_) {}
  }
  if (!Array.isArray(values) || values.length !== expectedLength) return null;
  return values.map(value => String(value && typeof value === 'object' ? (value.text || value.translation || value.translatedText || '') : value || '').trim().slice(0, 1200));
}

function normalizeLyricTranslationInput(input) {
  const rawLines = input && input.lines;
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 200) {
    const error = new Error('INVALID_TRANSLATION_LINES');
    error.code = 'INVALID_TRANSLATION_LINES';
    throw error;
  }
  const lines = rawLines.map(line => String(line == null ? '' : line).replace(/[\r\n\t]/g, ' ').trim().slice(0, 600));
  if (!lines.some(Boolean) || lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0) > 48000) {
    const error = new Error('TRANSLATION_INPUT_TOO_LARGE');
    error.code = 'TRANSLATION_INPUT_TOO_LARGE';
    throw error;
  }
  const sourceLanguage = /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(String(input.sourceLanguage || 'auto')) ? String(input.sourceLanguage || 'auto') : 'auto';
  const targetLanguage = /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(String(input.targetLanguage || 'zh-CN')) ? String(input.targetLanguage || 'zh-CN') : 'zh-CN';
  const languageContext = Array.isArray(input.languageContext)
    ? input.languageContext.slice(0, 200).map(line => String(line == null ? '' : line).replace(/[\r\n\t]/g, ' ').trim().slice(0, 600))
    : [];
  if (languageContext.reduce((sum, line) => sum + Buffer.byteLength(line), 0) > 48000) {
    const error = new Error('TRANSLATION_INPUT_TOO_LARGE');
    error.code = 'TRANSLATION_INPUT_TOO_LARGE';
    throw error;
  }
  return { ...input, lines, languageContext, sourceLanguage, targetLanguage };
}

async function proxyRemoteLyricTranslation(input, signal) {
  const lines = input.lines;
  const sourceLanguage = input.sourceLanguage;
  const targetLanguage = input.targetLanguage;
  const remote = await resolveTranslationEndpoint();
  const body = JSON.stringify({ sourceLanguage, targetLanguage, lines });
  const payload = await new Promise((resolve, reject) => {
    const req = https.request(remote.endpoint, {
      method: 'POST',
      lookup: (_hostname, _options, callback) => callback(null, remote.address, remote.family),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Authorization: 'Bearer ' + remote.key,
      },
    }, response => {
      const chunks = [];
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > 512 * 1024) req.destroy(new Error('TRANSLATION_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) return reject(new Error('TRANSLATION_UPSTREAM_' + response.statusCode));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_) { reject(new Error('TRANSLATION_INVALID_RESPONSE')); }
      });
    });
    const abort = () => req.destroy(Object.assign(new Error('TRANSLATION_ABORTED'), { code: 'TRANSLATION_ABORTED' }));
    if (signal) signal.addEventListener('abort', abort, { once: true });
    req.setTimeout(7000, () => req.destroy(Object.assign(new Error('TRANSLATION_TIMEOUT'), { code: 'TRANSLATION_TIMEOUT' })));
    req.on('error', reject);
    req.on('close', () => { if (signal) signal.removeEventListener('abort', abort); });
    req.write(body);
    req.end();
  });
  const translations = translationValues(payload, lines.length);
  if (!translations) {
    const error = new Error('TRANSLATION_INVALID_RESPONSE');
    error.code = 'TRANSLATION_INVALID_RESPONSE';
    throw error;
  }
  return { ok: true, translations, sourceLanguage, targetLanguage, adapter: 'remote-admin' };
}

function retryableTranslationError(error) {
  const code = String(error && (error.code || error.message) || '');
  return /TRANSLATION_(?:TIMEOUT|UPSTREAM_429|UPSTREAM_5\d\d|INVALID_RESPONSE|RESPONSE_TOO_LARGE)/.test(code)
    || /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(code);
}

async function proxyLyricTranslation(rawInput, options = {}) {
  const input = normalizeLyricTranslationInput(rawInput);
  const hasEndpoint = !!String(process.env.LF_TRANSLATE_ENDPOINT || '').trim();
  const hasKey = !!String(process.env.LF_TRANSLATE_API_KEY || '').trim();
  let remoteWarning = '';
  if (hasEndpoint && hasKey) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await proxyRemoteLyricTranslation(input, options.signal);
      } catch (error) {
        remoteWarning = String(error.code || error.message || 'TRANSLATION_REMOTE_FAILED');
        if (!retryableTranslationError(error) || attempt > 0 || options.signal && options.signal.aborted) break;
        await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
  } else if (hasEndpoint || hasKey) {
    remoteWarning = 'BLOCKED_EXTERNAL_CONFIG';
  }
  const local = await localTranslationService.translateLyrics(input, options);
  if (remoteWarning) local.remoteWarning = remoteWarning;
  return local;
}

function localAssetMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.ogv': 'video/ogg', '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary', '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
  };
  return types[ext] || 'application/octet-stream';
}

function decodeLocalPathParts(raw) {
  if (!raw) return [];
  const parts = raw.split('/').filter(Boolean).map(part => {
    let value;
    try { value = decodeURIComponent(part); } catch (_) { throw new Error('INVALID_LOCAL_PATH'); }
    if (!value || value === '.' || value === '..' || /[\\/:\0]/.test(value)) throw new Error('INVALID_LOCAL_PATH');
    return value;
  });
  return parts;
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function resolveLocalReadOnlyFile(rootValue, parts) {
  if (!rootValue || !parts.length) return '';
  let root;
  try { root = fs.realpathSync(path.resolve(rootValue)); } catch (_) { return ''; }
  const candidate = path.resolve(root, ...parts);
  if (!pathIsInside(root, candidate)) return '';
  let real;
  try {
    real = fs.realpathSync(candidate);
    if (!pathIsInside(root, real) || !fs.statSync(real).isFile()) return '';
  } catch (_) { return ''; }
  return real;
}

function parseSingleRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}

function sendLocalReadOnlyFile(req, res, filePath, htmlWallpaper) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }
  const stat = fs.statSync(filePath);
  const range = parseSingleRange(req.headers.range, stat.size);
  if (range === false) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, stat.size - 1);
  const headers = {
    'Content-Type': localAssetMime(filePath),
    'Content-Length': stat.size ? end - start + 1 : 0,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
  if (htmlWallpaper) headers['Content-Security-Policy'] = WALLPAPER_HTML_CSP;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD' || stat.size === 0) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const allowed = !!root && !/^C:$/i.test(drive);
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function legacyBeatCacheModeToken() {
  return ['m', 'r'].join('');
}
function normalizeBeatCacheMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === legacyBeatCacheModeToken()) return 'cinema';
  return raw === 'dj' ? 'dj' : raw.slice(0, 32);
}
function canonicalBeatMapCacheKey(value) {
  const raw = String(value || '').trim();
  const suffix = ':' + legacyBeatCacheModeToken();
  if (raw.toLowerCase().endsWith(suffix)) return raw.slice(0, -suffix.length) + ':cinema';
  return raw;
}
function legacyBeatMapCacheKey(value) {
  const canonical = canonicalBeatMapCacheKey(value);
  const suffix = ':cinema';
  if (!canonical.toLowerCase().endsWith(suffix)) return '';
  return canonical.slice(0, -suffix.length) + ':' + legacyBeatCacheModeToken();
}
function canonicalBeatMapCachePayload(source, key) {
  const meta = source && source.meta && typeof source.meta === 'object' ? source.meta : source || {};
  const map = source && source.map;
  if (!key || !map || typeof map !== 'object') return null;
  const lowerKey = key.toLowerCase();
  const mode = lowerKey.endsWith(':cinema') ? 'cinema'
    : (lowerKey.endsWith(':dj') ? 'dj' : normalizeBeatCacheMode(meta.mode));
  return {
    v: 2,
    key,
    savedAt: Number(source.savedAt) > 0 ? Number(source.savedAt) : Date.now(),
    meta: {
      provider: String(meta.provider || '').slice(0, 32),
      title: String(meta.title || '').slice(0, 160),
      artist: String(meta.artist || '').slice(0, 160),
      mode,
    },
    map,
  };
}
function compactBeatMapCachePayload(body) {
  const key = canonicalBeatMapCacheKey(body && body.key);
  return canonicalBeatMapCachePayload(body || {}, key);
}
function readValidatedBeatMapCacheFile(file, expectedKey) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.key !== expectedKey || !raw.map || typeof raw.map !== 'object') return null;
    return raw;
  } catch (_) {
    return null;
  }
}
function atomicWriteBeatMapCacheFile(file, payload) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
}
function verifiedBeatMapCacheWrite(file, payload) {
  atomicWriteBeatMapCacheFile(file, payload);
  const verified = readValidatedBeatMapCacheFile(file, payload.key);
  if (!verified || verified.v !== 2 || !verified.meta || verified.meta.mode !== payload.meta.mode) {
    const err = new Error('BEAT_CACHE_WRITE_VERIFICATION_FAILED');
    err.code = 'BEAT_CACHE_WRITE_VERIFICATION_FAILED';
    throw err;
  }
  return verified;
}
function readBeatMapCache(key) {
  const canonicalKey = canonicalBeatMapCacheKey(key);
  const file = safeBeatMapCacheFile(canonicalKey);
  if (!file) return null;
  const current = readValidatedBeatMapCacheFile(file, canonicalKey);
  if (current) {
    const payload = canonicalBeatMapCachePayload(current, canonicalKey);
    if (!payload) return null;
    if (current.v === 2 && current.meta && current.meta.mode === payload.meta.mode) return current;
    return verifiedBeatMapCacheWrite(file, payload);
  }

  const legacyKey = legacyBeatMapCacheKey(canonicalKey);
  const legacyFile = legacyKey ? safeBeatMapCacheFile(legacyKey) : null;
  const legacy = readValidatedBeatMapCacheFile(legacyFile, legacyKey);
  if (!legacy) return null;
  const migrated = canonicalBeatMapCachePayload(legacy, canonicalKey);
  if (!migrated) return null;
  migrated.meta.mode = 'cinema';
  const verified = verifiedBeatMapCacheWrite(file, migrated);
  fs.unlinkSync(legacyFile);
  return verified;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const verified = verifiedBeatMapCacheWrite(file, payload);
  const legacyKey = legacyBeatMapCacheKey(payload.key);
  const legacyFile = legacyKey ? safeBeatMapCacheFile(legacyKey) : null;
  if (legacyFile && legacyFile !== file && fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  return { ok: true, key: verified.key, savedAt: verified.savedAt, dir: path.dirname(file) };
}
function readRequestBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => { out[k] = v; });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}
function normalizeApiCode(payload) {
  const body = payload && (payload.body || payload);
  return Number((body && body.code) || (body && body.body && body.body.code) || (payload && payload.status) || 0);
}
function normalizeApiMessage(payload) {
  const body = payload && (payload.body || payload);
  return (body && (body.message || body.msg || body.error)) || (body && body.body && (body.body.message || body.body.msg || body.body.error)) || '';
}
function parseCookieString(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}
function serializeCookieObject(obj) {
  return Object.keys(obj || {})
    .filter(k => obj[k] != null && String(obj[k]) !== '')
    .map(k => k + '=' + String(obj[k]))
    .join('; ');
}
function qqCookieObject() {
  return parseCookieString(qqCookie);
}
function normalizeQQUin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}
function qqCookieUin(obj) {
  obj = obj || qqCookieObject();
  const raw = Number(obj.login_type) === 2 ? (obj.wxuin || obj.uin || obj.p_uin) : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}
function qqCookieMusicKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
}
function qqCookiePlaybackKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
}
function decodeQQCookieValue(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim(); }
  catch (e) { return String(value || '').trim(); }
}
function qqCookieNickname(obj, uin) {
  obj = obj || qqCookieObject();
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  const padded = uin ? '0' + uin : '';
  const keys = [
    uin && ('ptnick_' + uin),
    padded && ('ptnick_' + padded),
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname'
  ].filter(Boolean);
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key]);
      if (nick) return nick;
    }
  }
  const ptnickKey = Object.keys(obj).find(key => /^ptnick_/i.test(key) && obj[key]);
  return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : '';
}
function qqCookieAvatar(obj, uin) {
  obj = obj || qqCookieObject();
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || '';
  if (direct) return decodeQQCookieValue(direct);
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : '';
}
function normalizeQQCookieInput(cookieText) {
  const obj = parseCookieString(cookieText);
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin;
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin;
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin);
  return serializeCookieObject(obj);
}
function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}
function classifyNeteasePlaybackRestriction(lastData, loginInfo) {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn);
  const fee = Number(lastData && lastData.fee);
  const code = Number(lastData && lastData.code);
  const freeTrial = lastData && lastData.freeTrialInfo;
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee });
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee });
  }
  if (fee === 1) {
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee });
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee });
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee });
  }
  return playbackRestriction('netease', 'url_unavailable', '网易云没有返回可播放地址，可能是版权、会员或地区限制', loggedIn ? 'switch_source' : 'login', { code, fee });
}
function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if (code === 104003) {
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源', 'switch_source', { code, rawMessage: rawMsg });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', { code, rawMessage: rawMsg });
}
const NETEASE_QUALITY_CANDIDATES = [
  { level: 'jymaster', br: 1999000, label: '超清母带', svip: true },
  { level: 'hires',    br: 1999000, label: '高清臻音' },
  { level: 'lossless', br: 1411000, label: '无损' },
  { level: 'exhigh',   br: 999000,  label: '极高' },
  { level: 'standard', br: 128000,  label: '标准' },
];
const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
];
function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}
function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex(item => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}
function hasNeteaseSvip(loginInfo) {
  return !!(loginInfo && loginInfo.loggedIn && (loginInfo.vipLevel === 'svip' || loginInfo.isSvip || Number(loginInfo.vipType || 0) >= 10));
}
function mapArtists(raw) {
  return (raw || [])
    .map(a => ({ id: a && a.id, name: (a && a.name) || '' }))
    .filter(a => a.name);
}
function normalizeClimaxStartSec(raw, durationValue) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const duration = Math.max(0, Number(durationValue) || 0);
  const durationSec = duration > 10000 ? duration / 1000 : duration;
  const chorus = raw.chorus && typeof raw.chorus === 'object' ? raw.chorus : {};
  const climax = raw.climax && typeof raw.climax === 'object' ? raw.climax : {};
  const highlight = raw.highlight && typeof raw.highlight === 'object' ? raw.highlight : {};
  const chorusInfo = raw.chorus_info && typeof raw.chorus_info === 'object' ? raw.chorus_info : {};
  const audioFeatures = raw.audio_features && typeof raw.audio_features === 'object' ? raw.audio_features
    : (raw.audioFeatures && typeof raw.audioFeatures === 'object' ? raw.audioFeatures : {});
  const candidates = [
    ['climaxStartSec', raw.climaxStartSec],
    ['chorusStartSec', raw.chorusStartSec],
    ['highlightStartSec', raw.highlightStartSec],
    ['climaxStartMs', raw.climaxStartMs],
    ['chorusStartMs', raw.chorusStartMs],
    ['highlightStartMs', raw.highlightStartMs],
    ['climaxStart', raw.climaxStart],
    ['chorusStart', raw.chorusStart || raw.chorus_start || raw.chorus_start_time],
    ['highlightStart', raw.highlightStart],
    ['previewStartTime', raw.previewStartTime],
    ['auditionStartTime', raw.auditionStartTime],
    ['climax.start', climax.startSec ?? climax.startTimeMs ?? climax.startTime ?? climax.start],
    ['chorus.start', chorus.startSec ?? chorus.startTimeMs ?? chorus.startTime ?? chorus.start],
    ['highlight.start', highlight.startSec ?? highlight.startTimeMs ?? highlight.startTime ?? highlight.start],
    ['chorus_info.start_time', chorusInfo.start_time ?? chorusInfo.start_ms ?? chorusInfo.start],
    ['audio_features.climax_start', audioFeatures.climax_start ?? audioFeatures.climaxStart],
    ['audio_features.chorus_start', audioFeatures.chorus_start ?? audioFeatures.chorusStart],
  ];
  for (const [field, candidate] of candidates) {
    let value = Number(candidate);
    if (!Number.isFinite(value) || value < 0) continue;
    if (/ms|start_time/i.test(field) || (value > 1000 && (!durationSec || value > durationSec * 1.8))) value /= 1000;
    if (!Number.isFinite(value) || value < 0 || (durationSec > 0 && value >= durationSec - 0.15)) continue;
    return Math.round(value * 1000) / 1000;
  }
  return null;
}
function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  const privilege = s.privilege && typeof s.privilege === 'object' ? s.privilege : {};
  const blocked = Number.isFinite(Number(privilege.st)) && Number(privilege.st) < 0;
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map(a => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    climaxStartSec: normalizeClimaxStartSec(s, s.dt || s.duration || 0),
    fee: s.fee,
    playable: blocked ? false : null,
    restriction: blocked ? { category: 'copyright_unavailable', message: '网易云音乐标记该资源当前不可用' } : null,
    heat: Number(s.pop || s.score || s.playCount || 0) || 0,
    officialOriginal: s.originCoverType === 1 || s.isOriginal === true,
  };
}
function mapDiscoverPlaylist(pl, tag) {
  pl = pl || {};
  const creator = pl.creator || pl.user || {};
  const id = pl.id || pl.resourceId || pl.creativeId;
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: pl.name || pl.title || '',
    cover: pl.picUrl || pl.coverImgUrl || pl.coverUrl || pl.uiElement && pl.uiElement.image && pl.uiElement.image.imageUrl || '',
    trackCount: pl.trackCount || pl.songCount || pl.programCount || 0,
    playCount: pl.playCount || pl.playcount || 0,
    creator: creator.nickname || creator.name || '',
    tag: tag || pl.alg || '',
  };
}

function lowSignalText(value) {
  return String(value || '').trim().toLowerCase();
}

function isLowSignalPodcastItem(item) {
  const name = lowSignalText(item && (item.name || item.title || item.radioName));
  const sub = lowSignalText(item && (item.djName || item.category || item.desc || item.sub));
  const text = name + ' ' + sub;
  return /购买播客|付费精品|qzone|空间背景音乐|背景音乐|四只烤翅|试纸烤翅/i.test(text);
}

function isQQFavoritePlaylist(pl) {
  const name = String(pl && pl.name || '').trim();
  return /我喜欢|我的喜欢|喜欢的音乐/i.test(name);
}

function isQzoneBackgroundPlaylist(pl) {
  const text = String((pl && pl.name || '') + ' ' + (pl && pl.creator || '')).toLowerCase();
  return /qzone|空间|背景音乐/i.test(text);
}
async function requireLogin(res) {
  const info = await getLoginInfo();
  if (!info.loggedIn || !info.userId) {
    sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
    return null;
  }
  return info;
}

// ---------- 业务: 搜索 ----------
//   优先用 cloudsearch (新接口, 字段更全, picUrl 更稳定)
//   对于仍然缺失封面的歌曲, 用 song_detail 批量补齐
async function handleSearch(keywords, limit) {
  console.log('[Search]', keywords, 'limit:', limit);
  const result = await cloudsearch({ keywords, limit, cookie: userCookie });
  const songs = result.body && result.body.result && result.body.result.songs ? result.body.result.songs : [];

  let mapped = songs.map(s => {
    return mapSongRecord(s);
  });

  // 兜底: 补齐缺失的封面
  const missing = mapped.filter(s => !s.cover).map(s => s.id);
  if (missing.length) {
    try {
      console.log('[Search] backfilling covers for', missing.length, 'songs');
      const dd = await song_detail({ ids: missing.join(','), cookie: userCookie });
      const songsArr = (dd.body && dd.body.songs) || [];
      const idToPic = {};
      songsArr.forEach(s => {
        const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
        if (pic) idToPic[s.id] = pic;
      });
      mapped = mapped.map(s => s.cover ? s : { ...s, cover: idToPic[s.id] || '' });
    } catch (e) { console.warn('[Search] backfill failed:', e.message); }
  }

  return mapped;
}

async function handleDiscoverHome() {
  const info = await getLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  const tasks = [
    personalized({ limit: 8, cookie: userCookie, timestamp: Date.now() }),
    dj_hot({ limit: 6, offset: 0, cookie: userCookie, timestamp: Date.now() }),
    recommend_resource({ cookie: userCookie, timestamp: Date.now() }),
    recommend_songs({ cookie: userCookie, timestamp: Date.now() }),
  ];
  const result = await Promise.allSettled(tasks);

  const personalizedBody = result[0].status === 'fulfilled' && result[0].value && result[0].value.body || {};
  const publicPlaylists = (personalizedBody.result || personalizedBody.data || [])
    .map(pl => mapDiscoverPlaylist(pl, '推荐歌单'))
    .filter(pl => pl.id && pl.name)
    .slice(0, 8);

  const podcastBody = result[1].status === 'fulfilled' && result[1].value && result[1].value.body || {};
  const podcastRaw = podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data || [];
  const podcasts = (Array.isArray(podcastRaw) ? podcastRaw : [])
    .map(mapPodcastRadio)
    .filter(p => p.id && !isLowSignalPodcastItem(p))
    .slice(0, 6);

  let privatePlaylists = [];
  if (result[2].status === 'fulfilled' && result[2].value) {
    const body = result[2].value.body || {};
    const raw = body.recommend || body.data || [];
    privatePlaylists = (Array.isArray(raw) ? raw : [])
      .map(pl => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter(pl => pl.id && pl.name)
      .slice(0, 6);
  }

  let dailySongs = [];
  if (result[3].status === 'fulfilled' && result[3].value) {
    const body = result[3].value.body || {};
    const raw = body.data && (body.data.dailySongs || body.data.recommend) || body.recommend || [];
    dailySongs = (Array.isArray(raw) ? raw : [])
      .map(mapSongRecord)
      .filter(song => song.id && song.name)
      .slice(0, 12);
  }

  return {
    loggedIn,
    user: loggedIn ? { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' } : null,
    dailySongs,
    playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
    podcasts,
    updatedAt: Date.now(),
  };
}

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
};

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        resolve(text);
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from ' + targetUrl);
    err.cause = e;
    throw err;
  }
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  switch (Number(code)) {
    case 0: return '晴';
    case 1: return '晴间多云';
    case 2: return '多云';
    case 3: return '阴';
    // Compatibility for providers that expose WMO haze as code 5.
    case 5: return '霾';
    case 45: return '雾';
    case 48: return '雾凇';
    case 51: return '小毛毛雨';
    case 53: return '中毛毛雨';
    case 55: return '大毛毛雨';
    case 56: return '小冻毛毛雨';
    case 57: return '大冻毛毛雨';
    case 61: return '小雨';
    case 63: return '中雨';
    case 65: return '大雨';
    case 66: return '小冻雨';
    case 67: return '大冻雨';
    case 71: return '小雪';
    case 73: return '中雪';
    case 75: return '大雪';
    case 77: return '米雪';
    case 80: return '小阵雨';
    case 81: return '中阵雨';
    case 82: return '暴雨';
    case 85: return '小阵雪';
    case 86: return '大阵雪';
    case 95: return '雷雨';
    case 96: return '雷阵雨伴小冰雹';
    case 99: return '雷阵雨伴大冰雹';
    default: return '未知天气';
  }
}

function weatherServiceError(error) {
  const existing = String(error && error.code || '');
  if (existing === 'WEATHER_CITY_NOT_FOUND' || existing === 'WEATHER_DATA_INVALID') {
    return { code: existing, status: existing === 'WEATHER_CITY_NOT_FOUND' ? 404 : 502 };
  }
  const message = String(error && error.message || '');
  if (/timeout|aborted/i.test(message)) return { code: 'WEATHER_REQUEST_TIMEOUT', status: 504 };
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|socket/i.test(message)) {
    return { code: 'WEATHER_NETWORK_ERROR', status: 502 };
  }
  return { code: 'WEATHER_PROVIDER_ERROR', status: 502 };
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

async function resolveOpenMeteoLocation(query) {
  const raw = String(query || '').trim();
  if (!raw) return WEATHER_DEFAULT_LOCATION;
  const cacheKey = raw.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const cached = weatherLocationCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < WEATHER_LOCATION_CACHE_TTL_MS) return { ...cached.value };
  if (weatherLocationInFlight.has(cacheKey)) return weatherLocationInFlight.get(cacheKey);
  const request = (async () => {
    const tokens = raw.match(/[^省市区县州盟旗]{2,12}[省市区县州盟旗]/g) || [];
    const candidates = [raw];
    tokens.slice().reverse().forEach(token => {
      candidates.push(token, token.slice(0, -1));
    });
    for (const candidate of Array.from(new Set(candidates.map(value => value.trim()).filter(Boolean)))) {
      const u = new URL(OPEN_METEO_GEOCODE_URL);
      u.searchParams.set('name', candidate);
      u.searchParams.set('count', '5');
      u.searchParams.set('language', 'zh');
      u.searchParams.set('format', 'json');
      const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
      const results = body && Array.isArray(body.results) ? body.results : [];
      const first = /[\u3400-\u9fff]/u.test(raw)
        ? results.find(item => String(item.country_code || '').toUpperCase() === 'CN') || results[0]
        : results[0];
      if (!first) continue;
      const location = {
        name: first.name || candidate,
        country: first.country || '',
        admin1: first.admin1 || '',
        latitude: first.latitude,
        longitude: first.longitude,
        timezone: first.timezone || 'auto',
        query: raw,
      };
      setBoundedWeatherCache(weatherLocationCache, cacheKey, { savedAt: Date.now(), value: location });
      return location;
    }
    const error = new Error('WEATHER_CITY_NOT_FOUND');
    error.code = 'WEATHER_CITY_NOT_FOUND';
    throw error;
  })();
  weatherLocationInFlight.set(cacheKey, request);
  request.finally(() => {
    if (weatherLocationInFlight.get(cacheKey) === request) weatherLocationInFlight.delete(cacheKey);
  }).catch(() => {});
  return request;
}

async function fetchOpenMeteoWeather(params) {
  params = params || {};
  let location;
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    location = {
      name: String(params.city || params.name || '当前位置').trim() || '当前位置',
      country: '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || 'auto',
    };
  } else {
    location = await resolveOpenMeteoLocation(params.city || params.q || params.location);
  }
  const u = new URL(OPEN_METEO_FORECAST_URL);
  const cacheKey = [Number(location.latitude).toFixed(3), Number(location.longitude).toFixed(3), location.timezone || 'auto'].join(':');
  const cached = weatherCache.get(cacheKey);
  if (!params.force && cached && Date.now() - cached.savedAt < WEATHER_CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max');
  u.searchParams.set('forecast_days', '7');
  u.searchParams.set('timezone', location.timezone || 'auto');
  let refresh = weatherRefreshInFlight.get(cacheKey);
  if (!refresh) {
    refresh = (async () => {
      const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
      const cur = body && body.current || {};
      const daily = body && body.daily || {};
      const currentWeatherCode = Number(cur.weather_code);
      if (!Number.isInteger(currentWeatherCode) || openMeteoWeatherLabel(currentWeatherCode) === '未知天气') {
        const error = new Error('WEATHER_DATA_INVALID');
        error.code = 'WEATHER_DATA_INVALID';
        throw error;
      }
      const weather = {
        provider: 'open-meteo',
        location: {
          name: location.name,
          country: location.country || '',
          admin1: location.admin1 || '',
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: body.timezone || location.timezone || '',
          fallback: !!location.fallback,
        },
        label: openMeteoWeatherLabel(currentWeatherCode),
        weatherCode: currentWeatherCode,
        temperature: Number(cur.temperature_2m),
        apparentTemperature: Number(cur.apparent_temperature),
        humidity: Number(cur.relative_humidity_2m),
        precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
        cloudCover: Number(cur.cloud_cover),
        windSpeed: Number(cur.wind_speed_10m),
        windDirection: Number(cur.wind_direction_10m),
        windGusts: Number(cur.wind_gusts_10m),
        isDay: Number(cur.is_day),
        time: cur.time || '',
        updatedAt: Date.now(),
        forecast: (daily.time || []).map((date, index) => ({
          date,
          label: openMeteoWeatherLabel(daily.weather_code && daily.weather_code[index]),
          weatherCode: Number(daily.weather_code && daily.weather_code[index]),
          temperatureMax: Number(daily.temperature_2m_max && daily.temperature_2m_max[index]),
          temperatureMin: Number(daily.temperature_2m_min && daily.temperature_2m_min[index]),
          sunrise: daily.sunrise && daily.sunrise[index] || '',
          sunset: daily.sunset && daily.sunset[index] || '',
          windSpeedMax: Number(daily.wind_speed_10m_max && daily.wind_speed_10m_max[index]),
          windDirection: Number(daily.wind_direction_10m_dominant && daily.wind_direction_10m_dominant[index]),
          precipitationProbability: Number(daily.precipitation_probability_max && daily.precipitation_probability_max[index]),
        })),
      };
      weather.mood = buildWeatherMood(weather);
      setBoundedWeatherCache(weatherCache, cacheKey, { savedAt: Date.now(), value: weather });
      return weather;
    })();
    weatherRefreshInFlight.set(cacheKey, refresh);
    refresh.finally(() => {
      if (weatherRefreshInFlight.get(cacheKey) === refresh) weatherRefreshInFlight.delete(cacheKey);
    }).catch(() => {});
  }
  if (!params.force && cached && cached.value) {
    refresh.catch(() => {});
    return { ...cached.value, cached: true, stale: true, revalidating: true };
  }
  try {
    return await refresh;
  } catch (error) {
    if (cached && cached.value) return { ...cached.value, cached: true, stale: true };
    throw error;
  }
}

async function fetchIpWeatherLocation() {
  if (weatherIpLocationCache && Date.now() - weatherIpLocationCache.savedAt < WEATHER_CACHE_TTL_MS) {
    return { ...weatherIpLocationCache.value, cached: true };
  }
  if (weatherIpLocationInFlight) return weatherIpLocationInFlight;
  const request = (async () => {
    const u = new URL(WEATHER_IP_LOCATION_URL);
    const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
    if (!body || body.success === false || !Number.isFinite(Number(body.latitude)) || !Number.isFinite(Number(body.longitude))) {
      const err = new Error(body && body.message || 'IP_LOCATION_FAILED');
      err.body = body;
      throw err;
    }
    const location = {
      provider: 'ipwho.is',
      city: body.city || WEATHER_DEFAULT_LOCATION.name,
      region: body.region || '',
      country: body.country || '',
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      timezone: body.timezone && body.timezone.id || 'auto',
      ip: body.ip || '',
    };
    weatherIpLocationCache = { savedAt: Date.now(), value: location };
    return location;
  })();
  weatherIpLocationInFlight = request;
  request.finally(() => {
    if (weatherIpLocationInFlight === request) weatherIpLocationInFlight = null;
  }).catch(() => {});
  return request;
}

function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

function uniqueSongsByKey(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    const key = String(song && (song.id || song.name + '|' + song.artist) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function tagWeatherPoolSongs(songs, source) {
  return (songs || []).map(song => ({ ...song, weatherSource: source }));
}

async function fetchWeatherPlaylistSongs(playlist, limit) {
  const id = playlist && playlist.id;
  if (!id) return [];
  let rawTracks = [];
  try {
    if (typeof playlist_track_all === 'function') {
      const all = await playlist_track_all({ id, limit: limit || 36, offset: 0, cookie: userCookie, timestamp: Date.now() });
      rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
    }
  } catch (e) {
    console.warn('[WeatherRadio] playlist_track_all failed:', playlist && playlist.name, e.message);
  }
  if (!rawTracks.length && typeof playlist_detail === 'function') {
    try {
      const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
      const pl = (detail.body && detail.body.playlist) || {};
      rawTracks = pl.tracks || [];
    } catch (e) {
      console.warn('[WeatherRadio] playlist_detail failed:', playlist && playlist.name, e.message);
    }
  }
  return rawTracks.map(mapSongRecord).filter(song => song.id && song.name).slice(0, limit || 36);
}

async function filterLikelyPlayableWeatherSongs(songs) {
  const source = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .slice(0, 24);
  const playable = [];
  const fallback = source.slice(0, 24);
  for (let i = 0; i < source.length; i += 4) {
    const chunk = source.slice(i, i + 4);
    const settled = await Promise.allSettled(chunk.map(async song => {
      const info = await handleSongUrl(song.id, { loggedIn: !!userCookie }, 'standard');
      return info && info.url ? song : null;
    }));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) playable.push(result.value);
      else if (result.status === 'rejected') console.warn('[WeatherRadio] playable probe failed:', chunk[idx] && chunk[idx].name, result.reason && result.reason.message);
    });
    if (playable.length >= 12) break;
  }
  return (playable.length ? playable : fallback).slice(0, 24);
}

function isLowSignalWeatherSong(song) {
  const text = String([
    song && song.name,
    song && song.artist,
    song && song.album,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!text) return true;
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true;
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true;
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true;
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true;
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text)) return true;
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true;
  return false;
}

function scoreWeatherSong(song, mood) {
  const text = String((song && song.name || '') + ' ' + (song && song.artist || '') + ' ' + (song && song.album || '')).toLowerCase();
  let score = 0;
  if (song && song.cover) score += 4;
  if (song && song.duration) score += 2;
  if (song && song.weatherSource === 'daily') score += 6;
  if (song && song.weatherSource === 'private') score += 4;
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text)) score += 10;
  const key = String(mood && mood.key || '');
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5;
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5;
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5;
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5;
  return score;
}

function weatherArtistKey(song) {
  const raw = String(song && song.artist || song && song.name || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return raw.trim().toLowerCase() || 'unknown';
}

function weatherTitleKey(song) {
  return String(song && song.name || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim();
}

function uniqueWeatherTitles(sorted) {
  const seen = new Set();
  const out = [];
  (sorted || []).forEach(song => {
    const key = weatherTitleKey(song);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(song);
  });
  return out;
}

function diversifyWeatherSongs(sorted, artistLimit) {
  const primary = [];
  const deferred = [];
  const counts = new Map();
  (sorted || []).forEach(song => {
    const key = weatherArtistKey(song);
    const count = counts.get(key) || 0;
    if (count < artistLimit) {
      primary.push(song);
      counts.set(key, count + 1);
    } else {
      deferred.push(song);
    }
  });
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length));
}

function orderWeatherSongs(songs, mood) {
  const sorted = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood));
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2);
}

async function buildWeatherRadio(params) {
  let weather;
  try {
    weather = await fetchOpenMeteoWeather(params);
  } catch (e) {
    console.warn('[WeatherRadio] weather provider failed, using fallback radio:', e.message);
    weather = fallbackWeatherForRadio(params, e);
  }
  const queries = weatherRadioSeedQueries(weather.mood);
  let songs = [];
  const settled = await Promise.allSettled(queries.slice(0, 4).map(q => handleSearch(q, 6)));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  if (songs.length < 10 && weather.mood && Array.isArray(weather.mood.keywords)) {
    const more = await Promise.allSettled(weather.mood.keywords.slice(0, 2).map(q => handleSearch(q, 6)));
    more.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
    });
  }
  songs = orderWeatherSongs(songs, weather.mood);
  return {
    ok: true,
    weather,
    radio: {
      title: weather.mood.title,
      subtitle: weather.mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      updatedAt: Date.now(),
    },
  };
}

function parseJSONText(text) {
  const raw = String(text || '').trim();
  const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1');
  return JSON.parse(json);
}

async function qqMusicRequest(payload, opts) {
  opts = opts || {};
  const body = JSON.stringify(payload);
  const headers = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (opts.cookie && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(QQ_MUSICU_URL, {
    method: 'POST',
    headers,
  }, body);
  return parseJSONText(text);
}

function normalizeQQProfile(body, cookieObj) {
  cookieObj = cookieObj || qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
  const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '';
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieObj, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin);
  let vipType = Number(
    cookieObj.vipType || cookieObj.vip_type ||
    data.vipType || data.vip_type || data.viptype || data.music_vip_level || data.green_vip_level || data.luxury_vip_level ||
    creator.vipType || creator.vip_type || creator.music_vip_level || creator.green_vip_level || creator.luxury_vip_level ||
    vipInfo.vipType || vipInfo.vip_type || vipInfo.music_vip_level || vipInfo.green_vip_level || vipInfo.luxury_vip_level || 0
  ) || 0;
  if (!vipType) {
    const vipFlag = data.isVip || data.is_vip || data.vipFlag || data.vipflag || creator.isVip || creator.is_vip || vipInfo.isVip || vipInfo.is_vip || vipInfo.vipFlag;
    if (vipFlag === true || Number(vipFlag) > 0 || String(vipFlag || '').toLowerCase() === 'true') vipType = 1;
  }
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
    preview: false,
    userId: uin,
    nickname: nick || (uin ? ('QQ ' + uin) : 'QQ 音乐'),
    avatar,
    vipType,
    hasCookie: !!qqCookie,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
  };
}

async function getQQLoginInfo() {
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, sessionValid: false, hasCookie: !!qqCookie };
  const fallback = normalizeQQProfile(null, cookieObj);
  let authUser;
  let authenticatedUin;
  try {
    const authBody = await qqMusicRequest({
      comm: { ct: 24, cv: 0, uin },
      req_0: {
        module: 'music.UserInfo.userInfoServer',
        method: 'GetLoginUserInfo',
        param: {},
      },
    }, { cookie: true });
    const authResult = authBody && authBody.req_0 || {};
    const authData = authResult.data || {};
    authUser = authData.user_info || authData.userInfo || authData.user || authData;
    authenticatedUin = normalizeQQUin(authUser.uin || authUser.userId || authUser.userid || authData.uin || '');
    const authCode = Number(authResult.code != null ? authResult.code : authBody && authBody.code);
    const authResultCode = Number(authResult.result != null ? authResult.result : authData.result);
    if (authCode === 301 || authCode === 401 || authResultCode === 301 || authResultCode === 401
        || (authenticatedUin && authenticatedUin !== normalizeQQUin(uin))) {
      saveQQCookie('');
      return { ...fallback, loggedIn: false, sessionValid: false, profileUnavailable: true, error: 'QQ_SESSION_INVALID' };
    }
    if (authCode !== 0 || !authenticatedUin) {
      return { ...fallback, loggedIn: true, sessionValid: false, profileUnavailable: true, error: 'QQ_SESSION_VALIDATION_UNAVAILABLE' };
    }
  } catch (e) {
    const code = Number(e && (e.statusCode || e.status || e.code) || 0);
    if (code === 301 || code === 401) {
      saveQQCookie('');
      return { ...fallback, loggedIn: false, sessionValid: false, profileUnavailable: true, error: 'QQ_SESSION_INVALID' };
    }
    return { ...fallback, loggedIn: true, sessionValid: false, profileUnavailable: true, error: 'QQ_SESSION_VALIDATION_UNAVAILABLE' };
  }
  let info = fallback;
  try {
    const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
    u.searchParams.set('cid', '205360838');
    u.searchParams.set('userid', uin);
    u.searchParams.set('reqfrom', '1');
    u.searchParams.set('g_tk', '5381');
    u.searchParams.set('loginUin', uin);
    u.searchParams.set('hostUin', '0');
    u.searchParams.set('format', 'json');
    u.searchParams.set('inCharset', 'utf8');
    u.searchParams.set('outCharset', 'utf-8');
    u.searchParams.set('notice', '0');
    u.searchParams.set('platform', 'yqq.json');
    u.searchParams.set('needNewCode', '0');
    const text = await requestText(u.toString(), {
      headers: { ...QQ_HEADERS, Cookie: qqCookie },
    });
    const body = parseJSONText(text);
    if (body && (Number(body.code) === 301 || Number(body.code) === 401
        || Number(body.result) === 301 || Number(body.result) === 401)) {
      saveQQCookie('');
      return { ...fallback, loggedIn: false, sessionValid: false, profileUnavailable: true, error: 'QQ_SESSION_INVALID' };
    }
    info = normalizeQQProfile(body, cookieObj);
  } catch (e) {
    console.warn('[QQLogin] optional profile refresh failed');
  }
  return {
    ...info,
    loggedIn: true,
    sessionValid: true,
    profileVerified: true,
    userId: authenticatedUin,
    nickname: info.nickname || authUser.nick || authUser.nickname || ('QQ ' + authenticatedUin),
    avatar: info.avatar || authUser.headpic || authUser.avatar || '',
  };
}

async function qqGetJSON(targetUrl, params, opts) {
  opts = opts || {};
  const u = new URL(targetUrl);
  Object.keys(params || {}).forEach(k => {
    if (params[k] != null) u.searchParams.set(k, String(params[k]));
  });
  const headers = { ...QQ_HEADERS, ...(opts.headers || {}) };
  if (opts.cookie !== false && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(u.toString(), { headers });
  return parseJSONText(text);
}

function audioProxyHeadersFor(audioUrl, range) {
  const headers = { 'User-Agent': UA };
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host === 'music.163.com' || host.endsWith('.music.163.com') || host.endsWith('.music.126.net')) {
      headers.Referer = 'https://music.163.com/';
    } else if (host === 'qq.com' || host.endsWith('.qq.com') || host === 'qpic.cn' || host.endsWith('.qpic.cn')
      || host === 'gtimg.cn' || host.endsWith('.gtimg.cn')) {
      headers.Referer = 'https://y.qq.com/';
    } else if (host === 'kugou.com' || host.endsWith('.kugou.com') || host.endsWith('.kgimg.com')) {
      headers.Referer = 'https://www.kugou.com/';
    } else if (host === 'qishui.com' || host.endsWith('.qishui.com') || host === 'douyinvod.com' || host.endsWith('.douyinvod.com')
      || host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'byteimg.com' || host.endsWith('.byteimg.com')
      || host === 'bytedance.com' || host.endsWith('.bytedance.com') || host === 'bytecdn.cn' || host.endsWith('.bytecdn.cn')
      || host === 'ibytedtos.com' || host.endsWith('.ibytedtos.com') || host === 'bytedanceapi.com' || host.endsWith('.bytedanceapi.com')
      || host === 'pstatp.com' || host.endsWith('.pstatp.com') || host === 'volccdn.com' || host.endsWith('.volccdn.com')) {
      headers.Referer = 'https://www.qishui.com/';
    }
  } catch (e) {}
  if (range) headers.Range = range;
  return headers;
}

function audioContentTypeForUrl(audioUrl, upstreamType) {
  const normalizedUpstreamType = String(upstreamType || '').split(';')[0].trim().toLowerCase();
  if (normalizedUpstreamType && normalizedUpstreamType !== 'application/octet-stream' && normalizedUpstreamType !== 'binary/octet-stream') {
    return upstreamType;
  }
  let pathname = '';
  try { pathname = new URL(audioUrl).pathname.toLowerCase(); } catch (e) {}
  if (/\.flac$/.test(pathname)) return 'audio/flac';
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
  if (/\.ogg$/.test(pathname)) return 'audio/ogg';
  if (/\.wav$/.test(pathname)) return 'audio/wav';
  return upstreamType || 'audio/mpeg';
}

function validateRemoteAudioUrl(input) {
  const parsed = new URL(String(input || ''));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('AUDIO_URL_PROTOCOL_NOT_ALLOWED');
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateV4 = /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '0.0.0.0';
  const privateV6 = host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe8[0-9a-f]:/i.test(host);
  if (!host || host === 'localhost' || host.endsWith('.local') || privateV4 || privateV6) {
    throw new Error('AUDIO_URL_HOST_NOT_ALLOWED');
  }
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function mapQQPlaylist(pl, kind, currentUserId) {
  pl = pl || {};
  const id = pl.dissid || pl.tid || pl.dirid || pl.id || pl.diss_id;
  const ownership = kind === 'created' ? 'owned' : (kind === 'collect' ? 'subscribed' : 'unknown');
  const creator = pl.creator && typeof pl.creator === 'object' ? pl.creator : {};
  const ownerIdValue = pl.uin ?? pl.owner_uin ?? pl.hostuin ?? pl.creator_uin
    ?? creator.uin ?? creator.userId ?? creator.id ?? (ownership === 'owned' ? currentUserId : '');
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    name: pl.diss_name || pl.name || pl.title || '',
    cover: pl.diss_cover || pl.logo || pl.picurl || pl.cover || '',
    trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || 0,
    playCount: pl.listen_num || pl.visitnum || pl.play_count || 0,
    creator: pl.hostname || pl.nick || pl.creator || 'QQ 音乐',
    ownerId: ownerIdValue || ownerIdValue === 0 ? String(ownerIdValue) : '',
    specialType: 0,
    ...playlistOwnershipMetadata(ownership, {
      mutationReason: 'PLATFORM_MUTATION_UNSUPPORTED',
    }),
  };
}

function mapNeteaseUserPlaylist(pl, currentUserId) {
  pl = pl || {};
  const creator = pl.creator && typeof pl.creator === 'object' ? pl.creator : {};
  const ownerIdValue = pl.userId ?? pl.user_id ?? creator.userId ?? creator.user_id ?? creator.id ?? '';
  const ownerId = ownerIdValue || ownerIdValue === 0 ? String(ownerIdValue) : '';
  const currentId = currentUserId || currentUserId === 0 ? String(currentUserId) : '';
  const subscribed = pl.subscribed === true;
  const ownership = subscribed ? 'subscribed' : (ownerId && currentId && ownerId === currentId ? 'owned' : 'unknown');
  const specialType = Number(pl.specialType || 0) || 0;
  return {
    provider: 'netease',
    source: 'netease',
    id: pl.id == null ? '' : String(pl.id),
    playlistId: pl.id == null ? '' : String(pl.id),
    name: pl.name || '',
    cover: pl.coverImgUrl || '',
    trackCount: pl.trackCount || 0,
    songCount: pl.trackCount || 0,
    playCount: pl.playCount || 0,
    creator: creator.nickname || '',
    ownerId,
    specialType,
    ...playlistOwnershipMetadata(ownership, {
      deleteSupported: true,
      unsubscribeSupported: true,
    }),
  };
}

function playlistMutationFailure(code, message, status, details) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = status || 500;
  error.details = details || null;
  return error;
}

function mutationIdentity(value) {
  if (value && typeof value === 'object') {
    value = value.userId ?? value.user_id ?? value.accountId ?? value.account_id ?? value.id ?? '';
  }
  return String(value == null ? '' : value).replace(/[\r\n\t]/g, '').trim().slice(0, 128);
}

function mutationField(body, names) {
  body = body && typeof body === 'object' ? body : {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(body, name)) return { present: true, value: body[name] };
  }
  return { present: false, value: undefined };
}

function validatePlaylistMutationIntent(body, target, currentAccountId, expectedOperation) {
  const accountField = mutationField(body, ['currentAccount', 'currentAccountId']);
  const ownerField = mutationField(body, ['owner', 'ownerId']);
  const ownershipField = mutationField(body, ['ownership']);
  const operationField = mutationField(body, ['operation']);
  const missing = [];
  if (!accountField.present) missing.push('currentAccount');
  if (!ownerField.present) missing.push('owner');
  if (!ownershipField.present) missing.push('ownership');
  if (!operationField.present) missing.push('operation');
  if (missing.length) {
    throw playlistMutationFailure('PLAYLIST_MUTATION_CONTEXT_REQUIRED', '歌单操作缺少不可变账号上下文', 400, { missing });
  }

  const actualAccount = mutationIdentity(currentAccountId);
  const requestedAccount = mutationIdentity(accountField.value);
  if (!actualAccount || requestedAccount !== actualAccount) {
    throw playlistMutationFailure('PLAYLIST_ACCOUNT_MISMATCH', '当前平台账号与确认时账号不一致，未执行操作', 409, {
      currentAccountId: actualAccount,
    });
  }

  const actualOwner = mutationIdentity(target && target.ownerId);
  if (mutationIdentity(ownerField.value) !== actualOwner) {
    throw playlistMutationFailure('PLAYLIST_OWNER_MISMATCH', '歌单所有者与确认时不一致，未执行操作', 409, {
      currentAccountId: actualAccount,
      ownerId: actualOwner,
    });
  }

  const actualOwnership = /^(owned|subscribed)$/.test(String(target && target.ownership || ''))
    ? String(target.ownership)
    : 'unknown';
  if (String(ownershipField.value || '').trim().toLowerCase() !== actualOwnership) {
    throw playlistMutationFailure('PLAYLIST_OWNERSHIP_MISMATCH', '歌单归属状态已变化，未执行操作', 409, {
      currentAccountId: actualAccount,
      ownerId: actualOwner,
      ownership: actualOwnership,
    });
  }

  const requestedOperation = String(operationField.value || '').trim().toLowerCase();
  if (requestedOperation !== expectedOperation) {
    throw playlistMutationFailure('PLAYLIST_OPERATION_MISMATCH', '歌单操作类型与当前能力不一致，未执行操作', 409, {
      currentAccountId: actualAccount,
      ownerId: actualOwner,
      ownership: actualOwnership,
      operation: expectedOperation,
    });
  }
  return { currentAccountId: actualAccount, ownerId: actualOwner, ownership: actualOwnership };
}

function localOnlyPlaylistMutationResult(provider, id, context, reason) {
  return {
    ok: true,
    provider,
    id: String(id),
    currentAccountId: context.currentAccountId,
    ownerId: context.ownerId,
    ownership: context.ownership,
    operation: 'remove-local',
    localOnly: true,
    remoteMutated: false,
    platformUnchanged: true,
    reason: reason || 'PLATFORM_MUTATION_UNSUPPORTED',
    notice: '仅从LF移除，平台端未删除',
  };
}

async function resolveNeteasePlaylistMutationTarget(id, account) {
  const result = await user_playlist({
    uid: account.userId,
    limit: 1000,
    offset: 0,
    cookie: userCookie,
    timestamp: Date.now(),
  });
  const listCode = normalizeApiCode(result);
  if (listCode !== 200) {
    throw playlistMutationFailure(
      'PLAYLIST_LIST_REFRESH_FAILED',
      normalizeApiMessage(result) || '无法重新校验当前账号歌单',
      listCode === 401 || listCode === 301 ? 401 : 502,
      { platformCode: listCode }
    );
  }
  const playlists = (result.body && result.body.playlist) || [];
  const raw = playlists.find(item => String(item && item.id || '') === String(id));
  if (!raw) {
    throw playlistMutationFailure('PLAYLIST_NOT_FOUND', '当前账号中未找到该歌单', 404);
  }
  const target = mapNeteaseUserPlaylist(raw, account.userId);
  if (target.ownership === 'unknown') {
    throw playlistMutationFailure('PLAYLIST_OWNERSHIP_UNKNOWN', '无法确认该歌单属于当前账号，未执行删除', 403, { target });
  }
  return target;
}

async function mutateNeteasePlaylist(target) {
  const params = { id: target.id, cookie: userCookie, timestamp: Date.now() };
  const operation = target.subscribed ? 'unsubscribe' : 'delete';
  const result = operation === 'unsubscribe'
    ? await playlist_subscribe({ ...params, t: 0 })
    : await playlist_delete(params);
  const code = normalizeApiCode(result);
  if (code !== 200) {
    const message = normalizeApiMessage(result);
    const authenticationFailed = code === 301 || code === 401;
    const permissionDenied = !authenticationFailed && (code === 403
      || /(?:permission|forbidden|denied|not\s+allowed|not\s+permitted|无权|权限|禁止|不允许|不能删除|无法删除|受保护)/i.test(message));
    const error = playlistMutationFailure(
      'PLATFORM_MUTATION_FAILED',
      normalizeApiMessage(result) || '平台未确认歌单删除成功',
      authenticationFailed ? 401 : (permissionDenied ? 403 : 502),
      { operation, platformCode: code, body: result.body || result }
    );
    error.platformDenied = permissionDenied;
    throw error;
  }
  return {
    ok: true,
    provider: 'netease',
    id: target.id,
    operation,
    ownership: target.ownership,
    ownerId: target.ownerId || '',
    localOnly: false,
    remoteMutated: true,
    platformUnchanged: false,
    code,
  };
}

function playlistMutationLoginFailure(provider) {
  return playlistMutationFailure('LOGIN_REQUIRED', '当前平台登录已失效，未执行歌单操作', 401, { provider });
}

function playlistMutationAccountFromSession(provider, sessionState) {
  const profile = sessionState && sessionState.profile && typeof sessionState.profile === 'object'
    ? sessionState.profile
    : {};
  const cookies = sessionState && sessionState.cookies && typeof sessionState.cookies === 'object'
    ? sessionState.cookies
    : {};
  const currentAccountId = mutationIdentity(profile.userId ?? profile.id ?? cookies.userid);
  if (!sessionState || sessionState.loggedIn !== true) throw playlistMutationLoginFailure(provider);
  if (!currentAccountId) {
    throw playlistMutationFailure('PLATFORM_ACCOUNT_ID_UNAVAILABLE', '无法验证当前平台账号，未执行歌单操作', 409, { provider });
  }
  return currentAccountId;
}

async function currentLocalOnlyMutationAccount(provider) {
  if (provider === 'qq') {
    const status = await getQQLoginInfo();
    if (!status || status.loggedIn !== true || !status.userId) throw playlistMutationLoginFailure(provider);
    return mutationIdentity(status.userId);
  }
  if (provider === 'kugou') {
    return playlistMutationAccountFromSession(provider, musicPlatformService.exportKugouSession());
  }
  if (provider === 'kugou_concept') {
    return playlistMutationAccountFromSession(provider, musicPlatformService.exportKugouConceptSession());
  }
  if (provider === 'qishui') {
    return playlistMutationAccountFromSession(provider, musicPlatformService.exportQishuiSession());
  }
  throw playlistMutationFailure('PLATFORM_MUTATION_UNSUPPORTED', '当前平台不支持该歌单操作', 409, { provider });
}

async function resolveLocalOnlyPlaylistMutationTarget(provider, id) {
  let currentAccountId = '';
  let result;
  try {
    if (provider === 'qq') {
      currentAccountId = await currentLocalOnlyMutationAccount(provider);
      result = await handleQQUserPlaylists();
    } else if (provider === 'kugou') {
      currentAccountId = await currentLocalOnlyMutationAccount(provider);
      result = await musicPlatformService.getKugouPlaylists(null, 300);
    } else if (provider === 'kugou_concept') {
      currentAccountId = await currentLocalOnlyMutationAccount(provider);
      result = await musicPlatformService.getKugouConceptPlaylists(null, 300);
    } else if (provider === 'qishui') {
      currentAccountId = await currentLocalOnlyMutationAccount(provider);
      result = await musicPlatformService.getQishuiPlaylists(null, 100);
    } else {
      throw playlistMutationFailure('PLATFORM_MUTATION_UNSUPPORTED', '当前平台不支持该歌单操作', 409, { provider });
    }
  } catch (error) {
    if (error && error.code && error.httpStatus) throw error;
    const message = String(error && error.message || 'PLAYLIST_LIST_REFRESH_FAILED');
    if (/NOT_LOGGED_IN|SESSION_INVALID|AUTH|LOGIN_REQUIRED/i.test(message)) throw playlistMutationLoginFailure(provider);
    throw playlistMutationFailure('PLAYLIST_LIST_REFRESH_FAILED', '无法重新校验当前平台账号歌单，未执行操作', 502, {
      provider,
      cause: message.slice(0, 160),
      currentAccountId,
    });
  }

  let confirmedAccountId;
  try {
    confirmedAccountId = await currentLocalOnlyMutationAccount(provider);
  } catch (error) {
    if (error && error.code && error.httpStatus) throw error;
    throw playlistMutationFailure('PLAYLIST_ACCOUNT_REVALIDATION_FAILED', '无法再次验证当前平台账号，未执行操作', 502, {
      provider,
      currentAccountId,
    });
  }
  if (confirmedAccountId !== currentAccountId) {
    throw playlistMutationFailure('PLAYLIST_ACCOUNT_CHANGED', '歌单刷新期间平台账号已切换，未执行操作', 409, {
      provider,
      currentAccountId: confirmedAccountId,
      expectedAccountId: currentAccountId,
    });
  }

  if (!result || result.loggedIn === false) throw playlistMutationLoginFailure(provider);
  if (result.ok === false) {
    throw playlistMutationFailure('PLAYLIST_LIST_REFRESH_FAILED', '无法重新校验当前平台账号歌单，未执行操作', 502, {
      provider,
      currentAccountId,
    });
  }
  const playlists = Array.isArray(result.playlists) ? result.playlists : [];
  const target = playlists.find(item => String(item && (item.id ?? item.playlistId) || '') === String(id));
  if (!target) {
    if (provider === 'qq' && result.refreshComplete === false) {
      throw playlistMutationFailure('PLAYLIST_LIST_REFRESH_FAILED', 'QQ音乐歌单未完整刷新，未执行操作', 502, {
        provider,
        currentAccountId,
      });
    }
    throw playlistMutationFailure('PLAYLIST_NOT_FOUND', '当前账号中未找到该歌单，未执行操作', 404, {
      provider,
      currentAccountId,
    });
  }
  return { target, currentAccountId };
}

function mapQQPlaylistTrack(raw) {
  raw = raw || {};
  const track = raw.songid || raw.songmid || raw.mid || raw.name ? raw : (raw.track_info || raw.songInfo || raw.songinfo || raw.song || {});
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || track.singers || []);
  const mid = track.mid || track.songmid || raw.mid || raw.songmid || '';
  const albumMid = album.mid || track.albummid || raw.albummid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
    qqId: track.id || track.songid || raw.id || raw.songid || '',
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || '',
    name: track.name || track.songname || raw.songname || '',
    artist: artists.map(a => a.name).join(' / ') || track.singername || raw.singername || '',
    artists,
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || track.albumname || raw.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300),
    duration: (Number(track.interval || raw.interval) || 0) * 1000,
    climaxStartSec: normalizeClimaxStartSec(track, (Number(track.interval || raw.interval) || 0) * 1000),
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  };
}

async function handleQQUserPlaylists() {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
  const uin = info.userId;
  const createdReq = qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
    hostUin: 0,
    hostuin: uin,
    sin: 0,
    size: 200,
    g_tk: 5381,
    loginUin: uin,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
  const collectReq = qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
    ct: 20,
    cid: 205360956,
    userid: uin,
    reqtype: 3,
    sin: 0,
    ein: 80,
  }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
  const [createdRaw, collectRaw] = await Promise.allSettled([createdReq, collectReq]);
  const created = createdRaw.status === 'fulfilled' && createdRaw.value && createdRaw.value.data && Array.isArray(createdRaw.value.data.disslist)
    ? createdRaw.value.data.disslist.map(pl => mapQQPlaylist(pl, 'created', uin)) : [];
  const collected = collectRaw.status === 'fulfilled' && collectRaw.value && collectRaw.value.data && Array.isArray(collectRaw.value.data.cdlist)
    ? collectRaw.value.data.cdlist.map(pl => mapQQPlaylist(pl, 'collect', uin)) : [];
  const seen = new Set();
  const playlists = created.concat(collected).filter(pl => {
    if (!pl.id || !pl.name || seen.has(pl.id)) return false;
    if (isQzoneBackgroundPlaylist(pl)) return false;
    seen.add(pl.id);
    return true;
  }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
  return {
    loggedIn: true,
    provider: 'qq',
    userId: uin,
    playlists,
    refreshComplete: createdRaw.status === 'fulfilled' && collectRaw.status === 'fulfilled',
  };
}

async function handleQQPlaylistTracks(id) {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
  const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    utf8: 1,
    disstid: pid,
    loginUin: info.userId,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
  const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {};
  const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(s => s.name && (s.mid || s.id));
  const playlist = {
    provider: 'qq',
    id: pid,
    name: detail.dissname || detail.diss_name || detail.name || '',
    cover: detail.logo || detail.diss_cover || '',
    trackCount: tracks.length,
  };
  return { loggedIn: true, provider: 'qq', playlist, tracks };
}

function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000';
}

function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000';
}

function mapQQArtists(raw) {
  return (raw || [])
    .map(a => ({
      id: a && a.id,
      mid: a && a.mid,
      name: (a && (a.name || a.title)) || '',
    }))
    .filter(a => a.name);
}

function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    name: item.name || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: null,
    heat: Number(item.hot || item.listen_count || item.playCount || 0) || 0,
    officialOriginal: item.isOriginal === true || Number(item.is_original || 0) === 1,
  };
}

function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || []);
  const mid = track.mid || fallback.mid || fallback.songmid || '';
  const albumMid = album.mid || album.pmid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || fallback.qqId || fallback.id || '',
    mid,
    songmid: mid,
    mediaMid: track.file && track.file.media_mid,
    name: track.name || track.title || fallback.name || '',
    artist: artists.map(a => a.name).join(' / ') || fallback.artist || '',
    artists: artists.length ? artists : (fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || fallback.album || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || fallback.cover || '',
    duration: (Number(track.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: track.pay && Number(track.pay.pay_play) ? false : null,
    restriction: track.pay && Number(track.pay.pay_play) ? { category: 'paid_required', message: 'QQ 音乐标记该歌曲需要购买或会员权限' } : null,
    heat: Number(track.volume && (track.volume.listen_count || track.volume.play_count) || track.listen_count || fallback.heat || 0) || 0,
    officialOriginal: track.isOriginal === true || Number(track.is_original || track.origin || 0) === 1,
  };
}

async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const text = await requestText(u.toString(), { headers: QQ_HEADERS });
  const json = parseJSONText(text);
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong);
}

async function qqSongDetail(mid, fallback) {
  if (!mid) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  });
  const data = json && json.songinfo && json.songinfo.data;
  return mapQQTrack(data && data.track_info, fallback);
}

async function handleQQArtistDetail(mid, limit) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, parseInt(limit || '36', 10) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, { cookie: true });
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return { provider: 'qq', error: block && (block.message || block.msg || block.code) || 'QQ_ARTIST_DETAIL_FAILED', artist: null, songs: [] };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter(song => song && song.name && (song.mid || song.id));
  const matchedSongArtist = songs[0] && (songs[0].artists || []).find(a => a && a.mid === singerMid);
  const artistMid = info.mid || singerMid;
  const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || '';
  const totalSong = Number(data.total_song || data.song_count || 0) || songs.length;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: artistName,
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: totalSong,
      albumSize: Number(data.total_album || 0) || 0,
      mvSize: Number(data.total_mv || 0) || 0,
    },
    total: totalSong,
    songs,
  };
}

async function handleQQSearch(keywords, limit) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  console.log('[QQSearch]', kw, 'limit:', limit);
  const base = await qqSmartboxSearch(kw, limit);
  const detailed = await Promise.all(base.map(async item => {
    try { return await qqSongDetail(item.mid, item); }
    catch (e) {
      console.warn('[QQSearch] detail failed:', item.mid, e.message);
      return item;
    }
  }));
  const seen = new Set();
  return detailed.filter(song => {
    const key = song && (song.mid || song.id || (song.name + '|' + song.artist));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

async function handleQQSongUrl(mid, mediaMid, qualityPreference) {
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || '0';
  const musicKey = qqCookieMusicKey(cookieObj);
  const playbackKey = qqCookiePlaybackKey(cookieObj);
  const fileMediaMid = String(mediaMid || '').trim();
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const mediaIds = [];
  if (fileMediaMid) mediaIds.push(fileMediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param,
    },
  }, { cookie: true });
  const data = json && json.req_0 && json.req_0.data;
  const infos = (data && Array.isArray(data.midurlinfo)) ? data.midurlinfo : [];
  const info = infos.find(item => item && item.purl) || infos[0];
  const purl = info && info.purl;
  if (purl) {
    const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
    const fileMeta = fileCandidates.find(item => item.filename === info.filename) || {};
    return {
      provider: 'qq',
      url: sip + purl,
      trial: false,
      playable: true,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      requestedQuality,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map(item => item.label + ' · ' + item.filename),
    requestedQuality,
  };
}

function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.user || raw.uin || {};
  const nickname = raw.nick || raw.nickname || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户';
  const avatar = raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || '';
  const timeRaw = Number(raw.time || raw.commenttime || raw.createTime || 0) || 0;
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: raw.rootcommentcontent || raw.content || raw.comment || '',
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: raw.encrypt_uin || raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  };
}

async function handleQQSongComments(id, mid, limit, offset) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid });
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (e) {
      console.warn('[QQComments] detail fallback failed:', e.message);
    }
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
  const uin = qqCookieUin() || '0';
  const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
    cid: '205360772',
    reqtype: '2',
    biztype: '1',
    topid,
    cmd: '8',
    needmusiccrit: '0',
    pagenum: String(page),
    pagesize: String(limit || 20),
  }, { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } });
  const hotList = body && body.hot_comment && body.hot_comment.commentlist;
  const normalList = body && body.comment && body.comment.commentlist;
  const raw = (offset === 0 && Array.isArray(hotList) && hotList.length) ? hotList : (normalList || []);
  const comments = (raw || []).map(mapQQComment).filter(c => c.content);
  const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
  return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    } catch (e) {
      console.warn('[QQLyric] base64 decode failed:', e.message);
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}

function normalizeQQSongId(id) {
  const n = String(id || '').replace(/\D/g, '');
  return n ? Number(n) : 0;
}

async function handleQQLyric(mid, id) {
  const songMID = String(mid || '').trim();
  const songID = normalizeQQSongId(id);
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };

  let lyricText = '';
  let transText = '';
  let qrcText = '';
  let romaText = '';
  let source = 'qq-musicu';

  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = songID;
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, { cookie: true });
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
    qrcText = decodeQQLyricText(data && data.qrc);
    romaText = decodeQQLyricText(data && data.roma);
  } catch (e) {
    console.warn('[QQLyric] musicu failed:', e.message);
  }

  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin() || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
      source = 'qq-legacy';
    } catch (e) {
      console.warn('[QQLyric] legacy failed:', e.message);
    }
  }

  return {
    provider: 'qq',
    id: songID || '',
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    qrc: qrcText,
    roma: romaText,
    source: lyricText ? source : 'qq-empty',
  };
}

function mapPodcastRadio(r) {
  r = r || {};
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
  const id = r.id || r.rid || r.radioId;
  return {
    id,
    rid: id,
    name: r.name || r.radioName || '',
    cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
    desc: r.desc || r.description || r.rcmdText || '',
    djName: dj.nickname || r.djName || r.nickname || '',
    category: r.category || r.categoryName || '',
    programCount: r.programCount || r.programNum || r.programCnt || 0,
    subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
  };
}

function mapPodcastProgram(p, fallbackRadio) {
  p = p || {};
  const mainSong = p.mainSong || p.song || p.mainTrack || {};
  const radio = p.radio || fallbackRadio || {};
  const mappedRadio = mapPodcastRadio(radio);
  const artists = mapArtists(mainSong.ar || mainSong.artists || []);
  const album = mainSong.al || mainSong.album || {};
  const dj = p.dj || radio.dj || {};
  const playableId = mainSong.id || p.mainSongId || p.songId;
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: p.name || mainSong.name || '',
    artist: mappedRadio.name || dj.nickname || artists.map(a => a.name).join(' / ') || mappedRadio.djName || '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || album.name || 'Podcast',
    cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
    duration: p.duration || mainSong.dt || mainSong.duration || 0,
    fee: mainSong.fee,
    djName: mappedRadio.djName || dj.nickname || '',
    radioName: mappedRadio.name || '',
    desc: p.description || p.desc || '',
    createTime: p.createTime || 0,
    serialNum: p.serialNum || p.serial || 0,
  };
}

function firstArrayFrom(obj, keys) {
  obj = obj || {};
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.list)) return value.list;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.resources)) return value.resources;
  }
  return [];
}

function mapPodcastVoice(v) {
  v = v || {};
  const raw = v.resource || v.voice || v.data || v.program || v;
  const mainSong = raw.mainSong || raw.song || raw.track || {};
  const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: raw.name || raw.songName || raw.title || mainSong.name || '',
    artist: (radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice'),
    album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
    cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
    duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
    djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
    radioName: radio.name || radio.radioName || raw.podcastName || '',
    desc: raw.desc || raw.description || '',
  };
}

function mapPodcastCollectionRadio(r, key) {
  const radio = mapPodcastRadio(r);
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  };
}

function podcastCollectionMeta(key, items) {
  const meta = {
    collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
    created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
    liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
  }[key] || { key, title: key, sub: '', itemType: 'radio' };
  const first = (items || [])[0] || {};
  return {
    ...meta,
    count: (items || []).length,
    cover: first.cover || first.picUrl || first.coverUrl || '',
  };
}

async function fetchMyPodcastItems(key, info, limit, offset) {
  limit = Math.max(8, Math.min(60, Number(limit) || 30));
  offset = Math.max(0, Number(offset) || 0);
  if (key === 'collect') {
    const r = await dj_sublist({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['djRadios', 'djradios', 'radios', 'data']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'created') {
    const r = await user_audio({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'paid') {
    const r = await dj_paygift({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'liked') {
    let raw = [];
    try {
      const sati = await sati_resource_sub_list({ cookie: userCookie, timestamp: Date.now() });
      raw = firstArrayFrom(sati.body, ['data', 'resources', 'list']);
    } catch (e) {
      console.warn('[MyPodcastLiked] sati sub list failed:', e.message);
    }
    if (!raw.length) {
      try {
        const recent = await record_recent_voice({ limit, cookie: userCookie, timestamp: Date.now() });
        raw = firstArrayFrom(recent.body, ['data', 'list', 'resources']);
      } catch (e) {
        console.warn('[MyPodcastLiked] recent voice fallback failed:', e.message);
      }
    }
    return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter(x => x.id && x.name) };
  }
  return { itemType: 'radio', items: [] };
}

// ---------- 业务: 取歌曲URL (探测试听) ----------
//   返回 { url, trial, level, br }
//   trial=true 表示这是试听片段 (freeTrialInfo 非空)
async function handleSongUrl(id, loginInfo, qualityPreference) {
  console.log('[SongUrl] id:', id, 'logged-in:', !!userCookie);
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const svipReady = hasNeteaseSvip(loginInfo);
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES)
    .filter(q => !q.svip || svipReady);

  let trialFallback = null; // 兜底: 即使是试听也要能播
  let lastData = null;
  let lastError = null;

  for (const q of qualities) {
    try {
      // 优先用 v1 接口 (支持更高音质 level 字段)
      let result;
      try {
        result = await song_url_v1({ id, level: q.level, cookie: userCookie });
      } catch (e) {
        result = await song_url({ id, br: q.br, cookie: userCookie });
      }
      const d = result.body && result.body.data && result.body.data[0];
      if (d) lastData = d;
      const url = d && d.url;
      const freeTrial = d && d.freeTrialInfo;
      console.log('[SongUrl]', q.level, '->', url ? 'OK' : 'no url', freeTrial ? '(TRIAL)' : '');
      if (url && !freeTrial) {
        return { url, trial: false, playable: true, level: q.level, quality: q.label, br: d.br, requestedQuality };
      }
      if (url && freeTrial && !trialFallback) {
        trialFallback = {
          url,
          trial: true,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          trialInfo: freeTrial,
          restriction: classifyNeteasePlaybackRestriction(d, loginInfo),
        };
      }
    } catch (err) {
      lastError = err;
      console.log('[SongUrl]', q.level, 'failed:', err.message);
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo);
  return {
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: lastData && lastData.fee,
    error: lastError && lastError.message,
    requestedQuality,
  };
}

// ---------- 业务: 登录态/用户信息 ----------
function readCookieFromResponse(resp) {
  const candidates = [
    resp && resp.cookie,
    resp && resp.body && resp.body.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookies,
  ];
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate);
    if (cookie) return cookie;
  }
  return '';
}
function firstPositiveNumberFrom(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}
function collectStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => collectStringValues(value[key], out, depth + 1));
  }
  return out;
}
function collectVipStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectVipStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type/i.test(key)) {
      collectStringValues(child, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1);
    }
  });
  return out;
}
function normalizeNeteaseVip(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  extra = extra || {};
  const vipInfo = profile.vipInfo || profile.vipinfo || account.vipInfo || account.vipinfo || extra.vipInfo || extra.vipinfo || {};
  const objects = [account, profile, vipInfo, extra];
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'redVipLevel', 'red_vip_level',
    'blackVipLevel', 'black_vip_level', 'luxuryVipLevel', 'luxury_vip_level',
    'svipType', 'svip_type',
  ]);
  const text = collectVipStringValues({ account, profile, vipInfo, extra }, [], 0).join(' ').toLowerCase();
  const svipFlag = objects.some(obj => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true ||
    Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || 0) > 0
  )) || /svip|supervip|super_vip|blackvip|black_vip|黑胶svip|超级会员/.test(text);
  const vipFlag = objects.some(obj => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true ||
    Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
  )) || /vip|黑胶|会员/.test(text);
  const isSvip = svipFlag || vipType >= 10;
  const isVip = isSvip || vipFlag || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}
function normalizeLoginInfo(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || '';
  if (!(userId || userId === 0)) return { loggedIn: false };
  const vip = normalizeNeteaseVip(profile, account, extra);
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
    ...vip,
  };
}
function isNeteaseAuthInvalidPayload(payload) {
  const code = normalizeApiCode(payload) || Number(payload && (payload.statusCode || payload.code) || 0);
  return code === 301 || code === 401;
}
function emptyNeteaseLoginInfo(extra) {
  return Object.assign({
    loggedIn: false,
    sessionValid: false,
    vipType: 0,
    vipLevel: 'none',
    isVip: false,
    isSvip: false,
    vipLabel: '无VIP',
  }, extra || {});
}

async function validateNeteaseCookie(candidateCookie) {
  if (!candidateCookie) return emptyNeteaseLoginInfo();
  let validationUnavailable = false;

  // login_status 对二维码 cookie 的资料刷新通常更及时；失败时再降级到 user_account。
  try {
    const st = await login_status({ cookie: candidateCookie, timestamp: Date.now() });
    if (isNeteaseAuthInvalidPayload(st)) {
      return emptyNeteaseLoginInfo({ authInvalid: true, error: 'NETEASE_SESSION_INVALID' });
    }
    const body = st.body || {};
    const data = body.data || body;
    const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account, data);
    if (info.loggedIn) return { ...info, sessionValid: true, profileVerified: true };
  } catch (e) {
    if (isNeteaseAuthInvalidPayload(e)) {
      return emptyNeteaseLoginInfo({ authInvalid: true, error: 'NETEASE_SESSION_INVALID' });
    }
    validationUnavailable = true;
  }

  try {
    const acc = await user_account({ cookie: candidateCookie, timestamp: Date.now() });
    if (isNeteaseAuthInvalidPayload(acc)) {
      return emptyNeteaseLoginInfo({ authInvalid: true, error: 'NETEASE_SESSION_INVALID' });
    }
    const body = acc.body || {};
    const info = normalizeLoginInfo(body.profile, body.account, body);
    if (info.loggedIn) return { ...info, sessionValid: true, profileVerified: true };
  } catch (e) {
    if (isNeteaseAuthInvalidPayload(e)) {
      return emptyNeteaseLoginInfo({ authInvalid: true, error: 'NETEASE_SESSION_INVALID' });
    }
    validationUnavailable = true;
  }
  return emptyNeteaseLoginInfo({
    loggedIn: true,
    profileUnavailable: true,
    pendingProfile: !validationUnavailable,
    hasCookie: true,
    error: validationUnavailable ? 'NETEASE_SESSION_VALIDATION_UNAVAILABLE' : 'NETEASE_SESSION_UNVERIFIED',
  });
}

async function getLoginInfo() {
  const candidateCookie = userCookie;
  const info = await validateNeteaseCookie(candidateCookie);
  if (info.authInvalid === true && candidateCookie && userCookie === candidateCookie) saveCookie('');
  const publicInfo = { ...info, hasCookie: !!userCookie };
  delete publicInfo.authInvalid;
  return publicInfo;
}

async function getNeteaseCommentsForPlatform(song, limit) {
  const id = song && song.id;
  if (!id) return { provider: 'netease', comments: [], error: 'MISSING_NETEASE_SONG_ID' };
  const result = await comment_music({ id, limit, offset: 0, cookie: userCookie, timestamp: Date.now() });
  const body = result.body || result || {};
  const raw = Array.isArray(body.hotComments) && body.hotComments.length ? body.hotComments : (body.comments || []);
  const comments = raw.map(item => ({
    id: item.commentId,
    content: item.content || '',
    likedCount: Number(item.likedCount || 0) || 0,
    time: Number(item.time || 0) || 0,
    user: item.user ? {
      id: item.user.userId,
      nickname: item.user.nickname || '',
      avatar: item.user.avatarUrl || '',
    } : null,
    provider: 'netease',
    song,
  })).filter(item => item.content);
  return { provider: 'netease', id, total: Number(body.total || comments.length) || comments.length, comments, hot: true };
}

function secureNeteaseCoverUrl(value) {
  let raw = String(value || '').trim();
  if (!raw || raw.length > 2048 || /[\r\n]/.test(raw)) return '';
  if (raw.startsWith('//')) raw = 'https:' + raw;
  else if (raw.startsWith('http://')) raw = 'https://' + raw.slice(7);
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const officialAsset = host === 'music.126.net' || host.endsWith('.music.126.net')
      || host === 'music.163.com' || host.endsWith('.music.163.com');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !officialAsset) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

async function getNeteaseHotCandidates(limit) {
  const candidateLimit = Math.max(1, Math.min(30, Number(limit) || 20));
  const result = await recommend_songs({ cookie: userCookie, timestamp: Date.now() });
  const body = result.body || result || {};
  const raw = body.data && (body.data.dailySongs || body.data.recommend) || body.recommend || [];
  const mapped = (Array.isArray(raw) ? raw : [])
    .map(mapSongRecord)
    .filter(item => item.id && item.name)
    .slice(0, candidateLimit)
    .map(item => ({ ...item, cover: secureNeteaseCoverUrl(item.cover) }));
  if (!mapped.length) return [];

  const requestedIds = new Set(mapped.map(item => String(item.id)));
  const detailById = new Map();
  try {
    const detail = await song_detail({ ids: Array.from(requestedIds).join(','), cookie: userCookie, timestamp: Date.now() });
    const detailSongs = detail && detail.body && Array.isArray(detail.body.songs) ? detail.body.songs : [];
    detailSongs.forEach(song => {
      const id = String(song && song.id || '');
      if (!id || !requestedIds.has(id)) return;
      const album = song.al || song.album || {};
      detailById.set(id, secureNeteaseCoverUrl(album.picUrl || album.coverUrl || ''));
    });
  } catch (error) {
    console.warn('[HotComments] Netease song_detail cover lookup failed:', error.message);
  }
  return mapped.map(item => ({
    ...item,
    cover: detailById.get(String(item.id)) || item.cover || '',
  }));
}

async function getQQHotCandidates(limit) {
  const candidateLimit = Math.max(1, Math.min(30, Number(limit) || 20));
  const result = await handleQQUserPlaylists();
  const first = result && Array.isArray(result.playlists) && result.playlists[0];
  if (!first || !first.id) return [];
  const tracks = await handleQQPlaylistTracks(first.id);
  return (tracks && Array.isArray(tracks.tracks) ? tracks.tracks : []).slice(0, candidateLimit);
}

function playlistLinkLoaderFailure(code, message, httpStatus, details) {
  return {
    ok: false,
    code,
    error: code,
    message,
    httpStatus,
    details: details || undefined,
  };
}

function classifyPlaylistLinkUpstreamFailure(provider, code, message, loggedIn) {
  const numeric = Number(code || 0) || 0;
  const text = String(message || '');
  if (numeric === 301 || numeric === 401 || /(?:login|登录|未登录|会话)/i.test(text)) {
    return playlistLinkLoaderFailure('PLAYLIST_LOGIN_REQUIRED', '该歌单需要先登录' + (provider === 'qq' ? ' QQ 音乐' : '网易云音乐'), 401);
  }
  if (numeric === 403 || /(?:forbidden|permission|private|权限|私密)/i.test(text)) {
    return playlistLinkLoaderFailure('PLAYLIST_FORBIDDEN', '当前账号无权读取该歌单', 403);
  }
  if (numeric === 410 || /(?:deleted|removed|PLAYLIST_DELETED|已删除)/i.test(text)) {
    return playlistLinkLoaderFailure('PLAYLIST_DELETED', '该歌单已被删除', 410);
  }
  if (numeric === 404 || /(?:not[_\s-]*found|不存在|未找到)/i.test(text)) {
    return playlistLinkLoaderFailure('PLAYLIST_NOT_FOUND', '未找到该歌单', 404);
  }
  if (!loggedIn && /(?:auth|cookie|account)/i.test(text)) {
    return playlistLinkLoaderFailure('PLAYLIST_LOGIN_REQUIRED', '该歌单需要先登录对应音乐平台', 401);
  }
  return playlistLinkLoaderFailure('PLAYLIST_UPSTREAM_FAILED', '音乐平台未能返回歌单数据', 502, {
    provider,
    platformCode: numeric || String(code || ''),
  });
}

async function loadNeteasePlaylistLink(playlistId) {
  const id = String(playlistId || '');
  const login = await getLoginInfo();
  let detailResult;
  try {
    detailResult = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
  } catch (error) {
    return classifyPlaylistLinkUpstreamFailure('netease', error && (error.statusCode || error.code), error && error.message, login.loggedIn);
  }
  const body = detailResult && (detailResult.body || detailResult) || {};
  const code = normalizeApiCode(detailResult);
  const playlist = body.playlist;
  if (!playlist || typeof playlist !== 'object' || !playlist.name) {
    return classifyPlaylistLinkUpstreamFailure('netease', code, normalizeApiMessage(detailResult) || 'PLAYLIST_NOT_FOUND', login.loggedIn);
  }
  const isPrivate = Number(playlist.privacy || 0) > 0 || playlist.private === true;
  if (isPrivate && !login.loggedIn) {
    return playlistLinkLoaderFailure('PLAYLIST_LOGIN_REQUIRED', '该私密歌单需要先登录网易云音乐', 401, { provider: 'netease' });
  }
  const sourceCount = Math.max(0, Number(playlist.trackCount || (playlist.trackIds && playlist.trackIds.length) || 0) || 0);
  if (sourceCount > 20000) {
    return playlistLinkLoaderFailure('PLAYLIST_TOO_LARGE', '该歌单歌曲数量超过安全导入上限', 413, { provider: 'netease', songCount: sourceCount });
  }
  const rawTracks = [];
  if (typeof playlist_track_all === 'function') {
    const limit = 500;
    const expectedPages = Math.max(1, Math.ceil(Math.max(1, sourceCount) / limit));
    for (let page = 0; page < expectedPages && page < 40; page += 1) {
      let pageResult;
      try {
        pageResult = await playlist_track_all({ id, limit, offset: page * limit, cookie: userCookie, timestamp: Date.now() });
      } catch (error) {
        if (!rawTracks.length) {
          return classifyPlaylistLinkUpstreamFailure('netease', error && (error.statusCode || error.code), error && error.message, login.loggedIn);
        }
        break;
      }
      const pageBody = pageResult && (pageResult.body || pageResult) || {};
      const rows = Array.isArray(pageBody.songs) ? pageBody.songs : (Array.isArray(pageBody.tracks) ? pageBody.tracks : []);
      rawTracks.push(...rows);
      if (rows.length < limit || (!sourceCount && !rows.length)) break;
    }
  }
  if (!rawTracks.length && Array.isArray(playlist.tracks)) rawTracks.push(...playlist.tracks);
  const seen = new Set();
  const tracks = rawTracks.map(mapSongRecord).filter(song => {
    const key = String(song && song.id || '');
    if (!key || !song.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (isPrivate && login.loggedIn && sourceCount > 0 && !tracks.length) {
    return playlistLinkLoaderFailure('PLAYLIST_FORBIDDEN', '当前网易云音乐账号无权读取该私密歌单', 403, { provider: 'netease' });
  }
  return {
    ok: true,
    provider: 'netease',
    loggedIn: login.loggedIn === true,
    private: isPrivate,
    playlist: {
      id,
      name: playlist.name,
      cover: playlist.coverImgUrl || playlist.picUrl || '',
      creator: playlist.creator && (playlist.creator.nickname || playlist.creator.name) || '',
      trackCount: sourceCount || tracks.length,
      songCount: sourceCount || tracks.length,
      privacy: Number(playlist.privacy || 0) || 0,
      private: isPrivate,
    },
    tracks,
  };
}

async function loadQQPlaylistLink(playlistId) {
  const id = String(playlistId || '');
  const login = await getQQLoginInfo();
  let result;
  try {
    result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
      type: 1,
      utf8: 1,
      disstid: id,
      loginUin: login.userId || 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    }, { headers: { Referer: 'https://y.qq.com/n/ryqq/playlist/' + encodeURIComponent(id) } });
  } catch (error) {
    return classifyPlaylistLinkUpstreamFailure('qq', error && (error.statusCode || error.code), error && error.message, login.loggedIn);
  }
  const code = Number(result && (result.code || result.subcode) || 0) || 0;
  const detail = result && Array.isArray(result.cdlist) && result.cdlist[0];
  if (!detail || !(detail.dissname || detail.diss_name || detail.name)) {
    const message = result && (result.message || result.msg || result.error) || 'PLAYLIST_NOT_FOUND';
    return classifyPlaylistLinkUpstreamFailure('qq', code, message, login.loggedIn);
  }
  const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const seen = new Set();
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(song => {
    const key = String(song && (song.mid || song.id) || '');
    if (!key || !song.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sourceCount = Math.max(0, Number(detail.total_song_num || detail.songnum || detail.song_cnt || 0) || 0);
  const isPrivate = detail.private === true || detail.is_private === 1 || detail.is_public === 0 || detail.dir_show === 0;
  if (isPrivate && !login.loggedIn) {
    return playlistLinkLoaderFailure('PLAYLIST_LOGIN_REQUIRED', '该私密歌单需要先登录 QQ 音乐', 401, { provider: 'qq' });
  }
  if (isPrivate && login.loggedIn && sourceCount > 0 && !tracks.length) {
    return playlistLinkLoaderFailure('PLAYLIST_FORBIDDEN', '当前 QQ 音乐账号无权读取该私密歌单', 403, { provider: 'qq' });
  }
  return {
    ok: true,
    provider: 'qq',
    loggedIn: login.loggedIn === true,
    private: isPrivate,
    playlist: {
      id,
      name: detail.dissname || detail.diss_name || detail.name,
      cover: detail.logo || detail.diss_cover || detail.picurl || '',
      creator: detail.nickname || detail.nick || detail.creator && (detail.creator.nickname || detail.creator.name) || '',
      trackCount: sourceCount || tracks.length,
      songCount: sourceCount || tracks.length,
      private: isPrivate,
    },
    tracks,
  };
}

const musicPlatformService = createMusicPlatformService({
  searchNetease: handleSearch,
  searchQQ: handleQQSearch,
  resolveNetease: async (song, quality) => handleSongUrl(song.id, await getLoginInfo(), quality),
  resolveQQ: (song, quality) => handleQQSongUrl(song.mid || song.songmid || song.id, song.mediaMid, quality),
  commentsNetease: getNeteaseCommentsForPlatform,
  commentsQQ: (song, limit) => handleQQSongComments(song.qqId || song.id, song.mid || song.songmid, limit, 0),
  statusNetease: getLoginInfo,
  statusQQ: getQQLoginInfo,
  playlistNetease: loadNeteasePlaylistLink,
  playlistQQ: loadQQPlaylistLink,
  hotCandidates: {
    netease: getNeteaseHotCandidates,
    qq: getQQHotCandidates,
  },
});

function musicSessionRequestAuthorized(req) {
  const expected = String(process.env.LUMIFIELD_MUSIC_SESSION_SECRET || '');
  const supplied = String(req.headers['x-lumifield-session-secret'] || '');
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function withValidatedBackendSession(provider, value) {
  const result = value && typeof value === 'object' ? value : {};
  const profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
  const verified = provider === 'qishui'
    ? profile.profileVerified === true
    : (profile.profileVerified === true || profile.playlistsVerified === true);
  const sessionValid = result.loggedIn === true && result.ok !== false && !result.error
    && result.stale !== true && result.profileUnavailable !== true && result.pendingProfile !== true
    && result.ignoredStaleSession !== true && !!profile.userId && verified;
  return { ...result, provider, sessionValid };
}

function platformSongFromQuery(searchParams, fallbackProvider) {
  return {
    provider: searchParams.get('provider') || fallbackProvider || '',
    source: searchParams.get('provider') || fallbackProvider || '',
    id: searchParams.get('id') || searchParams.get('mid') || searchParams.get('hash') || '',
    qqId: searchParams.get('qqId') || '',
    mid: searchParams.get('mid') || '',
    songmid: searchParams.get('songmid') || searchParams.get('mid') || '',
    mediaMid: searchParams.get('mediaMid') || searchParams.get('media_mid') || '',
    hash: searchParams.get('hash') || '',
    hqHash: searchParams.get('hqHash') || '',
    sqHash: searchParams.get('sqHash') || '',
    albumId: searchParams.get('albumId') || searchParams.get('album_id') || '',
    albumAudioId: searchParams.get('albumAudioId') || searchParams.get('album_audio_id') || '',
    mixSongId: searchParams.get('mixSongId') || searchParams.get('mixsongid') || '',
    qishuiTrackId: searchParams.get('qishuiTrackId') || searchParams.get('id') || '',
    mediaType: searchParams.get('mediaType') || searchParams.get('qishuiMediaType') || 'track',
    qishuiMediaType: searchParams.get('qishuiMediaType') || searchParams.get('mediaType') || 'track',
    name: searchParams.get('name') || searchParams.get('title') || '',
    artist: searchParams.get('artist') || searchParams.get('author') || '',
    album: searchParams.get('album') || '',
    cover: searchParams.get('cover') || '',
    duration: Number(searchParams.get('duration') || 0) || 0,
    fee: Number(searchParams.get('fee') || 0) || 0,
  };
}

// ====================================================================
//  HTTP Server
// ====================================================================
const server = http.createServer(async (req, res) => {
  if (!isAllowedBrowserOrigin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ ok: false, error: 'ORIGIN_FORBIDDEN' }));
    return;
  }
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  if (pn === '/api/app/version') {
    sendJSON(res, {
      name: APP_PACKAGE.name || 'lumifield',
      productName: APP_PACKAGE.productName || 'LumiField',
      version: APP_VERSION,
    });
    return;
  }

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(res, entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key });
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }

  if (pn === '/api/discover/home') {
    try {
      sendJSON(res, await handleDiscoverHome());
    } catch (err) {
      console.error('[DiscoverHome]', err);
      sendJSON(res, { error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/weather/radio') {
    try {
      const data = await buildWeatherRadio({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[WeatherRadio]', err);
      sendJSON(res, {
        ok: false,
        error: err.message,
        weather: null,
        radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
      }, 500);
    }
    return;
  }

  if (pn === '/api/weather/current') {
    try {
      const weather = await fetchOpenMeteoWeather({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
        force: url.searchParams.has('t') || url.searchParams.get('force') === '1',
      });
      sendJSON(res, { ok: true, weather });
    } catch (err) {
      console.error('[WeatherCurrent]', err);
      const failure = weatherServiceError(err);
      sendJSON(res, { ok: false, code: failure.code, error: failure.code, weather: null }, failure.status);
    }
    return;
  }

  if (pn === '/api/platforms/status') {
    const status = await musicPlatformService.getStatuses();
    for (const provider of ['kugou', 'kugou_concept', 'netease', 'qq', 'qishui']) {
      status.platforms[provider] = { login: true, playback: true, ...(status.platforms[provider] || {}) };
    }
    sendJSON(res, status);
    return;
  }

  if (pn === '/api/platform/audit') {
    sendJSON(res, { ok: true, audit: musicPlatformService.audit });
    return;
  }

  if (pn === '/api/platform/search') {
    try {
      const keywords = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(50, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      sendJSON(res, await musicPlatformService.searchAcrossPlatforms(keywords, limit));
    } catch (err) {
      sendJSON(res, { ok: false, songs: [], error: err.message || 'PLATFORM_SEARCH_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/playlist-link/resolve') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '歌单链接解析仅允许 POST 请求' }, 405);
      return;
    }
    try {
      const body = await readLimitedJSON(req, 16 * 1024);
      const submittedUrl = body && (body.url || body.link || body.playlistUrl);
      const result = await musicPlatformService.resolvePlaylistLink(submittedUrl);
      sendJSON(res, result, result && result.ok ? 200 : Math.max(400, Math.min(599, Number(result && result.status) || 500)));
    } catch (error) {
      const code = error && error.code || 'INVALID_JSON_BODY';
      const status = code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400;
      sendJSON(res, {
        ok: false,
        code,
        message: code === 'REQUEST_BODY_TOO_LARGE' ? '请求内容过大' : '请求必须是有效 JSON',
      }, status);
    }
    return;
  }

  if (pn === '/api/platform/resolve') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const song = body.song || (req.method === 'POST' ? body : platformSongFromQuery(url.searchParams));
      sendJSON(res, await musicPlatformService.resolvePlayableSource({
        song,
        quality: body.quality || url.searchParams.get('quality') || '',
        force: body.force === true || body.force === 1 || url.searchParams.get('force') === '1',
      }));
    } catch (err) {
      sendJSON(res, { ok: false, url: '', playable: false, error: err.message || 'PLATFORM_RESOLVE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/platform/session/clear') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_CLEAR_FORBIDDEN' }, 403);
      return;
    }
    invalidateNeteaseQrSessions();
    saveCookie('');
    saveQQCookie('');
    sendJSON(res, { ok: true, loggedIn: false, sessionValid: false });
    return;
  }

  if (pn === '/api/platform/hot-comments') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const provider = body.provider || url.searchParams.get('provider') || '';
      const song = body.song || (provider ? platformSongFromQuery(url.searchParams, provider) : null);
      sendJSON(res, await musicPlatformService.hotComments({
        provider,
        song,
        limit: body.limit || url.searchParams.get('limit') || 12,
      }));
    } catch (err) {
      sendJSON(res, { ok: false, comments: [], empty: true, error: err.message || 'HOT_COMMENTS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/search') {
    try {
      const keywords = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(60, parseInt(url.searchParams.get('limit') || '24', 10) || 24));
      sendJSON(res, { ok: true, provider: 'kugou', songs: await musicPlatformService.searchKugou(keywords, limit) });
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou', songs: [], error: err.message || 'KUGOU_SEARCH_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/song/url') {
    try {
      const song = platformSongFromQuery(url.searchParams, 'kugou');
      sendJSON(res, await musicPlatformService.resolvePlayableSource({
        song,
        quality: url.searchParams.get('quality') || '',
        force: url.searchParams.get('force') === '1',
      }));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou', url: '', playable: false, error: err.message || 'KUGOU_RESOLVE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/lyric') {
    try {
      sendJSON(res, await musicPlatformService.kugouLyrics(platformSongFromQuery(url.searchParams, 'kugou')));
    } catch (err) {
      sendJSON(res, { provider: 'kugou', lyric: '', error: err.message || 'KUGOU_LYRIC_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/song/comments') {
    try {
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      sendJSON(res, await musicPlatformService.kugouComments(platformSongFromQuery(url.searchParams, 'kugou'), limit));
    } catch (err) {
      sendJSON(res, { provider: 'kugou', comments: [], error: err.message || 'KUGOU_COMMENTS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/login/qr/key') {
    try {
      sendJSON(res, await musicPlatformService.createKugouQrLogin());
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou', candidate: 4, status: 0, error: err.message || 'KUGOU_QR_CREATE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/login/qr/check') {
    try {
      sendJSON(res, await musicPlatformService.checkKugouQrLogin(url.searchParams.get('key') || url.searchParams.get('qrcode') || ''));
    } catch (err) {
      const expired = err && err.message === 'KUGOU_QR_SESSION_EXPIRED';
      sendJSON(res, { ok: false, provider: 'kugou', candidate: 4, status: expired ? 5 : 0, loggedIn: false, error: err.message || 'KUGOU_QR_CHECK_FAILED' }, expired ? 410 : 502);
    }
    return;
  }

  if (pn === '/api/kugou/session/export') {
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_EXPORT_FORBIDDEN' }, 403);
      return;
    }
    sendJSON(res, musicPlatformService.exportKugouSession());
    return;
  }

  if (pn === '/api/kugou/login/status') {
    const status = await musicPlatformService.getStatuses();
    sendJSON(res, withValidatedBackendSession('kugou', status.platforms.kugou || { provider: 'kugou', loggedIn: false }));
    return;
  }

  if (pn === '/api/kugou/session') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_SYNC_FORBIDDEN' }, 403);
      return;
    }
    try {
      sendJSON(res, withValidatedBackendSession('kugou', await musicPlatformService.updateKugouSession(await readRequestBody(req))));
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'SESSION_SYNC_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/kugou/user/playlists') {
    try {
      sendJSON(res, await musicPlatformService.getKugouPlaylists(url.searchParams.get('page'), url.searchParams.get('limit')));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou', playlists: [], error: err.message || 'KUGOU_PLAYLISTS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou/playlist/tracks') {
    try {
      sendJSON(res, await musicPlatformService.getKugouPlaylistTracks(
        url.searchParams.get('id'),
        url.searchParams.get('page'),
        url.searchParams.get('limit')
      ));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou', tracks: [], error: err.message || 'KUGOU_PLAYLIST_TRACKS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/kugou-concept/login/qr/key') {
    try {
      sendJSON(res, await musicPlatformService.createKugouConceptQrLogin());
    } catch (err) {
      sendJSON(res, {
        ok: false,
        provider: 'kugou_concept',
        edition: 'concept',
        status: 0,
        error: err.message || 'KUGOU_CONCEPT_QR_CREATE_FAILED',
      }, 502);
    }
    return;
  }

  if (pn === '/api/kugou-concept/login/qr/check') {
    try {
      sendJSON(res, await musicPlatformService.checkKugouConceptQrLogin(
        url.searchParams.get('key') || url.searchParams.get('qrcode') || ''
      ));
    } catch (err) {
      const expired = err && err.message === 'KUGOU_CONCEPT_QR_SESSION_EXPIRED';
      sendJSON(res, {
        ok: false,
        provider: 'kugou_concept',
        edition: 'concept',
        status: expired ? 5 : 0,
        loggedIn: false,
        error: err.message || 'KUGOU_CONCEPT_QR_CHECK_FAILED',
      }, expired ? 410 : 502);
    }
    return;
  }

  if (pn === '/api/kugou-concept/session/export') {
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_EXPORT_FORBIDDEN' }, 403);
      return;
    }
    sendJSON(res, musicPlatformService.exportKugouConceptSession());
    return;
  }

  if (pn === '/api/kugou-concept/login/status') {
    const status = await musicPlatformService.getStatuses();
    sendJSON(res, withValidatedBackendSession('kugou_concept', status.platforms.kugou_concept || { provider: 'kugou_concept', loggedIn: false }));
    return;
  }

  if (pn === '/api/kugou-concept/session') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_SYNC_FORBIDDEN' }, 403);
      return;
    }
    try {
      sendJSON(res, withValidatedBackendSession('kugou_concept', await musicPlatformService.updateKugouConceptSession(await readRequestBody(req))));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'kugou_concept', error: err.message || 'SESSION_SYNC_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/kugou-concept/user/playlists') {
    try {
      sendJSON(res, await musicPlatformService.getKugouConceptPlaylists(
        url.searchParams.get('page'),
        url.searchParams.get('limit')
      ));
    } catch (err) {
      sendJSON(res, {
        ok: false,
        provider: 'kugou_concept',
        playlists: [],
        error: err.message || 'KUGOU_CONCEPT_PLAYLISTS_FAILED',
      }, 502);
    }
    return;
  }

  if (pn === '/api/kugou-concept/playlist/tracks') {
    try {
      sendJSON(res, await musicPlatformService.getKugouConceptPlaylistTracks(
        url.searchParams.get('id'),
        url.searchParams.get('page'),
        url.searchParams.get('limit')
      ));
    } catch (err) {
      sendJSON(res, {
        ok: false,
        provider: 'kugou_concept',
        tracks: [],
        error: err.message || 'KUGOU_CONCEPT_PLAYLIST_TRACKS_FAILED',
      }, 502);
    }
    return;
  }

  if (pn === '/api/kugou-concept/song/url') {
    try {
      const song = platformSongFromQuery(url.searchParams, 'kugou_concept');
      sendJSON(res, await musicPlatformService.resolvePlayableSource({
        song,
        quality: url.searchParams.get('quality') || '',
        force: url.searchParams.get('force') === '1',
      }));
    } catch (err) {
      sendJSON(res, {
        ok: false,
        provider: 'kugou_concept',
        url: '',
        playable: false,
        error: err.message || 'KUGOU_CONCEPT_RESOLVE_FAILED',
      }, 502);
    }
    return;
  }

  if (pn === '/api/qishui/login/qr/key') {
    try {
      sendJSON(res, await musicPlatformService.createQishuiQrLogin());
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'qishui', status: 0, error: err.message || 'QISHUI_QR_CREATE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/qishui/login/qr/check') {
    try {
      sendJSON(res, await musicPlatformService.checkQishuiQrLogin(url.searchParams.get('key') || ''));
    } catch (err) {
      const expired = err && err.message === 'QISHUI_QR_SESSION_EXPIRED';
      sendJSON(res, {
        ok: false,
        provider: 'qishui',
        status: expired ? 5 : 0,
        loggedIn: false,
        error: err.message || 'QISHUI_QR_CHECK_FAILED',
      }, expired ? 410 : 502);
    }
    return;
  }

  if (pn === '/api/qishui/session/export') {
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_EXPORT_FORBIDDEN' }, 403);
      return;
    }
    sendJSON(res, musicPlatformService.exportQishuiSession());
    return;
  }

  if (pn === '/api/qishui/login/status') {
    const status = await musicPlatformService.getStatuses();
    sendJSON(res, withValidatedBackendSession('qishui', status.platforms.qishui || { provider: 'qishui', loggedIn: false }));
    return;
  }

  if (pn === '/api/qishui/session') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    if (!musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, error: 'SESSION_SYNC_FORBIDDEN' }, 403);
      return;
    }
    try {
      sendJSON(res, withValidatedBackendSession('qishui', await musicPlatformService.updateQishuiSession(await readRequestBody(req))));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'qishui', loggedIn: false, error: err.message || 'SESSION_SYNC_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/qishui/user/playlists') {
    try {
      sendJSON(res, await musicPlatformService.getQishuiPlaylists(
        url.searchParams.get('cursor'),
        url.searchParams.get('limit')
      ));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'qishui', playlists: [], error: err.message || 'QISHUI_PLAYLISTS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/qishui/playlist/tracks') {
    try {
      sendJSON(res, await musicPlatformService.getQishuiPlaylistTracks(
        url.searchParams.get('id'),
        url.searchParams.get('cursor'),
        url.searchParams.get('limit')
      ));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'qishui', tracks: [], error: err.message || 'QISHUI_PLAYLIST_TRACKS_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/qishui/song/url') {
    try {
      sendJSON(res, await musicPlatformService.resolveQishui(platformSongFromQuery(url.searchParams, 'qishui')));
    } catch (err) {
      sendJSON(res, { ok: false, provider: 'qishui', url: '', playable: false, error: err.message || 'QISHUI_RESOLVE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/translate/lyrics') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    if (Number(req.headers['content-length'] || 0) > 64 * 1024) {
      sendJSON(res, { ok: false, code: 'REQUEST_BODY_TOO_LARGE', error: 'REQUEST_BODY_TOO_LARGE' }, 413);
      return;
    }
    if (!translationRateAllowed(req)) {
      sendJSON(res, { ok: false, code: 'TRANSLATION_RATE_LIMITED', error: 'TRANSLATION_RATE_LIMITED' }, 429);
      return;
    }
    try {
      const body = await readLimitedJSON(req, 64 * 1024);
      const controller = new AbortController();
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      req.once('aborted', abort);
      res.once('close', abort);
      try {
        sendJSON(res, await proxyLyricTranslation(body, { signal: controller.signal }));
      } finally {
        req.removeListener('aborted', abort);
        res.removeListener('close', abort);
      }
    } catch (err) {
      const code = err.code || err.message || 'TRANSLATION_FAILED';
      const status = code === 'REQUEST_BODY_TOO_LARGE' || code === 'TRANSLATION_INPUT_TOO_LARGE' ? 413
        : (code === 'INVALID_JSON_BODY' || code === 'INVALID_TRANSLATION_LINES' ? 400
          : (code === 'TRANSLATION_ABORTED' ? 499 : 502));
      if (!res.destroyed && !res.writableEnded) sendJSON(res, { ok: false, code, error: code }, status);
    }
    return;
  }

  const wallpaperMatch = /^\/api\/local-wallpaper\/([^/]+)\/(.+)$/.exec(pn);
  if (wallpaperMatch) {
    try {
      const importId = wallpaperMatch[1];
      if (!LOCAL_WALLPAPER_ID_RE.test(importId)) throw new Error('INVALID_WALLPAPER_ID');
      const parts = [importId.toLowerCase()].concat(decodeLocalPathParts(wallpaperMatch[2]));
      const filePath = resolveLocalReadOnlyFile(process.env.LUMIFIELD_WALLPAPER_DIR, parts);
      if (!filePath) {
        sendJSON(res, { ok: false, error: 'LOCAL_WALLPAPER_NOT_FOUND' }, 404);
        return;
      }
      sendLocalReadOnlyFile(req, res, filePath, /\.html?$/i.test(filePath));
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'INVALID_LOCAL_WALLPAPER_PATH' }, 400);
    }
    return;
  }

  const stemMatch = /^\/api\/local-stem\/([a-f0-9]{64})\/(vocals\.wav|no_vocals\.wav)$/i.exec(pn);
  if (stemMatch) {
    if (!LOCAL_STEM_ID_RE.test(stemMatch[1])) {
      sendJSON(res, { ok: false, error: 'INVALID_STEM_ID' }, 400);
      return;
    }
    const filePath = resolveLocalReadOnlyFile(process.env.LUMIFIELD_STEM_DIR, [stemMatch[1].toLowerCase(), stemMatch[2].toLowerCase()]);
    if (!filePath) {
      sendJSON(res, { ok: false, error: 'LOCAL_STEM_NOT_FOUND' }, 404);
      return;
    }
    try { sendLocalReadOnlyFile(req, res, filePath, false); }
    catch (_) { sendJSON(res, { ok: false, error: 'LOCAL_STEM_READ_FAILED' }, 500); }
    return;
  }

  if (pn === '/api/weather/ip-location') {
    try {
      sendJSON(res, { ok: true, location: await fetchIpWeatherLocation() });
    } catch (err) {
      console.error('[WeatherIpLocation]', err);
      const failure = weatherServiceError(err);
      sendJSON(res, { ok: false, code: failure.code, error: failure.code, location: null }, failure.status);
    }
    return;
  }

  // ---------- 搜索 ----------
  if (pn === '/api/search') {
    try {
      const kw    = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const songs = await handleSearch(kw, limit);
      sendJSON(res, { songs });
    } catch (err) { console.error('[Search]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
    return;
  }

  if (pn === '/api/qq/search') {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
      const songs = await handleQQSearch(kw, limit);
      sendJSON(res, { provider: 'qq', songs });
    } catch (err) {
      console.error('[QQSearch]', err);
      sendJSON(res, { provider: 'qq', error: err.message, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/url') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('id') || '';
      const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || '';
      const quality = url.searchParams.get('quality') || '';
      const info = await handleQQSongUrl(mid, mediaMid, quality);
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQSongUrl]', err);
      sendJSON(res, { provider: 'qq', url: '', playable: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/qq/lyric') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      if (!mid && !id) { sendJSON(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400); return; }
      const data = await handleQQLyric(mid, id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQLyric]', err);
      sendJSON(res, { provider: 'qq', error: err.message, lyric: '' }, 500);
    }
    return;
  }

  // ---------- 歌曲URL ----------
  if (pn === '/api/qq/login/status') {
    try {
      const info = await getQQLoginInfo();
      sendJSON(res, { ok: true, ...info });
    } catch (err) {
      console.error('[QQLoginStatus]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/qq/login/cookie') {
    if (req.method !== 'POST' || !musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, provider: 'qq', loggedIn: false, sessionValid: false, error: 'SESSION_SYNC_FORBIDDEN' }, 403);
      return;
    }
    const previousCookie = qqCookie;
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeQQCookieInput(raw);
      const obj = parseCookieString(normalized);
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        sendJSON(res, { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' }, 400);
        return;
      }
      saveQQCookie(normalized);
      const info = await getQQLoginInfo();
      if (!info || info.loggedIn !== true || info.sessionValid !== true || info.error || info.profileUnavailable === true) {
        saveQQCookie(previousCookie);
        sendJSON(res, { provider: 'qq', ok: false, loggedIn: false, sessionValid: false, error: 'QQ_SESSION_INVALID' }, 401);
        return;
      }
      sendJSON(res, { ok: true, ...info, saved: true });
    } catch (err) {
      saveQQCookie(previousCookie);
      console.error('[QQLoginCookie] validation failed');
      sendJSON(res, { provider: 'qq', ok: false, loggedIn: false, sessionValid: false, error: 'QQ_SESSION_VALIDATION_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/qq/logout') {
    if (req.method !== 'POST' || !musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, provider: 'qq', loggedIn: false, sessionValid: false, error: 'SESSION_CLEAR_FORBIDDEN' }, 403);
      return;
    }
    saveQQCookie('');
    sendJSON(res, { provider: 'qq', ok: true, loggedIn: false, sessionValid: false });
    return;
  }

  if (pn === '/api/qq/user/playlists') {
    try {
      const data = await handleQQUserPlaylists();
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQUserPlaylists]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('disstid') || '';
      const data = await handleQQPlaylistTracks(id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQPlaylistTracks]', err);
      sendJSON(res, { provider: 'qq', error: err.message, tracks: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/artist/detail') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || '';
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36));
      if (!mid) {
        sendJSON(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400);
        return;
      }
      const data = await handleQQArtistDetail(mid, limit);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQArtistDetail]', err);
      sendJSON(res, { provider: 'qq', error: err.message, artist: null, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/comments') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const data = await handleQQSongComments(id, mid, limit, offset);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQSongComments]', err);
      sendJSON(res, { provider: 'qq', error: err.message, comments: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/search') {
    try {
      const kw = String(url.searchParams.get('keywords') || '').trim();
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      if (!kw) { sendJSON(res, { podcasts: [] }); return; }
      const r = await cloudsearch({ keywords: kw, type: 1009, limit, cookie: userCookie, timestamp: Date.now() });
      const result = (r.body && r.body.result) || {};
      const raw = result.djRadios || result.djradios || result.radios || [];
      const podcasts = raw.map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, total: result.djRadiosCount || result.djradiosCount || podcasts.length });
    } catch (err) {
      console.error('[PodcastSearch]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/hot') {
    try {
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await dj_hot({ limit, offset, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.djRadios || body.djradios || body.radios || body.data || [];
      const podcasts = (Array.isArray(raw) ? raw : []).map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, more: !!body.hasMore });
    } catch (err) {
      console.error('[PodcastHot]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/detail') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) { sendJSON(res, { error: 'Missing podcast id' }, 400); return; }
      const r = await dj_detail({ rid, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body);
      sendJSON(res, { podcast: radio });
    } catch (err) {
      console.error('[PodcastDetail]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/programs') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) { sendJSON(res, { error: 'Missing podcast id', programs: [] }, 400); return; }
      const limit = Math.max(10, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await dj_program({ rid, limit, offset, asc: false, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.programs || (body.data && (body.data.list || body.data.programs)) || [];
      const radio = raw[0] && raw[0].radio ? mapPodcastRadio(raw[0].radio) : { id: rid, rid };
      const programs = (Array.isArray(raw) ? raw : [])
        .map(p => mapPodcastProgram(p, radio))
        .filter(p => p.id && p.name);
      sendJSON(res, { radio, programs, more: !!body.more, total: body.count || programs.length });
    } catch (err) {
      console.error('[PodcastPrograms]', err);
      sendJSON(res, { error: err.message, programs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        const empty = ['collect', 'created', 'liked'].map(k => podcastCollectionMeta(k, []));
        sendJSON(res, { loggedIn: false, collections: empty });
        return;
      }
      const keys = ['collect', 'created', 'liked'];
      const collections = await Promise.all(keys.map(async key => {
        try {
          const data = await fetchMyPodcastItems(key, info, 12, 0);
          return podcastCollectionMeta(key, data.items || []);
        } catch (e) {
          console.warn('[MyPodcast]', key, e.message);
          return podcastCollectionMeta(key, []);
        }
      }));
      sendJSON(res, { loggedIn: true, collections });
    } catch (err) {
      console.error('[MyPodcast]', err);
      sendJSON(res, { error: err.message, collections: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my/items') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, items: [] }); return; }
      const key = String(url.searchParams.get('key') || 'collect');
      const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36;
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const data = await fetchMyPodcastItems(key, info, limit, offset);
      sendJSON(res, { loggedIn: true, key, ...podcastCollectionMeta(key, data.items || []), itemType: data.itemType, items: data.items || [] });
    } catch (err) {
      console.error('[MyPodcastItems]', err);
      sendJSON(res, { error: err.message, items: [] }, 500);
    }
    return;
  }

  if (pn === '/api/song/url') {
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      const loginInfo = await getLoginInfo();
      const info = await handleSongUrl(sid, loginInfo, quality);
      sendJSON(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      });
    } catch (err) { console.error('[SongUrl]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  if (pn === '/api/login/cookie') {
    if (req.method !== 'POST' || !musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, loggedIn: false, sessionValid: false, error: 'SESSION_SYNC_FORBIDDEN' }, 403);
      return;
    }
    const previousCookie = userCookie;
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      const obj = parseCookieString(normalized);
      if (!obj.MUSIC_U) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400);
        return;
      }
      saveCookie(normalized);
      const info = await getLoginInfo();
      if (!info || info.loggedIn !== true || info.sessionValid !== true || info.error || info.profileUnavailable === true) {
        saveCookie(previousCookie);
        sendJSON(res, { ok: false, loggedIn: false, sessionValid: false, error: 'NETEASE_SESSION_INVALID' }, 401);
        return;
      }
      sendJSON(res, { ok: true, ...info, saved: true, hasCookie: !!userCookie });
    } catch (err) {
      saveCookie(previousCookie);
      console.error('[LoginCookie] validation failed');
      sendJSON(res, { ok: false, loggedIn: false, sessionValid: false, error: 'NETEASE_SESSION_VALIDATION_FAILED' }, 500);
    }
    return;
  }

  // ---------- 登录: QR Key ----------
  // ---------- 播客 DJ 长音频后端离线锁拍 ----------
  if (pn === '/api/podcast/dj-beatmap') {
    try {
      const audioUrl = url.searchParams.get('url');
      const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0);
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        sendJSON(res, { error: 'Invalid audio url' }, 400);
        return;
      }
      console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's');
      const started = Date.now();
      const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0);
      const map = introSec
        ? await analyzePodcastDjIntro(audioUrl, { durationSec, introSec, userAgent: UA })
        : await analyzePodcastDjStream(audioUrl, { durationSec, userAgent: UA });
      console.log('[PodcastDjBeatmap] done beats:', map.visualBeatCount || 0, 'ms:', Date.now() - started, 'decode:', map.decode || {});
      sendJSON(res, { ok: true, map });
    } catch (err) {
      console.error('[PodcastDjBeatmap]', err);
      sendJSON(res, { ok: false, error: err.message || String(err) }, 500);
    }
    return;
  }

  if (pn === '/api/login/qr/key') {
    try {
      pruneNeteaseQrSessions();
      const generation = neteaseQrGeneration;
      const r = await login_qr_key({ timestamp: Date.now() });
      const key = r.body && r.body.data && r.body.data.unikey;
      if (generation !== neteaseQrGeneration) {
        sendJSON(res, { ok: false, error: 'NETEASE_QR_SESSION_EXPIRED' }, 409);
        return;
      }
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(String(key || ''))) {
        sendJSON(res, { ok: false, error: 'NETEASE_QR_KEY_EMPTY' }, 502);
        return;
      }
      neteaseQrSessions.set(key, {
        key,
        generation,
        createdAt: Date.now(),
        expiresAt: Date.now() + NETEASE_QR_SESSION_TTL_MS,
        used: false,
      });
      sendJSON(res, { ok: true, key, expiresIn: NETEASE_QR_SESSION_TTL_MS });
    } catch (_) { sendJSON(res, { ok: false, error: 'NETEASE_QR_CREATE_FAILED' }, 502); }
    return;
  }

  // ---------- 登录: QR 二维码图片 ----------
  if (pn === '/api/login/qr/create') {
    try {
      pruneNeteaseQrSessions();
      const key = String(url.searchParams.get('key') || '').trim();
      const issued = neteaseQrSessions.get(key);
      if (!issued || issued.generation !== neteaseQrGeneration) {
        sendJSON(res, { ok: false, error: 'NETEASE_QR_SESSION_EXPIRED' }, 410);
        return;
      }
      const generation = issued.generation;
      const r = await login_qr_create({ key, qrimg: true, timestamp: Date.now() });
      if (generation !== neteaseQrGeneration || neteaseQrSessions.get(key) !== issued) {
        sendJSON(res, { ok: false, error: 'NETEASE_QR_SESSION_EXPIRED' }, 409);
        return;
      }
      const d = r.body && r.body.data;
      sendJSON(res, { ok: true, img: d && d.qrimg, url: d && d.qrurl });
    } catch (_) { sendJSON(res, { ok: false, error: 'NETEASE_QR_CREATE_FAILED' }, 502); }
    return;
  }

  // ---------- 登录: 轮询扫码状态 ----------
  if (pn === '/api/login/qr/check') {
    if (req.method !== 'POST' || !musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, error: 'QR_CHECK_FORBIDDEN' }, 403);
      return;
    }
    try {
      const input = await readLimitedJSON(req, 4 * 1024);
      const key = String(input && input.key || '').trim();
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(key)) {
        sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, error: 'INVALID_QR_KEY' }, 400);
        return;
      }
      pruneNeteaseQrSessions();
      const issued = neteaseQrSessions.get(key);
      if (!issued || issued.generation !== neteaseQrGeneration) {
        sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, error: 'NETEASE_QR_SESSION_EXPIRED' });
        return;
      }
      const generation = issued.generation;
      let r = await login_qr_check({ key, timestamp: Date.now() });
      if (generation !== neteaseQrGeneration || neteaseQrSessions.get(key) !== issued) {
        sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, stale: true, error: 'NETEASE_QR_SESSION_EXPIRED' });
        return;
      }
      let body = r.body || {};
      let code = Number(body.code || r.code);
      const messages = { 800: '二维码已过期', 801: '等待扫码', 802: '等待确认', 803: '授权成功' };
      let msg = messages[code] || '二维码状态异常';
      let cookie = readCookieFromResponse(r);
      if (code === 803 && !cookie) {
        try {
          const retry = await login_qr_check({ key, noCookie: false, timestamp: Date.now() });
          if (generation !== neteaseQrGeneration || neteaseQrSessions.get(key) !== issued) {
            sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, stale: true, error: 'NETEASE_QR_SESSION_EXPIRED' });
            return;
          }
          const retryCookie = readCookieFromResponse(retry);
          if (retryCookie) {
            r = retry;
            body = retry.body || body;
            code = Number(body.code || retry.code || code);
            msg = messages[code] || msg;
            cookie = retryCookie;
          }
        } catch (_) {}
      }
      if (generation !== neteaseQrGeneration || neteaseQrSessions.get(key) !== issued) {
        sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, stale: true, error: 'NETEASE_QR_SESSION_EXPIRED' });
        return;
      }
      // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
      if (code === 803) {
        issued.used = true;
        neteaseQrSessions.delete(key);
        if (!cookie) {
          sendJSON(res, { ok: false, provider: 'netease', code, message: msg, loggedIn: false, sessionValid: false, error: 'NETEASE_QR_CREDENTIAL_MISSING' });
          return;
        }
        const info = await validateNeteaseCookie(cookie);
        if (!info || info.loggedIn !== true || info.sessionValid !== true || info.error
            || info.profileUnavailable === true || info.pendingProfile === true) {
          sendJSON(res, { ok: false, provider: 'netease', code, message: msg, loggedIn: false, sessionValid: false, error: 'NETEASE_QR_SESSION_INVALID' });
          return;
        }
        const profile = { ...info };
        delete profile.loggedIn;
        delete profile.sessionValid;
        delete profile.hasCookie;
        sendJSON(res, {
          ok: true,
          provider: 'netease',
          code,
          message: msg,
          loggedIn: true,
          sessionValid: true,
          profile,
          credential: cookie,
        });
        return;
      }
      sendJSON(res, { ok: true, provider: 'netease', code, message: msg, loggedIn: false, sessionValid: false });
    } catch (_) {
      sendJSON(res, { ok: false, provider: 'netease', loggedIn: false, sessionValid: false, error: 'NETEASE_QR_CHECK_FAILED' }, 502);
    }
    return;
  }

  // ---------- 登录态查询 ----------
  if (pn === '/api/login/status') {
    const info = await getLoginInfo();
    sendJSON(res, info);
    return;
  }

  // ---------- 登出 ----------
  if (pn === '/api/logout') {
    if (req.method !== 'POST' || !musicSessionRequestAuthorized(req)) {
      sendJSON(res, { ok: false, loggedIn: false, sessionValid: false, error: 'SESSION_CLEAR_FORBIDDEN' }, 403);
      return;
    }
    invalidateNeteaseQrSessions();
    try { await logout({ cookie: userCookie }); } catch (e) {}
    saveCookie('');
    sendJSON(res, { ok: true, loggedIn: false, sessionValid: false });
    return;
  }

  // ---------- 用户歌单 ----------
  if (pn === '/api/user/playlists') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, playlists: [] }); return; }
      const limit = Math.max(12, Math.min(100, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
      const r = await user_playlist({ uid: info.userId, limit, cookie: userCookie, timestamp: Date.now() });
      const list = ((r.body && r.body.playlist) || []).map(pl => mapNeteaseUserPlaylist(pl, info.userId));
      sendJSON(res, { loggedIn: true, userId: info.userId, playlists: list });
    } catch (err) {
      console.error('[UserPlaylists]', err);
      sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
    }
    return;
  }

  if (pn === '/api/playlist/mutate') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '歌单删除仅允许 POST 请求' }, 405);
      return;
    }
    const body = await readRequestBody(req);
    const provider = String(body.provider || '').trim().toLowerCase();
    const id = String(body.id || body.playlistId || '').trim();
    if (!/^(netease|qq|kugou|kugou_concept|qishui|local)$/.test(provider) || !id || id.length > 128) {
      sendJSON(res, { ok: false, code: 'INVALID_PLAYLIST_TARGET', message: '歌单平台或 ID 无效' }, 400);
      return;
    }
    if (provider === 'local') {
      sendJSON(res, {
        ok: false,
        provider,
        id,
        code: 'LOCAL_PLAYLIST_STORE_UNAVAILABLE',
        message: '本地歌单必须由LF本地存储原子删除，后端未执行操作',
      }, 409);
      return;
    }
    const requestedAccountForLock = mutationIdentity(body.currentAccount ?? body.currentAccountId);
    const mutationKey = provider + ':' + requestedAccountForLock + ':' + id;
    if (playlistMutationInFlight.has(mutationKey)) {
      sendJSON(res, {
        ok: false,
        provider,
        id,
        code: 'PLAYLIST_MUTATION_IN_PROGRESS',
        message: '该歌单正在处理中，请勿重复操作',
      }, 409);
      return;
    }
    playlistMutationInFlight.set(mutationKey, Date.now());
    try {
      if (provider === 'netease') {
        const info = await getLoginInfo();
        if (!info || info.loggedIn !== true || !info.userId) throw playlistMutationLoginFailure(provider);
        const target = await resolveNeteasePlaylistMutationTarget(id, info);
        const expectedOperation = target.subscribed ? 'unsubscribe' : 'delete';
        const context = validatePlaylistMutationIntent(body, target, info.userId, expectedOperation);
        const confirmedInfo = await getLoginInfo();
        if (!confirmedInfo || confirmedInfo.loggedIn !== true || !confirmedInfo.userId) {
          throw playlistMutationLoginFailure(provider);
        }
        if (mutationIdentity(confirmedInfo.userId) !== context.currentAccountId) {
          throw playlistMutationFailure('PLAYLIST_ACCOUNT_CHANGED', '远端操作前平台账号已切换，未执行操作', 409, {
            provider,
            currentAccountId: mutationIdentity(confirmedInfo.userId),
            expectedAccountId: context.currentAccountId,
          });
        }
        try {
          const result = await mutateNeteasePlaylist(target);
          sendJSON(res, { ...result, currentAccountId: context.currentAccountId });
        } catch (error) {
          if (!error || error.platformDenied !== true) throw error;
          sendJSON(res, localOnlyPlaylistMutationResult(provider, id, context, 'PLATFORM_PERMISSION_DENIED'));
        }
      } else {
        const resolved = await resolveLocalOnlyPlaylistMutationTarget(provider, id);
        const context = validatePlaylistMutationIntent(body, resolved.target, resolved.currentAccountId, 'remove-local');
        sendJSON(res, localOnlyPlaylistMutationResult(provider, id, context, 'PLATFORM_MUTATION_UNSUPPORTED'));
      }
    } catch (err) {
      const status = Number(err && err.httpStatus) || 500;
      const log = status >= 500 ? console.error : console.warn;
      const details = err && err.details && typeof err.details === 'object' ? err.details : {};
      log('[PlaylistMutate]', provider, id, err && err.code || 'PLAYLIST_MUTATION_FAILED', err && err.message || '');
      sendJSON(res, {
        ok: false,
        provider,
        id,
        code: err && err.code || 'PLAYLIST_MUTATION_FAILED',
        ...(details.currentAccountId ? { currentAccountId: details.currentAccountId } : {}),
        ...(details.ownerId != null ? { ownerId: details.ownerId } : {}),
        ...(details.ownership ? { ownership: details.ownership } : {}),
        ...(details.operation ? { operation: details.operation } : {}),
        message: err && err.message || '歌单删除失败',
      }, status);
    } finally {
      playlistMutationInFlight.delete(mutationKey);
    }
    return;
  }

  // ---------- 红心状态 ----------
  if (pn === '/api/song/like/check') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!ids.length) { sendJSON(res, { error: 'Missing song id', liked: {}, ids: [] }, 400); return; }
      let likedIds = [];
      try {
        if (typeof song_like_check === 'function') {
          const checked = await song_like_check({ ids: JSON.stringify(ids.map(Number).filter(Boolean)), cookie: userCookie, timestamp: Date.now() });
          const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {};
          if (Array.isArray(data)) likedIds = data.map(String);
          else if (data && typeof data === 'object') {
            ids.forEach(id => {
              if (data[id] || data[String(id)] || data[Number(id)]) likedIds.push(String(id));
            });
          }
        }
      } catch (e) {
        console.warn('[LikeCheck] direct check failed:', e.message);
      }
      if (!likedIds.length) {
        const r = await likelist({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
        likedIds = ((r.body && r.body.ids) || []).map(String);
      }
      const set = new Set(likedIds);
      const liked = {};
      ids.forEach(id => { liked[id] = set.has(String(id)); });
      sendJSON(res, { loggedIn: true, ids, liked });
    } catch (err) {
      console.error('[LikeCheck]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 红心/取消红心 ----------
  if (pn === '/api/song/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return; }
      const r = await like_song({ id, like: String(nextLike), cookie: userCookie, timestamp: Date.now() });
      const code = (r.body && r.body.code) || r.code || 200;
      sendJSON(res, { loggedIn: true, id, liked: nextLike, code, body: r.body || r });
    } catch (err) {
      console.error('[Like]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 创建歌单 ----------
  if (pn === '/api/playlist/create') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const name = String(body.name || url.searchParams.get('name') || '').trim();
      const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
      if (!name) { sendJSON(res, { error: 'Missing playlist name' }, 400); return; }
      const r = await playlist_create({ name, privacy, cookie: userCookie, timestamp: Date.now() });
      const created = (r.body && (r.body.playlist || r.body.data)) || {};
      sendJSON(res, { loggedIn: true, playlist: created, body: r.body || r });
    } catch (err) {
      console.error('[PlaylistCreate]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 收藏歌曲到歌单 ----------
  if (pn === '/api/playlist/add-song') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid');
      const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
      if (!pid || !id) { sendJSON(res, { error: 'Missing playlist id or song id' }, 400); return; }
      const attempts = [];
      let finalBody = null;
      let finalCode = 0;
      let finalMessage = '';
      let success = false;

      const primary = await playlist_tracks({ op: 'add', pid, tracks: String(id), cookie: userCookie, timestamp: Date.now() });
      finalBody = primary.body || primary;
      finalCode = normalizeApiCode(primary);
      finalMessage = normalizeApiMessage(primary);
      success = finalCode === 200 && !(finalBody && finalBody.error);
      attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody });

      if (!success && typeof playlist_track_add === 'function') {
        try {
          const fallback = await playlist_track_add({ pid, ids: String(id), cookie: userCookie, timestamp: Date.now() });
          finalBody = fallback.body || fallback;
          finalCode = normalizeApiCode(fallback);
          finalMessage = normalizeApiMessage(fallback);
          success = finalCode === 200 && !(finalBody && finalBody.error);
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody });
        } catch (fallbackErr) {
          const errBody = fallbackErr.body || fallbackErr.response || {};
          finalBody = errBody;
          finalCode = normalizeApiCode(errBody);
          finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || '';
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody });
        }
      }

      if (!success) {
        sendJSON(res, { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts }, finalCode === 401 ? 401 : 409);
        return;
      }
      sendJSON(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts });
    } catch (err) {
      console.error('[PlaylistAddSong]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 歌词 ----------
  if (pn === '/api/lyric') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing song id', lyric: '' }, 400); return; }
      let body = {};
      let source = 'lyric';
      try {
        if (typeof lyric_new === 'function') {
          const nr = await lyric_new({ id, cookie: userCookie, timestamp: Date.now() });
          body = nr.body || {};
          source = 'lyric_new';
        }
      } catch (errNew) {
        console.warn('[LyricNew]', errNew.message);
      }
      if (!((body.lrc && body.lrc.lyric) || (body.yrc && body.yrc.lyric))) {
        const r = await lyric({ id, cookie: userCookie, timestamp: Date.now() });
        body = r.body || body || {};
        source = 'lyric';
      }
      sendJSON(res, {
        lyric: (body.lrc && body.lrc.lyric) || '',
        tlyric: (body.tlyric && body.tlyric.lyric) || '',
        yrc: (body.yrc && body.yrc.lyric) || '',
        source,
      });
    } catch (err) {
      console.error('[Lyric]', err);
      sendJSON(res, { error: err.message, lyric: '' }, 500);
    }
    return;
  }

  // ---------- 歌曲评论 ----------
  if (pn === '/api/song/comments') {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (!id) { sendJSON(res, { error: 'Missing song id', comments: [] }, 400); return; }
      const r = await comment_music({ id, limit, offset, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || r || {};
      const raw = body.hotComments && offset === 0 ? body.hotComments : (body.comments || []);
      const comments = (raw || []).map(c => ({
        id: c.commentId,
        content: c.content || '',
        likedCount: c.likedCount || 0,
        time: c.time || 0,
        user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
      })).filter(c => c.content);
      sendJSON(res, { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0), body });
    } catch (err) {
      console.error('[SongComments]', err);
      sendJSON(res, { error: err.message, comments: [] }, 500);
    }
    return;
  }

  // ---------- 歌手主页 / 热门歌曲 ----------
  if (pn === '/api/artist/detail') {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      if (!id) { sendJSON(res, { error: 'Missing artist id', songs: [] }, 400); return; }
      let detailBody = {};
      try {
        const detail = await artist_detail({ id, cookie: userCookie, timestamp: Date.now() });
        detailBody = detail.body || detail || {};
      } catch (e) {
        console.warn('[ArtistDetail] detail failed:', e.message);
      }
      let rawSongs = [];
      try {
        const list = await artist_songs({ id, order: 'hot', limit, offset: 0, cookie: userCookie, timestamp: Date.now() });
        const b = list.body || list || {};
        rawSongs = (b.songs || (b.data && b.data.songs) || []);
      } catch (e) {
        console.warn('[ArtistSongs] hot failed:', e.message);
      }
      if (!rawSongs.length) {
        const top = await artist_top_song({ id, cookie: userCookie, timestamp: Date.now() });
        const b = top.body || top || {};
        rawSongs = b.songs || [];
      }
      const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {};
      const songs = rawSongs.map(mapSongRecord).filter(s => s.id).slice(0, limit);
      sendJSON(res, {
        id,
        artist: {
          id: artist.id || id,
          name: artist.name || artist.artistName || '',
          avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
          brief: artist.briefDesc || artist.description || artist.desc || '',
          musicSize: artist.musicSize || artist.songSize || 0,
          albumSize: artist.albumSize || 0,
        },
        songs,
        body: detailBody,
      });
    } catch (err) {
      console.error('[ArtistDetail]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return;
  }

  // ---------- 歌单曲目详情 ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400); return; }

      let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
      let rawTracks = [];

      // 新版本 NeteaseCloudMusicApi 通常提供 playlist_track_all；旧版本退回 playlist_detail。
      if (typeof playlist_track_all === 'function') {
        try {
          const all = await playlist_track_all({ id, limit: 500, offset: 0, cookie: userCookie, timestamp: Date.now() });
          rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', err.message);
        }
      }

      if (!rawTracks.length && typeof playlist_detail === 'function') {
        const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
        const pl = (detail.body && detail.body.playlist) || {};
        playlistMeta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 };
        rawTracks = pl.tracks || [];
      }

      const tracks = rawTracks.map(mapSongRecord).filter(t => t.id);

      if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length;
      sendJSON(res, { playlist: playlistMeta, tracks });
    } catch (err) {
      console.error('[PlaylistTracks]', err);
      sendJSON(res, { error: err.message, tracks: [] }, 500);
    }
    return;
  }

  // ---------- 封面代理 (带 CORS 头, 给 canvas 提取像素用) ----------
  if (pn === '/api/cover') {
    try {
      const coverUrl = url.searchParams.get('url');
      // URL 校验: 必须是 http(s) 开头, 否则直接 404 (不要让 fetch 抛错)
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid cover url');
        return;
      }
      const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
      const ct  = resp.headers.get('content-type') || 'image/jpeg';
      const cl  = resp.headers.get('content-length');
      const hdr = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      };
      if (cl) hdr['Content-Length'] = cl;
      res.writeHead(resp.status, hdr);
      const reader = resp.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Cover]', err); res.writeHead(500); res.end(); }
    return;
  }

  // ---------- 音频代理 (支持 Range) ----------
  if (pn === '/api/audio') {
    let upstreamController = null;
    let connectTimer = null;
    try {
      const audioUrl = validateRemoteAudioUrl(url.searchParams.get('url'));
      if (!audioUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const range = req.headers.range || '';
      const hdr = audioProxyHeadersFor(audioUrl, range);
      upstreamController = new AbortController();
      connectTimer = setTimeout(() => upstreamController.abort(), 15000);
      res.once('close', () => { if (upstreamController) upstreamController.abort(); });
      const up = await fetch(audioUrl, { headers: hdr, signal: upstreamController.signal, redirect: 'follow' });
      clearTimeout(connectTimer);
      connectTimer = null;
      if (!up.body || up.status < 200 || up.status >= 300) {
        const surfacedStatus = [401, 403, 404, 410, 416].includes(up.status) ? up.status : 502;
        const failureHeaders = {
          'X-LumiField-Upstream-Status': String(up.status || 0),
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        };
        const failureContentRange = up.headers.get('content-range');
        if (failureContentRange) failureHeaders['Content-Range'] = failureContentRange;
        if (up.status === 416 || up.headers.get('accept-ranges')) failureHeaders['Accept-Ranges'] = up.headers.get('accept-ranges') || 'bytes';
        res.writeHead(surfacedStatus, failureHeaders);
        res.end('Audio upstream unavailable');
        return;
      }
      const out = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        'X-LumiField-Upstream-Status': String(up.status || 0),
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
      const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
      res.writeHead(up.status, out);
      const reader = up.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) {
      console.error('[Audio]', err && err.message || err);
      if (!res.headersSent) res.writeHead(err && /NOT_ALLOWED/.test(err.message || '') ? 400 : 502);
      if (!res.writableEnded) res.end();
    } finally {
      if (connectTimer) clearTimeout(connectTimer);
    }
    return;
  }

  // ---------- 静态资源 ----------
  if (pn === SOUNDTOUCH_PROCESSOR_ROUTE) {
    serveStatic(res, SOUNDTOUCH_PROCESSOR_PATH, {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    return;
  }
  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(__dirname, 'public', filePath);
  const hardenedPage = pn === '/lf-monitor.html' || pn === '/kugou-login.html';
  const staticHeaders = hardenedPage ? {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  } : null;
  serveStatic(res, filePath, staticHeaders);
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log(' 登录态: ' + (userCookie ? '已登录(cookie已加载)' : '未登录'));
  console.log('======================================================');
});

module.exports = server;
