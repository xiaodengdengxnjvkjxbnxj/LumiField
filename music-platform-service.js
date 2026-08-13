'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const os = require('os');
const QRCode = require('qrcode');

const PLATFORM_ORDER = Object.freeze(['kugou', 'kugou_concept', 'netease', 'qq', 'qishui']);
const SEARCH_PLATFORM_ORDER = Object.freeze(['kugou', 'netease', 'qq', 'qishui']);
const SEARCH_POLICY_VERSION = 'lf-search-v2';
const SEARCH_TTL_MS = 5 * 60 * 1000;
const SOURCE_TTL_MS = 60 * 1000;
const MAX_REMOTE_JSON_BYTES = 4 * 1024 * 1024;
const HOT_COMMENT_MAX_CANDIDATES_PER_PROVIDER = 20;
const HOT_COMMENT_MAX_JOBS = 40;
const KUGOU_APP_ID = 1005;
const KUGOU_ANDROID_CLIENT_VERSION = 20489;
const KUGOU_ANDROID_SIGNATURE_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const KUGOU_SOURCE_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';
const KUGOU_COMMENT_CODE = 'fc4be23b4e972707f36b8a828a93ba8a';
const KUGOU_LOGIN_BASE_URL = 'https://login-user.kugou.com';
const KUGOU_QR_PAGE_URL = 'https://h5.kugou.com/apps/loginQRCode/html/index.html';
const KUGOU_SOURCE_APP_ID = 2919;
const KUGOU_WEB_SIGNATURE_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const KUGOU_QR_SESSION_TTL_MS = 5 * 60 * 1000;
const KUGOU_STANDARD_RSA_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\n'
  + 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n'
  + '-----END PUBLIC KEY-----';
const KUGOU_CONCEPT_APP_ID = 3116;
const KUGOU_CONCEPT_QR_APP_ID = 1001;
const KUGOU_CONCEPT_ANDROID_CLIENT_VERSION = 11440;
const KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const KUGOU_CONCEPT_PLAY_KEY_SALT = 'kgcloudv2';
const QISHUI_API_ORIGIN = 'https://api.qishui.com';
const QISHUI_APP_ID = '386088';
const QISHUI_APP_VERSION = '3.5.1';
const QISHUI_APP_VERSION_CODE = '30050100';
const QISHUI_TRON_BUILD_ID = '408871041';
const QISHUI_QR_SESSION_TTL_MS = 5 * 60 * 1000;
const QISHUI_QR_EXPIRY_SAFETY_MS = 3 * 1000;
const QISHUI_COOKIE_ALLOWLIST = /^(?:sessionid|sessionid_ss|sid_guard|sid_tt|sid_tt_ss|uid_tt|uid_tt_ss|passport_csrf_token|passport_csrf_token_default|odin_tt|ttwid|s_v_web_id|store-region|store-region-src|reg-store-region|install_id|tt-target-idc)$/i;
const KUGOU_SESSION_ALLOWLIST = new Set([
  'token', 'userid', 'vip_token', 'vip_type', 'dfid', 'KUGOU_API_MID',
  'KUGOU_API_GUID', 'KUGOU_API_DEV', 'KUGOU_API_MAC', 'KUGOU_API_PLATFORM',
  'uuid', 'KugooID', 'KuGoo',
]);
const KUGOU_HTTP_COOKIE_ALLOWLIST = new Set([
  'token', 'userid', 'vip_token', 'vip_type', 'dfid', 'KUGOU_API_MID',
]);
const PLAYLIST_LINK_MAX_INPUT_LENGTH = 4096;
const PLAYLIST_LINK_MAX_URL_LENGTH = 2048;
const PLAYLIST_LINK_MAX_REDIRECTS = 5;
const PLAYLIST_LINK_REDIRECT_BODY_LIMIT = 64 * 1024;
const PLAYLIST_LINK_QUERY_KEYS = Object.freeze({
  netease: ['id', 'playlistid', 'playlist_id'],
  qq: ['id', 'disstid', 'dissid', 'tid', 'playlistid', 'playlist_id'],
  kugou: ['specialid', 'listid', 'playlistid', 'playlist_id', 'id'],
  kugou_concept: ['specialid', 'listid', 'playlistid', 'playlist_id', 'id'],
  qishui: ['playlist_id', 'playlistid', 'collection_id', 'collectionid', 'id'],
});

class PlaylistLinkError extends Error {
  constructor(code, message, httpStatus, details) {
    super(message || code);
    this.name = 'PlaylistLinkError';
    this.code = code;
    this.httpStatus = httpStatus || 400;
    this.details = details || null;
  }
}

function playlistLinkError(code, message, httpStatus, details) {
  return new PlaylistLinkError(code, message, httpStatus, details);
}

function playlistProviderForHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (host === 'music.163.com' || host === 'y.music.163.com' || host === '163cn.tv' || host === 'www.163cn.tv') return 'netease';
  if (host === 'y.qq.com' || host.endsWith('.y.qq.com')) return 'qq';
  if (host === 'kugou.com' || host.endsWith('.kugou.com')) return 'kugou';
  if (host === 'qishui.com' || host.endsWith('.qishui.com') || host === 'qishui.douyin.com') return 'qishui';
  return '';
}

function stripPlaylistUrlPunctuation(value) {
  return String(value || '').replace(/[\]\[(){}<>\u3008-\u3011\u3014-\u3015,.;:!?\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f]+$/u, '');
}

function extractPlaylistUrl(input) {
  if (typeof input !== 'string') {
    throw playlistLinkError('PLAYLIST_URL_REQUIRED', '请提供音乐平台歌单链接', 400);
  }
  const source = input.trim();
  if (!source) throw playlistLinkError('PLAYLIST_URL_REQUIRED', '请提供音乐平台歌单链接', 400);
  if (source.length > PLAYLIST_LINK_MAX_INPUT_LENGTH) {
    throw playlistLinkError('PLAYLIST_URL_TOO_LONG', '歌单链接内容过长', 413);
  }
  if (/\u0000|%00|%0d|%0a/i.test(source)) {
    throw playlistLinkError('PLAYLIST_URL_INVALID', '歌单链接包含非法字符', 400);
  }
  const matches = source.match(/https:\/\/[^\s<>"'`]+/gi) || [];
  const urls = Array.from(new Set(matches.map(stripPlaylistUrlPunctuation).filter(Boolean)));
  if (!urls.length) {
    if (/\bhttp:\/\//i.test(source)) {
      throw playlistLinkError('PLAYLIST_URL_HTTPS_REQUIRED', '仅支持 HTTPS 官方歌单链接', 400);
    }
    throw playlistLinkError('PLAYLIST_URL_INVALID', '未识别到有效的 HTTPS 歌单链接', 400);
  }
  if (urls.length !== 1) {
    throw playlistLinkError('PLAYLIST_URL_AMBIGUOUS', '一次只能导入一个歌单链接', 400);
  }
  if (urls[0].length > PLAYLIST_LINK_MAX_URL_LENGTH) {
    throw playlistLinkError('PLAYLIST_URL_TOO_LONG', '歌单链接过长', 413);
  }
  return { source, url: urls[0] };
}

function safeDecodeURIComponent(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch (_) { return String(value || ''); }
}

function playlistRouteText(parsed) {
  return [parsed.pathname, parsed.search, safeDecodeURIComponent(parsed.hash)].join(' ').toLowerCase();
}

function playlistQueryValue(parsed, names) {
  const lowered = new Set((names || []).map(name => String(name).toLowerCase()));
  for (const [key, value] of parsed.searchParams) {
    if (lowered.has(String(key).toLowerCase()) && value) return String(value).trim();
  }
  const hash = safeDecodeURIComponent(parsed.hash || '').replace(/^#/, '');
  const question = hash.indexOf('?');
  if (question >= 0) {
    const params = new URLSearchParams(hash.slice(question + 1));
    for (const [key, value] of params) {
      if (lowered.has(String(key).toLowerCase()) && value) return String(value).trim();
    }
  }
  return '';
}

function playlistPathValue(parsed, provider) {
  const path = safeDecodeURIComponent(parsed.pathname || '');
  const patterns = provider === 'netease'
    ? [/(?:^|\/)playlist(?:\/|\-)(\d{1,20})(?:\/|$)/i]
    : provider === 'qq'
      ? [/(?:^|\/)(?:playlist|taoge|diss)(?:\/|\-)(\d{1,20})(?:\/|$)/i]
      : provider === 'qishui'
        ? [/(?:^|\/)(?:playlist|collection)(?:\/|\-)([a-z0-9_-]{1,128})(?:\/|$)/i]
        : [/(?:^|\/)(?:special|plist|playlist|collection|list)(?:\/single\/|\/|\-)([a-z0-9_-]{1,128})(?:\.html?|\/|$)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(path);
    if (match && match[1]) return match[1];
  }
  return '';
}

function normalizePlaylistId(provider, value) {
  const raw = String(value || '').trim();
  if (provider === 'netease' || provider === 'qq') {
    if (!/^[1-9]\d{0,19}$/.test(raw)) return '';
    return raw;
  }
  if (!/^[a-z0-9_-]{1,128}$/i.test(raw) || /^0+$/.test(raw)) return '';
  return raw;
}

function canonicalPlaylistUrl(provider, playlistId) {
  const encoded = encodeURIComponent(playlistId);
  if (provider === 'netease') return 'https://music.163.com/playlist?id=' + encoded;
  if (provider === 'qq') return 'https://y.qq.com/n/ryqq/playlist/' + encoded;
  if (provider === 'kugou') return 'https://www.kugou.com/yy/special/single/' + encoded + '.html';
  if (provider === 'kugou_concept') return 'https://www.kugou.com/yy/special/single/' + encoded + '.html?appid=3116';
  if (provider === 'qishui') return 'https://www.qishui.com/playlist/' + encoded;
  return '';
}

function isPlaylistRoute(provider, routeText) {
  if (provider === 'netease') return /(?:^|[\s\/#?&])playlist(?:[\s\/#?&=]|$)/i.test(routeText);
  if (provider === 'qq') return /(?:playlist|taoge|diss|details\/taoge)/i.test(routeText);
  if (provider === 'kugou' || provider === 'kugou_concept') return /(?:special|plist|playlist|collection|cloudlist|list)/i.test(routeText);
  if (provider === 'qishui') return /(?:playlist|collection)/i.test(routeText);
  return false;
}

function isOfficialPlaylistShortLink(parsed, provider) {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (provider === 'netease') return host === '163cn.tv' || host === 'www.163cn.tv';
  if (provider === 'qq') return /\/base\/fcgi-bin\/u\/?$/i.test(path) || parsed.searchParams.has('__');
  if (provider === 'kugou' || provider === 'kugou_concept') {
    return host === 't.kugou.com' || host === 't1.kugou.com' || /\/(?:share|s)\//i.test(path);
  }
  if (provider === 'qishui') return host === 'qishui.douyin.com' || /^\/s\//i.test(path) || /\/share\//i.test(path);
  return false;
}

/**
 * Pure parser: validates one user-supplied official HTTPS playlist URL and
 * extracts only identifiers encoded by that URL. It performs no I/O.
 */
function parseOfficialPlaylistLink(input) {
  const extracted = extractPlaylistUrl(input);
  let parsed;
  try { parsed = new URL(extracted.url); }
  catch (_) { throw playlistLinkError('PLAYLIST_URL_INVALID', '歌单链接格式无效', 400); }
  if (parsed.protocol !== 'https:') {
    throw playlistLinkError('PLAYLIST_URL_HTTPS_REQUIRED', '仅支持 HTTPS 官方歌单链接', 400);
  }
  if (parsed.username || parsed.password) {
    throw playlistLinkError('PLAYLIST_URL_CREDENTIALS_FORBIDDEN', '歌单链接不得包含凭据', 400);
  }
  if (parsed.port && parsed.port !== '443') {
    throw playlistLinkError('PLAYLIST_URL_PORT_FORBIDDEN', '歌单链接不得使用非标准端口', 400);
  }
  const hostProvider = playlistProviderForHost(parsed.hostname);
  if (!hostProvider) {
    throw playlistLinkError('PLAYLIST_HOST_UNSUPPORTED', '仅支持五个音乐平台的官方链接', 422);
  }
  let provider = hostProvider;
  const route = playlistRouteText(parsed);
  if (provider === 'kugou' && (/(?:concept|lite)/i.test(route)
    || /(?:^|[?&])appid=3116(?:&|$)/i.test(parsed.search)
    || /酷狗概念版/.test(extracted.source))) provider = 'kugou_concept';
  const contextIsPlaylist = isPlaylistRoute(provider, route);
  let candidate = contextIsPlaylist ? playlistQueryValue(parsed, PLAYLIST_LINK_QUERY_KEYS[provider]) : '';
  if (!candidate) candidate = playlistPathValue(parsed, provider);
  const playlistId = normalizePlaylistId(provider, candidate);
  if (candidate && !playlistId) {
    throw playlistLinkError('PLAYLIST_ID_INVALID', '歌单 ID 格式无效', 400, { provider });
  }
  const shortLink = !playlistId && isOfficialPlaylistShortLink(parsed, provider);
  if (!playlistId && !shortLink) {
    throw playlistLinkError('PLAYLIST_ID_MISSING', '该官方链接中没有可识别的歌单 ID', 422, { provider });
  }
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return Object.freeze({
    provider,
    playlistId,
    normalizedUrl: playlistId ? canonicalPlaylistUrl(provider, playlistId) : parsed.toString(),
    submittedUrl: parsed.toString(),
    shortLink,
    requiresRedirect: shortLink,
  });
}

function md5(value) {
  return crypto.createHash('md5').update(String(value || ''), 'utf8').digest('hex');
}

function safeText(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLength || 256);
}

function playlistOwnershipMetadata(ownership, options) {
  options = options || {};
  ownership = /^(owned|subscribed)$/.test(String(ownership || '')) ? String(ownership) : 'unknown';
  const owned = ownership === 'owned';
  const subscribed = ownership === 'subscribed';
  const protectedPlaylist = options.protected === true;
  const deleteSupported = options.deleteSupported === true;
  const unsubscribeSupported = options.unsubscribeSupported === true;
  let mutationReason = safeText(options.mutationReason, 128);
  if (!mutationReason) {
    if (protectedPlaylist) mutationReason = 'PLAYLIST_PROTECTED';
    else if (ownership === 'unknown') mutationReason = 'PLAYLIST_OWNERSHIP_UNKNOWN';
    else if ((owned && !deleteSupported) || (subscribed && !unsubscribeSupported)) mutationReason = 'PLATFORM_MUTATION_UNSUPPORTED';
  }
  return {
    ownership,
    owned,
    subscribed,
    canDelete: owned && deleteSupported && !protectedPlaylist,
    canUnsubscribe: subscribed && unsubscribeSupported,
    mutationReason,
  };
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

function normalizeText(value) {
  return safeText(value, 512)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\(（\[【].*?[\)）\]】]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeArtistParts(value) {
  return safeText(value, 256)
    .split(/\s*[/,&、]\s*|\s+(?:feat\.?|ft\.?)\s+/i)
    .map(normalizeText)
    .filter(Boolean);
}

function isDerivativeText(value) {
  return /(翻唱|cover|伴奏|伴唱|instrumental|remix|dj(?:版)?|现场|演唱会|live|片段|铃声|纯音乐|纯享版|清唱|karaoke|demo|加速(?:版)?|降速(?:版)?|慢速(?:版)?|升调(?:版)?|降调(?:版)?|变速(?:版)?|氛围(?:版)?|烟嗓(?:版)?|治愈(?:版)?|\b\d+(?:\.\d+)?\s*x\b|sped\s*up|slowed|nightcore|女声版|男声版|抖音版|剪辑版|伤感版|改编|串烧|medley|车载版)/i.test(String(value || ''));
}

function derivativeKind(value) {
  value = String(value || '');
  if (/(现场|演唱会|live)/i.test(value)) return 'live';
  if (/(remix|dj(?:版)?|混音)/i.test(value)) return 'remix';
  if (/(伴奏|伴唱|instrumental|纯音乐|纯享版|karaoke)/i.test(value)) return 'instrumental';
  if (/(翻唱|cover|清唱|女声版|男声版)/i.test(value)) return 'cover';
  if (/(加速(?:版)?|降速(?:版)?|慢速(?:版)?|升调(?:版)?|降调(?:版)?|变速(?:版)?|氛围(?:版)?|烟嗓(?:版)?|治愈(?:版)?|\b\d+(?:\.\d+)?\s*x\b|sped\s*up|slowed|nightcore|抖音版|剪辑版|伤感版|片段|铃声|demo|改编|串烧|medley|车载版)/i.test(value)) return 'edited';
  return '';
}

function sameSong(source, candidate) {
  if (!source || !candidate) return false;
  const sourceTitle = normalizeText(source.name || source.title);
  const candidateTitle = normalizeText(candidate.name || candidate.title);
  if (!sourceTitle || !candidateTitle || sourceTitle !== candidateTitle) return false;
  const sourceVersion = derivativeKind([source.name, source.album].join(' '));
  const candidateVersion = derivativeKind([candidate.name, candidate.album].join(' '));
  if (sourceVersion !== candidateVersion) return false;
  const sourceArtists = normalizeArtistParts(source.artist || source.author);
  const candidateArtists = normalizeArtistParts(candidate.artist || candidate.author);
  if (!sourceArtists.length || !candidateArtists.length) return false;
  const left = Array.from(new Set(sourceArtists)).sort();
  const right = Array.from(new Set(candidateArtists)).sort();
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function sourceIdentity(song) {
  const title = normalizeText(song && (song.name || song.title));
  const artist = Array.from(new Set(normalizeArtistParts(song && (song.artist || song.author)))).sort().join('&');
  const version = derivativeKind([song && (song.name || song.title), song && song.album].join(' ')) || 'original';
  return title + '|' + artist + '|' + version;
}

function providerOf(song) {
  const provider = safeText(song && (song.provider || song.source || song.type), 24).toLowerCase();
  return PLATFORM_ORDER.includes(provider) ? provider : 'netease';
}

function realSongId(song, explicitProvider) {
  if (!song || typeof song !== 'object') return '';
  const provider = PLATFORM_ORDER.includes(explicitProvider) ? explicitProvider : providerOf(song);
  let id = '';
  if (provider === 'netease') id = song.id;
  else if (provider === 'qq') id = song.mid || song.songmid || song.id;
  else if (provider === 'kugou' || provider === 'kugou_concept') {
    id = song.mixSongId || song.albumAudioId || song.hash || song.id;
  } else if (provider === 'qishui') id = song.qishuiTrackId || song.id;
  id = safeText(id, 160);
  return id && id !== '0' ? id : '';
}

function realSongKey(song, explicitProvider) {
  const provider = PLATFORM_ORDER.includes(explicitProvider) ? explicitProvider : providerOf(song);
  const id = realSongId(song, provider);
  return id ? provider + ':' + id : '';
}

function secureKugouAssetUrl(value, size) {
  let raw = safeText(value, 2048);
  if (!raw) return '';
  raw = raw.replace(/\{size\}/g, String(size || 400));
  if (raw.startsWith('http://')) raw = 'https://' + raw.slice(7);
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'kugou.com' || host.endsWith('.kugou.com') || host.endsWith('.kgimg.com'))) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function requestJsonResponse(targetUrl, options, body) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      reject(new Error('REMOTE_PROTOCOL_NOT_ALLOWED'));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, response => {
      const chunks = [];
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_REMOTE_JSON_BYTES) {
          request.destroy(new Error('REMOTE_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode || 500) >= 400) {
          const error = new Error('REMOTE_HTTP_' + response.statusCode);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        try {
          const jsonText = text
            .replace('<!--KG_TAG_RES_START-->', '')
            .replace('<!--KG_TAG_RES_END-->', '')
            .trim()
            .replace(/^[^(]+\((.*)\);?$/s, '$1');
          resolve({
            data: JSON.parse(jsonText),
            statusCode: response.statusCode || 0,
            headers: response.headers || {},
          });
        } catch (_) {
          reject(new Error('REMOTE_INVALID_JSON'));
        }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('REMOTE_TIMEOUT')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function requestJson(targetUrl, options, body) {
  const response = await requestJsonResponse(targetUrl, options, body);
  return response.data;
}

function readOfficialPlaylistRedirect(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch (_) { reject(playlistLinkError('PLAYLIST_SHORT_LINK_INVALID', '官方短链格式无效', 400)); return; }
    if (parsed.protocol !== 'https:' || !playlistProviderForHost(parsed.hostname) || parsed.username || parsed.password
      || (parsed.port && parsed.port !== '443')) {
      reject(playlistLinkError('PLAYLIST_REDIRECT_REJECTED', '官方短链跳转目标不安全', 400));
      return;
    }
    const request = https.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LumiField/1.0',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.1',
        Range: 'bytes=0-' + (PLAYLIST_LINK_REDIRECT_BODY_LIMIT - 1),
      },
    }, response => {
      const status = Number(response.statusCode || 0);
      const location = safeText(response.headers && response.headers.location, PLAYLIST_LINK_MAX_URL_LENGTH);
      if (status >= 300 && status < 400 && location) {
        response.resume();
        try { resolve(new URL(location, parsed).toString()); }
        catch (_) { reject(playlistLinkError('PLAYLIST_REDIRECT_INVALID', '官方短链返回了无效跳转地址', 502)); }
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > PLAYLIST_LINK_REDIRECT_BODY_LIMIT) {
          request.destroy(playlistLinkError('PLAYLIST_REDIRECT_RESPONSE_TOO_LARGE', '官方短链响应过大', 502));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(playlistLinkError('PLAYLIST_SHORT_LINK_HTTP_ERROR', '官方短链暂时不可用', status === 404 ? 404 : 502, { status }));
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        const candidates = [];
        const add = value => {
          if (!value) return;
          const decoded = String(value).replace(/&amp;/gi, '&').replace(/\\\//g, '/');
          try { candidates.push(new URL(decoded, parsed).toString()); } catch (_) {}
        };
        const canonical = /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(text)
          || /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical/i.exec(text);
        const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url\s*=\s*([^"';]+)["']/i.exec(text);
        const jsonUrl = /["'](?:url|redirect_url|redirectUrl|location)["']\s*:\s*["'](https:[^"']+)["']/i.exec(text);
        add(canonical && canonical[1]);
        add(refresh && refresh[1]);
        add(jsonUrl && jsonUrl[1]);
        const usable = candidates.find(value => value !== parsed.toString() && playlistProviderForHost(new URL(value).hostname));
        if (usable) resolve(usable);
        else reject(playlistLinkError('PLAYLIST_SHORT_LINK_UNRESOLVED', '官方短链未返回可识别的歌单地址', 422));
      });
    });
    request.setTimeout(10000, () => request.destroy(playlistLinkError('PLAYLIST_SHORT_LINK_TIMEOUT', '官方短链解析超时', 504)));
    request.on('error', error => reject(error instanceof PlaylistLinkError
      ? error
      : playlistLinkError('PLAYLIST_SHORT_LINK_FAILED', '官方短链解析失败', 502, { cause: safeText(error && error.message, 160) })));
    request.end();
  });
}

async function resolveOfficialPlaylistLink(input, options) {
  let parsed = parseOfficialPlaylistLink(input);
  if (!parsed.requiresRedirect) return parsed;
  const readRedirect = options && typeof options.readRedirect === 'function'
    ? options.readRedirect
    : readOfficialPlaylistRedirect;
  const initialProvider = parsed.provider;
  const visited = new Set();
  let current = parsed.submittedUrl;
  for (let count = 0; count < PLAYLIST_LINK_MAX_REDIRECTS; count += 1) {
    if (visited.has(current)) throw playlistLinkError('PLAYLIST_REDIRECT_LOOP', '官方短链发生循环跳转', 502);
    visited.add(current);
    const next = await readRedirect(current, { provider: initialProvider, redirectCount: count });
    if (typeof next !== 'string' || !next.trim()) {
      throw playlistLinkError('PLAYLIST_SHORT_LINK_UNRESOLVED', '官方短链未返回可识别的歌单地址', 422);
    }
    let nextParsed;
    try { nextParsed = parseOfficialPlaylistLink(next); }
    catch (error) {
      if (error instanceof PlaylistLinkError && error.code === 'PLAYLIST_ID_MISSING') {
        current = next;
        continue;
      }
      throw error;
    }
    const sameFamily = nextParsed.provider === initialProvider
      || (/^kugou(?:_concept)?$/.test(nextParsed.provider) && /^kugou(?:_concept)?$/.test(initialProvider));
    if (!sameFamily) {
      throw playlistLinkError('PLAYLIST_REDIRECT_PROVIDER_MISMATCH', '官方短链跳转到了其他平台', 400);
    }
    if (nextParsed.playlistId) return nextParsed;
    current = nextParsed.submittedUrl;
  }
  throw playlistLinkError('PLAYLIST_REDIRECT_LIMIT', '官方短链跳转次数过多', 502);
}

function sanitizeSearchSong(song) {
  if (!song || typeof song !== 'object') return null;
  const provider = providerOf(song);
  const id = safeText(song.id || song.mid || song.hash, 160);
  const name = safeText(song.name || song.title, 256);
  if (!id || !name) return null;
  const artists = Array.isArray(song.artists)
    ? song.artists.map(item => ({ id: safeText(item && (item.id || item.mid), 96), name: safeText(item && item.name, 128) })).filter(item => item.name)
    : [];
  const climaxStartSec = normalizeClimaxStartSec(song, song.duration || song.durationMs || song.dt);
  return {
    provider,
    source: provider,
    type: provider === 'qq' ? 'qq' : (/^kugou(?:_concept)?$/.test(provider) || provider === 'qishui' ? provider : 'song'),
    id,
    qqId: safeText(song.qqId, 96),
    mid: safeText(song.mid || song.songmid, 160),
    songmid: safeText(song.songmid || song.mid, 160),
    mediaMid: safeText(song.mediaMid || song.media_mid, 160),
    hash: safeText(song.hash || song.fileHash, 96).toUpperCase(),
    hqHash: safeText(song.hqHash, 96).toUpperCase(),
    sqHash: safeText(song.sqHash, 96).toUpperCase(),
    albumId: safeText(song.albumId || song.album_id, 96),
    albumAudioId: safeText(song.albumAudioId || song.album_audio_id || song.mixSongId, 96),
    mixSongId: safeText(song.mixSongId || song.albumAudioId || song.id, 96),
    qishuiTrackId: safeText(song.qishuiTrackId || song.id, 160),
    mediaType: safeText(song.mediaType || song.qishuiMediaType || 'track', 32),
    qishuiMediaType: safeText(song.qishuiMediaType || song.mediaType || 'track', 32),
    name,
    artist: safeText(song.artist || song.author, 256),
    artists,
    artistId: safeText(song.artistId, 96),
    artistMid: safeText(song.artistMid, 96),
    album: safeText(song.album, 256),
    cover: safeText(song.cover, 2048),
    duration: Math.max(0, Number(song.duration) || 0),
    climaxStartSec,
    fee: Number(song.fee || 0) || 0,
    playable: song.playable === true ? true : (song.playable === false ? false : null),
    restriction: song.restriction && typeof song.restriction === 'object' ? {
      category: safeText(song.restriction.category, 64),
      message: safeText(song.restriction.message, 256),
    } : null,
    heat: Math.max(0, Number(song.heat || song.playCount || song.ownerCount) || 0),
    officialOriginal: song.officialOriginal === true,
    qualityRank: Math.max(0, Number(song.qualityRank) || 0),
  };
}

function normalizePlatformComment(provider, fallbackSong, comment) {
  if (!comment || typeof comment !== 'object') return null;
  provider = PLATFORM_ORDER.includes(provider) ? provider : providerOf(fallbackSong || comment.song);
  const song = sanitizeSearchSong(comment.song || fallbackSong);
  const originalContent = String(comment.content == null ? '' : comment.content);
  const content = safeText(originalContent, 4000);
  if (!song || !content) return null;
  const user = comment.user && typeof comment.user === 'object' ? comment.user : {};
  song.provider = provider;
  song.source = provider;
  return {
    id: safeText(comment.id || comment.commentId, 128),
    content,
    contentTruncated: originalContent.trim().length > content.length,
    likedCount: Math.max(0, Number(comment.likedCount || comment.likes) || 0),
    time: Math.max(0, Number(comment.time || comment.createdAt) || 0),
    user: {
      id: safeText(user.id || user.userId || user.uin, 128),
      nickname: safeText(user.nickname || user.name || user.nick, 128),
      avatar: safeText(user.avatar || user.avatarUrl || user.avatarurl, 2048),
    },
    provider,
    source: provider,
    song,
  };
}

function mapKugouSong(raw) {
  raw = raw || {};
  const filename = safeText(raw.FileName || raw.filename, 512);
  const filenameParts = filename.split(/\s+-\s+/);
  const id = raw.MixSongID || raw.mixsongid || raw.album_audio_id || raw.ID || raw.id || raw.Audioid || raw.FileHash || raw.filehash || raw.hash || '';
  const hash = raw.FileHash || raw.filehash || raw.hash || '';
  const hqHash = raw.HQFileHash || raw.hq_hash || '';
  const sqHash = raw.SQFileHash || raw.sq_hash || '';
  const singerName = raw.SingerName || raw.singername || raw.author_name || raw.singer || (filenameParts.length > 1 ? filenameParts.shift() : '');
  const name = raw.SongName || raw.songname || raw.audio_name || raw.name || (filenameParts.length ? filenameParts.join(' - ') : filename);
  const albumId = raw.AlbumID || raw.album_id || '';
  const payType = Number(raw.PayType || raw.pay_type || raw.HQPayType || 0) || 0;
  const privilege = Number(raw.Privilege || raw.privilege || 0) || 0;
  const free = !!hash && payType === 0 && privilege === 0;
  const image = raw.AlbumImage || raw.Image || raw.img || raw.cover || raw.union_cover || '';
  const singers = Array.isArray(raw.Singers) ? raw.Singers : [];
  const durationValue = Number(raw.Duration || raw.duration || raw.timelength || 0) || 0;
  return sanitizeSearchSong({
    provider: 'kugou',
    id,
    hash,
    hqHash,
    sqHash,
    albumId,
    albumAudioId: raw.MixSongID || raw.album_audio_id || raw.ID || id,
    mixSongId: raw.MixSongID || raw.mixsongid || id,
    name,
    artist: singerName,
    artists: singers.map(item => ({ id: item && item.id, name: item && item.name })),
    album: raw.AlbumName || raw.album_name || '',
    cover: secureKugouAssetUrl(image, 400),
    duration: durationValue > 10000 ? durationValue : durationValue * 1000,
    climaxStartSec: normalizeClimaxStartSec(raw, durationValue > 10000 ? durationValue : durationValue * 1000),
    fee: free ? 0 : 1,
    playable: free,
    restriction: free ? null : { category: 'vip_required', message: '酷狗当前版本需要会员、购买或其他合法播放权限' },
    heat: Number(raw.OwnerCount || raw.owner_count || raw.HeatLevel || raw.heat || 0) || 0,
    officialOriginal: Number(raw.IsOriginal || raw.is_original || 0) === 1,
    qualityRank: sqHash ? 3 : (hqHash ? 2 : 1),
  });
}

function scoreSong(song, query, sourceIndex) {
  const queryText = normalizeText(query);
  const name = normalizeText(song.name);
  const artist = normalizeText(song.artist);
  const album = normalizeText(song.album);
  const derivative = isDerivativeText([song.name, song.artist, song.album].join(' '));
  const wantsDerivative = isDerivativeText(query);
  const rawArtist = safeText(song.artist, 256).normalize('NFKC').toLowerCase();
  const artistAliases = Array.from(new Set([
    artist,
    ...((rawArtist.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) || []).map(normalizeText)),
  ].filter(alias => alias && alias.length >= 2))).sort((left, right) => right.length - left.length);
  const queryRemainder = name && queryText.includes(name) ? queryText.replace(name, '') : '';
  const asksForSpecificArtist = queryRemainder.length >= 2;
  const matchedArtistAlias = artistAliases.find(alias =>
    queryText.includes(alias) || (asksForSpecificArtist && (queryRemainder.includes(alias) || alias.includes(queryRemainder)))
  ) || '';
  const exactArtist = !!matchedArtistAlias;
  const exactTitle = !!(name && (queryText === name || (queryText.includes(name) && (!asksForSpecificArtist || exactArtist))));
  let score = 0;
  if (exactTitle) score += 190;
  else if (name && queryText.includes(name)) score += 132;
  else if (name && name.includes(queryText)) score += 86;
  if (exactArtist) score += 118;
  if (exactTitle && exactArtist) score += 170;
  if (asksForSpecificArtist && !exactArtist) score -= 240;
  if (album && queryText.includes(album)) score += 24;
  if (song.officialOriginal) score += 48;
  if (song.playable === true) score += 34;
  else if (song.playable === false) score -= 22;
  if (!wantsDerivative && derivative) score -= 185;
  else if (wantsDerivative && derivative) score += 42;
  score += Math.min(30, Math.log10(Math.max(1, Number(song.heat) || 1)) * 5);
  const providerIndex = SEARCH_PLATFORM_ORDER.indexOf(providerOf(song));
  score += providerIndex < 0 ? 0 : (SEARCH_PLATFORM_ORDER.length - providerIndex) * 3;
  score -= Math.max(0, Number(sourceIndex) || 0) * 0.35;
  return Math.round(score * 100) / 100;
}

function rankSongs(songs, query) {
  return (Array.isArray(songs) ? songs : [])
    .map(sanitizeSearchSong)
    .filter(Boolean)
    .map((song, index) => ({ ...song, searchScore: scoreSong(song, query, index) }))
    .sort((left, right) => right.searchScore - left.searchScore);
}

function foldSongs(songs, limit) {
  const groups = new Map();
  songs.forEach(song => {
    const key = sourceIdentity(song);
    if (!key || key === '|') return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(song);
  });
  return Array.from(groups.values()).map(versions => {
    versions.sort((left, right) => {
      const scoreDelta = (right.searchScore || 0) - (left.searchScore || 0);
      if (scoreDelta) return scoreDelta;
      const playableDelta = Number(right.playable === true) - Number(left.playable === true);
      if (playableDelta) return playableDelta;
      const leftIndex = SEARCH_PLATFORM_ORDER.indexOf(providerOf(left));
      const rightIndex = SEARCH_PLATFORM_ORDER.indexOf(providerOf(right));
      return (leftIndex < 0 ? SEARCH_PLATFORM_ORDER.length : leftIndex) - (rightIndex < 0 ? SEARCH_PLATFORM_ORDER.length : rightIndex);
    });
    const primary = { ...versions[0] };
    primary.alternatives = versions.slice(1).map(version => ({ ...version, alternatives: undefined }));
    primary.platforms = Array.from(new Set(versions.map(providerOf)));
    return primary;
  }).sort((left, right) => (right.searchScore || 0) - (left.searchScore || 0)).slice(0, limit);
}

function parseCookieInput(input) {
  const output = {};
  const add = (key, value) => {
    key = safeText(key, 64);
    value = safeText(value, 4096);
    if (KUGOU_SESSION_ALLOWLIST.has(key) && value) output[key] = value;
  };
  if (Array.isArray(input)) {
    input.forEach(item => {
      if (item && typeof item === 'object') add(item.name, item.value);
      else Object.assign(output, parseCookieInput(item));
    });
  } else if (input && typeof input === 'object') {
    Object.keys(input).forEach(key => add(key, input[key] && typeof input[key] === 'object' ? input[key].value : input[key]));
  } else {
    String(input || '').split(';').forEach(part => {
      const index = part.indexOf('=');
      if (index > 0) add(part.slice(0, index), part.slice(index + 1));
    });
  }
  return output;
}

function createMusicPlatformService(dependencies) {
  const deps = dependencies || {};
  const playlistRequestJson = typeof deps.playlistRequestJson === 'function' ? deps.playlistRequestJson : requestJson;
  const searchCache = new Map();
  const sourceCache = new Map();
  const clientGuid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  const clientMid = BigInt('0x' + md5(clientGuid)).toString(10);
  const kugouDeviceCookies = Object.freeze({
    KUGOU_API_PLATFORM: 'music',
    KUGOU_API_GUID: clientGuid,
    KUGOU_API_MID: clientMid,
    KUGOU_API_DEV: crypto.randomBytes(5).toString('hex').toUpperCase(),
    KUGOU_API_MAC: '02:00:00:00:00:00',
  });
  let kugouCookies = { ...kugouDeviceCookies };
  let kugouProfile = null;
  let kugouSessionUpdatedAt = 0;
  let kugouAccountRefreshPromise = null;
  const kugouQrSessions = new Map();
  let kugouSessionGeneration = 0;
  const conceptClientGuid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  const conceptClientMid = BigInt('0x' + md5(conceptClientGuid)).toString(10);
  const kugouConceptDeviceCookies = Object.freeze({
    KUGOU_API_PLATFORM: 'lite',
    KUGOU_API_GUID: conceptClientGuid,
    KUGOU_API_MID: conceptClientMid,
    KUGOU_API_DEV: crypto.randomBytes(5).toString('hex').toUpperCase(),
    KUGOU_API_MAC: '02:00:00:00:00:00',
  });
  let kugouConceptCookies = { ...kugouConceptDeviceCookies };
  let kugouConceptProfile = null;
  let kugouConceptSessionUpdatedAt = 0;
  let kugouConceptAccountRefreshPromise = null;
  const kugouConceptQrSessions = new Map();
  let kugouConceptSessionGeneration = 0;
  const newQishuiDeviceId = () => BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(10);
  let qishuiDevice = { deviceId: newQishuiDeviceId(), installId: newQishuiDeviceId() };
  let qishuiCookies = {};
  let qishuiProfile = null;
  let qishuiSessionUpdatedAt = 0;
  let qishuiAccountRefreshPromise = null;
  const qishuiQrSessions = new Map();
  let qishuiSessionGeneration = 0;
  const authOperationQueues = new Map();

  function runAuthOperation(provider, task) {
    const previous = (authOperationQueues.get(provider) || Promise.resolve()).catch(() => {});
    const operation = previous.then(task);
    authOperationQueues.set(provider, operation);
    operation.finally(() => {
      if (authOperationQueues.get(provider) === operation) authOperationQueues.delete(provider);
    }).catch(() => {});
    return operation;
  }

  function invalidateKugouAuthGeneration() {
    kugouSessionGeneration += 1;
    kugouQrSessions.clear();
    kugouAccountRefreshPromise = null;
    return kugouSessionGeneration;
  }

  function invalidateKugouConceptAuthGeneration() {
    kugouConceptSessionGeneration += 1;
    kugouConceptQrSessions.clear();
    kugouConceptAccountRefreshPromise = null;
    return kugouConceptSessionGeneration;
  }

  function invalidateQishuiAuthGeneration() {
    qishuiSessionGeneration += 1;
    qishuiQrSessions.clear();
    qishuiAccountRefreshPromise = null;
    return qishuiSessionGeneration;
  }

  function assertAuthGeneration(actual, expected, code) {
    if (actual !== expected) throw new Error(code);
  }

  function pruneCache(cache, maxSize) {
    const now = Date.now();
    for (const [key, entry] of cache) if (!entry || entry.expiresAt <= now) cache.delete(key);
    while (cache.size > maxSize) cache.delete(cache.keys().next().value);
  }

  function kugouLoggedIn() {
    return !!(safeText(kugouCookies.userid, 64).replace(/\D/g, '') && safeText(kugouCookies.token, 4096));
  }

  function kugouCookieHeader() {
    return Object.keys(kugouCookies)
      .filter(key => KUGOU_HTTP_COOKIE_ALLOWLIST.has(key) && kugouCookies[key])
      .map(key => key + '=' + encodeURIComponent(safeText(kugouCookies[key], 4096)))
      .join('; ');
  }

  function kugouRequest(options) {
    options = options || {};
    const bodyText = options.body ? JSON.stringify(options.body) : '';
    const clienttime = Math.floor(Date.now() / 1000);
    const mid = /^[a-f0-9]{32,64}$/i.test(kugouCookies.KUGOU_API_MID || '') ? kugouCookies.KUGOU_API_MID : clientMid;
    const dfid = safeText(kugouCookies.dfid || '-', 64) || '-';
    const userid = safeText(kugouCookies.userid || '0', 64).replace(/\D/g, '') || '0';
    const token = safeText(kugouCookies.token, 4096);
    const params = Object.assign({
      dfid,
      mid,
      uuid: '-',
      appid: KUGOU_APP_ID,
      clientver: options.clientver || KUGOU_ANDROID_CLIENT_VERSION,
      clienttime,
    }, options.includeSession && token ? { token, userid } : {}, options.params || {});
    if (options.sourceKeyHash) {
      params.key = md5(String(options.sourceKeyHash).toLowerCase() + KUGOU_SOURCE_KEY_SALT + KUGOU_APP_ID + mid + userid);
    }
    params.signature = md5(KUGOU_ANDROID_SIGNATURE_SALT + Object.keys(params).sort().map(key => key + '=' + params[key]).join('') + bodyText + KUGOU_ANDROID_SIGNATURE_SALT);
    const baseURL = safeText(options.baseURL || 'https://gateway.kugou.com', 512);
    const base = new URL(baseURL);
    const baseHost = base.hostname.toLowerCase();
    if (base.protocol !== 'https:' || !(baseHost === 'kugou.com' || baseHost.endsWith('.kugou.com'))) {
      throw new Error('KUGOU_API_ORIGIN_REJECTED');
    }
    const url = new URL(options.path, base);
    Object.keys(params).forEach(key => url.searchParams.set(key, String(params[key])));
    const headers = {
      'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
      'Content-Type': 'application/json;charset=UTF-8',
      dfid,
      clienttime: String(clienttime),
      mid,
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    };
    if (options.router) headers['x-router'] = options.router;
    // MakcRe/KuGouMusicApi 的 Node 请求以签名参数/请求体传递会话，不依赖浏览器 Cookie。
    // 仅为明确要求 Cookie 的官方接口启用，避免把昵称、头像等资料写入 HTTP 头。
    if (options.sendCookieHeader === true) {
      const cookie = kugouCookieHeader();
      if (cookie) headers.Cookie = cookie;
    }
    if (bodyText) headers['Content-Length'] = Buffer.byteLength(bodyText);
    return requestJson(url.toString(), { method: options.method || 'GET', headers }, bodyText);
  }

  function kugouWebSignature(params) {
    const serialized = Object.keys(params || {}).sort().map(key => key + '=' + params[key]).join('');
    return md5(KUGOU_WEB_SIGNATURE_SALT + serialized + KUGOU_WEB_SIGNATURE_SALT);
  }

  function kugouLoginRequest(pathname, extraParams) {
    const clienttime = Math.floor(Date.now() / 1000);
    const params = Object.assign({
      dfid: safeText(kugouCookies.dfid || '-', 64) || '-',
      mid: safeText(kugouCookies.KUGOU_API_MID || clientMid, 96),
      uuid: safeText(kugouCookies.uuid || '-', 96) || '-',
      appid: KUGOU_APP_ID,
      clientver: KUGOU_ANDROID_CLIENT_VERSION,
      clienttime,
    }, extraParams || {});
    params.signature = kugouWebSignature(params);
    const url = new URL(pathname, KUGOU_LOGIN_BASE_URL);
    Object.keys(params).forEach(key => url.searchParams.set(key, String(params[key])));
    return requestJson(url.toString(), {
      headers: {
        dfid: String(params.dfid),
        clienttime: String(params.clienttime),
        mid: String(params.mid),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        Referer: KUGOU_QR_PAGE_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
    });
  }

  function pruneKugouQrSessions() {
    const now = Date.now();
    for (const [key, entry] of kugouQrSessions) {
      if (!entry || entry.expiresAt <= now || entry.used) kugouQrSessions.delete(key);
    }
  }

  function kugouConceptLoggedIn() {
    return !!(safeText(kugouConceptCookies.userid, 64).replace(/\D/g, '') && safeText(kugouConceptCookies.token, 4096));
  }

  function kugouConceptCookieHeader() {
    return Object.keys(kugouConceptCookies)
      .filter(key => KUGOU_HTTP_COOKIE_ALLOWLIST.has(key) && kugouConceptCookies[key])
      .map(key => key + '=' + encodeURIComponent(safeText(kugouConceptCookies[key], 4096)))
      .join('; ');
  }

  function kugouConceptRequest(options) {
    options = options || {};
    const bodyText = options.body ? JSON.stringify(options.body) : '';
    const clienttime = Math.floor(Date.now() / 1000);
    const mid = safeText(kugouConceptCookies.KUGOU_API_MID || conceptClientMid, 96) || conceptClientMid;
    const dfid = safeText(kugouConceptCookies.dfid || '-', 64) || '-';
    const userid = safeText(kugouConceptCookies.userid || '0', 64).replace(/\D/g, '') || '0';
    const token = safeText(kugouConceptCookies.token, 4096);
    const params = Object.assign({
      dfid,
      mid,
      uuid: '-',
      appid: KUGOU_CONCEPT_APP_ID,
      clientver: options.clientver || KUGOU_CONCEPT_ANDROID_CLIENT_VERSION,
      clienttime,
    }, options.includeSession && token ? { token, userid } : {}, options.params || {});
    params.signature = md5(KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT
      + Object.keys(params).sort().map(key => key + '=' + params[key]).join('')
      + bodyText
      + KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT);
    const baseURL = safeText(options.baseURL || 'https://gateway.kugou.com', 512);
    const base = new URL(baseURL);
    const baseHost = base.hostname.toLowerCase();
    if (base.protocol !== 'https:' || !(baseHost === 'kugou.com' || baseHost.endsWith('.kugou.com'))) {
      throw new Error('KUGOU_CONCEPT_API_ORIGIN_REJECTED');
    }
    const url = new URL(options.path, base);
    Object.keys(params).forEach(key => url.searchParams.set(key, String(params[key])));
    const headers = {
      'User-Agent': 'Android15-1070-11440-46-0-DiscoveryDRADProtocol-wifi',
      'Content-Type': 'application/json;charset=UTF-8',
      dfid,
      clienttime: String(clienttime),
      mid,
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    };
    if (options.router) headers['x-router'] = options.router;
    if (options.sendCookieHeader === true) {
      const cookie = kugouConceptCookieHeader();
      if (cookie) headers.Cookie = cookie;
    }
    if (bodyText) headers['Content-Length'] = Buffer.byteLength(bodyText);
    return requestJson(url.toString(), { method: options.method || 'GET', headers }, bodyText);
  }

  function kugouConceptLoginRequest(pathname, extraParams) {
    const clienttime = Math.floor(Date.now() / 1000);
    const params = Object.assign({
      dfid: safeText(kugouConceptCookies.dfid || '-', 64) || '-',
      mid: safeText(kugouConceptCookies.KUGOU_API_MID || conceptClientMid, 96),
      uuid: safeText(kugouConceptCookies.uuid || '-', 96) || '-',
      appid: KUGOU_CONCEPT_APP_ID,
      clientver: KUGOU_CONCEPT_ANDROID_CLIENT_VERSION,
      clienttime,
    }, extraParams || {});
    params.signature = kugouWebSignature(params);
    const url = new URL(pathname, KUGOU_LOGIN_BASE_URL);
    Object.keys(params).forEach(key => url.searchParams.set(key, String(params[key])));
    return requestJson(url.toString(), {
      headers: {
        dfid: String(params.dfid),
        clienttime: String(params.clienttime),
        mid: String(params.mid),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        Referer: KUGOU_QR_PAGE_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
    });
  }

  function pruneKugouConceptQrSessions() {
    const now = Date.now();
    for (const [key, entry] of kugouConceptQrSessions) {
      if (!entry || entry.expiresAt <= now || entry.used) kugouConceptQrSessions.delete(key);
    }
  }

  function qishuiCookieInput(input) {
    const output = {};
    const add = (name, value) => {
      name = safeText(name, 96);
      value = String(value == null ? '' : value).replace(/[\r\n;]/g, '').slice(0, 4096);
      if (QISHUI_COOKIE_ALLOWLIST.test(name) && value) output[name] = value;
    };
    if (Array.isArray(input)) {
      input.forEach(item => item && add(item.name, item.value));
    } else if (input && typeof input === 'object') {
      Object.keys(input).forEach(name => add(name, input[name]));
    } else {
      String(input || '').split(';').forEach(part => {
        const index = part.indexOf('=');
        if (index > 0) add(part.slice(0, index), part.slice(index + 1));
      });
    }
    return output;
  }

  function mergeQishuiSetCookies(target, values) {
    target = target || {};
    for (const entry of Array.isArray(values) ? values : []) {
      const first = String(entry || '').split(';', 1)[0];
      const index = first.indexOf('=');
      if (index <= 0) continue;
      const parsed = qishuiCookieInput({ [first.slice(0, index)]: first.slice(index + 1) });
      Object.assign(target, parsed);
    }
    return target;
  }

  function qishuiCookieHeader(cookies) {
    return Object.keys(cookies || {})
      .filter(name => QISHUI_COOKIE_ALLOWLIST.test(name) && cookies[name])
      .map(name => name + '=' + String(cookies[name]).replace(/[\r\n;]/g, '').slice(0, 4096))
      .join('; ');
  }

  function qishuiSessionCookie(cookies) {
    return safeText(cookies && (cookies.sessionid || cookies.sessionid_ss), 4096);
  }

  function qishuiLoggedIn() {
    return !!(qishuiSessionCookie(qishuiCookies) && qishuiProfile
      && qishuiProfile.profileVerified === true && safeText(qishuiProfile.userId, 96));
  }

  function qishuiUrlInfo(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    const lists = [value.url_list, value.urlList, value.urls].find(Array.isArray) || [];
    const direct = value.url || value.url_path || value.urlPath || value.uri || '';
    if (lists.length) {
      const first = String(lists[0] || '');
      if (/^https?:\/\//i.test(first)) {
        const uri = String(value.uri || '');
        return uri && !first.includes(uri) && /\/$/.test(first) ? first + uri.replace(/^\//, '') : first;
      }
    }
    return String(direct || '');
  }

  function secureQishuiUrl(value, media) {
    const raw = safeText(qishuiUrlInfo(value), 4096).replace(/^http:\/\//i, 'https://');
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const roots = media
        ? ['qishui.com', 'douyinvod.com', 'bytecdn.cn', 'byteimg.com', 'ibytedtos.com', 'bytedance.com', 'bytedanceapi.com', 'pstatp.com', 'volccdn.com']
        : ['qishui.com', 'byteimg.com', 'ibytedtos.com', 'bytedance.com', 'douyinpic.com', 'douyinstatic.com', 'pstatp.com'];
      if (parsed.protocol !== 'https:' || !roots.some(root => host === root || host.endsWith('.' + root))) return '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  }

  function qishuiCommonParams() {
    return {
      aid: QISHUI_APP_ID,
      app_name: 'luna_pc',
      region: 'cn',
      geo_region: 'cn',
      os_region: 'cn',
      sim_region: '',
      device_id: qishuiDevice.deviceId,
      cdid: '',
      iid: qishuiDevice.installId,
      version_name: QISHUI_APP_VERSION,
      version_code: QISHUI_APP_VERSION_CODE,
      channel: 'official',
      build_mode: 'master',
      network_carrier: '',
      ac: 'wifi',
      tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      resolution: '',
      device_platform: 'windows',
      device_type: 'Windows',
      os_version: os.version(),
      fp: qishuiDevice.deviceId,
    };
  }

  function appendQishuiQuery(url, params) {
    Object.entries(params || {}).forEach(([name, value]) => {
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(name, String(item)));
      else if (value != null) url.searchParams.set(name, String(value));
    });
  }

  async function qishuiRequest(pathname, options) {
    options = options || {};
    const url = new URL(pathname, QISHUI_API_ORIGIN);
    appendQishuiQuery(url, qishuiCommonParams());
    appendQishuiQuery(url, options.query || {});
    const bodyText = options.body ? JSON.stringify(options.body) : '';
    const cookie = qishuiCookieHeader(options.cookies || qishuiCookies);
    const response = await requestJsonResponse(url.toString(), {
      method: options.method || (bodyText ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LunaPC/' + QISHUI_APP_VERSION + '(' + QISHUI_TRON_BUILD_ID + ')',
        'x-luna-background-type': 'foreground',
        'x-luna-is-background-req': '0',
        'x-luna-is-local-user': cookie ? '1' : '0',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(bodyText ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(bodyText) } : {}),
      },
    }, bodyText);
    if (options.expectedGeneration != null) {
      assertAuthGeneration(qishuiSessionGeneration, options.expectedGeneration, 'QISHUI_QR_SESSION_EXPIRED');
    }
    mergeQishuiSetCookies(options.cookies || qishuiCookies, response.headers['set-cookie']);
    return response.data;
  }

  async function qishuiPassportRequest(pathname, method, params, cookies, verifyPortraitId) {
    const url = new URL(pathname, QISHUI_API_ORIGIN);
    const common = {
      aid: QISHUI_APP_ID,
      device_id: qishuiDevice.deviceId,
      install_id: qishuiDevice.installId,
      did: qishuiDevice.deviceId,
      iid: qishuiDevice.installId,
      device_platform: 'PC',
      version_code: QISHUI_APP_VERSION,
      passport_jssdk_type: 'normal',
      passport_jssdk_version: '2.4.13',
      p_js_v: '2.4.13',
      p_js_t: 'pro',
      p_zt: '0',
      p_ver: '1.0.29',
      account_sdk_source: 'web',
      language: 'zh',
      is_new_login: '1',
      is_from_iesaccountsaas: '1',
      is_from_ttaccountsdk: '1',
    };
    appendQishuiQuery(url, common);
    let bodyText = '';
    if (method === 'GET') appendQishuiQuery(url, params);
    else bodyText = new URLSearchParams(params || {}).toString();
    const cookie = qishuiCookieHeader(cookies);
    const csrfToken = safeText(cookies && (cookies.passport_csrf_token || cookies.passport_csrf_token_default), 4096);
    const portraitId = safeText(verifyPortraitId, 128);
    const response = await requestJsonResponse(url.toString(), {
      method,
      headers: {
        Accept: 'application/json, text/javascript',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrfToken ? { 'x-tt-passport-csrf-token': csrfToken } : {}),
        ...(portraitId ? { 'x-tt-passport-verify-portrait': portraitId } : {}),
        ...(bodyText ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyText) } : {}),
      },
    }, bodyText);
    mergeQishuiSetCookies(cookies, response.headers['set-cookie']);
    const payload = response.data && typeof response.data.data === 'object' ? response.data.data : response.data;
    if (!payload || Number(payload.error_code || 0) !== 0) {
      const error = new Error('QISHUI_PASSPORT_' + safeText(payload && (payload.error_code || payload.message) || 'INVALID_RESPONSE', 80));
      error.remoteCode = safeText(payload && payload.error_code, 32);
      error.remote = payload;
      throw error;
    }
    return payload;
  }

  function qishuiQrExpiresInMs(expireTime, nowMs) {
    const now = Number(nowMs) || Date.now();
    const raw = Number(expireTime);
    let expiresAt = now + QISHUI_QR_SESSION_TTL_MS;
    if (Number.isFinite(raw) && raw > 0) {
      if (raw >= 1e12) expiresAt = raw;
      else if (raw >= 1e9) expiresAt = raw * 1000;
      else expiresAt = now + raw * 1000;
    }
    return Math.max(1000, Math.min(QISHUI_QR_SESSION_TTL_MS, expiresAt - now - QISHUI_QR_EXPIRY_SAFETY_MS));
  }

  function pruneQishuiQrSessions() {
    const now = Date.now();
    for (const [key, entry] of qishuiQrSessions) {
      if (!entry || entry.expiresAt <= now || entry.used) qishuiQrSessions.delete(key);
    }
  }

  function firstRemoteValue(objects, keys) {
    for (const source of objects) {
      if (!source || typeof source !== 'object') continue;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== '' && source[key] != null) return source[key];
      }
    }
    return undefined;
  }

  function requireKugouBusinessSuccess(payload, code) {
    if (!payload || typeof payload !== 'object') throw new Error(code + '_INVALID_RESPONSE');
    const status = Object.prototype.hasOwnProperty.call(payload, 'status') ? Number(payload.status) : null;
    const errorCode = Object.prototype.hasOwnProperty.call(payload, 'error_code')
      ? Number(payload.error_code)
      : (Object.prototype.hasOwnProperty.call(payload, 'errcode') ? Number(payload.errcode) : 0);
    if ((status !== null && status !== 1) || (Number.isFinite(errorCode) && errorCode !== 0)) {
      const error = new Error(code + '_REMOTE_' + (errorCode || status || 'FAILED'));
      error.remoteStatus = status;
      error.remoteErrorCode = errorCode;
      throw error;
    }
    return payload.data && typeof payload.data === 'object' ? payload.data : payload;
  }

  function kugouMembershipFrom(objects) {
    const keys = ['vip_type', 'vipType', 'viptype', 'VIPType', 'music_vip_type', 'musicVipType', 'music_vip_level', 'm_type', 'y_type', 'svip_level', 'is_vip', 'isVip'];
    const values = [];
    for (const source of objects) {
      if (!source || typeof source !== 'object') continue;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== '' && source[key] != null) values.push(source[key]);
      }
    }
    if (!values.length) {
      return { membershipState: 'unknown', membershipVerified: false, vipType: 0, isVip: false, vipLevel: 'unknown', membershipLabel: '会员状态待酷狗返回' };
    }
    const numeric = values.map(value => Number(value)).filter(Number.isFinite);
    const isVip = values.some(value => value === true || /^(?:true|vip|member)$/i.test(String(value))) || numeric.some(value => value > 0);
    const vipType = numeric.length ? Math.max(0, ...numeric) : (isVip ? 1 : 0);
    return {
      membershipState: isVip ? 'member' : 'non_member',
      membershipVerified: true,
      vipType,
      isVip,
      vipLevel: isVip ? 'vip' : 'none',
      membershipLabel: isVip ? ('VIP ' + vipType) : '普通用户',
    };
  }

  function kugouRawRsaEncrypt(data) {
    const source = Buffer.from(JSON.stringify(data), 'utf8');
    const keySize = 128;
    if (source.length > keySize) throw new Error('KUGOU_PROFILE_RSA_INPUT_TOO_LARGE');
    const padded = Buffer.alloc(keySize);
    source.copy(padded);
    return crypto.publicEncrypt({ key: KUGOU_STANDARD_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex').toUpperCase();
  }

  async function refreshKugouStandardProfile(currentProfile) {
    const userid = Number(kugouCookies.userid) || 0;
    const token = safeText(kugouCookies.token, 4096);
    if (!userid || !token) throw new Error('KUGOU_PROFILE_NOT_LOGGED_IN');
    const visitTime = Math.floor(Date.now() / 1000);
    const body = {
      visit_time: visitTime,
      usertype: 1,
      p: kugouRawRsaEncrypt({ token, clienttime: visitTime }),
      userid,
    };
    const payload = await kugouRequest({
      path: '/v3/get_my_info',
      method: 'POST',
      router: 'usercenter.kugou.com',
      includeSession: true,
      params: { plat: 1 },
      body,
    });
    const data = requireKugouBusinessSuccess(payload, 'KUGOU_PROFILE');
    const remoteUserId = safeText(firstRemoteValue([data], ['userid', 'userId', 'user_id']), 96).replace(/\D/g, '');
    if (remoteUserId && remoteUserId !== String(userid)) throw new Error('KUGOU_PROFILE_USER_MISMATCH');
    const nickname = safeText(firstRemoteValue([data], ['nickname', 'nick_name', 'username', 'user_name']), 128);
    const avatar = secureKugouAssetUrl(firstRemoteValue([data], ['pic', 'avatar', 'img', 'user_pic']), 240);
    const membership = kugouMembershipFrom([data, data.vipInfo, data.vip_info]);
    return Object.assign({}, currentProfile || {}, membership, {
      provider: 'kugou',
      userId: remoteUserId || String(userid),
      nickname: nickname || safeText(currentProfile && currentProfile.nickname, 128),
      avatar: avatar || safeText(currentProfile && currentProfile.avatar, 2048),
      profileVerified: !!((remoteUserId || userid) && (nickname || avatar)),
      profileSource: 'kugou-standard-v3-get-my-info',
    });
  }

  function profileFromKugouQr(data) {
    const profile = data && typeof data.profile === 'object' ? data.profile : {};
    const user = data && typeof data.user === 'object' ? data.user : {};
    const vip = data && typeof data.vipInfo === 'object' ? data.vipInfo : {};
    const objects = [data, profile, user, vip];
    const userId = safeText(firstRemoteValue(objects, ['userid', 'userId', 'user_id']), 96).replace(/\D/g, '');
    const nickname = safeText(firstRemoteValue(objects, ['nickname', 'nickName', 'nick', 'username', 'name']), 128);
    const avatar = secureKugouAssetUrl(firstRemoteValue(objects, ['pic', 'avatar', 'avatarUrl', 'avatar_url', 'userpic']), 240);
    const membership = kugouMembershipFrom(objects);
    return {
      provider: 'kugou',
      userId,
      nickname,
      avatar,
      ...membership,
      profileVerified: false,
      profileSource: 'kugou-qr-candidate',
      playlistsVerified: false,
      playlistCount: 0,
    };
  }

  function profileFromKugouConceptQr(data) {
    const profile = data && typeof data.profile === 'object' ? data.profile : {};
    const user = data && typeof data.user === 'object' ? data.user : {};
    const vip = data && typeof data.vipInfo === 'object' ? data.vipInfo : {};
    const objects = [data, profile, user, vip];
    const userId = safeText(firstRemoteValue(objects, ['userid', 'userId', 'user_id']), 96).replace(/\D/g, '');
    const nickname = safeText(firstRemoteValue(objects, ['nickname', 'nickName', 'nick', 'username', 'name']), 128);
    const avatar = secureKugouAssetUrl(firstRemoteValue(objects, ['pic', 'avatar', 'avatarUrl', 'avatar_url', 'userpic']), 240);
    const membership = kugouMembershipFrom(objects);
    return {
      provider: 'kugou_concept',
      userId,
      nickname,
      avatar,
      ...membership,
      profileVerified: false,
      profileSource: 'kugou-concept-qr-candidate',
      playlistsVerified: false,
      playlistCount: 0,
    };
  }

  function requireQishuiSuccess(payload, code) {
    if (!payload || typeof payload !== 'object') throw new Error(code + '_INVALID_RESPONSE');
    const statusCode = Number(payload.status_code || 0);
    if (statusCode !== 0) {
      const error = new Error(code + '_REMOTE_' + statusCode);
      error.remoteStatus = statusCode;
      error.sessionInvalid = statusCode === 1000016;
      throw error;
    }
    return payload;
  }

  function profileFromQishuiMyInfo(payload) {
    requireQishuiSuccess(payload, 'QISHUI_PROFILE');
    const info = payload.my_info && typeof payload.my_info === 'object' ? payload.my_info : null;
    if (!info) throw new Error('QISHUI_PROFILE_MISSING');
    const artistBrief = info.artist_brief && typeof info.artist_brief === 'object' ? info.artist_brief : {};
    const userId = safeText(info.id || info.user_id || info.uid, 96);
    const nickname = safeText(artistBrief.name || info.nickname || info.public_name, 128);
    const avatar = secureQishuiUrl(artistBrief.url_avatar || info.medium_avatar_url || info.larger_avatar_url || info.avatar_url, false);
    if (!userId) throw new Error('QISHUI_PROFILE_ID_MISSING');
    const membershipVerified = Object.prototype.hasOwnProperty.call(info, 'is_vip')
      || Object.prototype.hasOwnProperty.call(info, 'vip_stage');
    const vipStage = safeText(info.vip_stage, 24).toLowerCase();
    const isVip = info.is_vip === true || /(?:vip|member)/.test(vipStage) || Number(info.vip_stage) > 0;
    const vipLevel = membershipVerified ? (/svip/.test(vipStage) ? 'svip' : (isVip ? 'vip' : 'none')) : 'unknown';
    return {
      provider: 'qishui',
      userId,
      nickname: nickname || '汽水音乐用户',
      avatar,
      vipType: isVip ? Math.max(1, Number(info.vip_stage) || 1) : 0,
      vipLevel,
      isVip,
      membershipLabel: membershipVerified ? (vipLevel === 'svip' ? 'SVIP' : (isVip ? 'VIP' : '普通用户')) : '会员状态待汽水音乐返回',
      membershipVerified,
      membershipState: membershipVerified ? (isVip ? 'member' : 'non_member') : 'unknown',
      profileVerified: true,
      profileSource: 'qishui-pc-me',
      playlistsVerified: false,
      playlistCount: 0,
      deviceId: qishuiDevice.deviceId,
      installId: qishuiDevice.installId,
      updatedAt: Date.now(),
    };
  }

  function mapQishuiPlaylist(item, ownership) {
    item = item && item.playlist && typeof item.playlist === 'object' ? item.playlist : item;
    if (!item || typeof item !== 'object') return null;
    const id = safeText(item.id || item.playlist_id, 128);
    const name = safeText(item.title || item.name, 256);
    if (!id || !name) return null;
    const owner = item.owner && typeof item.owner === 'object' ? item.owner : {};
    const songCount = Math.max(0, Number(item.count_tracks || item.track_count || item.song_count || item.total || 0) || 0);
    return {
      provider: 'qishui',
      source: 'qishui',
      id,
      playlistId: id,
      name,
      cover: secureQishuiUrl(item.url_cover || item.cover_url || item.cover, false),
      trackCount: songCount,
      songCount,
      creator: safeText(owner.nickname || owner.name || qishuiProfile && qishuiProfile.nickname, 128),
      ownerId: safeText(owner.id || owner.user_id || (ownership === 'owned' && qishuiProfile && qishuiProfile.userId), 96),
      playlistType: Number(item.type || 0) || 0,
      songs: [],
      ...playlistOwnershipMetadata(ownership, {
        mutationReason: 'PLATFORM_MUTATION_UNSUPPORTED',
      }),
    };
  }

  function mapQishuiTrack(item) {
    const entity = item && item.entity && typeof item.entity === 'object' ? item.entity : {};
    const wrapper = entity.track_wrapper && typeof entity.track_wrapper === 'object' ? entity.track_wrapper : {};
    const track = entity.track || wrapper.track || item && item.track || item;
    if (!track || typeof track !== 'object') return null;
    const id = safeText(track.id || track.track_id || item && item.id, 128);
    const name = safeText(track.name || track.title, 256);
    if (!id || !name) return null;
    const rawArtists = Array.isArray(track.artists) ? track.artists : (Array.isArray(track.artist_list) ? track.artist_list : []);
    const artists = rawArtists.map(artist => ({
      id: safeText(artist && (artist.id || artist.artist_id), 96),
      name: safeText(artist && (artist.name || artist.artist_name), 128),
    })).filter(artist => artist.name);
    const album = track.album && typeof track.album === 'object' ? track.album : {};
    let duration = Math.max(0, Number(track.duration || track.duration_ms || 0) || 0);
    if (duration && duration < 10000) duration *= 1000;
    const mediaType = safeText(track.media_type || item && item.media_type || 'track', 32) || 'track';
    return {
      provider: 'qishui',
      source: 'qishui',
      type: 'qishui',
      id,
      qishuiTrackId: id,
      mediaType,
      qishuiMediaType: mediaType,
      name,
      title: name,
      artist: artists.map(artist => artist.name).join(' / '),
      author: artists.map(artist => artist.name).join(' / '),
      artists,
      album: safeText(album.name || album.title, 256),
      albumId: safeText(album.id || album.album_id, 96),
      cover: secureQishuiUrl(album.url_cover || track.url_cover || track.cover_url, false),
      duration,
      climaxStartSec: normalizeClimaxStartSec(track, duration),
      playable: null,
      restriction: null,
    };
  }

  async function fetchQishuiProfile(expectedGeneration) {
    return profileFromQishuiMyInfo(await qishuiRequest('/luna/pc/me', { expectedGeneration }));
  }

  async function retryKugouAccountRequest(task, attempts) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await task(); }
      catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 260 * (attempt + 1)));
      }
    }
    throw lastError || new Error('KUGOU_ACCOUNT_SYNC_FAILED');
  }

  async function refreshKugouAccountData(attempts, expectedGeneration) {
    if (kugouAccountRefreshPromise) return kugouAccountRefreshPromise;
    const generation = expectedGeneration == null ? kugouSessionGeneration : expectedGeneration;
    const operation = (async () => {
      assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
      if (!kugouLoggedIn()) return { profileVerified: false, playlistsVerified: false, playlistCount: 0 };
      const retryCount = Math.max(1, Math.min(3, Number(attempts) || 2));
      try {
        const refreshedProfile = await retryKugouAccountRequest(() => refreshKugouStandardProfile(kugouProfile), retryCount);
        assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
        kugouProfile = refreshedProfile;
        delete kugouProfile.profileRefreshError;
      } catch (error) {
        assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
        kugouProfile = kugouProfile || {};
        kugouProfile.profileRefreshError = safeText(error && error.message || 'KUGOU_PROFILE_REFRESH_FAILED', 160);
      }
      try {
        const playlistResult = await retryKugouAccountRequest(() => getKugouPlaylists(null, 100), retryCount);
        assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
        kugouProfile.playlistsVerified = !!(playlistResult && playlistResult.ok);
        kugouProfile.playlistCount = Array.isArray(playlistResult && playlistResult.playlists) ? playlistResult.playlists.length : 0;
        delete kugouProfile.playlistError;
      } catch (error) {
        assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
        kugouProfile = kugouProfile || {};
        kugouProfile.playlistsVerified = kugouProfile.playlistsVerified === true;
        kugouProfile.playlistError = safeText(error && error.message || 'KUGOU_PLAYLIST_SYNC_FAILED', 160);
      }
      assertAuthGeneration(kugouSessionGeneration, generation, 'KUGOU_QR_SESSION_EXPIRED');
      kugouProfile.updatedAt = Date.now();
      return {
        profileVerified: !!kugouProfile.profileVerified,
        membershipVerified: !!kugouProfile.membershipVerified,
        membershipState: kugouProfile.membershipState || 'unknown',
        playlistsVerified: !!kugouProfile.playlistsVerified,
        playlistCount: kugouProfile.playlistCount || 0,
        profileError: kugouProfile.profileRefreshError || '',
        playlistError: kugouProfile.playlistError || '',
      };
    })();
    kugouAccountRefreshPromise = operation;
    try { return await operation; }
    finally { if (kugouAccountRefreshPromise === operation) kugouAccountRefreshPromise = null; }
  }

  async function refreshKugouConceptAccountData(attempts, expectedGeneration) {
    if (kugouConceptAccountRefreshPromise) return kugouConceptAccountRefreshPromise;
    const generation = expectedGeneration == null ? kugouConceptSessionGeneration : expectedGeneration;
    const operation = (async () => {
      assertAuthGeneration(kugouConceptSessionGeneration, generation, 'KUGOU_CONCEPT_QR_SESSION_EXPIRED');
      if (!kugouConceptLoggedIn()) return { profileVerified: false, playlistsVerified: false, playlistCount: 0 };
      const retryCount = Math.max(1, Math.min(3, Number(attempts) || 2));
      kugouConceptProfile = kugouConceptProfile || {
        provider: 'kugou_concept',
        userId: safeText(kugouConceptCookies.userid, 96),
        nickname: '',
        avatar: '',
        membershipState: 'unknown',
        membershipVerified: false,
        vipType: 0,
        isVip: false,
        vipLevel: 'unknown',
        membershipLabel: '会员状态待酷狗概念版返回',
        profileVerified: false,
        profileSource: 'session-credentials',
      };
      try {
        const playlistResult = await retryKugouAccountRequest(() => getKugouConceptPlaylists(null, 100), retryCount);
        assertAuthGeneration(kugouConceptSessionGeneration, generation, 'KUGOU_CONCEPT_QR_SESSION_EXPIRED');
        kugouConceptProfile.playlistsVerified = !!(playlistResult && playlistResult.ok);
        kugouConceptProfile.playlistCount = Array.isArray(playlistResult && playlistResult.playlists) ? playlistResult.playlists.length : 0;
        delete kugouConceptProfile.playlistError;
      } catch (error) {
        assertAuthGeneration(kugouConceptSessionGeneration, generation, 'KUGOU_CONCEPT_QR_SESSION_EXPIRED');
        kugouConceptProfile.playlistsVerified = kugouConceptProfile.playlistsVerified === true;
        kugouConceptProfile.playlistError = safeText(error && error.message || 'KUGOU_CONCEPT_PLAYLIST_SYNC_FAILED', 160);
      }
      assertAuthGeneration(kugouConceptSessionGeneration, generation, 'KUGOU_CONCEPT_QR_SESSION_EXPIRED');
      kugouConceptProfile.updatedAt = Date.now();
      return {
        profileVerified: !!kugouConceptProfile.profileVerified,
        membershipVerified: !!kugouConceptProfile.membershipVerified,
        membershipState: kugouConceptProfile.membershipState || 'unknown',
        playlistsVerified: !!kugouConceptProfile.playlistsVerified,
        playlistCount: kugouConceptProfile.playlistCount || 0,
        playlistError: kugouConceptProfile.playlistError || '',
      };
    })();
    kugouConceptAccountRefreshPromise = operation;
    try { return await operation; }
    finally { if (kugouConceptAccountRefreshPromise === operation) kugouConceptAccountRefreshPromise = null; }
  }

  async function refreshQishuiAccountData(attempts, expectedGeneration) {
    if (qishuiAccountRefreshPromise) return qishuiAccountRefreshPromise;
    const generation = expectedGeneration == null ? qishuiSessionGeneration : expectedGeneration;
    const operation = (async () => {
      assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
      if (!qishuiSessionCookie(qishuiCookies)) return { profileVerified: false, playlistsVerified: false, playlistCount: 0 };
      const retryCount = Math.max(1, Math.min(3, Number(attempts) || 2));
      try {
        const refreshedProfile = await retryKugouAccountRequest(() => fetchQishuiProfile(generation), retryCount);
        assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
        qishuiProfile = refreshedProfile;
      } catch (error) {
        assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
        if (error && error.sessionInvalid) {
          qishuiCookies = {};
          qishuiProfile = null;
          qishuiSessionUpdatedAt = Date.now();
        }
        throw error;
      }
      try {
        const playlistResult = await retryKugouAccountRequest(() => getQishuiPlaylists(null, 100, generation), retryCount);
        assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
        qishuiProfile.playlistsVerified = !!(playlistResult && playlistResult.ok);
        qishuiProfile.playlistCount = Array.isArray(playlistResult && playlistResult.playlists) ? playlistResult.playlists.length : 0;
        delete qishuiProfile.playlistError;
      } catch (error) {
        assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
        qishuiProfile.playlistsVerified = false;
        qishuiProfile.playlistError = safeText(error && error.message || 'QISHUI_PLAYLIST_SYNC_FAILED', 160);
      }
      assertAuthGeneration(qishuiSessionGeneration, generation, 'QISHUI_QR_SESSION_EXPIRED');
      qishuiProfile.updatedAt = Date.now();
      qishuiSessionUpdatedAt = Date.now();
      return {
        profileVerified: true,
        membershipVerified: !!qishuiProfile.membershipVerified,
        membershipState: qishuiProfile.membershipState || 'unknown',
        playlistsVerified: !!qishuiProfile.playlistsVerified,
        playlistCount: qishuiProfile.playlistCount || 0,
        playlistError: qishuiProfile.playlistError || '',
      };
    })();
    qishuiAccountRefreshPromise = operation;
    try { return await operation; }
    finally { if (qishuiAccountRefreshPromise === operation) qishuiAccountRefreshPromise = null; }
  }

  async function createKugouQrLogin() {
    pruneKugouQrSessions();
    const generation = kugouSessionGeneration;
    const body = await kugouLoginRequest('/v2/qrcode', {
      appid: 1001,
      type: 1,
      plat: 4,
      qrcode_txt: KUGOU_QR_PAGE_URL + '?appid=' + KUGOU_APP_ID + '&',
      srcappid: KUGOU_SOURCE_APP_ID,
    });
    if (generation !== kugouSessionGeneration) throw new Error('KUGOU_QR_SESSION_EXPIRED');
    const data = body && typeof body.data === 'object' ? body.data : {};
    const key = safeText(data.qrcode || data.key || data.qrCode || data.qrcode_key || body && (body.qrcode || body.key), 512);
    if (!key) throw new Error('KUGOU_QR_KEY_EMPTY');
    const qrcodeUrl = KUGOU_QR_PAGE_URL + '?qrcode=' + encodeURIComponent(key);
    let image = safeText(data.qrcode_img, 2 * 1024 * 1024);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) {
      image = await QRCode.toDataURL(qrcodeUrl, { type: 'image/png', width: 320, margin: 2, errorCorrectionLevel: 'M' });
    }
    if (generation !== kugouSessionGeneration) throw new Error('KUGOU_QR_SESSION_EXPIRED');
    kugouQrSessions.set(key, {
      key,
      createdAt: Date.now(),
      expiresAt: Date.now() + KUGOU_QR_SESSION_TTL_MS,
      used: false,
      generation,
    });
    return {
      ok: true,
      provider: 'kugou',
      candidate: 4,
      status: 1,
      expiresIn: KUGOU_QR_SESSION_TTL_MS,
      data: { key, qrcode: key, qrcode_img: image, qrcode_url: qrcodeUrl },
    };
  }

  async function checkKugouQrLogin(key) {
    pruneKugouQrSessions();
    key = safeText(key, 512);
    const issued = kugouQrSessions.get(key);
    if (!issued || issued.generation !== kugouSessionGeneration) throw new Error('KUGOU_QR_SESSION_EXPIRED');
    const generation = issued.generation;
    const body = await kugouLoginRequest('/v2/get_userinfo_qrcode', {
      plat: 4,
      appid: KUGOU_APP_ID,
      srcappid: KUGOU_SOURCE_APP_ID,
      qrcode: key,
    });
    if (generation !== kugouSessionGeneration || kugouQrSessions.get(key) !== issued) {
      throw new Error('KUGOU_QR_SESSION_EXPIRED');
    }
    const data = body && typeof body.data === 'object' ? body.data : {};
    const status = Number(data.status != null ? data.status : body && body.status) || 0;
    let sync = null;
    if (status === 4) {
      const token = safeText(data.token, 4096);
      const profile = profileFromKugouQr(data);
      if (!token || !profile.userId) {
        return { ok: false, provider: 'kugou', candidate: 4, status, loggedIn: false, error: 'KUGOU_QR_CREDENTIALS_MISSING' };
      }
      kugouCookies = Object.assign({}, kugouDeviceCookies, kugouCookies, {
        token,
        userid: profile.userId,
      });
      if (profile.membershipVerified) kugouCookies.vip_type = String(profile.vipType);
      kugouProfile = profile;
      kugouSessionUpdatedAt = Date.now();
      sourceCache.clear();
      sync = await refreshKugouAccountData(3, generation);
      if (generation !== kugouSessionGeneration || kugouQrSessions.get(key) !== issued) {
        throw new Error('KUGOU_QR_SESSION_EXPIRED');
      }
      if (kugouProfile.membershipVerified) kugouCookies.vip_type = String(kugouProfile.vipType);
      issued.used = true;
    }
    return {
      ok: true,
      provider: 'kugou',
      candidate: 4,
      status,
      loggedIn: kugouLoggedIn(),
      sessionValid: !!(kugouLoggedIn() && kugouProfile && (kugouProfile.profileVerified === true || kugouProfile.playlistsVerified === true)),
      profile: kugouLoggedIn() ? { ...kugouProfile } : null,
      sync,
    };
  }

  function exportKugouSession() {
    const sessionValid = !!(kugouLoggedIn() && kugouProfile
      && (kugouProfile.profileVerified === true || kugouProfile.playlistsVerified === true));
    return {
      ok: true,
      provider: 'kugou',
      loggedIn: kugouLoggedIn(),
      sessionValid,
      cookies: kugouLoggedIn() ? { ...kugouCookies } : {},
      profile: kugouLoggedIn() && kugouProfile ? { ...kugouProfile } : null,
      sessionUpdatedAt: kugouSessionUpdatedAt || 0,
    };
  }

  async function createKugouConceptQrLogin() {
    pruneKugouConceptQrSessions();
    const generation = kugouConceptSessionGeneration;
    const body = await kugouConceptLoginRequest('/v2/qrcode', {
      appid: KUGOU_CONCEPT_QR_APP_ID,
      type: 1,
      plat: 4,
      qrcode_txt: KUGOU_QR_PAGE_URL + '?appid=' + KUGOU_CONCEPT_APP_ID + '&',
      srcappid: KUGOU_SOURCE_APP_ID,
    });
    if (generation !== kugouConceptSessionGeneration) throw new Error('KUGOU_CONCEPT_QR_SESSION_EXPIRED');
    const data = body && typeof body.data === 'object' ? body.data : {};
    const key = safeText(data.qrcode || data.key || data.qrCode || data.qrcode_key || body && (body.qrcode || body.key), 512);
    if (!key) throw new Error('KUGOU_CONCEPT_QR_KEY_EMPTY');
    const qrcodeUrl = KUGOU_QR_PAGE_URL + '?qrcode=' + encodeURIComponent(key);
    let image = safeText(data.qrcode_img, 2 * 1024 * 1024);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) {
      image = await QRCode.toDataURL(qrcodeUrl, { type: 'image/png', width: 320, margin: 2, errorCorrectionLevel: 'M' });
    }
    if (generation !== kugouConceptSessionGeneration) throw new Error('KUGOU_CONCEPT_QR_SESSION_EXPIRED');
    kugouConceptQrSessions.set(key, {
      key,
      createdAt: Date.now(),
      expiresAt: Date.now() + KUGOU_QR_SESSION_TTL_MS,
      used: false,
      generation,
    });
    return {
      ok: true,
      provider: 'kugou_concept',
      edition: 'concept',
      status: 1,
      expiresIn: KUGOU_QR_SESSION_TTL_MS,
      data: { key, qrcode: key, qrcode_img: image, qrcode_url: qrcodeUrl },
    };
  }

  async function checkKugouConceptQrLogin(key) {
    pruneKugouConceptQrSessions();
    key = safeText(key, 512);
    const issued = kugouConceptQrSessions.get(key);
    if (!issued || issued.generation !== kugouConceptSessionGeneration) throw new Error('KUGOU_CONCEPT_QR_SESSION_EXPIRED');
    const generation = issued.generation;
    const body = await kugouConceptLoginRequest('/v2/get_userinfo_qrcode', {
      plat: 4,
      appid: KUGOU_CONCEPT_APP_ID,
      srcappid: KUGOU_SOURCE_APP_ID,
      qrcode: key,
    });
    if (generation !== kugouConceptSessionGeneration || kugouConceptQrSessions.get(key) !== issued) {
      throw new Error('KUGOU_CONCEPT_QR_SESSION_EXPIRED');
    }
    const data = body && typeof body.data === 'object' ? body.data : {};
    const status = Number(data.status != null ? data.status : body && body.status) || 0;
    if (status !== 4) {
      return { ok: true, provider: 'kugou_concept', edition: 'concept', status, loggedIn: false, sessionValid: false, profile: null, sync: null };
    }
    const token = safeText(firstRemoteValue([
      data,
      data && data.profile,
      data && data.user,
    ], ['token', 'user_token', 'access_token']), 4096);
    const profile = profileFromKugouConceptQr(data);
    if (!token || !profile.userId) {
      return {
        ok: false,
        provider: 'kugou_concept',
        edition: 'concept',
        status,
        loggedIn: false,
        error: 'KUGOU_CONCEPT_QR_CREDENTIALS_MISSING',
      };
    }
    kugouConceptCookies = Object.assign(
      {},
      kugouConceptDeviceCookies,
      kugouConceptCookies,
      parseCookieInput(data),
      { token, userid: profile.userId }
    );
    if (profile.membershipVerified) kugouConceptCookies.vip_type = String(profile.vipType);
    else delete kugouConceptCookies.vip_type;
    kugouConceptProfile = profile;
    kugouConceptSessionUpdatedAt = Date.now();
    sourceCache.clear();
    const sync = await refreshKugouConceptAccountData(3, generation);
    if (generation !== kugouConceptSessionGeneration || kugouConceptQrSessions.get(key) !== issued) {
      throw new Error('KUGOU_CONCEPT_QR_SESSION_EXPIRED');
    }
    issued.used = true;
    return {
      ok: true,
      provider: 'kugou_concept',
      edition: 'concept',
      status,
      loggedIn: true,
      sessionValid: !!(kugouConceptProfile && (kugouConceptProfile.profileVerified === true || kugouConceptProfile.playlistsVerified === true)),
      profile: { ...kugouConceptProfile },
      sync,
    };
  }

  function exportKugouConceptSession() {
    const sessionValid = !!(kugouConceptLoggedIn() && kugouConceptProfile
      && (kugouConceptProfile.profileVerified === true || kugouConceptProfile.playlistsVerified === true));
    return {
      ok: true,
      provider: 'kugou_concept',
      edition: 'concept',
      loggedIn: kugouConceptLoggedIn(),
      sessionValid,
      cookies: kugouConceptLoggedIn() ? { ...kugouConceptCookies } : {},
      profile: kugouConceptLoggedIn() && kugouConceptProfile ? { ...kugouConceptProfile } : null,
      sessionUpdatedAt: kugouConceptSessionUpdatedAt || 0,
    };
  }

  async function createQishuiQrLogin() {
    pruneQishuiQrSessions();
    const generation = qishuiSessionGeneration;
    const cookies = {};
    const verifyPortraitId = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')) + '.login';
    const payload = await qishuiPassportRequest('/passport/web/get_qrcode/', 'GET', {
      next: QISHUI_API_ORIGIN,
      need_logo: 'false',
      need_short_url: 'false',
      is_new_login: '1',
    }, cookies, verifyPortraitId);
    if (generation !== qishuiSessionGeneration) throw new Error('QISHUI_QR_SESSION_EXPIRED');
    const token = safeText(payload.token, 4096);
    if (!token) throw new Error('QISHUI_QR_TOKEN_EMPTY');
    const localKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(24).toString('hex');
    const scanUrl = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
    scanUrl.searchParams.set('token', token);
    scanUrl.searchParams.set('os', 'Windows');
    scanUrl.searchParams.set('computer_name', 'LumiField');
    const image = await QRCode.toDataURL(scanUrl.toString().replace(/\+/g, '%20'), {
      type: 'image/png', width: 320, margin: 2, errorCorrectionLevel: 'M',
    });
    if (generation !== qishuiSessionGeneration) throw new Error('QISHUI_QR_SESSION_EXPIRED');
    const expiresIn = qishuiQrExpiresInMs(payload.expire_time, Date.now());
    qishuiQrSessions.set(localKey, {
      token,
      cookies,
      verifyPortraitId,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn,
      used: false,
      generation,
    });
    return {
      ok: true,
      provider: 'qishui',
      status: 1,
      expiresIn,
      data: { key: localKey, qrcode_img: image },
    };
  }

  async function checkQishuiQrLogin(key) {
    pruneQishuiQrSessions();
    const localKey = safeText(key, 160);
    const issued = qishuiQrSessions.get(localKey);
    if (!issued || issued.generation !== qishuiSessionGeneration) throw new Error('QISHUI_QR_SESSION_EXPIRED');
    const generation = issued.generation;
    let payload;
    try {
      payload = await qishuiPassportRequest('/passport/web/check_qrconnect/', 'POST', {
        need_logo: 'false',
        need_short_url: 'false',
        is_frontier: 'true',
        token: issued.token,
        is_new_login: '1',
        next: QISHUI_API_ORIGIN,
      }, issued.cookies, issued.verifyPortraitId);
    } catch (error) {
      if (generation !== qishuiSessionGeneration || qishuiQrSessions.get(localKey) !== issued) {
        throw new Error('QISHUI_QR_SESSION_EXPIRED');
      }
      if (String(error && error.remoteCode || '') === '2156') {
        qishuiQrSessions.delete(localKey);
        return {
          ok: false,
          provider: 'qishui',
          status: 0,
          loggedIn: false,
          refreshQr: true,
          error: 'QISHUI_QR_FLOW_REJECTED',
        };
      }
      throw error;
    }
    if (generation !== qishuiSessionGeneration || qishuiQrSessions.get(localKey) !== issued) {
      throw new Error('QISHUI_QR_SESSION_EXPIRED');
    }
    const remoteStatus = safeText(payload.status, 32).toLowerCase();
    const status = remoteStatus === 'confirmed' || remoteStatus === '3'
      ? 4
      : (remoteStatus === 'scanned' || remoteStatus === '2' ? 2
        : (remoteStatus === 'expired' || remoteStatus === 'refused' || remoteStatus === '4' || remoteStatus === '5' ? 5 : 1));
    if (status !== 4) {
      return { ok: true, provider: 'qishui', status, remoteStatus, loggedIn: false, sessionValid: false, profile: null, sync: null };
    }
    qishuiCookies = qishuiCookieInput(issued.cookies);
    if (!qishuiSessionCookie(qishuiCookies)) {
      return { ok: false, provider: 'qishui', status, loggedIn: false, error: 'QISHUI_QR_SESSION_COOKIE_MISSING' };
    }
    const sync = await refreshQishuiAccountData(3, generation);
    if (generation !== qishuiSessionGeneration || qishuiQrSessions.get(localKey) !== issued) {
      throw new Error('QISHUI_QR_SESSION_EXPIRED');
    }
    if (!qishuiLoggedIn()) {
      return { ok: false, provider: 'qishui', status, loggedIn: false, error: 'QISHUI_PROFILE_VALIDATION_FAILED' };
    }
    issued.used = true;
    return {
      ok: true,
      provider: 'qishui',
      status,
      loggedIn: true,
      sessionValid: !!(qishuiProfile && qishuiProfile.profileVerified === true),
      profile: { ...qishuiProfile },
      sync,
    };
  }

  function exportQishuiSession() {
    const sessionValid = !!(qishuiLoggedIn() && qishuiProfile && qishuiProfile.profileVerified === true);
    return {
      ok: true,
      provider: 'qishui',
      loggedIn: qishuiLoggedIn(),
      sessionValid,
      cookies: qishuiLoggedIn() ? { ...qishuiCookies } : {},
      profile: qishuiLoggedIn() && qishuiProfile ? { ...qishuiProfile } : null,
      device: { ...qishuiDevice },
      sessionUpdatedAt: qishuiSessionUpdatedAt || 0,
    };
  }

  async function searchKugou(keywords, limit) {
    const query = safeText(keywords, 160);
    if (!query) return [];
    const url = new URL('https://songsearch.kugou.com/song_search_v2');
    Object.entries({
      keyword: query,
      page: 1,
      pagesize: Math.max(4, Math.min(60, Number(limit) || 24)),
      userid: -1,
      clientver: '',
      platform: 'WebFilter',
      filter: 2,
      iscorrection: 1,
      privilege_filter: 0,
    }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const payload = await requestJson(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' } });
    const lists = payload && payload.data && Array.isArray(payload.data.lists) ? payload.data.lists : [];
    return lists.map(mapKugouSong).filter(Boolean);
  }

  async function searchAcrossPlatforms(keywords, limit) {
    const query = safeText(keywords, 160);
    const resultLimit = Math.max(4, Math.min(50, Number(limit) || 18));
    if (!query) return { ok: true, songs: [], providersTried: [], cacheExpiresAt: Date.now() + SEARCH_TTL_MS };
    const cacheKey = SEARCH_POLICY_VERSION + ':' + normalizeText(query) + ':' + resultLimit;
    pruneCache(searchCache, 80);
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
    const providersTried = [];
    const errors = {};
    let combined = [];
    const run = async (provider, fn) => {
      providersTried.push(provider);
      try {
        const songs = await fn();
        combined = combined.concat(rankSongs(songs, query));
      } catch (error) {
        errors[provider] = safeText(error && error.message || 'SEARCH_FAILED', 160);
      }
    };
    await run('kugou', () => searchKugou(query, Math.max(resultLimit * 2, 24)));
    if (typeof deps.searchNetease === 'function') await run('netease', () => deps.searchNetease(query, Math.max(resultLimit, 18)));
    if (typeof deps.searchQQ === 'function') await run('qq', () => deps.searchQQ(query, Math.max(resultLimit, 12)));
    if (typeof deps.searchQishui === 'function') await run('qishui', () => deps.searchQishui(query, Math.max(resultLimit, 12)));
    const value = {
      ok: true,
      songs: foldSongs(combined, resultLimit),
      providersTried,
      errors,
      priority: SEARCH_PLATFORM_ORDER.slice(),
      qishuiSearchEnabled: typeof deps.searchQishui === 'function',
      rankingPolicy: SEARCH_POLICY_VERSION,
      cacheExpiresAt: Date.now() + SEARCH_TTL_MS,
    };
    searchCache.set(cacheKey, { value, expiresAt: value.cacheExpiresAt });
    return value;
  }

  function classifyKugouRestriction(payload) {
    const processList = Array.isArray(payload && payload.fail_process) ? payload.fail_process.map(String) : [];
    let category = 'copyright_unavailable';
    let message = '酷狗未返回可播放的完整音源';
    if (processList.includes('buy')) {
      category = 'paid_required';
      message = '酷狗歌曲需要购买或相应版权权限';
    } else if (processList.includes('pkg') || payload && payload.tracker_through && Number(payload.tracker_through.musicpack_advance) > 0) {
      category = 'vip_required';
      message = '酷狗歌曲需要有效会员权限';
    } else if (!kugouLoggedIn()) {
      category = 'login_required';
      message = '酷狗歌曲需要登录标准版账号后播放';
    }
    return { category, message };
  }

  async function resolveKugou(song, quality) {
    const source = sanitizeSearchSong(song);
    if (!source || !source.hash) return { provider: 'kugou', url: '', playable: false, reason: 'resource_invalid', message: '酷狗歌曲缺少有效 hash' };
    const qualityValue = /^(?:jymaster|hires|lossless|flac)$/i.test(String(quality || '')) ? 'flac' : (/^(?:exhigh|high|320)$/i.test(String(quality || '')) ? '320' : '128');
    const hash = source.hash.toLowerCase();
    const payload = await kugouRequest({
      path: '/v5/url',
      router: 'trackercdn.kugou.com',
      clientver: 11430,
      includeSession: true,
      sourceKeyHash: hash,
      params: {
        album_id: Number(source.albumId) || 0,
        area_code: 1,
        hash,
        ssa_flag: 'is_fromtrack',
        version: 11430,
        page_id: 151369488,
        quality: qualityValue,
        album_audio_id: Number(source.albumAudioId || source.mixSongId || source.id) || 0,
        behavior: 'play',
        pid: 2,
        cmd: 26,
        pidversion: 3001,
        IsFreePart: 0,
        ppage_id: '463467626,350369493,788954147',
        cdnBackup: 1,
        module: '',
      },
    });
    const candidates = [].concat(payload && payload.url || [], payload && payload.backupUrl || []).filter(Boolean);
    let audioUrl = '';
    for (const candidate of candidates) {
      try {
        const parsed = new URL(String(candidate).replace(/^http:/, 'https:'));
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === 'https:' && (host === 'kugou.com' || host.endsWith('.kugou.com'))) {
          audioUrl = parsed.toString();
          break;
        }
      } catch (_) {}
    }
    if (audioUrl) {
      return {
        provider: 'kugou',
        url: audioUrl,
        playable: true,
        trial: false,
        level: qualityValue === '128' ? 'standard' : (qualityValue === '320' ? 'exhigh' : 'lossless'),
        quality: qualityValue,
        br: Number(payload.bitRate || 0) || 0,
      };
    }
    const restriction = classifyKugouRestriction(payload || {});
    return { provider: 'kugou', url: '', playable: false, reason: restriction.category, message: restriction.message, restriction };
  }

  function classifyKugouConceptRestriction(payload) {
    const processList = Array.isArray(payload && payload.fail_process) ? payload.fail_process.map(String) : [];
    let category = 'copyright_unavailable';
    let message = '酷狗概念版未返回可播放的完整音源';
    if (processList.includes('buy')) {
      category = 'paid_required';
      message = '酷狗概念版歌曲需要购买或相应版权权限';
    } else if (processList.includes('pkg') || payload && payload.tracker_through && Number(payload.tracker_through.musicpack_advance) > 0) {
      category = 'vip_required';
      message = '酷狗概念版歌曲需要有效会员权限';
    } else if (!kugouConceptLoggedIn()) {
      category = 'login_required';
      message = '酷狗概念版歌曲需要登录概念版账号后播放';
    }
    return { category, message };
  }

  async function resolveKugouConcept(song, quality) {
    const source = sanitizeSearchSong(song);
    if (!source || !source.hash) {
      return { provider: 'kugou_concept', url: '', playable: false, reason: 'resource_invalid', message: '酷狗概念版歌曲缺少有效 hash' };
    }
    if (!kugouConceptLoggedIn()) {
      const restriction = classifyKugouConceptRestriction({});
      return { provider: 'kugou_concept', url: '', playable: false, reason: restriction.category, message: restriction.message, restriction };
    }
    const qualityValue = /^(?:jymaster|hires|lossless|flac)$/i.test(String(quality || ''))
      ? 'lossless'
      : (/^(?:exhigh|high|320)$/i.test(String(quality || '')) ? 'exhigh' : 'standard');
    const selectedHash = qualityValue === 'lossless'
      ? (source.sqHash || source.hqHash || source.hash)
      : (qualityValue === 'exhigh' ? (source.hqHash || source.hash) : source.hash);
    const hash = safeText(selectedHash, 96).toUpperCase();
    const mid = safeText(kugouConceptCookies.KUGOU_API_MID || conceptClientMid, 96) || conceptClientMid;
    const userid = safeText(kugouConceptCookies.userid, 64).replace(/\D/g, '') || '0';
    const token = safeText(kugouConceptCookies.token, 4096) || '0';
    const params = {
      cmd: 26,
      hash,
      behavior: 'play',
      appid: KUGOU_CONCEPT_APP_ID,
      pid: 2,
      mid,
      userid,
      version: KUGOU_CONCEPT_ANDROID_CLIENT_VERSION,
      clientver: KUGOU_CONCEPT_ANDROID_CLIENT_VERSION,
      vipType: safeText(kugouConceptCookies.vip_type || '0', 24),
      token,
      key: md5(hash + KUGOU_CONCEPT_PLAY_KEY_SALT + KUGOU_CONCEPT_APP_ID + mid + userid),
    };
    if (source.albumAudioId || source.mixSongId) params.album_audio_id = safeText(source.albumAudioId || source.mixSongId, 96);
    if (source.albumId) params.album_id = safeText(source.albumId, 96);
    const url = new URL('/i/v2/', 'https://trackercdn.kugou.com');
    Object.keys(params).forEach(key => url.searchParams.set(key, String(params[key])));
    const cookie = kugouConceptCookieHeader();
    const payload = await requestJson(url.toString(), {
      headers: Object.assign({
        'User-Agent': 'Android15-1070-11440-46-0-DiscoveryDRADProtocol-wifi',
      }, cookie ? { Cookie: cookie } : {}),
    });
    const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : (payload || {});
    const rawCandidates = [
      data.play_url,
      data.play_backup_url,
      data.url,
      data.src,
      data.backup_url,
      payload && payload.url,
      payload && payload.backupUrl,
    ];
    const candidates = rawCandidates.flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean);
    let audioUrl = '';
    for (const candidate of candidates) {
      try {
        const parsed = new URL(String(candidate).replace(/^http:/, 'https:'));
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === 'https:' && (host === 'kugou.com' || host.endsWith('.kugou.com') || host.endsWith('.kgimg.com'))) {
          audioUrl = parsed.toString();
          break;
        }
      } catch (_) {}
    }
    if (audioUrl) {
      return {
        provider: 'kugou_concept',
        url: audioUrl,
        playable: true,
        trial: false,
        level: qualityValue,
        quality: qualityValue,
        br: Number(data.bitRate || data.bitrate || payload && payload.bitRate || 0) || 0,
      };
    }
    const restriction = classifyKugouConceptRestriction(data);
    return { provider: 'kugou_concept', url: '', playable: false, reason: restriction.category, message: restriction.message, restriction };
  }

  async function findSameSong(provider, source) {
    const query = [source.name, source.artist].filter(Boolean).join(' ').trim();
    if (!query) return null;
    let songs = [];
    if (provider === 'kugou') songs = await searchKugou(query, 18);
    else if (provider === 'kugou_concept') {
      songs = (await searchKugou(query, 18)).map(song => ({ ...song, provider: 'kugou_concept', source: 'kugou_concept', type: 'kugou_concept' }));
    }
    else if (provider === 'netease' && typeof deps.searchNetease === 'function') songs = await deps.searchNetease(query, 18);
    else if (provider === 'qq' && typeof deps.searchQQ === 'function') songs = await deps.searchQQ(query, 12);
    else if (provider === 'qishui' && typeof deps.searchQishui === 'function') songs = await deps.searchQishui(query, 12);
    const ranked = rankSongs(songs, query).filter(song => sameSong(source, song));
    return ranked[0] || null;
  }

  function normalizeRestriction(result) {
    result = result || {};
    const restriction = result.restriction && typeof result.restriction === 'object' ? result.restriction : {};
    let reason = safeText(result.reason || restriction.category, 64).toLowerCase();
    const message = safeText(result.message || restriction.message, 256);
    if (reason === 'copyright_restricted') reason = 'copyright_unavailable';
    else if (reason === 'protected_or_unavailable') reason = 'resource_unavailable';
    else if (reason === 'remote_rejected') reason = /(地区|区域|region|geo)/i.test(message) ? 'region_restricted' : 'resource_unavailable';
    else if (reason === 'url_expired' || reason === 'source_expired') reason = 'resource_expired';
    else if (!reason && !result.url) reason = 'url_unavailable';
    return { reason, message };
  }

  async function resolveProvider(provider, source, quality) {
    let directSource = providerOf(source) === provider;
    let candidate = directSource ? sanitizeSearchSong(source) : null;
    if (!candidate || (/^kugou(?:_concept)?$/.test(provider) && !candidate.hash) || (provider === 'qq' && !candidate.mid) || (provider === 'netease' && !candidate.id)) {
      candidate = await findSameSong(provider, source);
      directSource = false;
    }
    if (!candidate || (!directSource && !sameSong(source, candidate))) return { provider, url: '', playable: false, reason: 'same_song_not_found', message: '未找到同名、同歌手且同版本的可验证歌曲', directSource: false, matchVerified: false, matchPolicy: 'strict-title-artist-version' };
    let resolved;
    if (provider === 'kugou') resolved = await resolveKugou(candidate, quality);
    else if (provider === 'kugou_concept') resolved = await resolveKugouConcept(candidate, quality);
    else if (provider === 'qishui') resolved = await resolveQishui(candidate, quality);
    else if (provider === 'netease' && typeof deps.resolveNetease === 'function') resolved = await deps.resolveNetease(candidate, quality);
    else if (provider === 'qq' && typeof deps.resolveQQ === 'function') resolved = await deps.resolveQQ(candidate, quality);
    else resolved = { provider, url: '', playable: false, reason: 'provider_unavailable', message: '平台解析器不可用' };
    const normalized = normalizeRestriction(resolved);
    return {
      ...resolved,
      provider,
      reason: normalized.reason,
      message: normalized.message,
      restriction: normalized.reason ? { category: normalized.reason, message: normalized.message } : null,
      resolvedSong: candidate,
      directSource,
      matchVerified: directSource || sameSong(source, candidate),
      matchPolicy: directSource ? 'direct-platform-id' : 'strict-title-artist-version',
    };
  }

  async function resolvePlayableSource(input) {
    input = input || {};
    const source = sanitizeSearchSong(input.song || input);
    if (!source) return { ok: false, url: '', playable: false, reason: 'resource_invalid', message: '歌曲信息无效', requestedProvider: '', fallbackUsed: false, priority: SEARCH_PLATFORM_ORDER.slice(), finalResult: 'restricted', attempts: [] };
    const quality = safeText(input.quality || 'hires', 32);
    const requestedProvider = providerOf(source);
    const qishuiSearchEnabled = typeof deps.searchQishui === 'function';
    const fallbackOrder = SEARCH_PLATFORM_ORDER.filter(provider => provider !== 'qishui' || qishuiSearchEnabled);
    const order = [requestedProvider].concat(fallbackOrder.filter(provider => provider !== requestedProvider));
    const cacheKey = SEARCH_POLICY_VERSION + ':' + requestedProvider + ':' + (source.id || source.hash || source.mid) + ':' + normalizeText(source.name) + ':' + quality;
    pruneCache(sourceCache, 120);
    if (!input.force) {
      const cached = sourceCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
    }
    const attempts = [];
    for (const provider of order) {
      try {
        const result = await resolveProvider(provider, source, quality);
        const normalized = normalizeRestriction(result);
        attempts.push({
          provider,
          directSource: result.directSource === true,
          matchVerified: result.matchVerified === true,
          matchPolicy: safeText(result.matchPolicy, 64),
          reason: normalized.reason,
          message: normalized.message,
        });
        if (result.url && result.playable !== false) {
          const value = {
            ...result,
            ok: true,
            requestedProvider,
            fallbackUsed: provider !== requestedProvider,
            fallbackFrom: provider === requestedProvider ? '' : requestedProvider,
            fallbackTo: provider === requestedProvider ? '' : provider,
            priority: SEARCH_PLATFORM_ORDER.slice(),
            qishuiSearchEnabled,
            finalResult: 'playable',
            attempts,
            cacheExpiresAt: Date.now() + SOURCE_TTL_MS,
          };
          sourceCache.set(cacheKey, { value, expiresAt: value.cacheExpiresAt });
          return value;
        }
      } catch (error) {
        sourceCache.delete(cacheKey);
        attempts.push({ provider, directSource: provider === requestedProvider, matchVerified: false, matchPolicy: provider === requestedProvider ? 'direct-platform-id' : 'strict-title-artist-version', reason: 'resolve_failed', message: safeText(error && error.message || 'RESOLVE_FAILED', 256) });
      }
    }
    const priority = ['paid_required', 'vip_required', 'login_required', 'region_restricted', 'copyright_unavailable', 'resource_expired', 'resource_invalid', 'resource_unavailable', 'url_unavailable', 'resolve_failed'];
    const selected = priority.map(reason => attempts.find(item => item.reason === reason)).find(Boolean) || attempts[0] || { reason: 'url_unavailable', message: '所有平台均未返回可播放音源' };
    return {
      ok: false,
      url: '',
      playable: false,
      requestedProvider,
      fallbackUsed: false,
      fallbackFrom: '',
      fallbackTo: '',
      priority: SEARCH_PLATFORM_ORDER.slice(),
      qishuiSearchEnabled,
      finalResult: 'restricted',
      failedProvider: selected.provider || requestedProvider,
      reason: selected.reason || 'url_unavailable',
      message: selected.message || '所有平台均未返回可播放音源',
      restriction: { provider: selected.provider || requestedProvider, category: selected.reason || 'url_unavailable', message: selected.message || '所有平台均未返回可播放音源' },
      attempts,
    };
  }

  async function kugouLyrics(song) {
    const source = sanitizeSearchSong(song);
    if (!source || !source.hash) return { provider: 'kugou', lyric: '', error: 'MISSING_KUGOU_HASH' };
    const searchUrl = new URL('https://lyrics.kugou.com/search');
    const duration = Math.max(0, Number(source.duration) || 0);
    Object.entries({
      ver: 1,
      man: 'yes',
      client: 'pc',
      keyword: [source.artist, source.name].filter(Boolean).join(' - '),
      duration: duration > 10000 ? Math.round(duration) : Math.round(duration * 1000),
      hash: source.hash,
    }).forEach(([key, value]) => searchUrl.searchParams.set(key, String(value)));
    const found = await requestJson(searchUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' } });
    const candidates = Array.isArray(found && found.candidates) ? found.candidates : [];
    const matching = candidates.filter(candidate => {
      const titleMatches = !source.name || normalizeText(candidate.song).includes(normalizeText(source.name)) || normalizeText(source.name).includes(normalizeText(candidate.song));
      const artistMatches = !source.artist || normalizeArtistParts(source.artist).some(name => normalizeArtistParts(candidate.singer).includes(name));
      return titleMatches && artistMatches;
    });
    const candidate = (matching.length ? matching : candidates).sort((left, right) => Number(right.product_from === '官方推荐歌词') - Number(left.product_from === '官方推荐歌词') || Number(right.score || 0) - Number(left.score || 0))[0];
    if (!candidate || !candidate.id || !candidate.accesskey) return { provider: 'kugou', lyric: '', error: 'LYRIC_NOT_FOUND' };
    const downloadUrl = new URL('https://lyrics.kugou.com/download');
    Object.entries({ ver: 1, client: 'pc', id: candidate.id, accesskey: candidate.accesskey, fmt: 'lrc', charset: 'utf8' }).forEach(([key, value]) => downloadUrl.searchParams.set(key, String(value)));
    const payload = await requestJson(downloadUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' } });
    let lyric = '';
    try { lyric = Buffer.from(String(payload && payload.content || ''), 'base64').toString('utf8'); } catch (_) {}
    if (Buffer.byteLength(lyric) > 2 * 1024 * 1024) lyric = '';
    return { provider: 'kugou', lyric, tlyric: '', source: candidate.product_from || 'kugou-lyrics' };
  }

  async function kugouComments(song, limit) {
    const source = sanitizeSearchSong(song);
    const mixSongId = source && safeText(source.mixSongId || source.albumAudioId || source.id, 96).replace(/\D/g, '');
    if (!source || !mixSongId) return { provider: 'kugou', comments: [], error: 'MISSING_KUGOU_MIX_SONG_ID' };
    const payload = await kugouRequest({
      path: '/mcomment/v1/cmtlist',
      method: 'POST',
      includeSession: true,
      params: {
        mixsongid: mixSongId,
        need_show_image: 1,
        p: 1,
        pagesize: Math.max(6, Math.min(50, Number(limit) || 20)),
        show_classify: 1,
        show_hotword_list: 1,
        extdata: '0',
        code: KUGOU_COMMENT_CODE,
      },
    });
    const raw = Array.isArray(payload && payload.list) ? payload.list : [];
    const comments = raw.map(item => ({
      id: safeText(item.id, 96),
      content: safeText(item.content, 2000),
      likedCount: Math.max(0, Number(item.like && (item.like.count || item.like.likenum) || 0) || 0),
      time: Date.parse(String(item.addtime || '').replace(/-/g, '/')) || 0,
      user: {
        id: safeText(item.user_id, 96),
        nickname: safeText(item.user_name, 128),
        avatar: secureKugouAssetUrl(item.user_pic, 120),
      },
      provider: 'kugou',
      song: source,
    })).filter(comment => comment.content);
    return { provider: 'kugou', id: mixSongId, total: Number(payload && payload.count || comments.length) || comments.length, comments, hot: true };
  }

  async function commentsForSong(provider, song, limit) {
    provider = PLATFORM_ORDER.includes(provider) ? provider : providerOf(song);
    const sourceSong = sanitizeSearchSong({ ...(song || {}), provider, source: provider });
    let result;
    if (provider === 'kugou') result = await kugouComments(sourceSong || song, limit);
    else if (provider === 'netease' && typeof deps.commentsNetease === 'function') result = await deps.commentsNetease(sourceSong || song, limit);
    else if (provider === 'qq' && typeof deps.commentsQQ === 'function') result = await deps.commentsQQ(sourceSong || song, limit);
    else return { provider, source: provider, song: sourceSong, comments: [], error: 'COMMENTS_UNAVAILABLE' };
    result = result && typeof result === 'object' ? result : {};
    const comments = (Array.isArray(result.comments) ? result.comments : [])
      .map(comment => normalizePlatformComment(provider, sourceSong, comment))
      .filter(Boolean);
    return {
      ...result,
      provider,
      source: provider,
      song: sourceSong,
      comments,
      total: Math.max(comments.length, Number(result.total) || 0),
    };
  }

  async function getStatuses() {
    const result = {
      kugou: {
        provider: 'kugou',
        loggedIn: kugouLoggedIn(),
        sessionValid: !!(kugouLoggedIn() && kugouProfile && (kugouProfile.profileVerified === true || kugouProfile.playlistsVerified === true)),
        profile: kugouLoggedIn() ? kugouProfile : null,
        persistedBy: 'electron-session-partition',
        sessionUpdatedAt: kugouSessionUpdatedAt || 0,
      },
      kugou_concept: {
        provider: 'kugou_concept',
        loggedIn: kugouConceptLoggedIn(),
        sessionValid: !!(kugouConceptLoggedIn() && kugouConceptProfile && (kugouConceptProfile.profileVerified === true || kugouConceptProfile.playlistsVerified === true)),
        profile: kugouConceptLoggedIn() ? kugouConceptProfile : null,
        persistedBy: 'electron-session-partition',
        sessionUpdatedAt: kugouConceptSessionUpdatedAt || 0,
      },
      qishui: {
        provider: 'qishui',
        loggedIn: qishuiLoggedIn(),
        sessionValid: !!(qishuiLoggedIn() && qishuiProfile && qishuiProfile.profileVerified === true),
        profile: qishuiLoggedIn() ? qishuiProfile : null,
        persistedBy: 'electron-session-partition',
        sessionUpdatedAt: qishuiSessionUpdatedAt || 0,
      },
    };
    const tasks = [
      ['netease', deps.statusNetease],
      ['qq', deps.statusQQ],
    ];
    await Promise.all(tasks.map(async ([provider, fn]) => {
      if (typeof fn !== 'function') {
        result[provider] = { provider, loggedIn: false, available: false };
        return;
      }
      try {
        const status = await fn();
        const sessionValid = !!(status && status.loggedIn === true && status.sessionValid === true
          && status.ok !== false && !status.error && status.stale !== true
          && status.profileUnavailable !== true && status.pendingProfile !== true
          && status.ignoredStaleSession !== true);
        result[provider] = { provider, loggedIn: status && status.loggedIn === true, sessionValid, profile: sessionValid ? {
          userId: safeText(status.userId, 96),
          nickname: safeText(status.nickname, 128),
          avatar: safeText(status.avatar, 2048),
        } : null };
      } catch (error) {
        result[provider] = { provider, loggedIn: false, error: safeText(error && error.message || 'STATUS_FAILED', 160) };
      }
    }));
    return {
      ok: true,
      platforms: result,
      loggedInPlatforms: PLATFORM_ORDER.filter(provider => {
        const status = result[provider];
        return status && status.loggedIn === true && status.sessionValid === true
          && status.ok !== false && !status.error && status.stale !== true
          && status.profileUnavailable !== true && status.pendingProfile !== true
          && status.ignoredStaleSession !== true;
      }),
    };
  }

  async function hotComments(input) {
    input = input || {};
    const statuses = await getStatuses();
    const logged = statuses.loggedInPlatforms;
    const limit = Math.max(1, Math.min(20, Number(input.limit) || 12));
    const requestedProvider = safeText(input.provider, 24).toLowerCase();
    const explicitSong = sanitizeSearchSong(input.song || input);
    if (requestedProvider && explicitSong) {
      if (!logged.includes(requestedProvider)) return { ok: true, comments: [], empty: true, code: 'MUSIC_PLATFORM_LOGIN_REQUIRED', message: '登录对应音乐平台后显示歌曲热评' };
      let result;
      try {
        result = await commentsForSong(requestedProvider, explicitSong, limit);
      } catch (error) {
        return { ok: false, comments: [], empty: true, code: 'HOT_COMMENTS_UPSTREAM_FAILED', message: '热评读取失败，请稍后重试', error: safeText(error && error.message || 'HOT_COMMENTS_UPSTREAM_FAILED', 160) };
      }
      if (result.error && !(result.comments || []).length && result.error !== 'COMMENTS_UNAVAILABLE') {
        return { ok: false, comments: [], empty: true, code: 'HOT_COMMENTS_UPSTREAM_FAILED', message: '热评读取失败，请稍后重试', error: safeText(result.error, 160) };
      }
      const comments = (result.comments || []).sort((left, right) => Number(right.likedCount || 0) - Number(left.likedCount || 0)).slice(0, limit);
      return { ok: true, comments, empty: !comments.length, code: comments.length ? '' : 'NO_HOT_COMMENTS', message: comments.length ? '' : '当前歌曲暂无可用热评' };
    }
    if (!logged.length) return { ok: true, comments: [], empty: true, code: 'NO_LOGGED_IN_MUSIC_PLATFORM', message: '登录音乐平台后显示歌曲热评' };
    const requestedGroupCount = Math.max(1, Math.ceil(limit / 3));
    const candidateLimit = Math.min(HOT_COMMENT_MAX_CANDIDATES_PER_PROVIDER, Math.max(8, requestedGroupCount * 2));
    const maxJobs = Math.min(HOT_COMMENT_MAX_JOBS, Math.max(12, requestedGroupCount * 4));
    const candidateTasks = logged.map(async provider => {
      if (provider === 'kugou') {
        const songs = await searchKugou('热歌', candidateLimit);
        return { provider, supported: true, songs: songs.map(sanitizeSearchSong).filter(Boolean).slice(0, candidateLimit) };
      }
      const fn = deps.hotCandidates && deps.hotCandidates[provider];
      return typeof fn === 'function'
        ? { provider, supported: true, songs: ((await fn(candidateLimit)) || []).map(sanitizeSearchSong).filter(Boolean).slice(0, candidateLimit) }
        : { provider, supported: false, songs: [] };
    });
    const candidateResults = await Promise.allSettled(candidateTasks);
    const candidateBuckets = [];
    let candidateSuccesses = 0;
    let candidateFailures = 0;
    candidateResults.forEach((result, index) => {
      const provider = logged[index];
      const supported = provider === 'kugou' || !!(deps.hotCandidates && typeof deps.hotCandidates[provider] === 'function');
      if (result.status === 'rejected') {
        if (supported) candidateFailures += 1;
        return;
      }
      if (result.value.supported) candidateSuccesses += 1;
      if (result.status !== 'fulfilled') return;
      const songs = [];
      const seenProviderSongs = new Set();
      result.value.songs.forEach(song => {
        const key = realSongKey(song, provider);
        if (!key || seenProviderSongs.has(key)) return;
        seenProviderSongs.add(key);
        songs.push(song);
      });
      if (songs.length) candidateBuckets.push({ provider, songs });
    });
    const jobs = [];
    const seenJobs = new Set();
    for (let position = 0; jobs.length < maxJobs; position += 1) {
      let added = false;
      candidateBuckets.forEach(bucket => {
        const song = bucket.songs[position];
        const key = realSongKey(song, bucket.provider);
        if (!key || seenJobs.has(key) || jobs.length >= maxJobs) return;
        seenJobs.add(key);
        jobs.push({ provider: bucket.provider, song });
        added = true;
      });
      if (!added) break;
    }
    if (!jobs.length && candidateFailures > 0 && candidateSuccesses === 0) {
      return { ok: false, comments: [], empty: true, code: 'HOT_COMMENTS_UPSTREAM_FAILED', message: '热评读取失败，请稍后重试' };
    }
    const commentResults = await Promise.allSettled(jobs.map(job => commentsForSong(job.provider, job.song, 8)));
    const comments = [];
    let commentSuccesses = 0;
    let commentFailures = 0;
    commentResults.forEach(result => {
      if (result.status !== 'fulfilled') { commentFailures += 1; return; }
      const value = result.value || {};
      if (value.error && !(value.comments || []).length) commentFailures += 1;
      else commentSuccesses += 1;
      (value.comments || []).forEach(comment => comments.push(comment));
    });
    if (!comments.length && commentFailures > 0 && commentSuccesses === 0) {
      return { ok: false, comments: [], empty: true, code: 'HOT_COMMENTS_UPSTREAM_FAILED', message: '热评读取失败，请稍后重试' };
    }
    const deduplicated = [];
    const seen = new Set();
    comments.forEach(comment => {
      const song = comment.song || {};
      const user = comment.user || {};
      const provider = safeText(comment.provider || song.provider || song.source, 24).toLowerCase();
      const songKey = realSongKey(song, provider);
      if (!songKey) return;
      const key = [songKey, comment.id || '', comment.id ? '' : normalizeText(comment.content).slice(0, 500), comment.id ? '' : (user.id || user.nickname || ''), comment.id ? '' : comment.time || ''].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      deduplicated.push(comment);
    });
    const grouped = new Map();
    deduplicated.forEach(comment => {
      const song = comment.song || {};
      const provider = safeText(comment.provider || song.provider || song.source, 24).toLowerCase();
      const key = realSongKey(song, provider);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, { provider, song, comments: [] });
      grouped.get(key).comments.push(comment);
    });
    const groups = Array.from(grouped.values()).map(group => ({
      ...group,
      comments: group.comments.sort((left, right) => Number(right.likedCount || 0) - Number(left.likedCount || 0)).slice(0, 3),
    }));
    const selectedGroups = groups.filter(group => group.comments.length === 3);
    const selectedComments = selectedGroups.flatMap(group => group.comments);
    return {
      ok: true,
      comments: selectedComments,
      commentGroups: selectedGroups,
      commentsPerSong: 3,
      empty: !selectedComments.length,
      code: selectedComments.length ? '' : 'NO_HOT_COMMENTS',
      message: selectedComments.length ? '' : '已登录平台暂无可用热评',
    };
  }

  function scheduleKugouSessionUpdate(payload) {
    const input = payload && typeof payload === 'object' ? { ...payload } : {};
    if (input.clear === true) invalidateKugouAuthGeneration();
    return runAuthOperation('kugou', () => updateKugouSession(input));
  }

  function scheduleKugouConceptSessionUpdate(payload) {
    const input = payload && typeof payload === 'object' ? { ...payload } : {};
    if (input.clear === true) invalidateKugouConceptAuthGeneration();
    return runAuthOperation('kugou_concept', () => updateKugouConceptSession(input));
  }

  function scheduleQishuiSessionUpdate(payload) {
    const input = payload && typeof payload === 'object' ? { ...payload } : {};
    if (input.clear === true) invalidateQishuiAuthGeneration();
    return runAuthOperation('qishui', () => updateQishuiSession(input));
  }

  async function updateKugouSession(payload) {
    payload = payload || {};
    if (payload.clear === true) {
      kugouCookies = { ...kugouDeviceCookies };
      kugouProfile = null;
      kugouSessionUpdatedAt = Date.now();
      sourceCache.clear();
      return { ok: true, provider: 'kugou', loggedIn: false, sessionValid: false, profile: null, ignoredStaleSession: false };
    }
    const sourceProfile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const incomingCookies = Object.assign({}, kugouDeviceCookies, parseCookieInput(payload.cookies || payload.cookie || {}));
    const currentUserId = safeText(kugouCookies.userid, 96);
    const incomingUserId = safeText(incomingCookies.userid, 96);
    const incomingUpdatedAt = Math.max(0, Number(sourceProfile.updatedAt) || 0);
    if (!payload.clear && kugouLoggedIn() && currentUserId && incomingUserId && currentUserId !== incomingUserId && incomingUpdatedAt < kugouSessionUpdatedAt) {
      return { ok: true, provider: 'kugou', loggedIn: true, sessionValid: false, profile: kugouProfile, ignoredStaleSession: true };
    }
    kugouCookies = incomingCookies;
    const avatar = secureKugouAssetUrl(sourceProfile.avatar || sourceProfile.avatarUrl || sourceProfile.pic, 240);
    const nickname = safeText(sourceProfile.nickname || sourceProfile.name || kugouCookies.KugooID, 128);
    const vipType = Math.max(0, Number(sourceProfile.vipType != null ? sourceProfile.vipType : kugouCookies.vip_type) || 0);
    const membershipVerified = sourceProfile.membershipVerified === true || Object.prototype.hasOwnProperty.call(kugouCookies, 'vip_type');
    const membershipState = membershipVerified ? (sourceProfile.isVip === true || vipType > 0 ? 'member' : 'non_member') : 'unknown';
    kugouProfile = kugouLoggedIn() ? {
      userId: safeText(kugouCookies.userid, 96),
      nickname,
      avatar,
      vipType,
      vipLevel: sourceProfile.vipLevel || (membershipVerified ? (vipType > 0 ? 'vip' : 'none') : 'unknown'),
      isVip: sourceProfile.isVip === true || vipType > 0,
      membershipLabel: safeText(sourceProfile.membershipLabel, 64) || (membershipVerified ? (vipType > 0 ? 'VIP ' + vipType : '普通用户') : '会员状态待酷狗返回'),
      membershipVerified,
      membershipState,
      profileVerified: payload.revalidate !== true && sourceProfile.profileVerified === true,
      profileSource: safeText(sourceProfile.profileSource, 64) || (nickname || avatar ? 'persisted-profile' : 'unverified'),
      playlistsVerified: payload.revalidate !== true && sourceProfile.playlistsVerified === true,
      playlistCount: Math.max(0, Number(sourceProfile.playlistCount) || 0),
      updatedAt: incomingUpdatedAt,
    } : null;
    kugouSessionUpdatedAt = Date.now();
    sourceCache.clear();
    if (kugouLoggedIn() && (payload.revalidate === true || !kugouProfile.profileVerified || !kugouProfile.playlistsVerified)) {
      await refreshKugouAccountData(2, kugouSessionGeneration);
      if (kugouProfile.membershipVerified) kugouCookies.vip_type = String(kugouProfile.vipType);
    }
    return {
      ok: true,
      provider: 'kugou',
      loggedIn: kugouLoggedIn(),
      sessionValid: !!(kugouLoggedIn() && kugouProfile && (kugouProfile.profileVerified === true || kugouProfile.playlistsVerified === true)),
      profile: kugouProfile,
      ignoredStaleSession: false,
    };
  }

  async function updateKugouConceptSession(payload) {
    payload = payload || {};
    if (payload.clear === true) {
      kugouConceptCookies = { ...kugouConceptDeviceCookies };
      kugouConceptProfile = null;
      kugouConceptSessionUpdatedAt = Date.now();
      sourceCache.clear();
      return { ok: true, provider: 'kugou_concept', loggedIn: false, sessionValid: false, profile: null, ignoredStaleSession: false };
    }
    const sourceProfile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const incomingCookies = Object.assign({}, kugouConceptDeviceCookies, parseCookieInput(payload.cookies || payload.cookie || {}));
    const currentUserId = safeText(kugouConceptCookies.userid, 96);
    const incomingUserId = safeText(incomingCookies.userid, 96);
    const incomingUpdatedAt = Math.max(0, Number(sourceProfile.updatedAt) || 0);
    if (!payload.clear && kugouConceptLoggedIn() && currentUserId && incomingUserId
      && currentUserId !== incomingUserId && incomingUpdatedAt < kugouConceptSessionUpdatedAt) {
      return { ok: true, provider: 'kugou_concept', loggedIn: true, sessionValid: false, profile: kugouConceptProfile, ignoredStaleSession: true };
    }
    kugouConceptCookies = incomingCookies;
    const avatar = secureKugouAssetUrl(sourceProfile.avatar || sourceProfile.avatarUrl || sourceProfile.pic, 240);
    const nickname = safeText(sourceProfile.nickname || sourceProfile.name, 128);
    const membershipVerified = sourceProfile.membershipVerified === true
      || Object.prototype.hasOwnProperty.call(kugouConceptCookies, 'vip_type');
    const vipType = membershipVerified
      ? Math.max(0, Number(sourceProfile.vipType != null ? sourceProfile.vipType : kugouConceptCookies.vip_type) || 0)
      : 0;
    const isVip = membershipVerified && (sourceProfile.isVip === true || vipType > 0);
    kugouConceptProfile = kugouConceptLoggedIn() ? {
      provider: 'kugou_concept',
      userId: safeText(kugouConceptCookies.userid, 96),
      nickname,
      avatar,
      vipType,
      vipLevel: membershipVerified ? (safeText(sourceProfile.vipLevel, 24) || (isVip ? 'vip' : 'none')) : 'unknown',
      isVip,
      membershipLabel: membershipVerified
        ? (safeText(sourceProfile.membershipLabel, 64) || (isVip ? 'VIP ' + vipType : '普通用户'))
        : '会员状态待酷狗概念版返回',
      membershipVerified,
      membershipState: membershipVerified ? (isVip ? 'member' : 'non_member') : 'unknown',
      profileVerified: payload.revalidate !== true && sourceProfile.profileVerified === true && !!(nickname || avatar),
      profileSource: safeText(sourceProfile.profileSource, 64) || (nickname || avatar ? 'persisted-profile' : 'session-credentials'),
      playlistsVerified: payload.revalidate !== true && sourceProfile.playlistsVerified === true,
      playlistCount: Math.max(0, Number(sourceProfile.playlistCount) || 0),
      updatedAt: incomingUpdatedAt,
    } : null;
    kugouConceptSessionUpdatedAt = Date.now();
    sourceCache.clear();
    if (kugouConceptLoggedIn() && (payload.revalidate === true || !kugouConceptProfile.playlistsVerified)) {
      await refreshKugouConceptAccountData(2, kugouConceptSessionGeneration);
    }
    return {
      ok: true,
      provider: 'kugou_concept',
      loggedIn: kugouConceptLoggedIn(),
      sessionValid: !!(kugouConceptLoggedIn() && kugouConceptProfile && (kugouConceptProfile.profileVerified === true || kugouConceptProfile.playlistsVerified === true)),
      profile: kugouConceptProfile,
      ignoredStaleSession: false,
    };
  }

  async function updateQishuiSession(payload) {
    payload = payload || {};
    if (payload.clear === true) {
      qishuiCookies = {};
      qishuiProfile = null;
      qishuiSessionUpdatedAt = Date.now();
      sourceCache.clear();
      return { ok: true, provider: 'qishui', loggedIn: false, sessionValid: false, profile: null, ignoredStaleSession: false };
    }
    const sourceProfile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const sourceDevice = payload.device && typeof payload.device === 'object' ? payload.device : sourceProfile;
    const preserveExisting = payload.preserveExistingOnFailure === true && qishuiLoggedIn();
    const previous = preserveExisting ? {
      cookies: { ...qishuiCookies },
      profile: qishuiProfile ? { ...qishuiProfile } : null,
      device: { ...qishuiDevice },
      sessionUpdatedAt: qishuiSessionUpdatedAt,
    } : null;
    const deviceId = safeText(sourceDevice.deviceId, 64).replace(/\D/g, '');
    const installId = safeText(sourceDevice.installId, 64).replace(/\D/g, '');
    if (deviceId.length >= 8) qishuiDevice.deviceId = deviceId;
    if (installId.length >= 8) qishuiDevice.installId = installId;
    const incomingCookies = qishuiCookieInput(payload.cookies || payload.cookie || {});
    if (!qishuiSessionCookie(incomingCookies)) {
      qishuiCookies = {};
      qishuiProfile = null;
      return { ok: true, provider: 'qishui', loggedIn: false, sessionValid: false, profile: null, ignoredStaleSession: false };
    }
    const incomingUpdatedAt = Math.max(0, Number(sourceProfile.updatedAt) || 0);
    const incomingUserId = safeText(sourceProfile.userId || sourceProfile.id, 96);
    if (qishuiLoggedIn() && incomingUserId && qishuiProfile.userId !== incomingUserId
      && incomingUpdatedAt < qishuiSessionUpdatedAt) {
      return { ok: true, provider: 'qishui', loggedIn: true, sessionValid: false, profile: qishuiProfile, ignoredStaleSession: true };
    }
    qishuiCookies = incomingCookies;
    qishuiProfile = incomingUserId ? {
      provider: 'qishui',
      userId: incomingUserId,
      nickname: safeText(sourceProfile.nickname || sourceProfile.name, 128),
      avatar: secureQishuiUrl(sourceProfile.avatar || sourceProfile.avatarUrl, false),
      vipType: Math.max(0, Number(sourceProfile.vipType) || 0),
      vipLevel: safeText(sourceProfile.vipLevel, 24) || 'unknown',
      isVip: sourceProfile.isVip === true,
      membershipLabel: safeText(sourceProfile.membershipLabel, 64) || '会员状态待汽水音乐返回',
      membershipVerified: sourceProfile.membershipVerified === true,
      membershipState: safeText(sourceProfile.membershipState, 24) || 'unknown',
      profileVerified: sourceProfile.profileVerified === true,
      profileSource: safeText(sourceProfile.profileSource, 64) || 'persisted-profile',
      playlistsVerified: sourceProfile.playlistsVerified === true,
      playlistCount: Math.max(0, Number(sourceProfile.playlistCount) || 0),
      deviceId: qishuiDevice.deviceId,
      installId: qishuiDevice.installId,
      updatedAt: incomingUpdatedAt,
    } : null;
    qishuiSessionUpdatedAt = Date.now();
    sourceCache.clear();
    if (payload.revalidate === true || !qishuiProfile || !qishuiProfile.profileVerified) {
      try {
        await refreshQishuiAccountData(2, qishuiSessionGeneration);
      } catch (error) {
        if (previous) {
          qishuiCookies = previous.cookies;
          qishuiProfile = previous.profile;
          qishuiDevice = previous.device;
          qishuiSessionUpdatedAt = previous.sessionUpdatedAt;
          if (error && error.sessionInvalid) throw new Error('QISHUI_OFFICIAL_SESSION_INVALID');
        }
        if (error && error.sessionInvalid) return { ok: true, provider: 'qishui', loggedIn: false, sessionValid: false, profile: null };
        throw error;
      }
    }
    return {
      ok: true,
      provider: 'qishui',
      loggedIn: qishuiLoggedIn(),
      sessionValid: !!(qishuiLoggedIn() && qishuiProfile && qishuiProfile.profileVerified === true),
      profile: qishuiLoggedIn() ? qishuiProfile : null,
      ignoredStaleSession: false,
    };
  }

  function firstArray(payload, keys) {
    for (const key of keys) {
      const parts = key.split('.');
      let value = payload;
      for (const part of parts) value = value && value[part];
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  function kugouPlaylistMetadataFromPayload(payload, provider, playlistId, profile) {
    const candidates = [
      payload && payload.data && payload.data.listinfo,
      payload && payload.data && payload.data.list_info,
      payload && payload.data && payload.data.special,
      payload && payload.data && payload.data.special_info,
      payload && payload.data && payload.data.info,
      payload && payload.data && payload.data.playlist,
      payload && payload.listinfo,
      payload && payload.list_info,
      payload && payload.special,
      payload && payload.info,
      payload && payload.list && payload.list.list,
      payload && payload.list,
      payload && payload.playlist,
      payload && payload.data,
    ].filter(value => value && typeof value === 'object' && !Array.isArray(value));
    const raw = candidates.find(value => value.name || value.listname || value.list_name || value.specialname || value.title);
    if (!raw) return null;
    const name = safeText(raw.name || raw.listname || raw.list_name || raw.specialname || raw.title, 256);
    if (!name) return null;
    const id = safeText(raw.listid || raw.list_id || raw.specialid || raw.playlist_id || raw.id || playlistId, 128);
    const songCount = Math.max(0, Number(raw.count || raw.song_count || raw.total || raw.songnum || raw.songCount || 0) || 0);
    return {
      provider,
      source: provider,
      id: id || playlistId,
      playlistId: id || playlistId,
      globalId: safeText(raw.global_collection_id, 128),
      name,
      cover: secureKugouAssetUrl(raw.pic || raw.img || raw.imgurl || raw.cover || raw.list_pic || raw.image || raw.imageurl, 300),
      trackCount: songCount,
      songCount,
      creator: safeText(raw.nickname || raw.username || raw.user_name || raw.creator || profile && profile.nickname, 128),
      ...playlistOwnershipMetadata('unknown'),
    };
  }

  async function getKugouPublicPlaylistMetadata(playlistId, provider) {
    const id = normalizePlaylistId(provider, playlistId);
    if (!id) throw playlistLinkError('PLAYLIST_ID_INVALID', '歌单 ID 格式无效', 400, { provider });
    const endpoints = [
      'https://mobilecdn.kugou.com/api/v3/special/info?specialid=' + encodeURIComponent(id),
      'https://m.kugou.com/plist/list/' + encodeURIComponent(id) + '?json=true&page=1',
    ];
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const payload = await playlistRequestJson(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36',
            Referer: 'https://www.kugou.com/',
            Accept: 'application/json,text/plain,*/*',
          },
        });
        const status = Number(payload && (payload.status ?? payload.code ?? payload.errcode) || 0);
        if (status && status !== 1 && status !== 200) {
          const error = new Error(safeText(payload && (payload.error || payload.errmsg || payload.message), 160) || 'KUGOU_PLAYLIST_DETAIL_' + status);
          error.code = status === 404 ? 'PLAYLIST_NOT_FOUND' : 'KUGOU_PLAYLIST_DETAIL_FAILED';
          throw error;
        }
        const metadata = kugouPlaylistMetadataFromPayload(payload, provider, id, provider === 'kugou' ? kugouProfile : kugouConceptProfile);
        if (metadata) return metadata;
        lastError = new Error('KUGOU_PLAYLIST_METADATA_MISSING');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('KUGOU_PLAYLIST_METADATA_MISSING');
  }

  async function getKugouPublicPlaylist(playlistId, provider) {
    const id = normalizePlaylistId(provider, playlistId);
    if (!id) throw playlistLinkError('PLAYLIST_ID_INVALID', '歌单 ID 格式无效', 400, { provider });
    const metadata = await getKugouPublicPlaylistMetadata(id, provider);
    const size = 300;
    const rawTracks = [];
    const seenPages = new Set();
    let sourceTotal = 0;
    for (let page = 1; page <= 100; page += 1) {
      const endpoint = new URL('https://mobilecdn.kugou.com/api/v3/special/song');
      endpoint.searchParams.set('specialid', id);
      endpoint.searchParams.set('page', String(page));
      endpoint.searchParams.set('pagesize', String(size));
      endpoint.searchParams.set('with_res_tag', '1');
      const payload = await playlistRequestJson(endpoint.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36',
          Referer: 'https://www.kugou.com/yy/special/single/' + encodeURIComponent(id) + '.html',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      const status = Number(payload && (payload.status ?? payload.code ?? payload.error_code) || 0);
      if (status && status !== 1 && status !== 200) {
        const error = new Error(safeText(payload && (payload.error || payload.errmsg || payload.message), 160) || 'KUGOU_PLAYLIST_TRACKS_' + status);
        error.code = status === 401 ? 'PLAYLIST_LOGIN_REQUIRED'
          : (status === 403 ? 'PLAYLIST_FORBIDDEN' : (status === 404 ? 'PLAYLIST_NOT_FOUND' : 'KUGOU_PLAYLIST_TRACKS_FAILED'));
        throw error;
      }
      const rows = firstArray(payload, ['data.info', 'data.songs', 'data.list', 'info', 'songs', 'list']);
      const fingerprint = rows.map(item => item && (item.hash || item.FileHash || item.audio_id || item.mixsongid || item.filename || '')).join('|');
      if (seenPages.has(fingerprint)) break;
      seenPages.add(fingerprint);
      rawTracks.push(...rows);
      sourceTotal = Math.max(sourceTotal, Number(payload && payload.data && (payload.data.total || payload.data.count || payload.data.song_count) || 0) || 0);
      if (!rows.length || rows.length < size || (sourceTotal > 0 && rawTracks.length >= sourceTotal)) break;
    }
    const seen = new Set();
    const tracks = rawTracks.map(item => {
      const mapped = mapKugouSong(Object.assign({}, item, item && item.audio || {}, item && item.audio_info || {}));
      if (!mapped) return null;
      return provider === 'kugou_concept' ? {
        ...mapped,
        provider,
        source: provider,
        type: provider,
      } : mapped;
    }).filter(track => {
      const key = track && (track.id || track.hash);
      if (!key || seen.has(String(key))) return false;
      seen.add(String(key));
      return true;
    });
    if (sourceTotal > 0) {
      metadata.trackCount = sourceTotal;
      metadata.songCount = sourceTotal;
    } else if (!metadata.trackCount) {
      metadata.trackCount = tracks.length;
      metadata.songCount = tracks.length;
    }
    return { ok: true, provider, loggedIn: false, public: true, playlist: metadata, tracks, total: tracks.length };
  }

  async function getKugouPlaylists(page, pageSize) {
    if (!kugouLoggedIn()) return { ok: false, provider: 'kugou', loggedIn: false, playlists: [], error: 'NOT_LOGGED_IN' };
    const userid = Number(kugouCookies.userid) || 0;
    const token = safeText(kugouCookies.token, 4096);
    const size = Math.max(1, Math.min(300, Number(pageSize) || 100));
    const explicitPage = page != null && String(page).trim() !== '';
    const startPage = Math.max(1, Number(page) || 1);
    const fetchPage = async pageNumber => {
      const payload = await kugouRequest({
        path: '/v7/get_all_list',
        method: 'POST',
        router: 'cloudlist.service.kugou.com',
        includeSession: true,
        params: { plat: 1, userid, token },
        body: { userid, token, total_ver: 979, type: 2, page: pageNumber, pagesize: size },
      });
      requireKugouBusinessSuccess(payload, 'KUGOU_PLAYLISTS');
      return firstArray(payload, ['data.info', 'data.lists', 'data.list', 'info', 'lists', 'list']);
    };
    const allRaw = [];
    const pageFingerprints = new Set();
    let fetchedPages = 0;
    for (let pageNumber = startPage; pageNumber < startPage + (explicitPage ? 1 : 100); pageNumber += 1) {
      const raw = await fetchPage(pageNumber);
      fetchedPages += 1;
      const fingerprint = raw.map(item => item.listid || item.list_id || item.id || item.global_collection_id || '').join('|');
      if (pageFingerprints.has(fingerprint)) break;
      pageFingerprints.add(fingerprint);
      allRaw.push(...raw);
      if (explicitPage || raw.length < size) break;
    }
    const seen = new Set();
    const playlists = allRaw.map(item => {
      const id = safeText(item.listid || item.list_id || item.id || item.global_collection_id, 128);
      const songCount = Math.max(0, Number(item.count || item.song_count || item.total || 0) || 0);
      return {
        provider: 'kugou', id, playlistId: id,
        globalId: safeText(item.global_collection_id, 128),
        name: safeText(item.name || item.listname || item.list_name || item.specialname, 256),
        cover: secureKugouAssetUrl(item.pic || item.img || item.cover || item.list_pic, 300),
        trackCount: songCount, songCount,
        creator: safeText(item.nickname || item.username || kugouProfile && kugouProfile.nickname, 128),
        ownerId: safeText(item.userid || item.user_id || item.uid || item.ownerid || item.owner_id, 96),
        songs: [],
        ...playlistOwnershipMetadata('unknown'),
      };
    }).filter(item => item.id && item.name && !seen.has(item.id) && seen.add(item.id));
    return { ok: true, provider: 'kugou', loggedIn: true, playlists, total: playlists.length, fetchedPages, page: startPage, hasMore: explicitPage && allRaw.length >= size };
  }

  async function getKugouPlaylistTracks(id, page, pageSize) {
    if (!kugouLoggedIn()) return { ok: false, provider: 'kugou', loggedIn: false, tracks: [], error: 'NOT_LOGGED_IN' };
    const playlistId = safeText(id, 128);
    if (!playlistId) return { ok: false, provider: 'kugou', tracks: [], error: 'MISSING_PLAYLIST_ID' };
    const size = Math.max(1, Math.min(300, Number(pageSize) || 100));
    const userid = Number(kugouCookies.userid) || 0;
    const token = safeText(kugouCookies.token, 4096);
    const explicitPage = page != null && String(page).trim() !== '';
    const startPage = Math.max(1, Number(page) || 1);
    const allRaw = [];
    const pageFingerprints = new Set();
    let fetchedPages = 0;
    let playlist = null;
    for (let pageNumber = startPage; pageNumber < startPage + (explicitPage ? 1 : 100); pageNumber += 1) {
      const payload = await kugouRequest({
        path: '/v4/get_list_all_file',
        method: 'POST',
        router: 'cloudlist.service.kugou.com',
        includeSession: true,
        body: {
          listid: playlistId, userid, area_code: 1, show_relate_goods: 0,
          pagesize: size, allplatform: 1, show_cover: 1, type: 0, token, page: pageNumber,
        },
      });
      requireKugouBusinessSuccess(payload, 'KUGOU_PLAYLIST_TRACKS');
      if (!playlist) playlist = kugouPlaylistMetadataFromPayload(payload, 'kugou', playlistId, kugouProfile);
      const raw = firstArray(payload, ['data.info', 'data.songs', 'data.list', 'info', 'songs', 'list']);
      fetchedPages += 1;
      const fingerprint = raw.map(item => item.hash || item.FileHash || item.audio_id || item.mixsongid || item.audio_info && item.audio_info.hash || '').join('|');
      if (pageFingerprints.has(fingerprint)) break;
      pageFingerprints.add(fingerprint);
      allRaw.push(...raw);
      if (explicitPage || raw.length < size) break;
    }
    const tracks = allRaw.map(item => mapKugouSong(Object.assign({}, item, item.audio || {}, item.audio_info || {}))).filter(Boolean);
    return { ok: true, provider: 'kugou', loggedIn: true, playlistId, playlist, tracks, total: tracks.length, fetchedPages, page: startPage, hasMore: explicitPage && allRaw.length >= size };
  }

  async function getKugouConceptPlaylists(page, pageSize) {
    if (!kugouConceptLoggedIn()) {
      return { ok: false, provider: 'kugou_concept', loggedIn: false, playlists: [], error: 'NOT_LOGGED_IN' };
    }
    const userid = Number(kugouConceptCookies.userid) || 0;
    const token = safeText(kugouConceptCookies.token, 4096);
    const size = Math.max(1, Math.min(300, Number(pageSize) || 100));
    const explicitPage = page != null && String(page).trim() !== '';
    const startPage = Math.max(1, Number(page) || 1);
    const fetchPage = async pageNumber => {
      const payload = await kugouConceptRequest({
        path: '/v7/get_all_list',
        method: 'POST',
        router: 'cloudlist.service.kugou.com',
        includeSession: true,
        sendCookieHeader: true,
        params: { plat: 1, userid, token, total_ver: 979, type: 2, page: pageNumber, pagesize: size },
        body: { userid, token, total_ver: 979, type: 2, page: pageNumber, pagesize: size },
      });
      requireKugouBusinessSuccess(payload, 'KUGOU_CONCEPT_PLAYLISTS');
      return firstArray(payload, ['data.info', 'data.lists', 'data.list', 'info', 'lists', 'list']);
    };
    const allRaw = [];
    const pageFingerprints = new Set();
    let fetchedPages = 0;
    for (let pageNumber = startPage; pageNumber < startPage + (explicitPage ? 1 : 100); pageNumber += 1) {
      const raw = await fetchPage(pageNumber);
      fetchedPages += 1;
      const fingerprint = raw.map(item => item.listid || item.list_id || item.id || item.global_collection_id || '').join('|');
      if (pageFingerprints.has(fingerprint)) break;
      pageFingerprints.add(fingerprint);
      allRaw.push(...raw);
      if (explicitPage || raw.length < size) break;
    }
    const seen = new Set();
    const playlists = allRaw.map(item => {
      const id = safeText(item.listid || item.list_id || item.id || item.global_collection_id, 128);
      const songCount = Math.max(0, Number(item.count || item.song_count || item.total || 0) || 0);
      return {
        provider: 'kugou_concept',
        id,
        playlistId: id,
        globalId: safeText(item.global_collection_id, 128),
        name: safeText(item.name || item.listname || item.list_name || item.specialname, 256),
        cover: secureKugouAssetUrl(item.pic || item.img || item.cover || item.list_pic, 300),
        trackCount: songCount,
        songCount,
        creator: safeText(item.nickname || item.username || kugouConceptProfile && kugouConceptProfile.nickname, 128),
        ownerId: safeText(item.userid || item.user_id || item.uid || item.ownerid || item.owner_id, 96),
        songs: [],
        ...playlistOwnershipMetadata('unknown'),
      };
    }).filter(item => item.id && item.name && !seen.has(item.id) && seen.add(item.id));
    return {
      ok: true,
      provider: 'kugou_concept',
      loggedIn: true,
      playlists,
      total: playlists.length,
      fetchedPages,
      page: startPage,
      hasMore: explicitPage && allRaw.length >= size,
    };
  }

  async function getKugouConceptPlaylistTracks(id, page, pageSize) {
    if (!kugouConceptLoggedIn()) {
      return { ok: false, provider: 'kugou_concept', loggedIn: false, tracks: [], error: 'NOT_LOGGED_IN' };
    }
    const playlistId = safeText(id, 128).replace(/^kugou_concept:/, '');
    if (!playlistId) return { ok: false, provider: 'kugou_concept', tracks: [], error: 'MISSING_PLAYLIST_ID' };
    const size = Math.max(1, Math.min(300, Number(pageSize) || 100));
    const userid = Number(kugouConceptCookies.userid) || 0;
    const token = safeText(kugouConceptCookies.token, 4096);
    const explicitPage = page != null && String(page).trim() !== '';
    const startPage = Math.max(1, Number(page) || 1);
    const allRaw = [];
    const pageFingerprints = new Set();
    let fetchedPages = 0;
    let playlist = null;
    for (let pageNumber = startPage; pageNumber < startPage + (explicitPage ? 1 : 100); pageNumber += 1) {
      const payload = await kugouConceptRequest({
        path: '/v4/get_list_all_file',
        method: 'POST',
        router: 'cloudlist.service.kugou.com',
        includeSession: true,
        sendCookieHeader: true,
        params: { listid: playlistId, page: pageNumber, pagesize: size },
        body: {
          listid: playlistId,
          userid,
          area_code: 1,
          show_relate_goods: 0,
          pagesize: size,
          allplatform: 1,
          show_cover: 1,
          type: 0,
          token,
          page: pageNumber,
        },
      });
      requireKugouBusinessSuccess(payload, 'KUGOU_CONCEPT_PLAYLIST_TRACKS');
      if (!playlist) playlist = kugouPlaylistMetadataFromPayload(payload, 'kugou_concept', playlistId, kugouConceptProfile);
      const raw = firstArray(payload, ['data.info', 'data.songs', 'data.list', 'info', 'songs', 'list']);
      fetchedPages += 1;
      const fingerprint = raw.map(item => item.hash || item.FileHash || item.audio_id || item.mixsongid || item.audio_info && item.audio_info.hash || '').join('|');
      if (pageFingerprints.has(fingerprint)) break;
      pageFingerprints.add(fingerprint);
      allRaw.push(...raw);
      if (explicitPage || raw.length < size) break;
    }
    const tracks = allRaw.map(item => {
      const mapped = mapKugouSong(Object.assign({}, item, item.audio || {}, item.audio_info || {}));
      return mapped ? {
        ...mapped,
        provider: 'kugou_concept',
        source: 'kugou_concept',
        type: 'kugou_concept',
        playable: mapped.hash ? null : false,
        restriction: mapped.hash ? null : mapped.restriction,
      } : null;
    }).filter(Boolean);
    return {
      ok: true,
      provider: 'kugou_concept',
      loggedIn: true,
      playlistId,
      playlist,
      tracks,
      total: tracks.length,
      fetchedPages,
      page: startPage,
      hasMore: explicitPage && allRaw.length >= size,
    };
  }

  async function collectQishuiPages(pathname, initialCursor, count, itemKey, extraQuery, expectedGeneration) {
    const rows = [];
    const seenCursors = new Set();
    let cursor = safeText(initialCursor, 256);
    let fetchedPages = 0;
    for (let page = 0; page < 100; page += 1) {
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
      const payload = requireQishuiSuccess(await qishuiRequest(pathname, {
        query: { cursor, count: String(count), ...(extraQuery || {}) },
        expectedGeneration,
      }), 'QISHUI_COLLECTION');
      const pageRows = Array.isArray(payload[itemKey]) ? payload[itemKey] : [];
      rows.push(...pageRows);
      fetchedPages += 1;
      if (!payload.has_more) break;
      const next = safeText(payload.next_cursor, 256);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { rows, fetchedPages };
  }

  async function getQishuiPlaylists(cursor, pageSize, expectedGeneration) {
    if (!qishuiLoggedIn()) return { ok: false, provider: 'qishui', loggedIn: false, playlists: [], error: 'NOT_LOGGED_IN' };
    const size = Math.max(1, Math.min(100, Number(pageSize) || 50));
    const initialCursor = cursor == null ? '' : safeText(cursor, 256);
    let created;
    try {
      created = await collectQishuiPages('/luna/pc/user/playlist', initialCursor, size, 'playlists', {
        user_id: qishuiProfile.userId,
      }, expectedGeneration);
    } catch (_) {
      created = await collectQishuiPages('/luna/pc/me/playlist', initialCursor, size, 'playlists', null, expectedGeneration);
    }
    const collected = await collectQishuiPages('/luna/pc/me/collection/mixed', initialCursor, 500, 'mixed_collections', {
      item_types: ['album', 'playlist'],
    }, expectedGeneration);
    const seen = new Set();
    const playlists = created.rows.map(item => mapQishuiPlaylist(item, 'owned'))
      .concat(collected.rows.filter(item => item && item.playlist).map(item => mapQishuiPlaylist(item, 'subscribed')))
      .filter(item => item && !seen.has(item.id) && seen.add(item.id));
    return {
      ok: true,
      provider: 'qishui',
      loggedIn: true,
      playlists,
      total: playlists.length,
      fetchedPages: created.fetchedPages + collected.fetchedPages,
      hasMore: false,
    };
  }

  async function getQishuiPlaylistTracks(id, cursor, pageSize) {
    if (!qishuiLoggedIn()) return { ok: false, provider: 'qishui', loggedIn: false, tracks: [], error: 'NOT_LOGGED_IN' };
    const playlistId = safeText(id, 128).replace(/^qishui:/, '');
    if (!playlistId) return { ok: false, provider: 'qishui', tracks: [], error: 'MISSING_PLAYLIST_ID' };
    const size = Math.max(1, Math.min(100, Number(pageSize) || 100));
    const rows = [];
    const seenCursors = new Set();
    let nextCursor = cursor == null ? '' : safeText(cursor, 256);
    let fetchedPages = 0;
    let playlist = null;
    for (let page = 0; page < 100; page += 1) {
      if (seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      const payload = requireQishuiSuccess(await qishuiRequest('/luna/pc/playlist/detail', {
        query: { playlist_id: playlistId, cursor: nextCursor, count: size },
      }), 'QISHUI_PLAYLIST_TRACKS');
      if (!playlist && payload.playlist) playlist = mapQishuiPlaylist(payload.playlist);
      const pageRows = Array.isArray(payload.media_resources) && payload.media_resources.length
        ? payload.media_resources
        : (Array.isArray(payload.tracks) ? payload.tracks : []);
      rows.push(...pageRows);
      fetchedPages += 1;
      if (!payload.has_more) break;
      const next = safeText(payload.next_cursor, 256);
      if (!next || next === nextCursor) break;
      nextCursor = next;
    }
    const seen = new Set();
    const tracks = rows.map(mapQishuiTrack).filter(track => track && !seen.has(track.id) && seen.add(track.id));
    return {
      ok: true,
      provider: 'qishui',
      loggedIn: true,
      playlistId,
      playlist,
      tracks,
      total: tracks.length,
      fetchedPages,
      hasMore: false,
    };
  }

  async function getQishuiPublicPlaylistTracks(id, cursor, pageSize) {
    const playlistId = safeText(id, 128).replace(/^qishui:/, '');
    if (!playlistId) return { ok: false, provider: 'qishui', tracks: [], error: 'MISSING_PLAYLIST_ID' };
    const size = Math.max(1, Math.min(100, Number(pageSize) || 100));
    const rows = [];
    const seenCursors = new Set();
    let nextCursor = cursor == null ? '' : safeText(cursor, 256);
    let fetchedPages = 0;
    let playlist = null;
    const requestPlaylist = typeof deps.qishuiPlaylistRequest === 'function' ? deps.qishuiPlaylistRequest : qishuiRequest;
    for (let page = 0; page < 100; page += 1) {
      if (seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      let payload;
      try {
        payload = await requestPlaylist('/luna/pc/playlist/detail', {
          query: { playlist_id: playlistId, cursor: nextCursor, count: size },
          cookies: {},
          anonymous: true,
        });
      } catch (error) {
        const status = Number(error && (error.remoteStatus || error.statusCode) || 0);
        error.code = error && error.code || (status === 401 || status === 1000016
          ? 'PLAYLIST_LOGIN_REQUIRED'
          : (status === 403 ? 'PLAYLIST_FORBIDDEN' : (status === 404 ? 'PLAYLIST_NOT_FOUND' : 'QISHUI_PLAYLIST_PUBLIC_FAILED')));
        throw error;
      }
      const status = Number(payload && payload.status_code || 0);
      if (status !== 0) {
        const error = new Error('QISHUI_PLAYLIST_PUBLIC_REMOTE_' + status);
        error.remoteStatus = status;
        error.code = status === 401 || status === 1000016
          ? 'PLAYLIST_LOGIN_REQUIRED'
          : (status === 403 ? 'PLAYLIST_FORBIDDEN' : (status === 404 ? 'PLAYLIST_NOT_FOUND' : 'QISHUI_PLAYLIST_PUBLIC_FAILED'));
        throw error;
      }
      const rawPlaylist = payload.playlist && typeof payload.playlist === 'object' ? payload.playlist : null;
      const isPrivate = !!(rawPlaylist && (rawPlaylist.private === true || Number(rawPlaylist.is_private || 0) > 0
        || Number(rawPlaylist.privacy || 0) > 0 || /private/i.test(safeText(rawPlaylist.visibility, 32))));
      if (isPrivate) throw playlistLinkError('PLAYLIST_LOGIN_REQUIRED', '该私密歌单需要先登录汽水音乐', 401, { provider: 'qishui' });
      if (!playlist && rawPlaylist) {
        const mapped = mapQishuiPlaylist(rawPlaylist);
        const owner = rawPlaylist.owner && typeof rawPlaylist.owner === 'object' ? rawPlaylist.owner : {};
        playlist = mapped ? { ...mapped, creator: safeText(owner.nickname || owner.name, 128) } : null;
      }
      const pageRows = Array.isArray(payload.media_resources) && payload.media_resources.length
        ? payload.media_resources
        : (Array.isArray(payload.tracks) ? payload.tracks : []);
      rows.push(...pageRows);
      fetchedPages += 1;
      if (!payload.has_more) break;
      const next = safeText(payload.next_cursor, 256);
      if (!next || next === nextCursor) break;
      nextCursor = next;
    }
    if (!playlist) throw playlistLinkError('PLAYLIST_METADATA_UNAVAILABLE', '汽水音乐未返回真实歌单信息', 502, { provider: 'qishui' });
    const seen = new Set();
    const tracks = rows.map(mapQishuiTrack).filter(track => track && !seen.has(track.id) && seen.add(track.id));
    return {
      ok: true,
      provider: 'qishui',
      loggedIn: false,
      public: true,
      playlistId,
      playlist,
      tracks,
      total: tracks.length,
      fetchedPages,
      hasMore: false,
    };
  }

  function normalizePlaylistResolverError(error, provider) {
    if (error instanceof PlaylistLinkError) return error;
    const rawCode = safeText(error && (error.code || error.error), 96).toUpperCase();
    const rawMessage = safeText(error && error.message || rawCode, 256);
    const joined = rawCode + ' ' + rawMessage.toUpperCase();
    if (/NOT_LOGGED_IN|LOGIN_REQUIRED|SESSION_INVALID|AUTH(?:ORIZATION)?_?REQUIRED|REMOTE_HTTP_401/.test(joined)) {
      return playlistLinkError('PLAYLIST_LOGIN_REQUIRED', '该歌单需要先登录对应音乐平台', 401, { provider });
    }
    if (/DELETED|REMOVED|已删除|不存在|REMOTE_HTTP_410/.test(rawMessage) || /PLAYLIST_DELETED/.test(joined)) {
      return playlistLinkError('PLAYLIST_DELETED', '该歌单已被删除', 410, { provider });
    }
    if (/FORBIDDEN|PERMISSION|PRIVATE|NO_ACCESS|无权限|私密|REMOTE_HTTP_403/.test(joined)) {
      return playlistLinkError('PLAYLIST_FORBIDDEN', '当前账号无权读取该歌单', 403, { provider });
    }
    if (/NOT_FOUND|REMOTE_HTTP_404|不存在/.test(joined)) {
      return playlistLinkError('PLAYLIST_NOT_FOUND', '未找到该歌单', 404, { provider });
    }
    return playlistLinkError('PLAYLIST_UPSTREAM_FAILED', '歌单数据读取失败', 502, {
      provider,
      cause: rawCode || rawMessage || 'UNKNOWN',
    });
  }

  function ensurePlaylistPayload(result, provider) {
    if (!result || result.ok === false) {
      const failure = new Error(safeText(result && (result.message || result.error || result.code), 256) || 'PLAYLIST_UPSTREAM_FAILED');
      failure.code = safeText(result && (result.code || result.error), 96);
      failure.httpStatus = Number(result && (result.httpStatus || result.status)) || 0;
      throw normalizePlaylistResolverError(failure, provider);
    }
    return result;
  }

  function matchingPlaylist(playlists, playlistId) {
    const target = String(playlistId || '').replace(/^(?:kugou(?:_concept)?|qishui):/i, '');
    return (Array.isArray(playlists) ? playlists : []).find(item => {
      const ids = [item && item.id, item && item.playlistId, item && item.globalId, item && item.global_collection_id]
        .map(value => String(value == null ? '' : value).replace(/^(?:kugou(?:_concept)?|qishui):/i, ''));
      return ids.includes(target);
    }) || null;
  }

  function normalizeImportedTracks(provider, rows) {
    const tracks = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const song = sanitizeSearchSong({ ...row, provider, source: provider, type: provider });
      if (!song) continue;
      const key = provider + ':' + (song.id || song.mid || song.hash || song.qishuiTrackId);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tracks.push(song);
    }
    return tracks;
  }

  function normalizeImportedPlaylist(parsed, rawPlaylist, rawTracks, loggedIn) {
    const provider = parsed.provider;
    const playlistId = parsed.playlistId;
    const raw = rawPlaylist && typeof rawPlaylist === 'object' ? rawPlaylist : {};
    const name = safeText(raw.name || raw.title || raw.listname || raw.specialname, 256);
    if (!name) {
      throw playlistLinkError('PLAYLIST_METADATA_UNAVAILABLE', '平台未返回真实歌单名称，未执行导入', 502, { provider });
    }
    const tracks = normalizeImportedTracks(provider, rawTracks);
    const sourceCount = Math.max(0, Number(raw.trackCount || raw.songCount || raw.total || raw.count) || 0);
    const trackCount = sourceCount || tracks.length;
    const creatorValue = raw.creator && typeof raw.creator === 'object'
      ? (raw.creator.nickname || raw.creator.name || raw.creator.userName)
      : raw.creator;
    const updatedAt = Date.now();
    const isPrivate = raw.private === true || raw.isPrivate === true || Number(raw.privacy || 0) > 0;
    const playlist = {
      provider,
      source: provider,
      id: playlistId,
      playlistId,
      name,
      cover: safeText(raw.cover || raw.coverImgUrl || raw.picUrl || raw.logo || raw.image, 2048),
      creator: safeText(creatorValue || raw.nickname || raw.username, 128),
      trackCount,
      songCount: trackCount,
      sourceProvider: provider,
      sourcePlaylistId: playlistId,
      sourceUrl: parsed.normalizedUrl,
      sourceUpdatedAt: updatedAt,
    };
    const metadata = {
      name: playlist.name,
      cover: playlist.cover,
      creator: playlist.creator,
      songCount: playlist.songCount,
    };
    return {
      ok: true,
      provider,
      playlistId,
      normalizedUrl: parsed.normalizedUrl,
      sourceUrl: parsed.normalizedUrl,
      updatedAt,
      loggedIn: loggedIn === true,
      private: isPrivate,
      requiresLogin: isPrivate && loggedIn !== true,
      metadata,
      songs: tracks,
      playlist,
      tracks,
      total: tracks.length,
    };
  }

  async function resolvePlaylistLink(input) {
    let parsed;
    try {
      parsed = await resolveOfficialPlaylistLink(input);
      const provider = parsed.provider;
      let result;
      let metadata = null;
      let tracks = [];
      let loggedIn = false;
      if (provider === 'netease' || provider === 'qq') {
        const loader = provider === 'netease' ? deps.playlistNetease : deps.playlistQQ;
        if (typeof loader !== 'function') {
          throw playlistLinkError('PLAYLIST_PROVIDER_UNAVAILABLE', '该平台歌单服务当前不可用', 503, { provider });
        }
        result = ensurePlaylistPayload(await loader(parsed.playlistId), provider);
        metadata = result.playlist;
        tracks = result.tracks;
        loggedIn = result.loggedIn === true;
      } else if (provider === 'kugou') {
        try {
          const publicResult = ensurePlaylistPayload(await getKugouPublicPlaylist(parsed.playlistId, provider), provider);
          metadata = publicResult.playlist;
          tracks = publicResult.tracks;
          loggedIn = kugouLoggedIn();
        } catch (publicError) {
          if (!kugouLoggedIn()) throw normalizePlaylistResolverError(publicError, provider);
          const detail = ensurePlaylistPayload(await getKugouPlaylistTracks(parsed.playlistId, null, 300), provider);
          metadata = detail.playlist;
          if (!metadata) {
            const list = ensurePlaylistPayload(await getKugouPlaylists(null, 300), provider);
            metadata = matchingPlaylist(list.playlists, parsed.playlistId);
          }
          tracks = detail.tracks;
          loggedIn = true;
        }
      } else if (provider === 'kugou_concept') {
        try {
          const publicResult = ensurePlaylistPayload(await getKugouPublicPlaylist(parsed.playlistId, provider), provider);
          metadata = publicResult.playlist;
          tracks = publicResult.tracks;
          loggedIn = kugouConceptLoggedIn();
        } catch (publicError) {
          if (!kugouConceptLoggedIn()) throw normalizePlaylistResolverError(publicError, provider);
          const detail = ensurePlaylistPayload(await getKugouConceptPlaylistTracks(parsed.playlistId, null, 300), provider);
          metadata = detail.playlist;
          if (!metadata) {
            const list = ensurePlaylistPayload(await getKugouConceptPlaylists(null, 300), provider);
            metadata = matchingPlaylist(list.playlists, parsed.playlistId);
          }
          tracks = detail.tracks;
          loggedIn = true;
        }
      } else if (provider === 'qishui') {
        try {
          const publicResult = ensurePlaylistPayload(await getQishuiPublicPlaylistTracks(parsed.playlistId, null, 100), provider);
          metadata = publicResult.playlist;
          tracks = publicResult.tracks;
          loggedIn = qishuiLoggedIn();
        } catch (publicError) {
          if (!qishuiLoggedIn()) throw normalizePlaylistResolverError(publicError, provider);
          const detail = ensurePlaylistPayload(await getQishuiPlaylistTracks(parsed.playlistId, null, 100), provider);
          metadata = detail.playlist;
          tracks = detail.tracks;
          loggedIn = true;
        }
      } else {
        throw playlistLinkError('PLAYLIST_PROVIDER_UNSUPPORTED', '不支持该音乐平台', 422, { provider });
      }
      return normalizeImportedPlaylist(parsed, metadata, tracks, loggedIn);
    } catch (error) {
      const normalized = normalizePlaylistResolverError(error, parsed && parsed.provider || '');
      return {
        ok: false,
        code: normalized.code,
        message: normalized.message,
        status: normalized.httpStatus,
        provider: parsed && parsed.provider || normalized.details && normalized.details.provider || '',
        details: normalized.details || undefined,
      };
    }
  }

  function qishuiVideoModelUrls(model) {
    if (!model || typeof model !== 'object') return [];
    const urls = [];
    const seen = new Set();
    const add = value => {
      const secured = secureQishuiUrl(value, true);
      if (secured && !seen.has(secured)) {
        seen.add(secured);
        urls.push(secured);
      }
    };
    const protectedEntry = entry => !!(entry && (entry.play_auth || entry.playAuth
      || entry.encrypt_info || entry.encryptInfo || entry.drm_info || entry.drmInfo));
    const rawList = model.video_list || model.videoList;
    const list = Array.isArray(rawList) ? rawList
      : (rawList && typeof rawList === 'object' ? Object.values(rawList) : []);
    for (const entry of list) {
      if (!entry || protectedEntry(entry)) continue;
      add(entry.main_url || entry.mainUrl || entry.url);
      add(entry.backup_url || entry.backupUrl);
    }
    if (!protectedEntry(model)) {
      add(model.main_url || model.mainUrl || model.url);
      add(model.backup_url || model.backupUrl);
    }
    return urls;
  }

  function qishuiPlayInfoItems(payload) {
    const result = payload && (payload.Result || payload.result || payload);
    const data = result && (result.Data || result.data || payload && payload.data || result);
    const list = data && (data.PlayInfoList || data.playInfoList || data.play_info_list);
    return Array.isArray(list) ? list : [];
  }

  async function qishuiMediaRange(url, range) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'LunaPC/' + QISHUI_APP_VERSION + '(' + QISHUI_TRON_BUILD_ID + ')',
          Referer: 'https://www.qishui.com/',
          Range: range,
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.body || (response.status !== 200 && response.status !== 206)) throw new Error('QISHUI_MEDIA_PROBE_HTTP_' + response.status);
      if (!secureQishuiUrl(response.url || url, true)) throw new Error('QISHUI_MEDIA_PROBE_REDIRECT_REJECTED');
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (total < 96 * 1024) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = Buffer.from(item.value);
        chunks.push(chunk);
        total += chunk.length;
      }
      try { await reader.cancel(); } catch (_) {}
      return {
        buffer: Buffer.concat(chunks, total).subarray(0, 96 * 1024),
        contentType: safeText(response.headers.get('content-type'), 96).toLowerCase(),
        contentRange: safeText(response.headers.get('content-range'), 160),
        contentLength: Math.max(0, Number(response.headers.get('content-length')) || 0),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function qishuiMediaProbeTotal(result) {
    const match = /\/(\d+)$/.exec(result && result.contentRange || '');
    return match ? Math.max(0, Number(match[1]) || 0) : Math.max(0, Number(result && result.contentLength) || 0);
  }

  function qishuiMediaLooksProtected(buffer) {
    const header = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : '';
    return /(?:sinf|pssh|tenc|cenc|cbcs|enca)/.test(header);
  }

  function qishuiMediaLooksPlayable(result) {
    const buffer = result && result.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || qishuiMediaLooksProtected(buffer)) return false;
    const signature = buffer.subarray(0, 12).toString('latin1');
    return /^(?:ID3|fLaC|OggS|RIFF)/.test(signature) || signature.includes('ftyp')
      || /^audio\//.test(result.contentType || '');
  }

  async function selectQishuiAudioUrl(values) {
    const candidates = Array.from(new Set((values || []).filter(Boolean))).slice(0, 8);
    const probes = await Promise.all(candidates.map(async url => {
      try {
        const head = await qishuiMediaRange(url, 'bytes=0-98303');
        let combined = head;
        const total = qishuiMediaProbeTotal(head);
        if (!qishuiMediaLooksProtected(head.buffer) && !head.buffer.toString('latin1').includes('moov') && total > 96 * 1024) {
          const tail = await qishuiMediaRange(url, 'bytes=' + Math.max(0, total - 96 * 1024) + '-' + (total - 1));
          combined = { ...head, buffer: Buffer.concat([head.buffer, tail.buffer]) };
        }
        return qishuiMediaLooksPlayable(combined) ? { url, contentType: combined.contentType } : null;
      } catch (_) {
        return null;
      }
    }));
    return probes.find(Boolean) || null;
  }

  async function resolveQishui(song) {
    const source = sanitizeSearchSong(song);
    if (!source || !source.id) return { provider: 'qishui', url: '', playable: false, reason: 'resource_invalid', message: '汽水音乐歌曲信息无效' };
    if (!qishuiLoggedIn()) return { provider: 'qishui', url: '', playable: false, reason: 'login_required', message: '请先登录汽水音乐' };
    const payload = await qishuiRequest('/luna/pc/track_v2', {
      method: 'POST',
      body: {
        track_id: source.qishuiTrackId || source.id,
        media_type: source.qishuiMediaType || source.mediaType || 'track',
        queue_type: '',
        enable_refresh_api: true,
        scene_name: 'playlist',
      },
    });
    const statusCode = Number(payload && payload.status_code || 0);
    if (statusCode !== 0) {
      const copyright = statusCode === 1000005;
      return {
        provider: 'qishui', url: '', playable: false,
        reason: copyright ? 'copyright_unavailable' : 'resource_unavailable',
        message: copyright ? '该歌曲受汽水音乐版权或账号权限限制' : ('汽水音乐暂无法播放（' + statusCode + '）'),
      };
    }
    const player = payload.track_player && typeof payload.track_player === 'object' ? payload.track_player : {};
    const candidates = [];
    if (player.video_model) {
      try { candidates.push(...qishuiVideoModelUrls(JSON.parse(player.video_model))); } catch (_) {}
    }
    if (player.url_player_info) {
      const playerInfoUrl = secureQishuiUrl(player.url_player_info, true);
      if (playerInfoUrl) {
        try {
          const playInfoPayload = await requestJson(playerInfoUrl, {
            headers: { 'User-Agent': 'LunaPC/' + QISHUI_APP_VERSION + '(' + QISHUI_TRON_BUILD_ID + ')', Referer: 'https://www.qishui.com/' },
          });
          for (const playInfo of qishuiPlayInfoItems(playInfoPayload)) {
            const encrypted = !!(playInfo && (playInfo.PlayAuth || playInfo.play_auth || playInfo.EncryptInfo || playInfo.encrypt_info));
            if (encrypted) continue;
            candidates.push(secureQishuiUrl(playInfo && (playInfo.MainPlayUrl || playInfo.main_play_url), true));
            candidates.push(secureQishuiUrl(playInfo && (playInfo.BackupPlayUrl || playInfo.backup_play_url), true));
          }
        } catch (_) {}
      }
    }
    const selected = await selectQishuiAudioUrl(candidates);
    if (!selected) {
      return { provider: 'qishui', url: '', playable: false, reason: 'resource_unavailable', message: '汽水原始音源受保护或当前不可用，仅允许查找同曲合法音源' };
    }
    return {
      provider: 'qishui',
      url: selected.url,
      playable: true,
      trial: Number(player.video_model_type || 0) === 2,
      expiresAt: Math.max(0, Number(player.expire_at || payload.expire_at) || 0),
      quality: 'standard',
      contentType: selected.contentType,
    };
  }

  return {
    audit: Object.freeze({
      provider: 'kugou-standard+kugou-concept+qishui',
      qishuiReference: 'official Qishui Music 3.5.1 package protocol audit; no proprietary code, assets or native modules copied',
      searchPriority: SEARCH_PLATFORM_ORDER.slice(),
      qishuiSearchEnabled: typeof deps.searchQishui === 'function',
      searchPolicy: SEARCH_POLICY_VERSION,
      rejectedReferenceFeatures: ['non-standard-editions', 'hardcoded-third-party-credentials', 'device-fingerprint-simulation', 'behavior-simulation', 'unknown-cookie-upload'],
      networkBoundary: 'official-kugou-and-qishui-domains-only',
      provenanceNotice: 'NOTICE.md',
    }),
    searchKugou,
    searchAcrossPlatforms,
    resolvePlayableSource,
    resolveKugouConcept,
    kugouLyrics,
    kugouComments,
    commentsForSong,
    hotComments,
    getStatuses,
    updateKugouSession: scheduleKugouSessionUpdate,
    createKugouQrLogin: () => runAuthOperation('kugou', createKugouQrLogin),
    checkKugouQrLogin: key => runAuthOperation('kugou', () => checkKugouQrLogin(key)),
    exportKugouSession,
    getKugouPlaylists,
    getKugouPlaylistTracks,
    updateKugouConceptSession: scheduleKugouConceptSessionUpdate,
    createKugouConceptQrLogin: () => runAuthOperation('kugou_concept', createKugouConceptQrLogin),
    checkKugouConceptQrLogin: key => runAuthOperation('kugou_concept', () => checkKugouConceptQrLogin(key)),
    exportKugouConceptSession,
      getKugouConceptPlaylists,
      getKugouConceptPlaylistTracks,
      updateQishuiSession: scheduleQishuiSessionUpdate,
      createQishuiQrLogin: () => runAuthOperation('qishui', createQishuiQrLogin),
      checkQishuiQrLogin: key => runAuthOperation('qishui', () => checkQishuiQrLogin(key)),
      exportQishuiSession,
      getQishuiPlaylists,
      getQishuiPlaylistTracks,
      resolveQishui,
      resolvePlaylistLink,
    clearCaches() { searchCache.clear(); sourceCache.clear(); },
  };
}

module.exports = {
  createMusicPlatformService,
  parseOfficialPlaylistLink,
  resolveOfficialPlaylistLink,
  playlistProviderForHost,
  canonicalPlaylistUrl,
  PlaylistLinkError,
  mapKugouSong,
  playlistOwnershipMetadata,
  rankSongs,
  foldSongs,
  sameSong,
  realSongId,
  realSongKey,
};
