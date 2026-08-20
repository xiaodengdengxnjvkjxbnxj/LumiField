const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { createVerificationServices } = require('./lf-verification-services');
const { LFOAuthProviders } = require('./lf-oauth-providers');
const LumiFieldPresetSchema = require('../public/lumifield-preset-schema');
const LumiFieldLegalContent = require('../public/lf-legal-content');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const OFFLINE_SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const QR_TTL_MS = 3 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FEEDBACK_MAX_FILE_BYTES = 3 * 1024 * 1024 * 1024;
const FEEDBACK_CHUNK_BYTES = 4 * 1024 * 1024;
const FEEDBACK_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FEEDBACK_BLOCKED_EXTENSIONS = new Set(['.exe','.msi','.com','.bat','.cmd','.ps1','.psm1','.vbs','.vbe','.js','.jse','.wsf','.wsh','.scr','.cpl','.dll','.sys','.jar','.hta','.reg','.lnk','.url','.appx','.appxbundle']);
const FEEDBACK_ALLOWED_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.mp4','.webm','.mov','.mkv','.avi','.mp3','.wav','.flac','.m4a','.aac','.ogg','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.log','.md','.json','.csv','.rtf','.zip','.7z','.rar','.gz','.tar']);
const BLACKLIST_MESSAGE = '您的账户已被限制使用，请通过应用内反馈联系 LumiField 管理员。';
const DEV_WARNING = '您没有权限对此软件进行开发，如若继续您的账户将会被自动拉黑。';
const DEV_CONTACT = '如执意开发/进行二创，请联系作者：3599284614@qq.com / 15037841583@139.com。';
const INTEGRITY_UPDATE_WINDOW_MS = 30 * 60 * 1000;
const INTEGRITY_EVENT_TYPES = new Set([
  'hash_mismatch',
  'file_missing',
  'unexpected_script',
  'unauthorized_module',
  'integrity_bypass',
  'unauthorized_dev_api',
]);
const INTEGRITY_FILE_ALLOWLIST = new Map([
  ['lumifield-exe', 'LumiField.exe'],
  ['app-asar', 'resources/app.asar'],
  ['ffmpeg', 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'],
  ['desktop-main', 'desktop/main.js'],
  ['desktop-preload', 'desktop/preload.js'],
  ['desktop-backend', 'desktop/lf-backend.js'],
  ['desktop-api-server', 'desktop/lf-api-server.js'],
  ['server', 'server.js'],
  ['music-platform-service', 'music-platform-service.js'],
  ['public-index', 'public/index.html'],
  ['public-fixes-js', 'public/lumifield-fixes-v2.js'],
  ['public-fixes-css', 'public/lumifield-fixes-v2.css'],
  ['public-auth-monitor', 'public/lf-auth-monitor.js'],
  ['integrity-manifest', 'resources/lf-integrity-manifest.json'],
]);
const INTEGRITY_DYNAMIC_FILE_RULES = new Map([
  ['unexpected-script', new Set(['unexpected_script'])],
  ['install-module', new Set(['unauthorized_module', 'file_missing'])],
]);
const INTEGRITY_INSTALL_MODULE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.node', '.asar']);
const PRESET_SHARE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PRESET_SHARE_MAX_BYTES = 64 * 1024;
const PRESET_SHARE_MAX_DEPTH = 8;
const PRESET_SHARE_MAX_KEYS = 512;
const PRESET_SHARE_RATE_LIMITS = Object.freeze({
  create: { limit: 10, windowMs: 60 * 60 * 1000 },
  redeem: { limit: 20, windowMs: 10 * 60 * 1000, failedLimit: 8 },
  mine: { limit: 60, windowMs: 60 * 1000 },
  revoke: { limit: 30, windowMs: 60 * 60 * 1000 },
});
const PRESET_SHARE_ATTEMPT_RETENTION_MS = Math.max(
  ...Object.values(PRESET_SHARE_RATE_LIMITS).map(rule => rule.windowMs),
);
const PRESET_SHARE_SENSITIVE_KEY = /(?:token|cookie|password|passwd|secret|session|authorization|credential|account|email|phone|userid|oauth|apikey|privatekey|refresh|accesstoken|localpath|filepath|uri|url)/i;
const PRESET_SHARE_PRIVATE_VALUE = /(?:^[a-z]:|^\\\\|^\/|^~[\\/]|[\\/]\.\.(?:[\\/]|$)|^[a-z][a-z0-9+.-]*:|(?:^|\s)bearer\s+|(?:^|[;,\s])cookie\s*=|[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|[^\s@]+@[^\s@]+\.[^\s@]+|^1[3-9]\d{9}$)/i;

function now() { return Date.now(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function safeText(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function storedStringArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(item => safeText(item, 240)).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}
function validIntegrityId(value, max = 128) {
  const text = safeText(value, max);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(text) ? text : '';
}
function validIntegrityHash(value, allowMissing = false) {
  const text = safeText(value, 80).toLowerCase();
  if (allowMissing && text === 'missing') return text;
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
}
function normalizedIntegrityPath(value) {
  const cleaned = safeText(value, 4096);
  if (cleaned.length > 240) return '';
  const text = cleaned.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.includes('../') || text.includes('/..')) return '';
  return text;
}
function normalizePresetShareCode(value) {
  const code = String(value == null ? '' : value).trim().toUpperCase();
  return /^LF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(code) ? code : '';
}
function generatePresetShareCode() {
  const bytes = crypto.randomBytes(12);
  let payload = '';
  for (let index = 0; index < bytes.length; index += 1) payload += PRESET_SHARE_CODE_ALPHABET[bytes[index] & 31];
  return `LF-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}`;
}
function inspectPresetShareValue(value) {
  let keyCount = 0;
  const seen = new Set();
  function visit(current, depth) {
    if (depth > PRESET_SHARE_MAX_DEPTH) throw Object.assign(new Error('PRESET_DEPTH_LIMIT'), { code: 'PRESET_DEPTH_LIMIT' });
    if (typeof current === 'string') {
      if (PRESET_SHARE_PRIVATE_VALUE.test(current)) {
        throw Object.assign(new Error('PRESET_SENSITIVE_DATA'), { code: 'PRESET_SENSITIVE_DATA' });
      }
      return;
    }
    if (current == null || typeof current !== 'object') return;
    if (seen.has(current)) throw Object.assign(new Error('PRESET_CIRCULAR'), { code: 'PRESET_SCHEMA_REJECTED' });
    seen.add(current);
    const keys = Object.keys(current);
    keyCount += keys.length;
    if (keyCount > PRESET_SHARE_MAX_KEYS) throw Object.assign(new Error('PRESET_KEY_LIMIT'), { code: 'PRESET_KEY_LIMIT' });
    keys.forEach(key => {
      const normalizedKey = String(key).replace(/[^A-Za-z0-9]/g, '');
      if (['__proto__', 'prototype', 'constructor'].includes(key) || PRESET_SHARE_SENSITIVE_KEY.test(normalizedKey)) {
        throw Object.assign(new Error('PRESET_SENSITIVE_DATA'), { code: 'PRESET_SENSITIVE_DATA' });
      }
      visit(current[key], depth + 1);
    });
    seen.delete(current);
  }
  visit(value, 0);
  return { keyCount };
}
function preparePresetSharePayload(value) {
  let serializedInput;
  try { serializedInput = JSON.stringify(value); }
  catch (_) { return { ok: false, error: 'PRESET_SCHEMA_INVALID' }; }
  if (serializedInput == null) return { ok: false, error: 'PRESET_SCHEMA_INVALID' };
  if (Buffer.byteLength(serializedInput, 'utf8') > PRESET_SHARE_MAX_BYTES) {
    return { ok: false, error: 'PRESET_PAYLOAD_TOO_LARGE' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== LumiFieldPresetSchema.TYPE || value.schema !== LumiFieldPresetSchema.SCHEMA) {
    return { ok: false, error: 'PRESET_SCHEMA_INVALID' };
  }
  if (Number(value.version) !== LumiFieldPresetSchema.VERSION) {
    return { ok: false, error: 'PRESET_SCHEMA_UNSUPPORTED' };
  }
  try { inspectPresetShareValue(value); }
  catch (error) {
    return {
      ok: false,
      error: error.code === 'PRESET_SENSITIVE_DATA' ? error.code : 'PRESET_SCHEMA_INVALID',
    };
  }
  try {
    const normalized = LumiFieldPresetSchema.normalize(value, { allowEmpty: false });
    const rejected = []
      .concat(normalized.unknownFields || [])
      .concat(normalized.invalidFields || [])
      .concat(normalized.ignoredFields || []);
    if (rejected.length) return { ok: false, error: 'PRESET_SCHEMA_INVALID' };
    const sanitized = LumiFieldPresetSchema.sanitizeForShare(normalized.canonical);
    inspectPresetShareValue(sanitized.canonical);
    const canonical = LumiFieldPresetSchema.normalize(sanitized.canonical, { allowEmpty: false }).canonical;
    const presetJson = LumiFieldPresetSchema.serialize(canonical, 0);
    if (Buffer.byteLength(presetJson, 'utf8') > PRESET_SHARE_MAX_BYTES) {
      return { ok: false, error: 'PRESET_PAYLOAD_TOO_LARGE' };
    }
    return {
      ok: true,
      canonical: JSON.parse(presetJson),
      presetJson,
      presetHash: hash(presetJson),
      schemaVersion: Number(canonical.version || LumiFieldPresetSchema.VERSION),
      name: safeText(canonical.name, 64) || '共享预设',
    };
  } catch (_) {
    return { ok: false, error: 'PRESET_SCHEMA_INVALID' };
  }
}
function validatePresetShareInput(input, allowedFields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'INVALID_PRESET_SHARE_REQUEST' };
  }
  const unexpected = Object.keys(input).find(key => !allowedFields.has(key));
  return unexpected
    ? { ok: false, error: 'PRESET_SHARE_FIELD_REJECTED', field: unexpected }
    : { ok: true };
}
function publicPresetShare(row) {
  return {
    id: row.id,
    name: row.name,
    schemaVersion: Number(row.schema_version),
    status: row.status,
    redemptionCount: Number(row.redemption_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || null,
  };
}
function maskedIdentifier(value) {
  const text = safeText(value, 160);
  if (!text) return '未配置';
  if (text.length < 7) return `${text.slice(0, 1)}••••${text.slice(-1)}`;
  return `${text.slice(0, 3)}••••${text.slice(-3)}`;
}
function maskedEmail(value) {
  const source = safeText(value, 160).toLowerCase();
  const text = (source.match(/<([^<>]+)>$/) || [null, source])[1];
  const at = text.indexOf('@');
  if (at < 1) return '未配置';
  return `${text.slice(0, Math.min(2, at))}••••${text.slice(at)}`;
}
function maskedServiceError(value) {
  const code = safeText(value, 100).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return code.slice(0, 80) || '';
}
function reviewState(value, configured) {
  if (!configured) return { code: 'blocked', label: '配置未完成', externalState: 'BLOCKED_EXTERNAL_CONFIG' };
  const normalized = safeText(value, 40).toLowerCase();
  if (['approved', 'pass', 'passed', 'active'].includes(normalized)) return { code: 'approved', label: '已通过', externalState: 'PASS' };
  if (['pending', 'reviewing', 'submitted'].includes(normalized)) return { code: 'pending', label: '审核中', externalState: 'WAITING_PLATFORM_REVIEW' };
  if (['rejected', 'denied', 'failed'].includes(normalized)) return { code: 'rejected', label: '未通过', externalState: 'BLOCKED_EXTERNAL_CONFIG' };
  return { code: 'not_submitted', label: '未提交', externalState: 'BLOCKED_EXTERNAL_CONFIG' };
}
function safeFileName(value) {
  const base = path.basename(String(value || '').replace(/\\/g, '/')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base.slice(0, 180);
}
function feedbackFilePolicy(name, mime, size) {
  const fileName = safeFileName(name);
  const extension = path.extname(fileName).toLowerCase();
  const bytes = Number(size);
  if (!fileName || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > FEEDBACK_MAX_FILE_BYTES) return { ok: false, error: 'FILE_SIZE_INVALID', message: '附件为空或超过 3 GB。' };
  if (FEEDBACK_BLOCKED_EXTENSIONS.has(extension) || /(?:application\/x-msdownload|application\/x-executable|text\/javascript)/i.test(String(mime || ''))) return { ok: false, error: 'DANGEROUS_FILE_TYPE', message: '禁止上传可直接执行的程序或脚本。' };
  const knownType = FEEDBACK_ALLOWED_EXTENSIONS.has(extension);
  const storedExtension = extension && /^\.[a-z0-9]{1,16}$/i.test(extension) ? extension : '.bin';
  return { ok: true, fileName, extension: storedExtension, mime: safeText(mime, 120) || 'application/octet-stream', size: bytes, quarantine: !knownType || ['.zip','.7z','.rar','.gz','.tar'].includes(extension) };
}

function validFeedbackContact(value) {
  const contact = safeText(value, 160);
  return !!contact && (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^1[3-9]\d{9}$/.test(contact));
}
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}
function accountType(account) {
  if (/^\+861\d{10}$/.test(account)) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) return 'email';
  return '';
}
function normalizeIdentity(input, expectedType = '') {
  const source = safeText(input, 160).toLowerCase();
  if (!source) return { value: '', type: '' };
  if (!expectedType || expectedType === 'email') {
    const email = source.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { value: email, type: 'email' };
    if (expectedType === 'email') return { value: '', type: '' };
  }
  if (!expectedType || expectedType === 'phone' || expectedType === 'phone_legacy') {
    const compact = source.replace(/[\s()-]/g, '');
    const digits = compact.replace(/^\+/, '');
    const legacyType = expectedType === 'phone_legacy' ? 'phone_legacy' : 'phone';
    if (/^1\d{10}$/.test(digits)) return { value: `+86${digits}`, type: legacyType };
    if (/^861\d{10}$/.test(digits)) return { value: `+${digits}`, type: legacyType };
    if (/^\+[1-9]\d{7,14}$/.test(compact)) return { value: compact, type: legacyType };
  }
  return { value: '', type: '' };
}
function normalizeAccount(input) {
  return normalizeIdentity(input).value;
}
function passwordStrength(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 128) return false;
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}
function compareSemver(a, b) {
  const pa = String(a || '').split(/[+-]/)[0].split('.').map(Number);
  const pb = String(b || '').split(/[+-]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta) return delta;
  }
  return 0;
}
function passwordRecord(password) {
  return { salt: '', passwordHash: bcrypt.hashSync(String(password), 12) };
}
function verifyPassword(password, salt, expected) {
  if (/^\$2[aby]\$/.test(String(expected || ''))) {
    try { return bcrypt.compareSync(String(password), String(expected)); } catch (_) { return false; }
  }
  try {
    const actual = crypto.pbkdf2Sync(String(password), String(salt), 210000, 64, 'sha512');
    const target = Buffer.from(String(expected), 'hex');
    return actual.length === target.length && crypto.timingSafeEqual(actual, target);
  } catch (_) { return false; }
}
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.display_name || row.nickname,
    account: row.account,
    accountType: row.account_type,
    avatar: row.avatar || '',
    role: row.role,
    developerPermission: !!row.developer_permission,
    blacklisted: !!row.blacklisted,
    status: row.status || 'active',
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function sessionPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceType: row.device_type,
    deviceName: row.device_name,
    appVersion: row.app_version,
    loginMethod: row.login_method,
    location: row.location || '未知',
    locationAuthorized: !!row.location_authorized,
    loginAt: row.created_at,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
    online: !!row.online,
  };
}

class LFBackend {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.appVersion = safeText(options.appVersion || '0.0.0', 40);
    this.updatePublicKey = String(options.updatePublicKey || this.env.LF_UPDATE_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
    this.allowLocalCodes = options.allowLocalCodes === true || (options.allowLocalCodes == null && this.env.LF_ALLOW_LOCAL_CODES === '1');
    this.verificationServices = options.verificationServices || createVerificationServices(this.env);
    this.oauthProviders = options.oauthProviders || new LFOAuthProviders(this.env, options.fetcher || globalThis.fetch);
    this.pendingCodeRequests = new Set();
    this.dbPath = path.resolve(options.dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.feedbackAttachmentDir = path.join(path.dirname(this.dbPath), 'lf-feedback-attachments');
    fs.mkdirSync(this.feedbackAttachmentDir, { recursive: true });
    this.feedbackUploadDir = path.join(this.feedbackAttachmentDir, '.uploads');
    fs.mkdirSync(this.feedbackUploadDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.presetShareHmacKey = this.loadPresetShareHmacKey();
    this.backfillIdentities();
    this.bootstrapAdmin();
    this.cleanupExpiredVerificationCodes();
    this.verificationCleanupTimer = setInterval(() => this.cleanupExpiredVerificationCodes(), 15 * 60 * 1000);
    if (this.verificationCleanupTimer.unref) this.verificationCleanupTimer.unref();
    this.feedbackRetryTimer = setInterval(() => this.retryFeedbackNotifications().catch(() => {}), 5 * 60 * 1000);
    if (this.feedbackRetryTimer.unref) this.feedbackRetryTimer.unref();
    this.recordBuildVersion();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE, account_type TEXT NOT NULL,
        nickname TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', developer_permission INTEGER NOT NULL DEFAULT 0,
        blacklisted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, refresh_token_hash TEXT NOT NULL UNIQUE,
        device_type TEXT NOT NULL, device_name TEXT NOT NULL, app_version TEXT NOT NULL, login_method TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '未知', location_authorized INTEGER NOT NULL DEFAULT 0, online INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL,
        revoked_at INTEGER, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS login_logs (
        id TEXT PRIMARY KEY, user_id TEXT, account TEXT NOT NULL, method TEXT NOT NULL, device_type TEXT NOT NULL,
        success INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_key TEXT NOT NULL, device_type TEXT NOT NULL, device_name TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, UNIQUE(user_id, device_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS feedbacks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
        screenshot_name TEXT NOT NULL DEFAULT '', log_excerpt TEXT NOT NULL DEFAULT '', delivery_status TEXT NOT NULL DEFAULT 'queued',
        created_at INTEGER NOT NULL, delivered_at INTEGER, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS feedback_attachments (
        id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, user_id TEXT NOT NULL, file_name TEXT NOT NULL,
        mime TEXT NOT NULL, size INTEGER NOT NULL, stored_path TEXT NOT NULL, sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL, completed_at INTEGER NOT NULL,
        FOREIGN KEY(feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS feedback_attachments_feedback ON feedback_attachments(feedback_id);
      CREATE TABLE IF NOT EXISTS feedback_uploads (
        id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, user_id TEXT NOT NULL, file_name TEXT NOT NULL,
        mime TEXT NOT NULL, expected_size INTEGER NOT NULL, received_size INTEGER NOT NULL DEFAULT 0,
        next_chunk INTEGER NOT NULL DEFAULT 0, temp_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploading',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY(feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS feedback_notifications (
        id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '', next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER,
        revision INTEGER NOT NULL DEFAULT 1, reason TEXT NOT NULL DEFAULT 'initial_submission',
        last_message_id TEXT NOT NULL DEFAULT '', last_accepted TEXT NOT NULL DEFAULT '[]',
        last_rejected TEXT NOT NULL DEFAULT '[]', last_response TEXT NOT NULL DEFAULT '', last_attempt_at INTEGER,
        FOREIGN KEY(feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS feedback_notification_attempts (
        id TEXT PRIMARY KEY, notification_id TEXT NOT NULL, feedback_id TEXT NOT NULL,
        revision INTEGER NOT NULL, attempt_number INTEGER NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '',
        accepted TEXT NOT NULL DEFAULT '[]', rejected TEXT NOT NULL DEFAULT '[]', response TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, completed_at INTEGER,
        UNIQUE(notification_id,revision,attempt_number),
        FOREIGN KEY(notification_id) REFERENCES feedback_notifications(id) ON DELETE CASCADE,
        FOREIGN KEY(feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS feedback_notification_attempts_feedback
        ON feedback_notification_attempts(feedback_id,revision,attempt_number);
      CREATE TABLE IF NOT EXISTS feedback_download_grants (
        id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, admin_user_id TEXT,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_accessed_at INTEGER,
        attempt_id TEXT NOT NULL DEFAULT '', notification_revision INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(attachment_id) REFERENCES feedback_attachments(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS update_releases (
        id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, notes TEXT NOT NULL DEFAULT '', mandatory INTEGER NOT NULL DEFAULT 0,
        rollout_percent INTEGER NOT NULL DEFAULT 100, package_path TEXT NOT NULL DEFAULT '', package_sha256 TEXT NOT NULL DEFAULT '',
        signature TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
        decided_by TEXT, decided_at INTEGER, rollback_version TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS update_targets (
        id TEXT PRIMARY KEY, release_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offered',
        updated_at INTEGER NOT NULL, UNIQUE(release_id, user_id), FOREIGN KEY(release_id) REFERENCES update_releases(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_permissions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, permission TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT, updated_at INTEGER NOT NULL, UNIQUE(user_id, permission),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ban_records (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, reason TEXT NOT NULL DEFAULT '',
        changed_by TEXT NOT NULL, created_at INTEGER NOT NULL, lifted_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS verification_codes (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
        provider TEXT NOT NULL, delivery_status TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_codes_lookup ON verification_codes(account, purpose, created_at DESC);
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL, target_user_id TEXT,
        detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS integrity_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL, manifest_id TEXT NOT NULL,
        app_version TEXT NOT NULL, file_id TEXT NOT NULL, relative_path TEXT NOT NULL,
        expected_hash TEXT NOT NULL, actual_hash TEXT NOT NULL, event_type TEXT NOT NULL,
        evidence_key TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
        disposition TEXT NOT NULL DEFAULT 'pending', observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
        UNIQUE(user_id, device_id, evidence_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS integrity_events_user_time ON integrity_events(user_id, received_at DESC);
      CREATE TABLE IF NOT EXISTS integrity_enforcement (
        user_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'clean', first_event_id TEXT,
        warning_issued_at INTEGER, warning_ack_at INTEGER, blocked_event_id TEXT,
        generation INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS integrity_update_windows (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL, release_id TEXT NOT NULL,
        from_version TEXT NOT NULL, to_version TEXT NOT NULL, source_manifest_id TEXT NOT NULL,
        target_manifest_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active', started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        completed_at INTEGER, UNIQUE(user_id, device_id, release_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(release_id) REFERENCES update_releases(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS integrity_update_active ON integrity_update_windows(user_id, device_id, state, expires_at);
      CREATE TABLE IF NOT EXISTS preset_shares (
        id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL, schema_version INTEGER NOT NULL, preset_json TEXT NOT NULL,
        preset_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        redemption_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, revoked_at INTEGER,
        FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS preset_shares_owner_time ON preset_shares(owner_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS preset_share_attempts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
        request_key TEXT NOT NULL, code_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS preset_share_attempts_user_time ON preset_share_attempts(user_id, action, created_at DESC);
      CREATE INDEX IF NOT EXISTS preset_share_attempts_request_time ON preset_share_attempts(request_key, action, created_at DESC);
      CREATE TABLE IF NOT EXISTS qr_tokens (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
        confirmed_user_id TEXT, result_session_token TEXT, result_refresh_token TEXT,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, state_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS password_reset_tickets (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, ticket_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
    try { this.db.exec('ALTER TABLE qr_tokens ADD COLUMN result_refresh_token TEXT'); } catch (_) {}
    const addColumn = (table, definition) => { try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`); } catch (_) {} };
    addColumn('users', "display_name TEXT NOT NULL DEFAULT ''");
    addColumn('users', "status TEXT NOT NULL DEFAULT 'active'");
    addColumn('users', 'bootstrap_admin INTEGER NOT NULL DEFAULT 0');
    addColumn('users', 'must_change_password INTEGER NOT NULL DEFAULT 0');
    addColumn('verification_codes', 'target TEXT');
    addColumn('verification_codes', 'target_type TEXT');
    addColumn('verification_codes', 'used_at INTEGER');
    addColumn('verification_codes', 'invalidated_at INTEGER');
    addColumn('verification_codes', "request_ip TEXT NOT NULL DEFAULT ''");
    addColumn('login_logs', "ip_address TEXT NOT NULL DEFAULT ''");
    addColumn('login_logs', 'login_time INTEGER');
    addColumn('login_logs', "login_method TEXT NOT NULL DEFAULT ''");
    addColumn('feedbacks', "client_version TEXT NOT NULL DEFAULT ''");
    addColumn('feedbacks', "device_info TEXT NOT NULL DEFAULT ''");
    addColumn('feedbacks', "mail_status TEXT NOT NULL DEFAULT 'queued'");
    addColumn('feedbacks', "mail_error TEXT NOT NULL DEFAULT ''");
    addColumn('feedbacks', "processing_status TEXT NOT NULL DEFAULT 'new'");
    addColumn('feedbacks', 'updated_at INTEGER NOT NULL DEFAULT 0');
    addColumn('feedback_uploads', "attachment_id TEXT NOT NULL DEFAULT ''");
    addColumn('feedback_notifications', 'revision INTEGER NOT NULL DEFAULT 1');
    addColumn('feedback_notifications', "reason TEXT NOT NULL DEFAULT 'initial_submission'");
    addColumn('feedback_notifications', "last_message_id TEXT NOT NULL DEFAULT ''");
    addColumn('feedback_notifications', "last_accepted TEXT NOT NULL DEFAULT '[]'");
    addColumn('feedback_notifications', "last_rejected TEXT NOT NULL DEFAULT '[]'");
    addColumn('feedback_notifications', "last_response TEXT NOT NULL DEFAULT ''");
    addColumn('feedback_notifications', 'last_attempt_at INTEGER');
    addColumn('feedback_download_grants', "attempt_id TEXT NOT NULL DEFAULT ''");
    addColumn('feedback_download_grants', 'notification_revision INTEGER NOT NULL DEFAULT 0');
    addColumn('integrity_update_windows', "source_manifest_id TEXT NOT NULL DEFAULT ''");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_identities (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, identity_type TEXT NOT NULL,
        normalized_value TEXT NOT NULL UNIQUE, provider_user_id TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '',
        verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities(user_id);
      CREATE TABLE IF NOT EXISTS verification_attempts (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, target_type TEXT NOT NULL, purpose TEXT NOT NULL,
        request_ip TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_attempts_target ON verification_attempts(target, created_at DESC);
      CREATE INDEX IF NOT EXISTS verification_attempts_ip ON verification_attempts(request_ip, created_at DESC);
      CREATE TABLE IF NOT EXISTS verification_tickets (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, purpose TEXT NOT NULL, ticket_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
      );
    `);
    addColumn('user_identities', "provider_user_id TEXT NOT NULL DEFAULT ''");
    addColumn('user_identities', "display_name TEXT NOT NULL DEFAULT ''");
    addColumn('user_identities', "avatar_url TEXT NOT NULL DEFAULT ''");
    addColumn('user_identities', 'updated_at INTEGER NOT NULL DEFAULT 0');
    addColumn('oauth_states', "poll_token_hash TEXT NOT NULL DEFAULT ''");
    addColumn('oauth_states', "intent TEXT NOT NULL DEFAULT 'login'");
    addColumn('oauth_states', "request_user_id TEXT NOT NULL DEFAULT ''");
    addColumn('oauth_states', "redirect_uri TEXT NOT NULL DEFAULT ''");
    addColumn('oauth_states', "result_user_id TEXT NOT NULL DEFAULT ''");
    addColumn('oauth_states', "error_code TEXT NOT NULL DEFAULT ''");
    addColumn('oauth_states', 'confirmed_at INTEGER');
    addColumn('oauth_states', 'consumed_at INTEGER');
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider
      ON user_identities(identity_type,provider_user_id) WHERE provider_user_id<>''`);
    this.db.prepare("UPDATE users SET display_name=nickname WHERE display_name='' OR display_name IS NULL").run();
    this.db.prepare('UPDATE verification_codes SET target=account WHERE target IS NULL').run();
    this.db.prepare("UPDATE verification_codes SET target_type=CASE WHEN account LIKE '%@%' THEN 'email' ELSE 'phone' END WHERE target_type IS NULL").run();
    this.db.prepare('UPDATE verification_codes SET used_at=consumed_at WHERE used_at IS NULL AND consumed_at IS NOT NULL').run();
    this.db.prepare('UPDATE login_logs SET login_time=created_at WHERE login_time IS NULL').run();
    this.db.prepare("UPDATE login_logs SET login_method=method WHERE login_method='' OR login_method IS NULL").run();
    this.db.prepare("UPDATE user_identities SET identity_type='phone_legacy',updated_at=CASE WHEN updated_at=0 THEN created_at ELSE updated_at END WHERE identity_type='phone'").run();
    this.db.prepare("UPDATE users SET account_type='phone_legacy' WHERE account_type='phone'").run();
    this.db.prepare('UPDATE qr_tokens SET result_session_token=NULL,result_refresh_token=NULL').run();
    this.db.prepare("UPDATE feedback_notifications SET revision=1 WHERE revision IS NULL OR revision<1").run();
    this.db.prepare("UPDATE feedback_notifications SET reason='initial_submission' WHERE reason IS NULL OR reason=''").run();
    this.db.prepare(`UPDATE feedback_notification_attempts SET status='abandoned',error='PROCESS_RESTARTED',completed_at=?
      WHERE status='sending'`).run(now());
    this.db.prepare(`DELETE FROM feedback_download_grants WHERE attempt_id IN
      (SELECT id FROM feedback_notification_attempts WHERE status='abandoned')`).run();
    this.db.prepare(`UPDATE feedback_notifications SET status='retry',last_error='PROCESS_RESTARTED',next_attempt_at=?
      WHERE status='sending'`).run(now());
  }

  backfillIdentities() {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO user_identities
      (id,user_id,identity_type,normalized_value,verified_at,created_at) VALUES(?,?,?,?,?,?)`);
    this.db.prepare('SELECT id,account,account_type,created_at FROM users').all().forEach((user) => {
      const identity = normalizeIdentity(user.account, user.account_type);
      const type = identity.type === 'phone' ? 'phone_legacy' : identity.type;
      if (identity.value) insert.run(id('identity'), user.id, type, identity.value, user.created_at || now(), user.created_at || now());
    });
  }

  loadPresetShareHmacKey() {
    const configured = String(this.env.LF_PRESET_SHARE_HMAC_SECRET || '');
    if (configured) return crypto.createHash('sha256').update(configured, 'utf8').digest();
    const keyName = 'preset_share_hmac_secret_v1';
    let row = this.db.prepare('SELECT value FROM system_meta WHERE key=?').get(keyName);
    let decoded = null;
    try {
      decoded = row && Buffer.from(String(row.value || ''), 'base64');
      if (!decoded || decoded.length !== 32) decoded = null;
    } catch (_) { decoded = null; }
    if (!decoded) {
      const generated = crypto.randomBytes(32).toString('base64');
      this.db.prepare(`INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO NOTHING`).run(keyName, generated, now());
      row = this.db.prepare('SELECT value FROM system_meta WHERE key=?').get(keyName);
      try { decoded = Buffer.from(String(row && row.value || ''), 'base64'); }
      catch (_) { decoded = null; }
    }
    if (!decoded || decoded.length !== 32) throw new Error('PRESET_SHARE_HMAC_KEY_INVALID');
    return decoded;
  }

  bootstrapConfiguration() {
    const identities = [];
    String(this.env.LF_BOOTSTRAP_ADMIN_EMAILS || '').split(',').forEach((value) => {
      const item = normalizeIdentity(value, 'email');
      if (item.value && !identities.some(existing => existing.value === item.value)) identities.push(item);
    });
    return { identities, password: String(this.env.LF_BOOTSTRAP_ADMIN_PASSWORD || '') };
  }

  bootstrapAdmin() {
    const config = this.bootstrapConfiguration();
    this.reservedIdentities = new Set(config.identities.map(item => item.value));
    this.bootstrapAdminId = '';
    if (!config.identities.length || !config.password) {
      const missing = [];
      if (!config.identities.some(item => item.type === 'email')) missing.push('LF_BOOTSTRAP_ADMIN_EMAILS');
      if (!config.password) missing.push('LF_BOOTSTRAP_ADMIN_PASSWORD');
      if (missing.length) this.audit(null, 'bootstrap_admin_not_configured', null, `missing=${missing.join(',')}`);
      return;
    }
    if (!passwordStrength(config.password)) {
      this.audit(null, 'bootstrap_admin_invalid_configuration', null, 'invalid=LF_BOOTSTRAP_ADMIN_PASSWORD');
      return;
    }
    const candidates = [];
    config.identities.forEach((identity) => {
      const row = this.db.prepare(`SELECT u.* FROM user_identities i JOIN users u ON u.id=i.user_id
        WHERE i.normalized_value=?`).get(identity.value);
      if (row && !candidates.some(item => item.id === row.id)) candidates.push(row);
    });
    let admin = candidates.find(item => item.bootstrap_admin) || candidates.find(item => item.role === 'admin') || candidates[0];
    const createdAt = now();
    if (!admin) {
      const primary = config.identities[0];
      const record = passwordRecord(config.password);
      const userId = id('user');
      this.db.prepare(`INSERT INTO users
        (id,account,account_type,nickname,avatar,password_hash,password_salt,role,developer_permission,blacklisted,created_at,updated_at,display_name,status,bootstrap_admin,must_change_password)
        VALUES(?,?,?,'LumiField 管理员','',?,?,'admin',1,0,?,?,'LumiField 管理员','active',1,1)`)
        .run(userId, primary.value, primary.type, record.passwordHash, record.salt, createdAt, createdAt);
      admin = this.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    } else {
      const firstBootstrap = !admin.bootstrap_admin;
      const record = firstBootstrap || this.env.LF_BOOTSTRAP_ADMIN_FORCE_PASSWORD_RESET === '1' ? passwordRecord(config.password) : null;
      if (record) {
        this.db.prepare(`UPDATE users SET password_hash=?,password_salt='',role='admin',developer_permission=1,
          blacklisted=0,status='active',bootstrap_admin=1,must_change_password=1,updated_at=? WHERE id=?`)
          .run(record.passwordHash, createdAt, admin.id);
      } else {
        this.db.prepare(`UPDATE users SET role='admin',developer_permission=1,blacklisted=0,status='active',bootstrap_admin=1,updated_at=? WHERE id=?`)
          .run(createdAt, admin.id);
      }
      admin = this.db.prepare('SELECT * FROM users WHERE id=?').get(admin.id);
    }
    const conflictingIds = candidates.map(item => item.id).filter(userId => userId !== admin.id);
    conflictingIds.forEach((userId) => {
      this.db.prepare("UPDATE users SET role='user',developer_permission=0,status='reserved-conflict',updated_at=? WHERE id=?").run(createdAt, userId);
      this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=? AND revoked_at IS NULL').run(createdAt, userId);
      this.audit(admin.id, 'bootstrap_identity_conflict_disabled', userId, 'reserved_identity_reassigned');
    });
    const bind = this.db.prepare(`INSERT INTO user_identities(id,user_id,identity_type,normalized_value,verified_at,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(normalized_value) DO UPDATE SET user_id=excluded.user_id,
      identity_type=excluded.identity_type,verified_at=excluded.verified_at`);
    config.identities.forEach(identity => bind.run(id('identity'), admin.id, identity.type, identity.value, createdAt, createdAt));
    this.db.prepare(`INSERT INTO user_permissions(id,user_id,permission,enabled,updated_by,updated_at)
      VALUES(?,?,'developer',1,NULL,?) ON CONFLICT(user_id,permission) DO UPDATE SET enabled=1,updated_at=excluded.updated_at`)
      .run(id('perm'), admin.id, createdAt);
    this.bootstrapAdminId = admin.id;
    this.audit(admin.id, 'bootstrap_admin_ready', admin.id, `identities=${config.identities.length}`);
  }

  cleanupExpiredVerificationCodes() {
    const cutoff = now() - 24 * 60 * 60 * 1000;
    try {
      this.db.prepare('DELETE FROM verification_codes WHERE expires_at<?').run(cutoff);
      this.db.prepare('DELETE FROM verification_attempts WHERE created_at<?').run(cutoff);
      this.db.prepare('DELETE FROM verification_tickets WHERE expires_at<?').run(cutoff);
      this.db.prepare('DELETE FROM qr_tokens WHERE expires_at<?').run(cutoff);
      this.db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(cutoff);
      const expiredUploads = this.db.prepare('SELECT id,temp_path FROM feedback_uploads WHERE expires_at<?').all(now());
      expiredUploads.forEach((upload) => {
        const candidate = path.resolve(upload.temp_path || '');
        if (candidate.startsWith(path.resolve(this.feedbackUploadDir) + path.sep)) { try { fs.unlinkSync(candidate); } catch (_) {} }
      });
      this.db.prepare('DELETE FROM feedback_uploads WHERE expires_at<?').run(now());
      this.db.prepare('DELETE FROM feedback_download_grants WHERE expires_at<?').run(now());
      const staleDraftCutoff = now() - 24 * 60 * 60 * 1000;
      const staleDraftAttachments = this.db.prepare(`SELECT a.stored_path FROM feedback_attachments a
        JOIN feedbacks f ON f.id=a.feedback_id WHERE f.processing_status='draft' AND f.updated_at<?`).all(staleDraftCutoff);
      staleDraftAttachments.forEach((attachment) => {
        const candidate = path.resolve(attachment.stored_path || '');
        if (candidate.startsWith(path.resolve(this.feedbackAttachmentDir) + path.sep)) { try { fs.unlinkSync(candidate); } catch (_) {} }
      });
      this.db.prepare("DELETE FROM feedbacks WHERE processing_status='draft' AND updated_at<?").run(staleDraftCutoff);
    } catch (_) {}
  }

  findUserByIdentity(value) {
    return this.db.prepare(`SELECT u.* FROM user_identities i JOIN users u ON u.id=i.user_id
      WHERE i.normalized_value=?`).get(value);
  }

  isReservedIdentity(value) { return !!value && this.reservedIdentities && this.reservedIdentities.has(value); }

  close() {
    if (this.verificationCleanupTimer) clearInterval(this.verificationCleanupTimer);
    if (this.feedbackRetryTimer) clearInterval(this.feedbackRetryTimer);
    try { this.db.close(); } catch (_) {}
  }

  audit(actorUserId, action, targetUserId, detail) {
    this.db.prepare('INSERT INTO audit_logs (id, actor_user_id, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id('audit'), actorUserId || null, safeText(action, 80), targetUserId || null, safeText(detail, 600), now());
  }

  recordBuildVersion() {
    const previous = this.db.prepare("SELECT value FROM system_meta WHERE key='last_app_version'").get();
    if (!previous || (previous.value && previous.value !== this.appVersion)) {
      this.db.prepare(`INSERT OR IGNORE INTO update_releases
        (id, version, notes, mandatory, rollout_percent, status, created_at)
        VALUES (?, ?, ?, 0, 100, 'pending', ?)`)
        .run(id('release'), this.appVersion, `检测到新构建 ${this.appVersion}，等待管理员确认发布。`, now());
    }
    this.db.prepare(`INSERT INTO system_meta(key,value,updated_at) VALUES('last_app_version',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(this.appVersion, now());
  }

  async sendVerificationCode(input = {}) {
    const identity = normalizeIdentity(input.target == null ? input.account : input.target, 'email');
    const purpose = ['register', 'reset', 'bind_email'].includes(input.purpose) ? input.purpose : 'register';
    if (!identity.value) {
      return { ok: false, error: 'INVALID_EMAIL', message: '请输入有效邮箱。' };
    }
    if (purpose === 'register' && this.isReservedIdentity(identity.value)) {
      return { ok: false, error: 'RESERVED_IDENTITY', message: '该账号为系统保留账号，无法用于普通用户注册。' };
    }
    const requestIp = safeText(input.requestIp, 80) || 'local';
    const requestKey = `${identity.value}:${purpose}`;
    if (this.pendingCodeRequests.has(requestKey)) return { ok: false, error: 'RATE_LIMITED', retryAfter: 1, message: '请求过于频繁，请稍后重试。' };
    const recent = this.db.prepare(`SELECT created_at FROM verification_attempts
      WHERE target=? AND purpose=? AND status='delivered' ORDER BY created_at DESC LIMIT 1`).get(identity.value, purpose);
    if (recent && now() - recent.created_at < 60000) {
      const retryAfter = Math.ceil((60000 - (now() - recent.created_at)) / 1000);
      return { ok: false, error: 'RATE_LIMITED', retryAfter, message: `请求过于频繁，请 ${retryAfter} 秒后重试。` };
    }
    const hourStart = now() - 3600000;
    const hourCount = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM verification_attempts
      WHERE target=? AND status='delivered' AND created_at>?`).get(identity.value, hourStart).count || 0);
    if (hourCount >= 5) return { ok: false, error: 'RATE_LIMITED', retryAfter: 3600, message: '该账号一小时内验证码次数已达上限，请稍后重试。' };
    const ipLimit = Math.max(5, Number(this.env.LF_VERIFICATION_IP_HOURLY_LIMIT || 30));
    const ipCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM verification_attempts WHERE request_ip=? AND created_at>?').get(requestIp, hourStart).count || 0);
    if (ipCount >= ipLimit) return { ok: false, error: 'RATE_LIMITED', retryAfter: 3600, message: '该网络一小时内验证码请求已达上限，请稍后重试。' };
    this.pendingCodeRequests.add(requestKey);
    const attemptId = id('attempt');
    this.db.prepare(`INSERT INTO verification_attempts(id,target,target_type,purpose,request_ip,status,provider,created_at)
      VALUES(?,?,?,?,?,'started','',?)`).run(attemptId, identity.value, identity.type, purpose, requestIp, now());
    try {
      const code = String(crypto.randomInt(100000, 1000000));
      const service = this.verificationServices[identity.type];
      const configuration = service && service.configuration ? service.configuration() : { configured: false, missing: [] };
      let delivery;
      if (!configuration.configured && this.allowLocalCodes) {
        delivery = { ok: true, configured: false, provider: 'local-development', localCode: code, developmentMode: true };
      } else if (!service || !configuration.configured) {
        this.db.prepare("UPDATE verification_attempts SET status='unavailable',provider=? WHERE id=?").run(configuration.provider || 'unconfigured', attemptId);
        this.audit(null, 'verification_provider_unavailable', null, `${identity.type}:missing=${(configuration.missing || []).join(',')}`);
        return { ok: false, configured: false, error: 'EMAIL_SERVICE_UNAVAILABLE', message: '邮件服务暂时不可用。' };
      } else {
        delivery = await service.sendCode(identity.value, code, purpose);
      }
      if (!delivery.ok) {
        this.db.prepare("UPDATE verification_attempts SET status='failed',provider=? WHERE id=?").run(delivery.provider || 'unknown', attemptId);
        this.audit(null, 'verification_delivery_failed', null, `${identity.type}:${delivery.provider || 'unknown'}:${delivery.providerError || delivery.error || 'SEND_FAILED'}`);
        return { ok: false, configured: true, error: 'EMAIL_SEND_FAILED', message: '验证码发送失败，请稍后重试。' };
      }
      const createdAt = now();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare(`UPDATE verification_codes SET consumed_at=?,used_at=?,invalidated_at=?
          WHERE COALESCE(target,account)=? AND purpose=? AND consumed_at IS NULL AND used_at IS NULL`)
          .run(createdAt, createdAt, createdAt, identity.value, purpose);
        this.db.prepare(`INSERT INTO verification_codes
          (id,account,target,target_type,purpose,code_hash,provider,delivery_status,expires_at,consumed_at,used_at,invalidated_at,request_ip,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)`)
          .run(id('code'), identity.value, identity.value, identity.type, purpose, hash(code), delivery.provider, delivery.configured ? 'sent' : 'local-development', createdAt + CODE_TTL_MS, requestIp, createdAt);
        this.db.prepare("UPDATE verification_attempts SET status='delivered',provider=? WHERE id=?").run(delivery.provider, attemptId);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      this.audit(null, 'verification_code_sent', null, `${identity.type}:${purpose}:${delivery.provider}`);
      const result = { ok: true, configured: !!delivery.configured, provider: delivery.provider, expiresIn: 300, cooldownSeconds: 60, message: '验证码已发送。' };
      if (delivery.developmentMode) Object.assign(result, { developmentMode: true, localCode: delivery.localCode, message: '开发测试模式：验证码已生成。' });
      return result;
    } finally {
      this.pendingCodeRequests.delete(requestKey);
    }
  }

  consumeCodeResult(account, purpose, code) {
    const row = this.db.prepare(`SELECT * FROM verification_codes
      WHERE COALESCE(target,account)=? AND purpose=? ORDER BY created_at DESC LIMIT 1`).get(account, purpose);
    if (!row) return { ok: false, error: 'CODE_INVALID', message: '验证码错误。' };
    if (row.consumed_at || row.used_at) return { ok: false, error: 'CODE_USED', message: '验证码已使用。' };
    if (row.expires_at < now()) return { ok: false, error: 'CODE_EXPIRED', message: '验证码已过期。' };
    if (!/^\d{6}$/.test(String(code || '')) || hash(code) !== row.code_hash) return { ok: false, error: 'CODE_INVALID', message: '验证码错误。' };
    const usedAt = now();
    const update = this.db.prepare(`UPDATE verification_codes SET consumed_at=?,used_at=?
      WHERE id=? AND consumed_at IS NULL AND used_at IS NULL`).run(usedAt, usedAt, row.id);
    return update.changes === 1 ? { ok: true } : { ok: false, error: 'CODE_USED', message: '验证码已使用。' };
  }

  consumeCode(account, purpose, code) { return this.consumeCodeResult(account, purpose, code).ok; }

  verifyVerificationCode(input = {}) {
    const identity = normalizeIdentity(input.target == null ? input.account : input.target, 'email');
    const purpose = ['register', 'reset', 'bind_email'].includes(input.purpose) ? input.purpose : 'register';
    if (!identity.value) return { ok: false, error: 'INVALID_EMAIL', message: '邮箱格式错误。' };
    const verified = this.consumeCodeResult(identity.value, purpose, String(input.code || ''));
    if (!verified.ok) return verified;
    const ticket = randomToken(24);
    this.db.prepare('INSERT INTO verification_tickets(id,target,purpose,ticket_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)')
      .run(id('verify'), identity.value, purpose, hash(ticket), now(), now() + CODE_TTL_MS);
    return { ok: true, verified: true, ticket, expiresIn: 300, message: '验证码验证成功。' };
  }

  consumeVerificationTicket(target, purpose, ticketValue) {
    if (!ticketValue) return false;
    const ticket = this.db.prepare(`SELECT * FROM verification_tickets WHERE target=? AND purpose=? AND ticket_hash=?
      AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(target, purpose, hash(ticketValue));
    if (!ticket || ticket.expires_at < now()) return false;
    return this.db.prepare('UPDATE verification_tickets SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(now(), ticket.id).changes === 1;
  }

  register(input = {}) {
    const identity = normalizeIdentity(input.account, 'email');
    const account = identity.value;
    const type = identity.type;
    const password = String(input.password || '');
    if (!account || type !== 'email') return { ok: false, error: 'INVALID_EMAIL', message: '请输入有效邮箱。' };
    if (this.isReservedIdentity(account)) return { ok: false, error: 'RESERVED_IDENTITY', message: '该账号为系统保留账号，无法用于普通用户注册。' };
    if (!passwordStrength(password)) return { ok: false, error: 'WEAK_PASSWORD', message: '密码需为 8–128 位，并同时包含字母和数字。' };
    if (this.findUserByIdentity(account)) return { ok: false, error: 'ACCOUNT_EXISTS', message: '该账号已注册。' };
    const verified = input.verificationTicket
      ? (this.consumeVerificationTicket(account, 'register', String(input.verificationTicket)) ? { ok: true } : { ok: false, error: 'INVALID_VERIFICATION_TICKET', message: '验证凭证无效或已过期。' })
      : this.consumeCodeResult(account, 'register', String(input.code || ''));
    if (!verified.ok) return verified;
    const record = passwordRecord(password);
    const userId = id('user');
    const created = now();
    const nickname = safeText(input.nickname, 60) || `LF 用户 ${account.slice(-4)}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO users
        (id,account,account_type,nickname,avatar,password_hash,password_salt,role,developer_permission,blacklisted,created_at,updated_at,display_name,status,bootstrap_admin,must_change_password)
        VALUES(?,?,?,?, '',?,?,'user',0,0,?,?,?,?,0,0)`)
        .run(userId, account, type, nickname, record.passwordHash, record.salt, created, created, nickname, 'active');
      this.db.prepare(`INSERT INTO user_identities(id,user_id,identity_type,normalized_value,verified_at,created_at)
        VALUES(?,?,?,?,?,?)`).run(id('identity'), userId, type, account, created, created);
      this.db.prepare(`INSERT INTO user_permissions(id,user_id,permission,enabled,updated_by,updated_at) VALUES(?,?,'developer',0,NULL,?)`)
        .run(id('perm'), userId, created);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (/UNIQUE/i.test(String(error.message))) return { ok: false, error: 'ACCOUNT_EXISTS', message: '该账号已注册。' };
      throw error;
    }
    this.audit(userId, 'account_registered', userId, `${type}:user`);
    return { ok: true, user: publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(userId)), requiresLogin: true };
  }

  failedAttempts(account) {
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM login_logs
      WHERE account=? AND success=0 AND created_at>?`).get(account, now() - LOGIN_WINDOW_MS).count || 0);
  }

  recordLogin(user, account, method, deviceType, success, reason, ipAddress) {
    const createdAt = now();
    this.db.prepare(`INSERT INTO login_logs(id,user_id,account,method,device_type,success,reason,created_at,ip_address,login_time,login_method)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id('login'), user ? user.id : null, account, method, deviceType, success ? 1 : 0, safeText(reason, 100), createdAt, safeText(ipAddress, 80), createdAt, method);
  }

  createSession(user, input = {}) {
    const token = randomToken();
    const refreshToken = randomToken();
    const created = now();
    const deviceType = input.deviceType === 'mobile' ? 'mobile' : 'pc';
    const deviceName = safeText(input.deviceName, 100) || (deviceType === 'mobile' ? 'LF Mobile' : `${os.hostname()} · Windows`);
    const locationAuthorized = !!input.locationAuthorized;
    const location = locationAuthorized ? (safeText(input.location, 100) || '未知') : (safeText(input.ipLocation, 100) || '未知');
    const sessionId = id('session');
    this.db.prepare(`INSERT INTO user_sessions
      (id,user_id,token_hash,refresh_token_hash,device_type,device_name,app_version,login_method,location,location_authorized,online,created_at,last_active_at,expires_at,refresh_expires_at,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)`)
      .run(sessionId, user.id, hash(token), hash(refreshToken), deviceType, deviceName, this.appVersion, safeText(input.loginMethod, 30) || user.account_type, location, locationAuthorized ? 1 : 0, created, created, created + SESSION_TTL_MS, created + REFRESH_TTL_MS);
    const deviceKey = hash(`${deviceType}:${deviceName}`);
    this.db.prepare(`INSERT INTO devices(id,user_id,device_key,device_type,device_name,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,device_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,device_name=excluded.device_name`)
      .run(id('device'), user.id, deviceKey, deviceType, deviceName, created, created);
    return { token, refreshToken, session: sessionPublic(this.db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sessionId)) };
  }

  login(input = {}) {
    const identity = normalizeIdentity(input.account);
    const account = identity.value;
    const method = safeText(input.method, 30) || identity.type || 'password';
    const deviceType = input.deviceType === 'mobile' ? 'mobile' : 'pc';
    const requestIp = safeText(input.requestIp, 80);
    if (!account) return { ok: false, error: 'INVALID_ACCOUNT', message: '账号格式错误。' };
    const failures = this.failedAttempts(account);
    if (failures >= 5) return { ok: false, error: 'LOGIN_LOCKED', retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000), message: '登录失败次数过多，请 15 分钟后重试。' };
    const user = this.findUserByIdentity(account);
    if (!user || user.status !== 'active' || !verifyPassword(input.password, user.password_salt, user.password_hash)) {
      this.recordLogin(user, account, method, deviceType, false, 'INVALID_CREDENTIALS', requestIp);
      return { ok: false, error: 'INVALID_CREDENTIALS', attemptsRemaining: Math.max(0, 4 - failures), message: '账号或密码错误。' };
    }
    if (!/^\$2[aby]\$/.test(String(user.password_hash || ''))) {
      const upgraded = passwordRecord(input.password);
      this.db.prepare("UPDATE users SET password_hash=?,password_salt='',updated_at=? WHERE id=?").run(upgraded.passwordHash, now(), user.id);
      user.password_hash = upgraded.passwordHash;
      user.password_salt = '';
      this.audit(user.id, 'password_hash_upgraded', user.id, 'bcrypt');
    }
    if (user.blacklisted) {
      this.recordLogin(user, account, method, deviceType, false, 'BLACKLISTED', requestIp);
      return { ok: false, error: 'BLACKLISTED', message: BLACKLIST_MESSAGE };
    }
    const session = this.createSession(user, Object.assign({}, input, { loginMethod: method, deviceType }));
    this.recordLogin(user, account, method, deviceType, true, '', requestIp);
    this.audit(user.id, 'login_success', user.id, `${method}:${deviceType}`);
    return { ok: true, user: publicUser(user), ...session, adminMessage: user.role === 'admin' ? '已拥有开发权限' : '', passwordChangeRecommended: user.role === 'admin' && !!user.must_change_password };
  }

  sessionByToken(token, allowExpired = false) {
    if (!token) return null;
    const row = this.db.prepare(`SELECT s.*,u.account,u.account_type,u.nickname,u.avatar,u.role,u.developer_permission,u.blacklisted,u.created_at AS user_created_at,u.updated_at AS user_updated_at
      FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hash(token));
    if (!row || row.revoked_at || (!allowExpired && row.expires_at < now())) return null;
    return row;
  }

  authStatus(token, input = {}) {
    const offline = !!input.offline;
    const checkedAt = now();
    const row = this.sessionByToken(token, offline);
    if (!row) return { ok: false, authenticated: false, error: 'INVALID_SESSION' };
    if (row.blacklisted) {
      this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=?').run(checkedAt, row.user_id);
      return { ok: false, authenticated: false, error: 'BLACKLISTED', message: BLACKLIST_MESSAGE };
    }
    if (offline) {
      const lastActiveAt = Number(row.last_active_at || 0);
      const refreshExpiresAt = Number(row.refresh_expires_at || 0);
      if (refreshExpiresAt <= checkedAt || !lastActiveAt || checkedAt - lastActiveAt > OFFLINE_SESSION_MAX_MS) {
        return { ok: false, authenticated: false, offline: true, error: 'OFFLINE_SESSION_EXPIRED', message: '离线登录状态已过期，请联网重新验证。' };
      }
    } else {
      this.db.prepare('UPDATE user_sessions SET online=1,last_active_at=? WHERE id=?').run(checkedAt, row.id);
    }
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    return { ok: true, authenticated: true, offline, user: publicUser(user), session: sessionPublic(this.db.prepare('SELECT * FROM user_sessions WHERE id=?').get(row.id)), adminMessage: user.role === 'admin' ? '已拥有开发权限' : '' };
  }

  refreshSession(refreshToken) {
    const row = this.db.prepare(`SELECT s.*,s.id AS session_id,u.role,u.developer_permission,u.blacklisted
      FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_token_hash=?`).get(hash(refreshToken));
    if (!row || row.revoked_at || row.refresh_expires_at < now() || row.blacklisted) return { ok: false, error: row && row.blacklisted ? 'BLACKLISTED' : 'INVALID_REFRESH', message: row && row.blacklisted ? BLACKLIST_MESSAGE : '登录状态已过期，请重新登录。' };
    this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE id=?').run(now(), row.session_id);
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    return { ok: true, user: publicUser(user), ...this.createSession(user, { deviceType: row.device_type, deviceName: row.device_name, loginMethod: row.login_method, location: row.location, locationAuthorized: !!row.location_authorized }) };
  }

  logout(token) {
    const row = this.sessionByToken(token, true);
    if (row) {
      this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE id=?').run(now(), row.id);
      this.audit(row.user_id, 'logout', row.user_id, row.device_type);
    }
    return { ok: true };
  }

  setOnline(token, online) {
    const row = this.sessionByToken(token, true);
    if (!row) return { ok: false, error: 'INVALID_SESSION' };
    this.db.prepare('UPDATE user_sessions SET online=?,last_active_at=? WHERE id=?').run(online ? 1 : 0, now(), row.id);
    return { ok: true };
  }

  verifyResetCode(input = {}) {
    const account = normalizeIdentity(input.account, 'email').value;
    if (!account) return { ok: false, error: 'INVALID_EMAIL', message: '邮箱格式错误。' };
    if (!this.findUserByIdentity(account)) return { ok: false, error: 'ACCOUNT_NOT_FOUND', message: '账号不存在。' };
    const verified = this.consumeCodeResult(account, 'reset', String(input.code || ''));
    if (!verified.ok) return verified;
    const ticket = randomToken(24);
    this.db.prepare('INSERT INTO password_reset_tickets(id,account,ticket_hash,created_at,expires_at) VALUES(?,?,?,?,?)')
      .run(id('reset'), account, hash(ticket), now(), now() + 10 * 60 * 1000);
    return { ok: true, ticket, expiresIn: 600, message: '身份验证成功。' };
  }

  resetPassword(input = {}) {
    const account = normalizeIdentity(input.account, 'email').value;
    if (!account || !passwordStrength(input.password)) return { ok: false, error: 'INVALID_INPUT', message: '邮箱格式错误，或新密码未满足强度要求。' };
    const ticket = this.db.prepare('SELECT * FROM password_reset_tickets WHERE account=? AND ticket_hash=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(account, hash(input.ticket));
    if (!ticket || ticket.expires_at < now()) return { ok: false, error: 'INVALID_RESET_TICKET', message: '重置凭证无效或已过期，请重新验证。' };
    const user = this.findUserByIdentity(account);
    if (!user) return { ok: false, error: 'ACCOUNT_NOT_FOUND', message: '账号不存在。' };
    const record = passwordRecord(input.password);
    this.db.prepare('UPDATE password_reset_tickets SET consumed_at=? WHERE id=?').run(now(), ticket.id);
    this.db.prepare('UPDATE users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?').run(record.passwordHash, record.salt, now(), user.id);
    this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=? AND revoked_at IS NULL').run(now(), user.id);
    this.audit(user.id, 'password_reset', user.id, user.account_type);
    return { ok: true, message: '密码已更改，请使用新密码登录。' };
  }

  changePassword(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION', message: '登录状态已过期。' };
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!user || !verifyPassword(input.currentPassword, user.password_salt, user.password_hash)) {
      return { ok: false, error: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误。' };
    }
    if (!passwordStrength(input.newPassword)) return { ok: false, error: 'WEAK_PASSWORD', message: '新密码需为 8–128 位，并同时包含字母和数字。' };
    const record = passwordRecord(input.newPassword);
    this.db.prepare('UPDATE users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?')
      .run(record.passwordHash, record.salt, now(), user.id);
    this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=? AND id<>? AND revoked_at IS NULL').run(now(), user.id, session.id);
    this.audit(user.id, 'password_changed', user.id, 'authenticated');
    return { ok: true, message: '密码已安全更新。' };
  }

  createQrToken() {
    const token = randomToken(24);
    const created = now();
    this.db.prepare(`INSERT INTO qr_tokens(id,token_hash,status,created_at,expires_at) VALUES(?,?, 'pending',?,?)`)
      .run(id('qr'), hash(token), created, created + QR_TTL_MS);
    const configuredBase = String(this.env.LF_MOBILE_AUTH_URL || this.env.LF_REMOTE_API_URL || '').trim();
    let qrContent = `lumifield://auth/confirm?token=${encodeURIComponent(token)}`;
    let mobileAuthorizationConfigured = false;
    if (configuredBase) {
      try {
        const approval = new URL('/mobile/qr-login', configuredBase);
        const localDevelopment = this.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost', '::1'].includes(approval.hostname);
        if (approval.protocol === 'https:' || (localDevelopment && approval.protocol === 'http:')) {
          approval.searchParams.set('token', token);
          approval.hash = '';
          qrContent = approval.toString();
          mobileAuthorizationConfigured = true;
        }
      } catch (_) {}
    }
    return { ok: true, token, qrContent, mobileAuthorizationConfigured, expiresIn: QR_TTL_MS / 1000 };
  }

  confirmQr(input = {}) {
    const session = this.sessionByToken(input.sessionToken);
    if (!session) return { ok: false, error: 'INVALID_SESSION', message: '手机端登录状态无效。' };
    if (session.blacklisted) return { ok: false, error: 'BLACKLISTED', message: BLACKLIST_MESSAGE };
    const confirmedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const qr = this.db.prepare('SELECT * FROM qr_tokens WHERE token_hash=?').get(hash(input.qrToken));
      if (!qr || qr.status !== 'pending' || qr.expires_at < confirmedAt) {
        this.db.exec('ROLLBACK');
        return { ok: false, error: 'QR_EXPIRED', message: '二维码已过期或已使用。' };
      }
      const updated = this.db.prepare(`UPDATE qr_tokens SET status='confirmed',confirmed_user_id=?,result_session_token=NULL,result_refresh_token=NULL
        WHERE id=? AND status='pending' AND consumed_at IS NULL`).run(session.user_id, qr.id);
      if (updated.changes !== 1) {
        this.db.exec('ROLLBACK');
        return { ok: false, error: 'QR_EXPIRED', message: '二维码已过期或已使用。' };
      }
      this.db.exec('COMMIT');
      this.audit(session.user_id, 'qr_login_confirmed', session.user_id, qr.id);
      return { ok: true, status: 'confirmed' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  rejectQr(input = {}) {
    const session = this.sessionByToken(input.sessionToken);
    if (!session) return { ok: false, error: 'INVALID_SESSION', message: '手机端登录状态无效。' };
    if (session.blacklisted) return { ok: false, error: 'BLACKLISTED', message: BLACKLIST_MESSAGE };
    const rejectedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const qr = this.db.prepare('SELECT * FROM qr_tokens WHERE token_hash=?').get(hash(input.qrToken));
      if (!qr || qr.status !== 'pending' || qr.expires_at < rejectedAt) {
        this.db.exec('ROLLBACK');
        return { ok:false, error:'QR_EXPIRED', message:'二维码已过期或已处理。' };
      }
      const updated = this.db.prepare("UPDATE qr_tokens SET status='rejected',confirmed_user_id=? WHERE id=? AND status='pending' AND consumed_at IS NULL")
        .run(session.user_id, qr.id);
      if (updated.changes !== 1) {
        this.db.exec('ROLLBACK');
        return { ok:false, error:'QR_EXPIRED', message:'二维码已过期或已处理。' };
      }
      this.db.exec('COMMIT');
      this.audit(session.user_id, 'qr_login_rejected', session.user_id, qr.id);
      return { ok:true, status:'rejected' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  pollQr(qrToken) {
    const checkedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const qr = this.db.prepare('SELECT * FROM qr_tokens WHERE token_hash=?').get(hash(qrToken));
      if (!qr || qr.expires_at < checkedAt) {
        this.db.exec('ROLLBACK');
        return { ok: false, status: 'expired', error: 'QR_EXPIRED' };
      }
      if (qr.status !== 'confirmed' || qr.consumed_at) {
        this.db.exec('COMMIT');
        return { ok: true, status: qr.consumed_at ? 'consumed' : qr.status };
      }
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(qr.confirmed_user_id);
      if (!user || user.blacklisted) {
        this.db.exec('ROLLBACK');
        return { ok: false, status: 'expired', error: 'INVALID_SESSION' };
      }
      const claimed = this.db.prepare("UPDATE qr_tokens SET status='consumed',consumed_at=? WHERE id=? AND status='confirmed' AND consumed_at IS NULL").run(checkedAt, qr.id);
      if (claimed.changes !== 1) {
        this.db.exec('ROLLBACK');
        return { ok: true, status: 'consumed' };
      }
      const result = this.createSession(user, { deviceType: 'pc', deviceName: 'LF QR Login', loginMethod: 'qr' });
      this.db.exec('COMMIT');
      return { ok: true, status: 'confirmed', user: publicUser(user), ...result, adminMessage: user.role === 'admin' ? '已拥有开发权限' : '' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  oauthStart(providerOrInput) {
    const input = typeof providerOrInput === 'object' && providerOrInput ? providerOrInput : { provider: providerOrInput };
    const provider = safeText(input.provider, 20).toLowerCase();
    if (!['wechat', 'qq'].includes(provider)) return { ok: false, error: 'UNKNOWN_PROVIDER' };
    return { ok: false, error: 'FEATURE_REMOVED', provider, message: 'LF 账号仅支持邮箱登录。' };
    /* Legacy implementation is intentionally retained below for database/session migration compatibility. */
    const sessionTokenProvided = !!safeText(input.sessionToken, 500);
    const session = sessionTokenProvided ? this.sessionByToken(input.sessionToken) : null;
    if (sessionTokenProvided && !session) return { ok: false, error: 'INVALID_SESSION', message: '登录状态已过期。' };
    if (session && session.role === 'admin') {
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
      const recentFailures = Number(this.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=? AND action='oauth_admin_reauth_failed' AND created_at>?").get(session.user_id, now() - LOGIN_WINDOW_MS).count || 0);
      if (recentFailures >= 5) return { ok: false, error: 'REAUTH_LOCKED', retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000), message: '二次验证失败次数过多，请稍后重试。' };
      let reauthenticated = !!(input.currentPassword && user && verifyPassword(input.currentPassword, user.password_salt, user.password_hash));
      if (!reauthenticated && input.verificationTicket) {
        const emails = this.db.prepare("SELECT normalized_value FROM user_identities WHERE user_id=? AND identity_type='email'").all(session.user_id);
        reauthenticated = emails.some(item => this.consumeVerificationTicket(item.normalized_value, 'bind_email', String(input.verificationTicket)));
      }
      if (!reauthenticated) {
        if (input.currentPassword || input.verificationTicket) this.audit(session.user_id, 'oauth_admin_reauth_failed', session.user_id, provider);
        return { ok: false, error: 'ADMIN_REAUTH_REQUIRED', message: '管理员绑定微信或 QQ 前，必须验证管理员密码或邮箱验证码。' };
      }
      this.audit(session.user_id, 'oauth_admin_reauth_passed', session.user_id, provider);
    }
    const stateResult = this.oauthProviders.createState(provider);
    if (!stateResult.ok) {
      return { ok: false, configured: false, provider, error: 'BLOCKED_EXTERNAL_CONFIG', missing: stateResult.missing || [], message: `${provider === 'wechat' ? '微信' : 'QQ'}官方登录缺少开放平台配置。` };
    }
    const state = stateResult.state;
    const authorization = this.oauthProviders.authorizationUrl(provider, state);
    const label = provider === 'wechat' ? '微信' : 'QQ';
    if (!authorization.ok) {
      return { ok: false, configured: false, provider, error: 'BLOCKED_EXTERNAL_CONFIG', missing: authorization.missing || [], message: `${label}官方登录缺少开放平台配置。` };
    }
    const pollToken = randomToken(24);
    const createdAt = now();
    this.db.prepare(`INSERT INTO oauth_states
      (id,provider,state_hash,status,created_at,expires_at,poll_token_hash,intent,request_user_id,redirect_uri)
      VALUES(?,?,?,'pending',?,?,?,?,?,?)`)
      .run(id('oauth'), provider, hash(state), createdAt, createdAt + 10 * 60 * 1000, hash(pollToken), session ? 'bind' : 'login', session ? session.user_id : '', authorization.redirectUri || '');
    return { ok: true, configured: true, provider, authorizationUrl: authorization.authorizationUrl, pollToken, expiresIn: 600, message: `已打开${label}官方授权页面。` };
  }

  async oauthCallback(input = {}) {
    return { ok: false, error: 'FEATURE_REMOVED', message: 'LF 账号仅支持邮箱登录。' };
    /* Legacy callback implementation is intentionally unreachable. */
    const stateValue = safeText(input.state, 512);
    const code = safeText(input.code, 2048);
    if (!stateValue) return { ok: false, error: 'INVALID_OAUTH_CALLBACK' };
    const signedProvider = this.oauthProviders.stateProvider(stateValue);
    if (!signedProvider || !this.oauthProviders.validateState(signedProvider, stateValue)) return { ok: false, error: 'OAUTH_STATE_INVALID' };
    const stateHash = hash(stateValue);
    const startedAt = now();
    const state = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(stateHash);
    if (!state || state.provider !== signedProvider || state.expires_at < startedAt) return { ok: false, error: 'OAUTH_STATE_EXPIRED' };
    if (input.error || !code) {
      this.db.prepare("UPDATE oauth_states SET status='failed',error_code=? WHERE id=? AND status='pending'").run(safeText(input.error, 80) || 'OAUTH_CANCELLED', state.id);
      if (state.intent === 'test') this.recordLoginServiceTest(state.provider, 'test-login', false, safeText(input.error, 80) || 'OAUTH_CANCELLED', startedAt);
      return { ok: false, error: safeText(input.error, 80) || 'OAUTH_CANCELLED', message: '官方授权已取消。' };
    }
    const claimed = this.db.prepare("UPDATE oauth_states SET status='exchanging' WHERE id=? AND status='pending' AND consumed_at IS NULL").run(state.id);
    if (claimed.changes !== 1) return { ok: false, error: 'OAUTH_STATE_USED' };
    const profile = await this.oauthProviders.exchange(state.provider, code);
    if (!profile.ok) {
      this.db.prepare("UPDATE oauth_states SET status='failed',error_code=? WHERE id=? AND status='exchanging'").run(safeText(profile.error, 80), state.id);
      if (state.intent === 'test') this.recordLoginServiceTest(state.provider, 'test-login', false, profile.error || profile.providerError, now());
      return profile;
    }
    const normalizedValue = `${state.provider}:${safeText(profile.providerUserId, 180)}`;
    const completedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT * FROM oauth_states WHERE id=?').get(state.id);
      if (!current || current.status !== 'exchanging' || current.expires_at < completedAt) throw Object.assign(new Error('OAUTH_STATE_EXPIRED'), { code: 'OAUTH_STATE_EXPIRED' });
      if (current.intent === 'test') {
        this.db.prepare("UPDATE oauth_states SET status='confirmed',confirmed_at=?,error_code='' WHERE id=? AND status='exchanging'").run(completedAt, state.id);
        this.db.exec('COMMIT');
        this.recordLoginServiceTest(state.provider, 'test-login', true, '', completedAt);
        this.audit(current.request_user_id || null, 'login_service_test_completed', null, `${state.provider}:success`);
        return { ok: true, provider: state.provider, status: 'confirmed', testOnly: true, message: '官方登录测试成功，未创建或绑定账号。' };
      }
      const existingIdentity = this.db.prepare(`SELECT * FROM user_identities
        WHERE identity_type=? AND (provider_user_id=? OR normalized_value=?)`).get(state.provider, profile.providerUserId, normalizedValue);
      if (existingIdentity && current.request_user_id && existingIdentity.user_id !== current.request_user_id) {
        throw Object.assign(new Error('OAUTH_IDENTITY_BOUND'), { code: 'OAUTH_IDENTITY_BOUND' });
      }
      let userId = current.request_user_id || (existingIdentity && existingIdentity.user_id) || '';
      if (userId && !this.db.prepare('SELECT id FROM users WHERE id=?').get(userId)) throw Object.assign(new Error('USER_NOT_FOUND'), { code: 'USER_NOT_FOUND' });
      if (!userId) {
        userId = id('user');
        const generated = passwordRecord(randomToken(48));
        const nickname = safeText(profile.displayName, 60) || `${state.provider === 'wechat' ? '微信' : 'QQ'}用户`;
        this.db.prepare(`INSERT INTO users
          (id,account,account_type,nickname,avatar,password_hash,password_salt,role,developer_permission,blacklisted,created_at,updated_at,display_name,status,bootstrap_admin,must_change_password)
          VALUES(?,?,?,?,?,?,?,'user',0,0,?,?,?,?,0,0)`)
          .run(userId, normalizedValue, state.provider, nickname, safeText(profile.avatarUrl, 800), generated.passwordHash, generated.salt, completedAt, completedAt, nickname, 'active');
        this.db.prepare(`INSERT INTO user_permissions(id,user_id,permission,enabled,updated_by,updated_at) VALUES(?,?,'developer',0,NULL,?)`).run(id('perm'), userId, completedAt);
      }
      if (existingIdentity) {
        this.db.prepare(`UPDATE user_identities SET display_name=?,avatar_url=?,verified_at=?,updated_at=? WHERE id=?`)
          .run(safeText(profile.displayName, 60), safeText(profile.avatarUrl, 800), completedAt, completedAt, existingIdentity.id);
      } else {
        this.db.prepare(`INSERT INTO user_identities
          (id,user_id,identity_type,normalized_value,provider_user_id,display_name,avatar_url,verified_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id('identity'), userId, state.provider, normalizedValue, safeText(profile.providerUserId, 180), safeText(profile.displayName, 60), safeText(profile.avatarUrl, 800), completedAt, completedAt, completedAt);
      }
      this.db.prepare(`UPDATE users SET display_name=CASE WHEN display_name='' THEN ? ELSE display_name END,
        avatar=CASE WHEN avatar='' THEN ? ELSE avatar END,updated_at=? WHERE id=?`)
        .run(safeText(profile.displayName, 60), safeText(profile.avatarUrl, 800), completedAt, userId);
      this.db.prepare("UPDATE oauth_states SET status='confirmed',result_user_id=?,confirmed_at=?,error_code='' WHERE id=? AND status='exchanging'")
        .run(userId, completedAt, state.id);
      this.db.exec('COMMIT');
      this.audit(userId, current.intent === 'bind' ? 'oauth_identity_bound' : 'oauth_login_confirmed', userId, state.provider);
      return { ok: true, provider: state.provider, status: 'confirmed', message: '官方授权成功，可返回 LumiField。' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      this.db.prepare("UPDATE oauth_states SET status='failed',error_code=? WHERE id=? AND status='exchanging'").run(safeText(error.code || error.message, 80), state.id);
      return { ok: false, error: safeText(error.code || error.message, 80) || 'OAUTH_BIND_FAILED' };
    }
  }

  oauthPoll(pollToken) {
    return { ok: false, status: 'disabled', error: 'FEATURE_REMOVED', message: 'LF 账号仅支持邮箱登录。' };
    /* Legacy poll implementation is intentionally unreachable. */
    const checkedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.db.prepare('SELECT * FROM oauth_states WHERE poll_token_hash=?').get(hash(pollToken));
      if (!state || state.expires_at < checkedAt) {
        this.db.exec('ROLLBACK');
        return { ok: false, status: 'expired', error: 'OAUTH_STATE_EXPIRED' };
      }
      if (state.status === 'failed') {
        this.db.exec('COMMIT');
        return { ok: false, status: 'failed', error: state.error_code || 'OAUTH_PROVIDER_FAILED' };
      }
      if (state.status !== 'confirmed' || state.consumed_at) {
        this.db.exec('COMMIT');
        return { ok: true, status: state.consumed_at ? 'consumed' : state.status };
      }
      if (state.intent === 'test') {
        const consumedTest = this.db.prepare("UPDATE oauth_states SET status='consumed',consumed_at=? WHERE id=? AND status='confirmed' AND consumed_at IS NULL").run(checkedAt, state.id);
        this.db.exec(consumedTest.changes === 1 ? 'COMMIT' : 'ROLLBACK');
        return { ok: true, status: consumedTest.changes === 1 ? 'confirmed' : 'consumed', provider: state.provider, testOnly: true };
      }
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(state.result_user_id);
      if (!user || user.blacklisted) {
        this.db.exec('ROLLBACK');
        return { ok: false, status: 'failed', error: user && user.blacklisted ? 'BLACKLISTED' : 'USER_NOT_FOUND' };
      }
      const consumed = this.db.prepare("UPDATE oauth_states SET status='consumed',consumed_at=? WHERE id=? AND status='confirmed' AND consumed_at IS NULL").run(checkedAt, state.id);
      if (consumed.changes !== 1) {
        this.db.exec('ROLLBACK');
        return { ok: true, status: 'consumed' };
      }
      if (state.intent === 'bind') {
        this.db.exec('COMMIT');
        return { ok: true, status: 'confirmed', provider: state.provider, bound: true, user: publicUser(user) };
      }
      const session = this.createSession(user, { deviceType: 'pc', deviceName: 'LF Official OAuth', loginMethod: state.provider });
      this.db.exec('COMMIT');
      return { ok: true, status: 'confirmed', provider: state.provider, user: publicUser(user), ...session, adminMessage: user.role === 'admin' ? '已拥有开发权限' : '' };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  userIdentities(token) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const identities = this.db.prepare(`SELECT identity_type,normalized_value,display_name,avatar_url,verified_at,created_at,updated_at
      FROM user_identities WHERE user_id=? ORDER BY created_at`).all(session.user_id).map(item => ({
      type: item.identity_type,
      value: item.identity_type === 'email' ? item.normalized_value : item.identity_type === 'phone_legacy' ? '已保留的旧手机号身份' : item.display_name,
      displayName: item.display_name,
      avatarUrl: item.avatar_url,
      verifiedAt: item.verified_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
    return { ok: true, identities };
  }

  bindEmail(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const email = normalizeIdentity(input.email, 'email').value;
    if (!email) return { ok: false, error: 'INVALID_EMAIL', message: '邮箱格式错误。' };
    const existing = this.db.prepare('SELECT * FROM user_identities WHERE normalized_value=?').get(email);
    if (existing) return existing.user_id === session.user_id
      ? { ok: true, alreadyBound: true, message: '该邮箱已绑定当前账号。' }
      : { ok: false, error: 'IDENTITY_IN_USE', message: '该邮箱已绑定其他 LF 账号。' };
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!user) return { ok: false, error: 'USER_NOT_FOUND' };
    if (user.account_type !== 'email' && !passwordStrength(input.password)) {
      return { ok: false, error: 'WEAK_PASSWORD', message: '首次绑定邮箱时请设置 8–128 位、同时包含字母和数字的密码。' };
    }
    const verified = input.verificationTicket
      ? (this.consumeVerificationTicket(email, 'bind_email', String(input.verificationTicket)) ? { ok: true } : { ok: false, error: 'INVALID_VERIFICATION_TICKET' })
      : this.consumeCodeResult(email, 'bind_email', String(input.code || ''));
    if (!verified.ok) return verified;
    const changedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO user_identities
        (id,user_id,identity_type,normalized_value,provider_user_id,display_name,avatar_url,verified_at,created_at,updated_at)
        VALUES(?,?,'email',?,'',?,'',?,?,?)`).run(id('identity'), user.id, email, email, changedAt, changedAt, changedAt);
      if (user.account_type !== 'email') {
        const record = passwordRecord(input.password);
        this.db.prepare("UPDATE users SET account=?,account_type='email',password_hash=?,password_salt=?,updated_at=? WHERE id=?")
          .run(email, record.passwordHash, record.salt, changedAt, user.id);
      }
      this.db.exec('COMMIT');
      this.audit(user.id, 'email_identity_bound', user.id, 'email');
      return { ok: true, message: '邮箱已绑定。', identities: this.userIdentities(token).identities };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      return { ok: false, error: /UNIQUE/i.test(String(error.message)) ? 'IDENTITY_IN_USE' : 'BIND_EMAIL_FAILED' };
    }
  }

  unbindIdentity(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const type = safeText(input.type, 24).toLowerCase();
    if (!['wechat', 'qq'].includes(type)) return { ok: false, error: 'UNBIND_NOT_ALLOWED', message: '只能在此处解绑微信或 QQ。' };
    const identity = this.db.prepare('SELECT * FROM user_identities WHERE user_id=? AND identity_type=?').get(session.user_id, type);
    if (!identity) return { ok: false, error: 'IDENTITY_NOT_FOUND' };
    const alternatives = this.db.prepare('SELECT * FROM user_identities WHERE user_id=? AND id<>? ORDER BY CASE identity_type WHEN \'email\' THEN 0 WHEN \'phone_legacy\' THEN 1 ELSE 2 END,created_at').all(session.user_id, identity.id);
    if (!alternatives.length) return { ok: false, error: 'LAST_IDENTITY', message: '请先绑定邮箱或另一种登录方式。' };
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM user_identities WHERE id=? AND user_id=?').run(identity.id, session.user_id);
      if (user && user.account_type === type) {
        const next = alternatives[0];
        this.db.prepare('UPDATE users SET account=?,account_type=?,updated_at=? WHERE id=?').run(next.normalized_value, next.identity_type, now(), user.id);
      }
      this.db.exec('COMMIT');
      this.audit(session.user_id, 'oauth_identity_unbound', session.user_id, type);
      return { ok: true, message: `${type === 'wechat' ? '微信' : 'QQ'}已解绑。`, identities: this.userIdentities(token).identities };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      return { ok: false, error: 'UNBIND_FAILED' };
    }
  }

  profile(token) { return this.authStatus(token); }

  createFeedbackDraft(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const requested = safeText(input.draftId, 100);
    if (requested) {
      const existing = this.db.prepare("SELECT id FROM feedbacks WHERE id=? AND user_id=? AND processing_status='draft'").get(requested, session.user_id);
      if (existing) return { ok: true, id: existing.id, draft: true, resumed: true };
    }
    const feedbackId = id('feedback');
    const createdAt = now();
    this.db.prepare(`INSERT INTO feedbacks
      (id,user_id,content,contact,screenshot_name,log_excerpt,delivery_status,created_at,client_version,device_info,mail_status,mail_error,processing_status,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        feedbackId, session.user_id, '', '', '', '', 'draft', createdAt,
        safeText(input.clientVersion, 40) || this.appVersion, safeText(input.deviceInfo, 180),
        'draft', '', 'draft', createdAt
      );
    this.audit(session.user_id, 'feedback_draft_created', session.user_id, feedbackId);
    return { ok: true, id: feedbackId, draft: true, expiresAt: createdAt + 24 * 60 * 60 * 1000 };
  }

  submitFeedback(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const content = safeText(input.content, 5000);
    if (content.length < 5) return { ok: false, error: 'CONTENT_TOO_SHORT', message: '请至少填写 5 个字的问题描述。' };
    const contact = safeText(input.contact, 160);
    if (!contact) return { ok: false, error: 'CONTACT_REQUIRED', message: '请填写联系方式。' };
    if (!validFeedbackContact(contact)) return { ok: false, error: 'INVALID_CONTACT', message: '联系方式必须是有效邮箱或中国大陆手机号。' };
    const draftId = safeText(input.draftId, 100);
    const draft = draftId ? this.db.prepare("SELECT * FROM feedbacks WHERE id=? AND user_id=? AND processing_status='draft'").get(draftId, session.user_id) : null;
    if (draftId && !draft) return { ok: false, error: 'DRAFT_NOT_FOUND', message: '反馈草稿已失效，请重新选择附件。' };
    if (draft) {
      const pending = this.db.prepare("SELECT COUNT(*) AS n FROM feedback_uploads WHERE feedback_id=? AND status='uploading'").get(draft.id).n;
      if (pending) return { ok: false, error: 'UPLOADS_PENDING', message: '附件仍在上传，请等待完成后提交。' };
    }
    const feedbackId = draft ? draft.id : id('feedback');
    let screenshotBuffer = null;
    let screenshotExt = '';
    if (input.screenshotDataUrl) {
      const match = String(input.screenshotDataUrl).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return { ok: false, error: 'INVALID_SCREENSHOT', message: '截图格式无效，仅支持 PNG、JPEG 或 WebP。' };
      screenshotBuffer = Buffer.from(match[2], 'base64');
      if (!screenshotBuffer.length || screenshotBuffer.length > 2 * 1024 * 1024) return { ok: false, error: 'SCREENSHOT_TOO_LARGE', message: '截图不能超过 2 MB。' };
      screenshotExt = match[1] === 'jpeg' ? 'jpg' : match[1];
      const validMagic = screenshotExt === 'png'
        ? screenshotBuffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
        : screenshotExt === 'jpg'
          ? screenshotBuffer[0] === 0xff && screenshotBuffer[1] === 0xd8 && screenshotBuffer[2] === 0xff
          : screenshotBuffer.subarray(0, 4).toString('ascii') === 'RIFF' && screenshotBuffer.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!validMagic) return { ok: false, error: 'INVALID_SCREENSHOT', message: '截图内容与文件格式不匹配。' };
    }
    const cleanLog = safeText(input.logExcerpt, 12000)
      .replace(/(cookie|authorization|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
    const createdAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (draft) {
        this.db.prepare(`UPDATE feedbacks SET content=?,contact=?,screenshot_name=?,log_excerpt=?,delivery_status=?,client_version=?,device_info=?,
          mail_status='queued',mail_error='',processing_status='new',updated_at=? WHERE id=? AND user_id=? AND processing_status='draft'`)
          .run(content, contact, safeText(input.screenshotName, 180), cleanLog, input.offline ? 'queued-offline' : 'queued', safeText(input.clientVersion, 40) || this.appVersion, safeText(input.deviceInfo, 180), createdAt, feedbackId, session.user_id);
      } else {
        this.db.prepare(`INSERT INTO feedbacks
          (id,user_id,content,contact,screenshot_name,log_excerpt,delivery_status,created_at,client_version,device_info,mail_status,mail_error,processing_status,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,'queued','','new',?)`).run(feedbackId, session.user_id, content, contact, safeText(input.screenshotName, 180), cleanLog, input.offline ? 'queued-offline' : 'queued', createdAt, safeText(input.clientVersion, 40) || this.appVersion, safeText(input.deviceInfo, 180), createdAt);
      }
      this.db.prepare(`INSERT INTO feedback_notifications
        (id,feedback_id,status,attempts,last_error,next_attempt_at,created_at,revision,reason)
        VALUES(?,?,'queued',0,'',?,?,1,'initial_submission')`).run(id('notice'), feedbackId, createdAt, createdAt);
      if (screenshotBuffer) {
        const attachmentId = id('attachment');
        const storedPath = path.join(this.feedbackAttachmentDir, `${attachmentId}.${screenshotExt}`);
        fs.writeFileSync(storedPath, screenshotBuffer, { mode: 0o600, flag: 'wx' });
        this.db.prepare(`INSERT INTO feedback_attachments
          (id,feedback_id,user_id,file_name,mime,size,stored_path,sha256,status,created_at,completed_at)
          VALUES(?,?,?,?,?,?,?,?, 'ready',?,?)`).run(attachmentId, feedbackId, session.user_id, safeFileName(input.screenshotName) || `screenshot.${screenshotExt}`, screenshotExt === 'png' ? 'image/png' : screenshotExt === 'webp' ? 'image/webp' : 'image/jpeg', screenshotBuffer.length, storedPath, crypto.createHash('sha256').update(screenshotBuffer).digest('hex'), createdAt, createdAt);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    this.audit(session.user_id, 'feedback_submitted', session.user_id, feedbackId);
    return { ok: true, id: feedbackId, draftCommitted: !!draft, databaseSaved: true, queued: true, mailStatus: 'queued', message: input.offline ? '反馈已安全暂存；联网后继续附件与邮件投递。' : '反馈已保存到 LF 后台数据库。' };
  }

  createFeedbackUpload(token, feedbackId, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const feedback = this.db.prepare('SELECT id,user_id FROM feedbacks WHERE id=?').get(safeText(feedbackId, 100));
    if (!feedback || feedback.user_id !== session.user_id) return { ok: false, error: 'FEEDBACK_NOT_FOUND' };
    const policy = feedbackFilePolicy(input.name, input.type, Number(input.size));
    if (!policy.ok) return policy;
    const uploadId = id('upload');
    const tempPath = path.join(this.feedbackUploadDir, `${uploadId}.part`);
    fs.writeFileSync(tempPath, Buffer.alloc(0), { mode: 0o600, flag: 'wx' });
    const createdAt = now();
    this.db.prepare(`INSERT INTO feedback_uploads
      (id,feedback_id,user_id,file_name,mime,expected_size,received_size,next_chunk,temp_path,status,created_at,updated_at,expires_at)
      VALUES(?,?,?,?,?,?,0,0,?,'uploading',?,?,?)`).run(uploadId, feedback.id, session.user_id, policy.fileName, policy.mime, policy.size, tempPath, createdAt, createdAt, createdAt + 24 * 60 * 60 * 1000);
    this.db.prepare('UPDATE feedbacks SET updated_at=? WHERE id=?').run(createdAt, feedback.id);
    return { ok: true, uploadId, chunkSize: FEEDBACK_CHUNK_BYTES, receivedSize: 0, nextChunk: 0, resumable: true, expiresAt: createdAt + 24 * 60 * 60 * 1000 };
  }

  appendFeedbackUpload(token, uploadId, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const upload = this.db.prepare('SELECT * FROM feedback_uploads WHERE id=?').get(safeText(uploadId, 100));
    if (!upload || upload.user_id !== session.user_id || upload.status !== 'uploading') return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    if (upload.expires_at < now()) return { ok: false, error: 'UPLOAD_EXPIRED' };
    const chunkIndex = Number(input.chunkIndex);
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex !== upload.next_chunk) return { ok: false, error: 'CHUNK_OUT_OF_ORDER', nextChunk: upload.next_chunk, receivedSize: upload.received_size };
    let chunk;
    try { chunk = Buffer.isBuffer(input.data) ? input.data : Buffer.from(String(input.dataBase64 || ''), 'base64'); } catch (_) { chunk = Buffer.alloc(0); }
    if (!chunk.length || chunk.length > FEEDBACK_CHUNK_BYTES) return { ok: false, error: 'INVALID_CHUNK_SIZE' };
    if (upload.received_size + chunk.length > upload.expected_size) return { ok: false, error: 'UPLOAD_SIZE_EXCEEDED' };
    const resolved = path.resolve(upload.temp_path);
    if (!resolved.startsWith(path.resolve(this.feedbackUploadDir) + path.sep)) return { ok: false, error: 'INVALID_UPLOAD_PATH' };
    fs.appendFileSync(resolved, chunk);
    const received = upload.received_size + chunk.length;
    this.db.prepare('UPDATE feedback_uploads SET received_size=?,next_chunk=?,updated_at=?,expires_at=? WHERE id=?')
      .run(received, chunkIndex + 1, now(), now() + 24 * 60 * 60 * 1000, upload.id);
    this.db.prepare('UPDATE feedbacks SET updated_at=? WHERE id=?').run(now(), upload.feedback_id);
    return { ok: true, uploadId: upload.id, receivedSize: received, expectedSize: upload.expected_size, nextChunk: chunkIndex + 1, progress: Math.round(received / upload.expected_size * 10000) / 100 };
  }

  async finalizeFeedbackUpload(token, uploadId) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const upload = this.db.prepare('SELECT * FROM feedback_uploads WHERE id=?').get(safeText(uploadId, 100));
    if (!upload || upload.user_id !== session.user_id || upload.status !== 'uploading') return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    if (upload.received_size !== upload.expected_size) return { ok: false, error: 'UPLOAD_INCOMPLETE', receivedSize: upload.received_size, expectedSize: upload.expected_size, nextChunk: upload.next_chunk };
    const policy = feedbackFilePolicy(upload.file_name, upload.mime, upload.expected_size);
    if (!policy.ok) return policy;
    const source = path.resolve(upload.temp_path);
    if (!source.startsWith(path.resolve(this.feedbackUploadDir) + path.sep) || !fs.existsSync(source)) return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    const first = Buffer.alloc(16);
    const descriptor = fs.openSync(source, 'r');
    const read = fs.readSync(descriptor, first, 0, first.length, 0); fs.closeSync(descriptor);
    if (read >= 2 && first[0] === 0x4d && first[1] === 0x5a) return { ok: false, error: 'DANGEROUS_FILE_CONTENT', message: '检测到可执行程序内容，附件已拒绝。' };
    if (policy.extension === '.mp4' && first.subarray(4, 8).toString('ascii') !== 'ftyp') return { ok: false, error: 'FILE_SIGNATURE_MISMATCH' };
    const attachmentId = id('attachment');
    const target = path.join(this.feedbackAttachmentDir, `${attachmentId}${policy.extension}`);
    const sha256 = await hashFile(source);
    const current = this.db.prepare('SELECT status FROM feedback_uploads WHERE id=?').get(upload.id);
    if (!current || current.status !== 'uploading') return { ok: false, error: current && current.status === 'cancelled' ? 'UPLOAD_CANCELLED' : 'UPLOAD_NOT_FOUND' };
    fs.renameSync(source, target);
    const completedAt = now();
    const status = policy.quarantine ? 'quarantined' : 'ready';
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO feedback_attachments
        (id,feedback_id,user_id,file_name,mime,size,stored_path,sha256,status,created_at,completed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(attachmentId, upload.feedback_id, upload.user_id, policy.fileName, policy.mime, upload.expected_size, target, sha256, status, upload.created_at, completedAt);
      this.db.prepare("UPDATE feedback_uploads SET status='complete',attachment_id=?,updated_at=? WHERE id=?").run(attachmentId, completedAt, upload.id);
      this.db.prepare(`UPDATE feedbacks SET delivery_status=CASE WHEN processing_status='draft' THEN delivery_status ELSE 'uploaded' END,updated_at=? WHERE id=?`)
        .run(completedAt, upload.feedback_id);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return { ok: true, attachmentId, name: policy.fileName, size: upload.expected_size, sha256, status, quarantined: status === 'quarantined' };
  }

  feedbackUploadStatus(token, uploadId) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const upload = this.db.prepare(`SELECT id,feedback_id,user_id,file_name,mime,status,expected_size,received_size,next_chunk,expires_at,attachment_id
      FROM feedback_uploads WHERE id=?`).get(safeText(uploadId, 100));
    if (!upload || upload.user_id !== session.user_id) return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    return {
      ok: true,
      uploadId: upload.id,
      attachmentId: upload.attachment_id || '',
      feedbackId: upload.feedback_id,
      fileName: upload.file_name,
      mime: upload.mime,
      status: upload.status,
      expectedSize: upload.expected_size,
      receivedSize: upload.received_size,
      nextChunk: upload.next_chunk,
      chunkSize: FEEDBACK_CHUNK_BYTES,
      expiresAt: upload.expires_at,
    };
  }

  cancelFeedbackUpload(token, uploadId) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const upload = this.db.prepare('SELECT * FROM feedback_uploads WHERE id=?').get(safeText(uploadId, 100));
    if (!upload || upload.user_id !== session.user_id) return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    if (upload.status === 'complete') return { ok: false, error: 'UPLOAD_ALREADY_COMPLETE' };
    if (upload.status === 'cancelled') return { ok: true, uploadId: upload.id, status: 'cancelled', alreadyCancelled: true };
    const candidate = path.resolve(upload.temp_path || '');
    if (candidate.startsWith(path.resolve(this.feedbackUploadDir) + path.sep)) {
      try { fs.unlinkSync(candidate); } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    }
    this.db.prepare("UPDATE feedback_uploads SET status='cancelled',updated_at=?,expires_at=? WHERE id=?")
      .run(now(), now() + 24 * 60 * 60 * 1000, upload.id);
    this.audit(session.user_id, 'feedback_upload_cancelled', session.user_id, upload.id);
    return { ok: true, uploadId: upload.id, status: 'cancelled' };
  }

  deleteFeedbackAttachment(token, attachmentId) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const attachment = this.db.prepare(`SELECT a.*,f.processing_status FROM feedback_attachments a
      JOIN feedbacks f ON f.id=a.feedback_id WHERE a.id=? AND a.user_id=?`).get(safeText(attachmentId, 100), session.user_id);
    if (!attachment) return { ok: false, error: 'ATTACHMENT_NOT_FOUND' };
    if (attachment.processing_status !== 'draft') return { ok: false, error: 'FEEDBACK_ALREADY_SUBMITTED' };
    const candidate = path.resolve(attachment.stored_path || '');
    if (!candidate.startsWith(path.resolve(this.feedbackAttachmentDir) + path.sep)) return { ok: false, error: 'INVALID_ATTACHMENT_PATH' };
    try { fs.unlinkSync(candidate); } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    this.db.prepare('DELETE FROM feedback_uploads WHERE attachment_id=? AND user_id=?').run(attachment.id, session.user_id);
    this.db.prepare('DELETE FROM feedback_attachments WHERE id=? AND user_id=?').run(attachment.id, session.user_id);
    this.audit(session.user_id, 'feedback_attachment_deleted', session.user_id, attachment.id);
    return { ok: true, attachmentId: attachment.id, deleted: true };
  }

  requireAdmin(token) {
    const session = this.sessionByToken(token);
    if (!session || session.role !== 'admin' || session.blacklisted) return null;
    return session;
  }

  feedbackAttachment(token, feedbackId) {
    if (!this.requireAdmin(token)) return { ok: false, error: 'FORBIDDEN' };
    const key = safeText(feedbackId, 100);
    const row = this.db.prepare(`SELECT * FROM feedback_attachments WHERE id=? OR feedback_id=? ORDER BY completed_at DESC LIMIT 1`).get(key, key);
    if (!row) return { ok: false, error: 'ATTACHMENT_NOT_FOUND' };
    if (row.status !== 'ready') return { ok: false, error: row.status === 'quarantined' ? 'ATTACHMENT_QUARANTINED' : 'ATTACHMENT_UNAVAILABLE', status: row.status };
    const file = path.resolve(row.stored_path || '');
    if (!file.startsWith(path.resolve(this.feedbackAttachmentDir) + path.sep) || !fs.existsSync(file)) return { ok: false, error: 'ATTACHMENT_NOT_FOUND' };
    return { ok: true, filePath: file, name: row.file_name, mime: row.mime, size: row.size, sha256: row.sha256, attachmentId: row.id };
  }

  feedbackAttachmentData(token, feedbackId) {
    const result = this.feedbackAttachment(token, feedbackId);
    if (!result.ok) return result;
    const buffer = fs.readFileSync(result.filePath);
    if (buffer.length > 8 * 1024 * 1024) return { ok: false, error: 'ATTACHMENT_TOO_LARGE', message: '请使用有时效的下载链接读取大附件。' };
    return { ok: true, name: result.name, mime: result.mime, dataBase64: buffer.toString('base64') };
  }

  createFeedbackDownloadGrant(token, attachmentId) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    return this.issueFeedbackDownloadGrant(attachmentId, admin.user_id);
  }

  issueFeedbackDownloadGrant(attachmentId, adminUserId = '', attemptId = '', notificationRevision = 0) {
    const attachment = this.db.prepare("SELECT * FROM feedback_attachments WHERE id=? AND status='ready'").get(safeText(attachmentId, 100));
    if (!attachment) return { ok: false, error: 'ATTACHMENT_NOT_READY' };
    const grant = randomToken(32);
    const createdAt = now();
    const grantId = id('download');
    this.db.prepare(`INSERT INTO feedback_download_grants
      (id,attachment_id,token_hash,admin_user_id,created_at,expires_at,attempt_id,notification_revision)
      VALUES(?,?,?,?,?,?,?,?)`).run(grantId, attachment.id, hash(grant), adminUserId || null, createdAt, createdAt + FEEDBACK_LINK_TTL_MS, safeText(attemptId, 100), Number(notificationRevision) || 0);
    return { ok: true, grantId, attachmentId: attachment.id, grant, name: attachment.file_name, expiresAt: createdAt + FEEDBACK_LINK_TTL_MS };
  }

  feedbackDownloadByGrant(attachmentId, grant) {
    const row = this.db.prepare(`SELECT a.*,g.id AS grant_id,g.expires_at FROM feedback_download_grants g
      JOIN feedback_attachments a ON a.id=g.attachment_id WHERE g.attachment_id=? AND g.token_hash=?`).get(safeText(attachmentId, 100), hash(grant));
    if (!row || row.expires_at < now() || row.status !== 'ready') return { ok: false, error: 'DOWNLOAD_LINK_EXPIRED' };
    const file = path.resolve(row.stored_path || '');
    if (!file.startsWith(path.resolve(this.feedbackAttachmentDir) + path.sep) || !fs.existsSync(file)) return { ok: false, error: 'ATTACHMENT_NOT_FOUND' };
    this.db.prepare('UPDATE feedback_download_grants SET last_accessed_at=? WHERE id=?').run(now(), row.grant_id);
    return { ok: true, filePath: file, name: row.file_name, mime: row.mime, size: row.size, sha256: row.sha256 };
  }

  async setFeedbackAttachmentStatus(token, input = {}) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    const status = input.status === 'ready' ? 'ready' : input.status === 'rejected' ? 'rejected' : '';
    if (!status) return { ok: false, error: 'INVALID_STATUS' };
    const attachmentId = safeText(input.attachmentId, 100);
    const current = this.db.prepare('SELECT id,feedback_id,status FROM feedback_attachments WHERE id=?').get(attachmentId);
    if (!current) return { ok: false, error: 'ATTACHMENT_NOT_FOUND' };
    if (current.status === status) {
      const notice = this.db.prepare('SELECT revision,reason,status FROM feedback_notifications WHERE feedback_id=?').get(current.feedback_id);
      return { ok: true, status, idempotent: true, revision: notice && notice.revision || 1, notificationStatus: notice && notice.status || '' };
    }
    if (current.status !== 'quarantined') return { ok: false, error: 'ATTACHMENT_STATE_CONFLICT', status: current.status };
    let revision = 0;
    let reason = '';
    try {
      this.transaction(() => {
        const changed = this.db.prepare("UPDATE feedback_attachments SET status=? WHERE id=? AND status='quarantined'").run(status, attachmentId);
        if (changed.changes !== 1) throw new Error('ATTACHMENT_STATE_CONFLICT');
        if (status === 'ready') {
          reason = `quarantine_approved:${attachmentId}`;
          const updated = this.db.prepare(`UPDATE feedback_notifications SET
            revision=revision+1,reason=?,status='queued',attempts=0,last_error='',next_attempt_at=?,
            delivered_at=NULL,last_message_id='',last_accepted='[]',last_rejected='[]',last_response='',last_attempt_at=NULL
            WHERE feedback_id=?`).run(reason, now(), current.feedback_id);
          if (updated.changes !== 1) throw new Error('NOTIFICATION_NOT_FOUND');
          revision = this.db.prepare('SELECT revision FROM feedback_notifications WHERE feedback_id=?').get(current.feedback_id).revision;
          this.db.prepare("UPDATE feedbacks SET mail_status='queued',mail_error='',delivery_status='queued',updated_at=? WHERE id=?").run(now(), current.feedback_id);
        }
      });
    } catch (error) {
      if (error && error.message === 'ATTACHMENT_STATE_CONFLICT') {
        const latest = this.db.prepare('SELECT status,feedback_id FROM feedback_attachments WHERE id=?').get(attachmentId);
        const latestNotice = latest && this.db.prepare('SELECT revision,reason,status FROM feedback_notifications WHERE feedback_id=?').get(latest.feedback_id);
        if (latest && latest.status === status) {
          return { ok: true, status, idempotent: true, revision: latestNotice && latestNotice.revision || 1, notificationStatus: latestNotice && latestNotice.status || '' };
        }
        return { ok: false, error: 'ATTACHMENT_STATE_CONFLICT', status: latest && latest.status || 'missing' };
      }
      throw error;
    }
    this.audit(admin.user_id, 'feedback_attachment_reviewed', null, `${attachmentId}:${status}${revision ? `:revision=${revision}` : ''}`);
    if (status !== 'ready') return { ok: true, status, revision: 0 };
    const resend = await this.deliverFeedbackNotification(current.feedback_id, { expectedRevision: revision });
    return {
      ok: true,
      status,
      revision,
      notificationReason: reason,
      resent: !!resend.mailDelivered,
      mailStatus: resend.mailStatus,
      smtp: resend.smtp || null,
      error: resend.error || '',
      externalState: resend.externalState || '',
    };
  }

  async finalizeFeedback(token, feedbackId) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const feedback = this.db.prepare('SELECT id,user_id,processing_status FROM feedbacks WHERE id=?').get(safeText(feedbackId, 100));
    if (!feedback || (feedback.user_id !== session.user_id && session.role !== 'admin')) return { ok: false, error: 'FEEDBACK_NOT_FOUND' };
    if (feedback.processing_status === 'draft') return { ok: false, error: 'FEEDBACK_NOT_SUBMITTED' };
    return this.deliverFeedbackNotification(feedback.id);
  }

  async deliverFeedbackNotification(feedbackId, options = {}) {
    const feedback = this.db.prepare(`SELECT f.*,u.id AS lf_user_id,u.nickname,u.account FROM feedbacks f JOIN users u ON u.id=f.user_id WHERE f.id=?`).get(safeText(feedbackId, 100));
    if (!feedback) return { ok: false, error: 'FEEDBACK_NOT_FOUND' };
    if (feedback.processing_status === 'draft') return { ok: false, error: 'FEEDBACK_NOT_SUBMITTED' };
    let notification = this.db.prepare('SELECT * FROM feedback_notifications WHERE feedback_id=?').get(feedback.id);
    if (!notification) return { ok: false, error: 'NOTIFICATION_NOT_FOUND' };
    const expectedRevision = Number(options.expectedRevision || 0);
    if (expectedRevision && Number(notification.revision) !== expectedRevision) {
      return { ok: true, databaseSaved: true, mailDelivered: false, mailStatus: notification.status, superseded: true, revision: notification.revision };
    }
    if (notification.status === 'delivered') {
      return {
        ok: true, databaseSaved: true, mailDelivered: true, mailStatus: 'delivered',
        alreadyDelivered: true, revision: notification.revision,
        smtp: {
          messageId: notification.last_message_id || '',
          accepted: storedStringArray(notification.last_accepted),
          rejected: storedStringArray(notification.last_rejected),
          response: notification.last_response || '',
        },
      };
    }
    if (notification.status === 'sending') return { ok: true, databaseSaved: true, mailDelivered: false, mailStatus: 'sending', busy: true, revision: notification.revision };
    const attemptAt = now();
    const attempts = Number(notification.attempts || 0) + 1;
    const attemptId = id('notice-attempt');
    const claimed = this.transaction(() => {
      const changed = this.db.prepare(`UPDATE feedback_notifications SET status='sending',attempts=?,last_attempt_at=?
        WHERE id=? AND revision=? AND status IN ('queued','retry')`).run(attempts, attemptAt, notification.id, notification.revision);
      if (changed.changes !== 1) return false;
      this.db.prepare(`INSERT INTO feedback_notification_attempts
        (id,notification_id,feedback_id,revision,attempt_number,reason,status,created_at)
        VALUES(?,?,?,?,?,?,'sending',?)`).run(attemptId, notification.id, feedback.id, notification.revision, attempts, notification.reason || 'retry', attemptAt);
      return true;
    });
    if (!claimed) return { ok: true, databaseSaved: true, mailDelivered: false, mailStatus: 'sending', busy: true, revision: notification.revision };
    const allAttachments = this.db.prepare("SELECT * FROM feedback_attachments WHERE feedback_id=? ORDER BY created_at").all(feedback.id);
    const attachments = allAttachments.filter(item => item.status === 'ready');
    const attachmentSummary = {
      total: allAttachments.length,
      ready: attachments.length,
      quarantined: allAttachments.filter(item => item.status === 'quarantined').length,
      rejected: allAttachments.filter(item => item.status === 'rejected').length,
    };
    const publicBase = safeText(this.env.LF_PUBLIC_API_URL, 500).replace(/\/+$/, '');
    let validPublicBase = '';
    try {
      const parsed = new URL(publicBase);
      if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password) {
        validPublicBase = parsed.href.replace(/\/+$/, '');
      }
    } catch (_) {}
    const links = [];
    if (validPublicBase) {
      attachments.forEach((attachment) => {
        const grant = this.issueFeedbackDownloadGrant(attachment.id, '', attemptId, notification.revision);
        if (grant.ok) links.push({ name: attachment.file_name, expiresAt: grant.expiresAt, url: `${validPublicBase}/v1/admin/feedback-download?attachment=${encodeURIComponent(attachment.id)}&grant=${encodeURIComponent(grant.grant)}` });
      });
    }
    const service = this.verificationServices.email;
    let delivery;
    try {
      delivery = attachments.length && links.length !== attachments.length
        ? { ok: false, error: 'PUBLIC_DOWNLOAD_URL_UNAVAILABLE' }
        : service && typeof service.sendFeedbackNotification === 'function'
          ? await service.sendFeedbackNotification({ to: this.env.LF_FEEDBACK_NOTIFY_TO || '3599284614@qq.com', feedbackId: feedback.id, userId: feedback.lf_user_id, contact: feedback.contact, content: feedback.content, clientVersion: feedback.client_version || this.appVersion, deviceInfo: feedback.device_info, links, attachmentSummary })
          : { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE' };
    } catch (sendError) {
      delivery = { ok: false, error: 'EMAIL_SEND_FAILED', providerError: safeText(sendError && sendError.code, 80) || 'SMTP_SEND_FAILED' };
    }
    if (!delivery || typeof delivery !== 'object') delivery = { ok: false, error: 'EMAIL_SEND_FAILED' };
    const completedAt = now();
    const smtp = {
      messageId: safeText(delivery.messageId, 240),
      accepted: Array.isArray(delivery.accepted) ? delivery.accepted.map(item => safeText(item, 240)).filter(Boolean) : [],
      rejected: Array.isArray(delivery.rejected) ? delivery.rejected.map(item => safeText(item, 240)).filter(Boolean) : [],
      response: safeText(delivery.response, 500),
    };
    const error = delivery.ok ? '' : safeText(delivery.error || delivery.providerError, 100) || 'EMAIL_SEND_FAILED';
    const finalState = this.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM feedback_notifications WHERE id=?').get(notification.id);
      if (!current || Number(current.revision) !== Number(notification.revision)) {
        this.db.prepare("UPDATE feedback_notification_attempts SET status='superseded',error='REVISION_SUPERSEDED',message_id=?,accepted=?,rejected=?,response=?,completed_at=? WHERE id=?")
          .run(smtp.messageId, JSON.stringify(smtp.accepted), JSON.stringify(smtp.rejected), smtp.response, completedAt, attemptId);
        this.db.prepare('DELETE FROM feedback_download_grants WHERE attempt_id=?').run(attemptId);
        return 'superseded';
      }
      if (delivery.ok) {
        this.db.prepare(`UPDATE feedback_notifications SET status='delivered',last_error='',delivered_at=?,
          last_message_id=?,last_accepted=?,last_rejected=?,last_response=? WHERE id=?`)
          .run(completedAt, smtp.messageId, JSON.stringify(smtp.accepted), JSON.stringify(smtp.rejected), smtp.response, notification.id);
        this.db.prepare("UPDATE feedback_notification_attempts SET status='delivered',message_id=?,accepted=?,rejected=?,response=?,completed_at=? WHERE id=?")
          .run(smtp.messageId, JSON.stringify(smtp.accepted), JSON.stringify(smtp.rejected), smtp.response, completedAt, attemptId);
        this.db.prepare("UPDATE feedbacks SET mail_status='delivered',mail_error='',delivered_at=?,delivery_status='delivered',updated_at=? WHERE id=?").run(completedAt, completedAt, feedback.id);
        return 'delivered';
      }
      const delay = Math.min(24 * 60 * 60 * 1000, 60000 * Math.pow(2, Math.min(attempts, 8)));
      this.db.prepare(`UPDATE feedback_notifications SET status='retry',last_error=?,next_attempt_at=?,
        last_message_id=?,last_accepted=?,last_rejected=?,last_response=? WHERE id=?`)
        .run(error, completedAt + delay, smtp.messageId, JSON.stringify(smtp.accepted), JSON.stringify(smtp.rejected), smtp.response, notification.id);
      this.db.prepare("UPDATE feedback_notification_attempts SET status='retry',error=?,message_id=?,accepted=?,rejected=?,response=?,completed_at=? WHERE id=?")
        .run(error, smtp.messageId, JSON.stringify(smtp.accepted), JSON.stringify(smtp.rejected), smtp.response, completedAt, attemptId);
      this.db.prepare('DELETE FROM feedback_download_grants WHERE attempt_id=?').run(attemptId);
      this.db.prepare("UPDATE feedbacks SET mail_status='retry',mail_error=?,updated_at=? WHERE id=?").run(error, completedAt, feedback.id);
      return 'retry';
    });
    const blocked = ['EMAIL_SERVICE_UNAVAILABLE','PUBLIC_DOWNLOAD_URL_UNAVAILABLE'].includes(error);
    return {
      ok: true,
      databaseSaved: true,
      mailDelivered: finalState === 'delivered',
      mailStatus: finalState,
      revision: notification.revision,
      notificationReason: notification.reason,
      downloadLinksConfigured: !!validPublicBase,
      attachments: allAttachments.length,
      attachmentSummary,
      smtp,
      error,
      externalState: blocked ? 'BLOCKED_EXTERNAL_CONFIG' : '',
    };
  }

  async retryFeedbackNotifications(limit = 10) {
    const due = this.db.prepare("SELECT feedback_id FROM feedback_notifications WHERE status IN ('queued','retry') AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT ?").all(now(), Math.max(1, Math.min(50, Number(limit) || 10)));
    const results = [];
    for (const item of due) results.push(await this.deliverFeedbackNotification(item.feedback_id));
    return { ok: true, processed: results.length, delivered: results.filter(item => item.mailDelivered).length };
  }

  async adminRetryFeedbackNotifications(token, limit = 20) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN', message: '只有管理员能重试通知邮件。' };
    const result = await this.retryFeedbackNotifications(limit);
    this.audit(admin.user_id, 'feedback_notifications_retried', null, `processed=${result.processed};delivered=${result.delivered}`);
    return result;
  }

  loginServiceTestState(service) {
    const row = this.db.prepare('SELECT value FROM system_meta WHERE key=?').get(`login_service_test_${service}`);
    if (!row) return { action: '', status: 'never', testedAt: null, error: '', validationStatus: 'never', validationTestedAt: null, deliveryStatus: 'never', deliveryTestedAt: null };
    try {
      const parsed = JSON.parse(row.value);
      const status = value => ['passed','failed','started'].includes(value) ? value : 'never';
      return {
        action: safeText(parsed.action, 30), status: status(parsed.status), testedAt: Number(parsed.testedAt) || null, error: maskedServiceError(parsed.error),
        validationStatus: status(parsed.validationStatus), validationTestedAt: Number(parsed.validationTestedAt) || null,
        deliveryStatus: status(parsed.deliveryStatus), deliveryTestedAt: Number(parsed.deliveryTestedAt) || null,
      };
    } catch (_) { return { action: '', status: 'never', testedAt: null, error: '', validationStatus: 'never', validationTestedAt: null, deliveryStatus: 'never', deliveryTestedAt: null }; }
  }

  recordLoginServiceTest(service, action, passed, error, testedAt = now(), statusOverride = '') {
    const previous = this.loginServiceTestState(service);
    const status = statusOverride || (passed ? 'passed' : 'failed');
    const state = { ...previous, action: safeText(action, 30), status, testedAt, error: maskedServiceError(error) };
    if (action === 'validate') { state.validationStatus = status; state.validationTestedAt = testedAt; }
    if (action === 'send-test') { state.deliveryStatus = status; state.deliveryTestedAt = testedAt; }
    this.db.prepare(`INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(`login_service_test_${service}`, JSON.stringify(state), testedAt);
    return state;
  }

  loginServicesStatus() {
    const mailConfig = this.verificationServices.email && this.verificationServices.email.configuration
      ? this.verificationServices.email.configuration() : { configured: false, missing: ['LF_MAIL_HOST'] };
    return {
      email: {
        provider: 'smtp', configured: !!mailConfig.configured,
        configurationStatus: mailConfig.configured ? 'configured' : 'blocked',
        account: maskedEmail(this.env.LF_MAIL_USER || this.env.LF_MAIL_FROM),
        credential: this.env.LF_MAIL_PASSWORD ? '已配置（隐藏）' : this.env.LF_MAIL_ALLOW_NO_AUTH === '1' ? '无需认证' : '未配置',
        missing: Array.isArray(mailConfig.missing) ? mailConfig.missing.map(item => safeText(item, 60)) : [],
        lastTest: this.loginServiceTestState('email'),
      },
    };
  }

  adminLoginServices(token) {
    if (!this.requireAdmin(token)) return { ok: false, error: 'FORBIDDEN' };
    return { ok: true, services: this.loginServicesStatus() };
  }

  async testLoginService(token, input = {}) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    const serviceName = safeText(input.service, 20).toLowerCase();
    const action = safeText(input.action, 30).toLowerCase();
    if (['wechat','qq'].includes(serviceName)) return { ok: false, error: 'FEATURE_REMOVED', service: serviceName, message: 'LF 账号仅支持邮箱登录。' };
    if (serviceName !== 'email') return { ok: false, error: 'UNKNOWN_SERVICE' };
    if (serviceName === 'email') {
      const service = this.verificationServices.email;
      const config = service && service.configuration ? service.configuration() : { configured: false, missing: [] };
      if (action === 'validate') {
        const state = this.recordLoginServiceTest('email', action, !!config.configured, config.configured ? '' : 'EMAIL_SERVICE_UNAVAILABLE');
        this.audit(admin.user_id, 'login_service_validated', null, `email:${state.status}`);
        return config.configured ? { ok: true, service: 'email', action, testedAt: state.testedAt, message: 'SMTP 必填配置完整。' }
          : { ok: false, service: 'email', action, testedAt: state.testedAt, error: 'EMAIL_SERVICE_UNAVAILABLE', missing: config.missing || [] };
      }
      if (action !== 'send-test') return { ok: false, error: 'UNKNOWN_TEST_ACTION' };
      const previous = this.loginServiceTestState('email');
      if (previous.deliveryTestedAt && now() - previous.deliveryTestedAt < 60000) return { ok: false, error: 'RATE_LIMITED', retryAfter: 60 };
      const identity = this.db.prepare("SELECT normalized_value FROM user_identities WHERE user_id=? AND identity_type='email' ORDER BY created_at LIMIT 1").get(admin.user_id);
      if (!identity) return { ok: false, error: 'ADMIN_EMAIL_REQUIRED', message: '管理员账号没有可用于测试投递的邮箱。' };
      const delivery = service && service.sendCode ? await service.sendCode(identity.normalized_value, String(crypto.randomInt(100000, 1000000)), 'service_test') : { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE' };
      const state = this.recordLoginServiceTest('email', action, !!delivery.ok, delivery.error || delivery.providerError);
      this.audit(admin.user_id, 'login_service_test_completed', null, `email:${state.status}`);
      return delivery.ok
        ? { ok: true, service: 'email', action, delivered: true, recipient: maskedEmail(identity.normalized_value), testedAt: state.testedAt, message: '测试邮件已真实投递。' }
        : { ok: false, service: 'email', action, delivered: false, error: maskedServiceError(delivery.error || delivery.providerError) || 'EMAIL_SEND_FAILED', testedAt: state.testedAt };
    }
    if (!['validate','test-login'].includes(action)) return { ok: false, error: 'UNKNOWN_TEST_ACTION' };
    const stateResult = this.oauthProviders.createState(serviceName);
    if (!stateResult.ok) {
      const state = this.recordLoginServiceTest(serviceName, action, false, stateResult.error || 'BLOCKED_EXTERNAL_CONFIG');
      this.audit(admin.user_id, 'login_service_validated', null, `${serviceName}:failed`);
      return { ok: false, service: serviceName, action, error: stateResult.error || 'BLOCKED_EXTERNAL_CONFIG', missing: stateResult.missing || [], testedAt: state.testedAt };
    }
    const stateValue = stateResult.state;
    const authorization = this.oauthProviders.authorizationUrl(serviceName, stateValue);
    if (!authorization.ok) {
      const state = this.recordLoginServiceTest(serviceName, action, false, authorization.error || 'BLOCKED_EXTERNAL_CONFIG');
      this.audit(admin.user_id, 'login_service_validated', null, `${serviceName}:failed`);
      return { ok: false, service: serviceName, action, error: authorization.error || 'BLOCKED_EXTERNAL_CONFIG', missing: authorization.missing || [], testedAt: state.testedAt };
    }
    if (action === 'validate') {
      const state = this.recordLoginServiceTest(serviceName, action, true, '');
      this.audit(admin.user_id, 'login_service_validated', null, `${serviceName}:passed`);
      return { ok: true, service: serviceName, action, testedAt: state.testedAt, message: '配置格式与官方授权地址校验通过。' };
    }
    const createdAt = now();
    const pollToken = randomToken(24);
    this.db.prepare(`INSERT INTO oauth_states
      (id,provider,state_hash,status,created_at,expires_at,poll_token_hash,intent,request_user_id,redirect_uri)
      VALUES(?,?,?,'pending',?,?,?,?,?,?)`)
      .run(id('oauth'), serviceName, hash(stateValue), createdAt, createdAt + 10 * 60 * 1000, hash(pollToken), 'test', admin.user_id, authorization.redirectUri || '');
    this.recordLoginServiceTest(serviceName, action, false, '', createdAt, 'started');
    this.audit(admin.user_id, 'login_service_test_started', null, serviceName);
    return { ok: true, service: serviceName, action, launchUrl: authorization.authorizationUrl, testedAt: createdAt, status: 'started', message: '已发起官方测试登录；测试不会创建或绑定账号。' };
  }

  adminDashboard(token) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN', message: '只有管理员能进入 LF 后台监控。' };
    const cutoff = now() - 2 * 60 * 1000;
    this.db.prepare('UPDATE user_sessions SET online=0 WHERE last_active_at<?').run(cutoff);
    const stats = {
      totalUsers: this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      onlineUsers: this.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions WHERE online=1 AND revoked_at IS NULL AND last_active_at>=?').get(cutoff).n,
      todayActiveUsers: this.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions WHERE last_active_at>=?').get(new Date().setHours(0,0,0,0)).n,
      pcOnline: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions WHERE online=1 AND device_type='pc' AND revoked_at IS NULL AND last_active_at>=?").get(cutoff).n,
      mobileOnline: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions WHERE online=1 AND device_type='mobile' AND revoked_at IS NULL AND last_active_at>=?").get(cutoff).n,
      blacklistedUsers: this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE blacklisted=1').get().n,
      developerUsers: this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE developer_permission=1').get().n,
      queuedFeedback: this.db.prepare("SELECT COUNT(*) AS n FROM feedbacks WHERE processing_status='new'").get().n,
      mailRetryQueue: this.db.prepare("SELECT COUNT(*) AS n FROM feedback_notifications WHERE status='retry'").get().n,
    };
    const users = this.db.prepare(`SELECT u.id,u.nickname,u.account,u.account_type,u.avatar,u.role,u.developer_permission,u.blacklisted,u.created_at,u.updated_at,
      s.device_type,s.device_name,s.app_version,s.login_method,s.location,s.location_authorized,s.created_at AS login_at,s.last_active_at,s.online,
      ie.state AS integrity_state,ie.warning_issued_at,ie.warning_ack_at,ie.updated_at AS integrity_updated_at
      FROM users u LEFT JOIN user_sessions s ON s.id=(SELECT id FROM user_sessions x WHERE x.user_id=u.id ORDER BY x.last_active_at DESC LIMIT 1)
      LEFT JOIN integrity_enforcement ie ON ie.user_id=u.id
      ORDER BY COALESCE(s.last_active_at,u.created_at) DESC`).all().map(row => ({
        id: row.id, nickname: row.nickname, account: row.account, accountType: row.account_type, avatar: row.avatar,
        role: row.role, developerPermission: !!row.developer_permission, blacklisted: !!row.blacklisted,
        createdAt: row.created_at, deviceType: row.device_type || '未知', deviceName: row.device_name || '未知',
        appVersion: row.app_version || '未知', loginMethod: row.login_method || row.account_type,
        location: row.location || '未知', locationAuthorized: !!row.location_authorized, loginAt: row.login_at || null,
        lastActiveAt: row.last_active_at || null, online: !!row.online && Number(row.last_active_at || 0) >= cutoff,
        integrityState: row.integrity_state || 'clean',
        abnormalBehavior: ['warned_pending_ack', 'warned', 'blocked'].includes(row.integrity_state),
        integrityWarningIssuedAt: row.warning_issued_at || null,
        integrityWarningAckAt: row.warning_ack_at || null,
        integrityUpdatedAt: row.integrity_updated_at || null,
      }));
    const feedbacks = this.db.prepare(`SELECT f.*,u.nickname,u.account,
      n.revision AS notification_revision,n.reason AS notification_reason,n.status AS notification_status,
      n.attempts AS notification_attempts,n.last_message_id AS smtp_message_id,
      n.last_accepted AS smtp_accepted,n.last_rejected AS smtp_rejected,n.last_response AS smtp_response,
      n.last_attempt_at AS smtp_attempted_at
      FROM feedbacks f JOIN users u ON u.id=f.user_id
      LEFT JOIN feedback_notifications n ON n.feedback_id=f.id
      WHERE f.processing_status<>'draft' ORDER BY f.created_at DESC LIMIT 100`).all().map(feedback => ({
        ...feedback,
        notificationRevision: Number(feedback.notification_revision || 1),
        notificationReason: feedback.notification_reason || 'initial_submission',
        notificationStatus: feedback.notification_status || feedback.mail_status || 'queued',
        notificationAttempts: Number(feedback.notification_attempts || 0),
        smtpMessageId: feedback.smtp_message_id || '',
        smtpAccepted: storedStringArray(feedback.smtp_accepted),
        smtpRejected: storedStringArray(feedback.smtp_rejected),
        smtpResponse: feedback.smtp_response || '',
        smtpAttemptedAt: feedback.smtp_attempted_at || null,
        attachments: this.db.prepare(`SELECT id,file_name,mime,size,sha256,status,created_at,completed_at
          FROM feedback_attachments WHERE feedback_id=? ORDER BY created_at`).all(feedback.id),
      }));
    const releases = this.db.prepare('SELECT * FROM update_releases ORDER BY created_at DESC LIMIT 50').all();
    const securityEvents = this.db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'developer_%' OR action LIKE 'security_%' OR action LIKE 'login_service_%' OR action LIKE 'oauth_admin_%' ORDER BY created_at DESC LIMIT 100").all();
    this.audit(admin.user_id, 'admin_dashboard_viewed', null, '');
    return { ok: true, stats, users, feedbacks, releases, securityEvents, loginServices: this.loginServicesStatus(), refreshedAt: now(), appVersion: this.appVersion };
  }

  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = callback();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  ensureIntegrityEnforcement(userId, at = now()) {
    this.db.prepare(`INSERT INTO integrity_enforcement(user_id,state,generation,updated_at)
      VALUES(?,'clean',0,?) ON CONFLICT(user_id) DO NOTHING`).run(userId, at);
    return this.db.prepare('SELECT * FROM integrity_enforcement WHERE user_id=?').get(userId);
  }

  activeIntegrityUpdateWindow(userId, deviceId, at = now()) {
    this.db.prepare("UPDATE integrity_update_windows SET state='expired' WHERE state='active' AND expires_at<=?").run(at);
    return this.db.prepare(`SELECT * FROM integrity_update_windows
      WHERE user_id=? AND device_id=? AND state='active' AND expires_at>? ORDER BY started_at DESC LIMIT 1`)
      .get(userId, deviceId, at);
  }

  validateIntegrityEvent(input = {}) {
    const allowed = new Set([
      'deviceId', 'manifestId', 'appVersion', 'changedFileId', 'fileId', 'path', 'relativePath',
      'expectedHash', 'actualHash', 'eventType', 'timestamp', 'observedAt', 'confirmed',
    ]);
    const unexpected = Object.keys(input || {}).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'INTEGRITY_FIELD_REJECTED', field: unexpected };
    const deviceId = validIntegrityId(input.deviceId);
    const manifestId = validIntegrityId(input.manifestId);
    const appVersion = safeText(input.appVersion, 40);
    const fileId = safeText(input.changedFileId || input.fileId, 80);
    const relativePath = normalizedIntegrityPath(input.path || input.relativePath);
    const expectedPath = INTEGRITY_FILE_ALLOWLIST.get(fileId);
    const dynamicEventTypes = INTEGRITY_DYNAMIC_FILE_RULES.get(fileId);
    const eventType = safeText(input.eventType, 40).toLowerCase();
    const expectedHash = validIntegrityHash(input.expectedHash);
    const actualHash = validIntegrityHash(input.actualHash, eventType === 'file_missing');
    const observedAt = Number(input.timestamp == null ? input.observedAt : input.timestamp);
    const receivedAt = now();
    if (!deviceId) return { ok: false, error: 'INVALID_DEVICE_ID' };
    if (!manifestId) return { ok: false, error: 'INVALID_MANIFEST_ID' };
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) return { ok: false, error: 'INVALID_APP_VERSION' };
    if (dynamicEventTypes) {
      if (!dynamicEventTypes.has(eventType)) return { ok: false, error: 'INTEGRITY_EVENT_TYPE_REJECTED' };
      if (!relativePath || !INTEGRITY_INSTALL_MODULE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
        return { ok: false, error: 'INTEGRITY_PATH_NOT_ALLOWED' };
      }
    } else if (!expectedPath || relativePath !== expectedPath) {
      return { ok: false, error: 'INTEGRITY_PATH_NOT_ALLOWED' };
    }
    if (!INTEGRITY_EVENT_TYPES.has(eventType)) return { ok: false, error: 'INTEGRITY_EVENT_TYPE_REJECTED' };
    if (!expectedHash || !actualHash) return { ok: false, error: 'INVALID_INTEGRITY_HASH' };
    if (eventType === 'file_missing' && actualHash !== 'missing') return { ok: false, error: 'INVALID_MISSING_FILE_EVIDENCE' };
    if (eventType !== 'file_missing' && actualHash === 'missing') return { ok: false, error: 'INVALID_INTEGRITY_HASH' };
    if (eventType === 'hash_mismatch' && expectedHash === actualHash) return { ok: false, error: 'INTEGRITY_HASH_NOT_CHANGED' };
    if (!Number.isSafeInteger(observedAt) || observedAt < receivedAt - 30 * 24 * 60 * 60 * 1000 || observedAt > receivedAt + 5 * 60 * 1000) {
      return { ok: false, error: 'INVALID_INTEGRITY_TIMESTAMP' };
    }
    const evidenceKey = hash([manifestId, fileId, expectedHash, actualHash, eventType].join('|'));
    return {
      ok: true,
      deviceId,
      manifestId,
      appVersion,
      fileId,
      relativePath,
      expectedHash,
      actualHash,
      eventType,
      evidenceKey,
      observedAt,
      receivedAt,
      confirmed: input.confirmed === true,
    };
  }

  integrityStatus(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const allowed = new Set(['deviceId']);
    const unexpected = Object.keys(input || {}).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'INTEGRITY_FIELD_REJECTED', field: unexpected };
    const deviceId = input.deviceId == null || input.deviceId === '' ? '' : validIntegrityId(input.deviceId);
    if (input.deviceId && !deviceId) return { ok: false, error: 'INVALID_DEVICE_ID' };
    const enforcement = this.ensureIntegrityEnforcement(session.user_id);
    const updateWindow = deviceId ? this.activeIntegrityUpdateWindow(session.user_id, deviceId) : null;
    return {
      ok: true,
      developerPermission: !!session.developer_permission || session.role === 'admin',
      blacklisted: !!session.blacklisted,
      state: enforcement.state,
      generation: Number(enforcement.generation || 0),
      firstEventId: enforcement.first_event_id || '',
      warningIssuedAt: enforcement.warning_issued_at || null,
      warningAckAt: enforcement.warning_ack_at || null,
      updateWindow: updateWindow ? {
        id: updateWindow.id,
        fromVersion: updateWindow.from_version,
        toVersion: updateWindow.to_version,
        targetManifestId: updateWindow.target_manifest_id,
        expiresAt: updateWindow.expires_at,
      } : null,
      warning: enforcement.state === 'warned_pending_ack' || enforcement.state === 'warned'
        ? { message: DEV_WARNING, contact: DEV_CONTACT, requiresAcknowledgement: enforcement.state === 'warned_pending_ack' }
        : null,
    };
  }

  reportIntegrityEvent(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const event = this.validateIntegrityEvent(input);
    if (!event.ok) return event;
    let eventId = id('integrity');
    return this.transaction(() => {
      const duplicate = this.db.prepare(`SELECT id,disposition,confirmed FROM integrity_events
        WHERE user_id=? AND device_id=? AND evidence_key=?`).get(session.user_id, event.deviceId, event.evidenceKey);
      const enforcement = this.ensureIntegrityEnforcement(session.user_id, event.receivedAt);
      const activeUpdate = this.activeIntegrityUpdateWindow(session.user_id, event.deviceId, event.receivedAt);
      const activeUpdateMatches = !!(activeUpdate
        && activeUpdate.source_manifest_id === event.manifestId
        && activeUpdate.from_version === event.appVersion);
      const developerAllowed = !!session.developer_permission || session.role === 'admin';
      const recheckSuppressed = !!(duplicate && duplicate.disposition === 'suppressed_update' && event.confirmed && !activeUpdateMatches);
      const confirmPending = !!(duplicate && duplicate.disposition === 'pending' && event.confirmed && !activeUpdateMatches);
      const recheckRevokedPermission = !!(duplicate && duplicate.disposition === 'authorized_development'
        && event.confirmed && !developerAllowed && !activeUpdateMatches);
      const recheck = recheckSuppressed || confirmPending || recheckRevokedPermission;
      if (duplicate && !recheck) {
        return {
          ok: true,
          duplicate: true,
          eventId: duplicate.id,
          disposition: duplicate.disposition,
          state: enforcement.state,
          warning: enforcement.state === 'warned_pending_ack' || enforcement.state === 'warned'
            ? { message: DEV_WARNING, contact: DEV_CONTACT, requiresAcknowledgement: enforcement.state === 'warned_pending_ack' }
            : null,
        };
      }
      if (duplicate) eventId = duplicate.id;

      let disposition = 'pending';
      let nextState = enforcement.state;
      if (developerAllowed) {
        disposition = 'authorized_development';
      } else if (!event.confirmed) {
        disposition = 'pending';
      } else if (activeUpdateMatches) {
        disposition = 'suppressed_update';
      } else if (enforcement.state === 'clean') {
        disposition = 'warned';
        nextState = 'warned_pending_ack';
      } else if (enforcement.state === 'warned_pending_ack') {
        disposition = 'pending_ack';
      } else if (enforcement.state === 'warned') {
        disposition = event.receivedAt > Number(enforcement.warning_ack_at || 0) ? 'blocked' : 'pre_ack';
        if (disposition === 'blocked') nextState = 'blocked';
      } else if (enforcement.state === 'blocked') {
        disposition = 'blocked_existing';
      }

      if (recheck) {
        this.db.prepare(`UPDATE integrity_events SET manifest_id=?,app_version=?,confirmed=1,disposition=?,
          observed_at=?,received_at=? WHERE id=?`)
          .run(event.manifestId, event.appVersion, disposition, event.observedAt, event.receivedAt, eventId);
      } else {
        this.db.prepare(`INSERT INTO integrity_events
          (id,user_id,device_id,manifest_id,app_version,file_id,relative_path,expected_hash,actual_hash,event_type,
            evidence_key,confirmed,disposition,observed_at,received_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(eventId, session.user_id, event.deviceId, event.manifestId, event.appVersion, event.fileId,
            event.relativePath, event.expectedHash, event.actualHash, event.eventType, event.evidenceKey,
            event.confirmed ? 1 : 0, disposition, event.observedAt, event.receivedAt);
      }

      if (disposition === 'warned') {
        this.db.prepare(`UPDATE integrity_enforcement SET state='warned_pending_ack',first_event_id=?,
          warning_issued_at=?,warning_ack_at=NULL,blocked_event_id=NULL,updated_at=? WHERE user_id=?`)
          .run(eventId, event.receivedAt, event.receivedAt, session.user_id);
        this.audit(session.user_id, 'security_integrity_warning', session.user_id, `${event.deviceId}:${event.fileId}:${event.eventType}`);
      } else if (disposition === 'blocked' && enforcement.state !== 'blocked') {
        this.db.prepare("UPDATE users SET blacklisted=1,status='blocked',updated_at=? WHERE id=?").run(event.receivedAt, session.user_id);
        this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=? AND revoked_at IS NULL').run(event.receivedAt, session.user_id);
        this.db.prepare(`INSERT INTO ban_records(id,user_id,active,reason,changed_by,created_at)
          VALUES(?,?,1,?,'integrity-system',?)`)
          .run(id('ban'), session.user_id, '警告确认后继续发生新的 LF 核心完整性篡改', event.receivedAt);
        this.db.prepare(`UPDATE integrity_enforcement SET state='blocked',blocked_event_id=?,updated_at=? WHERE user_id=?`)
          .run(eventId, event.receivedAt, session.user_id);
        this.audit(null, 'security_integrity_auto_blocked', session.user_id, `${event.deviceId}:${event.fileId}:${event.eventType}`);
      }

      return {
        ok: true,
        duplicate: false,
        rechecked: recheck,
        eventId,
        disposition,
        state: nextState,
        blocked: nextState === 'blocked',
        developerAllowed,
        updateSuppressed: disposition === 'suppressed_update',
        warning: nextState === 'warned_pending_ack' || nextState === 'warned'
          ? { message: DEV_WARNING, contact: DEV_CONTACT, requiresAcknowledgement: nextState === 'warned_pending_ack' }
          : null,
      };
    });
  }

  ackIntegrityWarning(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const allowed = new Set(['deviceId', 'eventId', 'generation']);
    const unexpected = Object.keys(input || {}).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'INTEGRITY_FIELD_REJECTED', field: unexpected };
    const deviceId = validIntegrityId(input.deviceId);
    const eventId = safeText(input.eventId, 100);
    if (!deviceId || !eventId) return { ok: false, error: 'INVALID_WARNING_ACK' };
    return this.transaction(() => {
      const enforcement = this.ensureIntegrityEnforcement(session.user_id);
      if (Number.isFinite(Number(input.generation)) && Number(input.generation) !== Number(enforcement.generation || 0)) {
        return { ok: false, error: 'STALE_WARNING_GENERATION' };
      }
      if (enforcement.state === 'warned' && enforcement.first_event_id === eventId) {
        return { ok: true, acknowledged: true, duplicate: true, state: 'warned', warningAckAt: enforcement.warning_ack_at };
      }
      if (enforcement.state !== 'warned_pending_ack' || enforcement.first_event_id !== eventId) {
        return { ok: false, error: 'WARNING_NOT_PENDING' };
      }
      const event = this.db.prepare(`SELECT id FROM integrity_events
        WHERE id=? AND user_id=? AND device_id=? AND disposition='warned'`).get(eventId, session.user_id, deviceId);
      if (!event) return { ok: false, error: 'WARNING_EVENT_NOT_FOUND' };
      const acknowledgedAt = now();
      this.db.prepare("UPDATE integrity_enforcement SET state='warned',warning_ack_at=?,updated_at=? WHERE user_id=?")
        .run(acknowledgedAt, acknowledgedAt, session.user_id);
      this.audit(session.user_id, 'security_integrity_warning_acknowledged', session.user_id, `${deviceId}:${eventId}`);
      return { ok: true, acknowledged: true, duplicate: false, state: 'warned', warningAckAt: acknowledgedAt };
    });
  }

  startIntegrityUpdateWindow(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'INVALID_UPDATE_WINDOW' };
    const allowed = new Set(['deviceId', 'releaseId', 'fromVersion', 'toVersion', 'sourceManifestId', 'targetManifestId']);
    const unexpected = Object.keys(input || {}).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'INTEGRITY_FIELD_REJECTED', field: unexpected };
    const deviceId = validIntegrityId(input.deviceId);
    const releaseId = safeText(input.releaseId, 100);
    const fromVersion = safeText(input.fromVersion, 40);
    const toVersion = safeText(input.toVersion, 40);
    const sourceManifestId = validIntegrityHash(input.sourceManifestId);
    const requestedTargetManifestId = validIntegrityHash(input.targetManifestId);
    if (!deviceId || !releaseId || !sourceManifestId || !requestedTargetManifestId
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(fromVersion)
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(toVersion)) {
      return { ok: false, error: 'INVALID_UPDATE_WINDOW' };
    }
    const release = this.db.prepare("SELECT * FROM update_releases WHERE (id=? OR version=?) AND status='published'").get(releaseId, releaseId);
    if (!release || release.version !== toVersion) return { ok: false, error: 'UNVERIFIED_UPDATE_RELEASE' };
    const verified = this.verifyRelease(release, false);
    if (!verified.ok) return verified;
    const targetManifestId = validIntegrityHash(release.package_sha256);
    if (!targetManifestId || requestedTargetManifestId !== targetManifestId) {
      return { ok: false, error: 'UPDATE_TARGET_MISMATCH' };
    }
    const createdAt = now();
    return this.transaction(() => {
      const existing = this.db.prepare(`SELECT * FROM integrity_update_windows
        WHERE user_id=? AND device_id=? AND release_id=?`).get(session.user_id, deviceId, release.id);
      if (existing && existing.state === 'completed') {
        return { ok: false, error: 'UPDATE_WINDOW_REOPEN_DENIED', state: 'completed' };
      }
      if (existing && existing.state === 'active' && existing.expires_at > createdAt) {
        const sameTarget = existing.from_version === fromVersion
          && existing.to_version === toVersion
          && existing.source_manifest_id === sourceManifestId
          && existing.target_manifest_id === targetManifestId;
        if (!sameTarget) return { ok: false, error: 'UPDATE_WINDOW_CONFLICT' };
        return { ok: true, id: existing.id, state: 'active', duplicate: true, expiresAt: existing.expires_at };
      }
      if (existing) {
        if (existing.state === 'active') {
          this.db.prepare("UPDATE integrity_update_windows SET state='expired' WHERE id=?").run(existing.id);
        }
        return { ok: false, error: 'UPDATE_WINDOW_REOPEN_DENIED', state: 'expired' };
      }
      const windowId = id('integrity_update');
      const expiresAt = createdAt + INTEGRITY_UPDATE_WINDOW_MS;
      this.db.prepare(`INSERT INTO integrity_update_windows
        (id,user_id,device_id,release_id,from_version,to_version,source_manifest_id,target_manifest_id,state,started_at,expires_at,completed_at)
        VALUES(?,?,?,?,?,?,?,?,'active',?,?,NULL)`)
        .run(windowId, session.user_id, deviceId, release.id, fromVersion, toVersion, sourceManifestId, targetManifestId, createdAt, expiresAt);
      this.audit(session.user_id, 'security_integrity_update_started', session.user_id, `${deviceId}:${fromVersion}->${toVersion}`);
      return { ok: true, id: windowId, state: 'active', duplicate: false, expiresAt };
    });
  }

  completeIntegrityUpdateWindow(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const allowed = new Set(['deviceId', 'windowId', 'installedVersion', 'targetManifestId']);
    const unexpected = Object.keys(input || {}).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'INTEGRITY_FIELD_REJECTED', field: unexpected };
    const deviceId = validIntegrityId(input.deviceId);
    const windowId = safeText(input.windowId, 100);
    const installedVersion = safeText(input.installedVersion, 40);
    const targetManifestId = validIntegrityId(input.targetManifestId);
    if (!deviceId || !windowId || !targetManifestId) return { ok: false, error: 'INVALID_UPDATE_WINDOW' };
    return this.transaction(() => {
      const updateWindow = this.db.prepare(`SELECT * FROM integrity_update_windows
        WHERE id=? AND user_id=? AND device_id=?`).get(windowId, session.user_id, deviceId);
      if (!updateWindow) return { ok: false, error: 'UPDATE_WINDOW_NOT_FOUND' };
      if (updateWindow.state === 'completed') return { ok: true, id: updateWindow.id, state: 'completed', duplicate: true, completedAt: updateWindow.completed_at };
      if (updateWindow.state !== 'active' || updateWindow.expires_at <= now()) {
        this.db.prepare("UPDATE integrity_update_windows SET state='expired' WHERE id=?").run(updateWindow.id);
        return { ok: false, error: 'UPDATE_WINDOW_EXPIRED' };
      }
      if (installedVersion !== updateWindow.to_version || targetManifestId !== updateWindow.target_manifest_id) {
        return { ok: false, error: 'UPDATE_TARGET_MISMATCH' };
      }
      const completedAt = now();
      this.db.prepare("UPDATE integrity_update_windows SET state='completed',completed_at=? WHERE id=?")
        .run(completedAt, updateWindow.id);
      this.audit(session.user_id, 'security_integrity_update_completed', session.user_id, `${deviceId}:${installedVersion}`);
      return { ok: true, id: updateWindow.id, state: 'completed', duplicate: false, completedAt };
    });
  }

  setUserFlag(token, input = {}) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'INVALID_USER_FLAG' };
    const allowed = new Set(['userId', 'flag', 'value', 'reason']);
    const unexpected = Object.keys(input).find(key => !allowed.has(key));
    if (unexpected) return { ok: false, error: 'USER_FLAG_FIELD_REJECTED', field: unexpected };
    const userId = validIntegrityId(input.userId, 100);
    const flag = input.flag;
    if (!['developerPermission', 'blacklisted'].includes(flag)) return { ok: false, error: 'UNKNOWN_FLAG' };
    if (!userId || typeof input.value !== 'boolean' || (input.reason != null && typeof input.reason !== 'string')) {
      return { ok: false, error: 'INVALID_USER_FLAG' };
    }
    const enabled = input.value;
    const target = this.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!target) return { ok: false, error: 'USER_NOT_FOUND' };
    if (flag === 'blacklisted' && target.role === 'admin' && target.id === admin.user_id && enabled) {
      return { ok: false, error: 'SELF_BAN_DENIED', message: '不能拉黑当前管理员账号。' };
    }
    const changedAt = now();
    this.transaction(() => {
      if (flag === 'developerPermission') {
        this.db.prepare('UPDATE users SET developer_permission=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, changedAt, userId);
        this.db.prepare(`INSERT INTO user_permissions(id,user_id,permission,enabled,updated_by,updated_at) VALUES(?,?,'developer',?,?,?)
          ON CONFLICT(user_id,permission) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
          .run(id('perm'), userId, enabled ? 1 : 0, admin.user_id, changedAt);
        this.db.prepare(`INSERT INTO integrity_enforcement(user_id,state,generation,updated_at)
          VALUES(?,'clean',1,?) ON CONFLICT(user_id) DO UPDATE SET
          state='clean',first_event_id=NULL,warning_issued_at=NULL,warning_ack_at=NULL,blocked_event_id=NULL,
          generation=integrity_enforcement.generation+1,updated_at=excluded.updated_at`)
          .run(userId, changedAt);
        this.audit(admin.user_id, 'developer_permission_changed', userId, enabled ? 'enabled' : 'disabled');
      } else {
        this.db.prepare("UPDATE users SET blacklisted=?,status=?,updated_at=? WHERE id=?")
          .run(enabled ? 1 : 0, enabled ? 'blocked' : 'active', changedAt, userId);
        if (enabled) {
          this.db.prepare('UPDATE user_sessions SET revoked_at=?,online=0 WHERE user_id=? AND revoked_at IS NULL').run(changedAt, userId);
          this.db.prepare('INSERT INTO ban_records(id,user_id,active,reason,changed_by,created_at) VALUES(?,?,1,?,?,?)')
            .run(id('ban'), userId, safeText(input.reason, 300) || '管理员限制使用', admin.user_id, changedAt);
          this.db.prepare(`INSERT INTO integrity_enforcement(user_id,state,generation,updated_at)
            VALUES(?,'blocked',0,?) ON CONFLICT(user_id) DO UPDATE SET state='blocked',updated_at=excluded.updated_at`)
            .run(userId, changedAt);
        } else {
          this.db.prepare('UPDATE ban_records SET active=0,lifted_at=? WHERE user_id=? AND active=1').run(changedAt, userId);
          this.db.prepare(`INSERT INTO integrity_enforcement(user_id,state,generation,updated_at)
            VALUES(?,'clean',1,?) ON CONFLICT(user_id) DO UPDATE SET
            state='clean',first_event_id=NULL,warning_issued_at=NULL,warning_ack_at=NULL,blocked_event_id=NULL,
            generation=integrity_enforcement.generation+1,updated_at=excluded.updated_at`)
            .run(userId, changedAt);
        }
        this.audit(admin.user_id, 'blacklist_changed', userId, enabled ? 'enabled' : 'disabled');
      }
    });
    return { ok: true, user: publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(userId)) };
  }

  presetShareRequestKey(userId, input = {}) {
    const requestIp = safeText(input && input.requestIp, 80);
    const source = requestIp ? `preset-share-ip:${requestIp}` : `preset-share-user:${userId}`;
    return crypto.createHmac('sha256', this.presetShareHmacKey).update(source, 'utf8').digest('hex');
  }

  cleanupPresetShareAttempts(at = now()) {
    if (this.presetShareAttemptsCleanedAt
      && at - this.presetShareAttemptsCleanedAt < 60 * 1000) return 0;
    this.presetShareAttemptsCleanedAt = at;
    return Number(this.db.prepare('DELETE FROM preset_share_attempts WHERE created_at<=?')
      .run(at - PRESET_SHARE_ATTEMPT_RETENTION_MS).changes || 0);
  }

  presetShareRateLimit(session, action, input = {}) {
    const rule = PRESET_SHARE_RATE_LIMITS[action];
    if (!rule) return { ok: false, error: 'INVALID_PRESET_SHARE_ACTION' };
    const checkedAt = now();
    this.cleanupPresetShareAttempts(checkedAt);
    const since = checkedAt - rule.windowMs;
    const requestKey = this.presetShareRequestKey(session.user_id, input);
    const recent = this.db.prepare(`SELECT COUNT(*) AS count,MIN(created_at) AS oldest
      FROM preset_share_attempts
      WHERE action=? AND status<>'rate_limited' AND created_at>? AND (user_id=? OR request_key=?)`)
      .get(action, since, session.user_id, requestKey);
    let limited = Number(recent.count || 0) >= rule.limit;
    if (!limited && action === 'redeem' && rule.failedLimit) {
      const failures = this.db.prepare(`SELECT COUNT(*) AS count FROM preset_share_attempts
        WHERE action='redeem' AND status IN ('invalid_code','not_found','revoked','corrupt')
        AND created_at>? AND (user_id=? OR request_key=?)`).get(since, session.user_id, requestKey);
      limited = Number(failures.count || 0) >= rule.failedLimit;
    }
    if (!limited) return { ok: true, requestKey };
    const retryAfterMs = Math.max(1000, Number(recent.oldest || checkedAt) + rule.windowMs - checkedAt);
    const recorded = this.db.prepare(`SELECT id FROM preset_share_attempts
      WHERE action=? AND status='rate_limited' AND created_at>?
        AND (user_id=? OR request_key=?)
      LIMIT 1`).get(action, since, session.user_id, requestKey);
    if (!recorded) {
      this.db.prepare(`INSERT INTO preset_share_attempts(id,user_id,action,request_key,code_hash,status,created_at)
        VALUES(?,?,?,?,?,'rate_limited',?)`).run(id('preset_attempt'), session.user_id, action, requestKey, '', checkedAt);
      this.audit(session.user_id, 'preset_share_rate_limited', session.user_id, action);
    }
    return { ok: false, error: 'RATE_LIMITED', retryAfterMs };
  }

  recordPresetShareAttempt(session, action, requestKey, codeHash, status, at = now()) {
    this.db.prepare(`INSERT INTO preset_share_attempts(id,user_id,action,request_key,code_hash,status,created_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(id('preset_attempt'), session.user_id, action, requestKey, codeHash || '', safeText(status, 40), at);
  }

  createPresetShare(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const fields = validatePresetShareInput(input, new Set(['canonical', 'requestIp']));
    if (!fields.ok) return fields;
    const rate = this.presetShareRateLimit(session, 'create', input);
    if (!rate.ok) return rate;
    const prepared = preparePresetSharePayload(input.canonical);
    if (!prepared.ok) {
      this.recordPresetShareAttempt(session, 'create', rate.requestKey, '', 'rejected');
      this.audit(session.user_id, 'preset_share_create_rejected', session.user_id, prepared.error);
      return prepared;
    }
    const createdAt = now();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generatePresetShareCode();
      const codeHash = hash(code);
      const shareId = id('preset_share');
      try {
        this.transaction(() => {
          this.db.prepare(`INSERT INTO preset_shares
            (id,code_hash,owner_user_id,name,schema_version,preset_json,preset_hash,status,redemption_count,created_at,updated_at,revoked_at)
            VALUES(?,?,?,?,?,?,?,'active',0,?,?,NULL)`)
            .run(shareId, codeHash, session.user_id, prepared.name, prepared.schemaVersion,
              prepared.presetJson, prepared.presetHash, createdAt, createdAt);
          this.audit(session.user_id, 'preset_share_created', session.user_id, shareId);
        });
        this.recordPresetShareAttempt(session, 'create', rate.requestKey, codeHash, 'created', createdAt);
        const row = this.db.prepare('SELECT * FROM preset_shares WHERE id=?').get(shareId);
        return { ok: true, code, share: publicPresetShare(row) };
      } catch (error) {
        if (!/UNIQUE constraint failed:\s*preset_shares\.code_hash/i.test(String(error && error.message || ''))) {
          this.recordPresetShareAttempt(session, 'create', rate.requestKey, '', 'failed', createdAt);
          return { ok: false, error: 'PRESET_SHARE_CREATE_FAILED' };
        }
      }
    }
    this.recordPresetShareAttempt(session, 'create', rate.requestKey, '', 'failed', createdAt);
    return { ok: false, error: 'PRESET_SHARE_CODE_EXHAUSTED' };
  }

  redeemPresetShare(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const fields = validatePresetShareInput(input, new Set(['code', 'requestIp']));
    if (!fields.ok) return fields;
    const rate = this.presetShareRateLimit(session, 'redeem', input);
    if (!rate.ok) return rate;
    const code = normalizePresetShareCode(input.code);
    const codeHash = code ? hash(code) : hash(safeText(input.code, 100));
    if (!code) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'invalid_code');
      this.audit(session.user_id, 'preset_share_redeem_abuse', session.user_id, 'invalid_code');
      return { ok: false, error: 'NOT_FOUND' };
    }
    const row = this.db.prepare('SELECT * FROM preset_shares WHERE code_hash=?').get(codeHash);
    if (!row) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'not_found');
      this.audit(session.user_id, 'preset_share_redeem_abuse', session.user_id, `not_found:${codeHash.slice(0, 12)}`);
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (row.status === 'revoked') {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'revoked');
      this.audit(session.user_id, 'preset_share_redeem_abuse', session.user_id, `revoked:${row.id}`);
      return { ok: false, error: 'REVOKED' };
    }
    if (row.status !== 'active' || hash(row.preset_json) !== row.preset_hash) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'corrupt');
      this.audit(session.user_id, 'preset_share_integrity_failed', session.user_id, row.id);
      return { ok: false, error: 'PRESET_SHARE_CORRUPT' };
    }
    if (Number(row.schema_version) !== LumiFieldPresetSchema.VERSION) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'corrupt');
      this.audit(session.user_id, 'preset_share_schema_failed', session.user_id, `${row.id}:unsupported`);
      return { ok: false, error: 'PRESET_SCHEMA_UNSUPPORTED' };
    }
    let parsed;
    try { parsed = JSON.parse(row.preset_json); }
    catch (_) { parsed = null; }
    const prepared = preparePresetSharePayload(parsed);
    if (!prepared.ok) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'corrupt');
      this.audit(session.user_id, 'preset_share_schema_failed', session.user_id, row.id);
      return prepared;
    }
    if (prepared.presetHash !== row.preset_hash || prepared.schemaVersion !== Number(row.schema_version)) {
      this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'corrupt');
      this.audit(session.user_id, 'preset_share_schema_failed', session.user_id, row.id);
      return { ok: false, error: 'PRESET_SCHEMA_INVALID' };
    }
    const redeemedAt = now();
    this.transaction(() => {
      this.db.prepare('UPDATE preset_shares SET redemption_count=redemption_count+1,updated_at=? WHERE id=? AND status=?')
        .run(redeemedAt, row.id, 'active');
      this.audit(session.user_id, 'preset_share_redeemed', session.user_id, row.id);
    });
    this.recordPresetShareAttempt(session, 'redeem', rate.requestKey, codeHash, 'redeemed', redeemedAt);
    const current = this.db.prepare('SELECT * FROM preset_shares WHERE id=?').get(row.id);
    return { ok: true, preset: prepared.canonical, share: publicPresetShare(current) };
  }

  listPresetShares(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const fields = validatePresetShareInput(input, new Set(['requestIp']));
    if (!fields.ok) return fields;
    const rate = this.presetShareRateLimit(session, 'mine', input);
    if (!rate.ok) return rate;
    const rows = this.db.prepare('SELECT * FROM preset_shares WHERE owner_user_id=? ORDER BY created_at DESC').all(session.user_id);
    this.recordPresetShareAttempt(session, 'mine', rate.requestKey, '', 'listed');
    return { ok: true, shares: rows.map(publicPresetShare) };
  }

  revokePresetShare(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const fields = validatePresetShareInput(input, new Set(['shareId', 'requestIp']));
    if (!fields.ok) return fields;
    const rate = this.presetShareRateLimit(session, 'revoke', input);
    if (!rate.ok) return rate;
    const shareId = validIntegrityId(input.shareId, 100);
    const row = shareId
      ? this.db.prepare('SELECT * FROM preset_shares WHERE id=? AND owner_user_id=?').get(shareId, session.user_id)
      : null;
    if (!row) {
      this.recordPresetShareAttempt(session, 'revoke', rate.requestKey, '', 'not_found');
      this.audit(session.user_id, 'preset_share_revoke_abuse', session.user_id, 'not_found');
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (row.status === 'revoked') {
      this.recordPresetShareAttempt(session, 'revoke', rate.requestKey, row.code_hash, 'revoked_duplicate');
      return { ok: true, revoked: true, duplicate: true, share: publicPresetShare(row) };
    }
    const revokedAt = now();
    this.transaction(() => {
      this.db.prepare("UPDATE preset_shares SET status='revoked',revoked_at=?,updated_at=? WHERE id=? AND owner_user_id=? AND status='active'")
        .run(revokedAt, revokedAt, row.id, session.user_id);
      this.audit(session.user_id, 'preset_share_revoked', session.user_id, row.id);
    });
    this.recordPresetShareAttempt(session, 'revoke', rate.requestKey, row.code_hash, 'revoked', revokedAt);
    return {
      ok: true,
      revoked: true,
      duplicate: false,
      share: publicPresetShare(this.db.prepare('SELECT * FROM preset_shares WHERE id=?').get(row.id)),
    };
  }

  requestDeveloperAccess(token, input = {}) {
    const session = this.sessionByToken(token);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    if (session.developer_permission || session.role === 'admin') return { ok: true, allowed: true, message: '已拥有开发权限' };
    this.audit(session.user_id, 'developer_access_attempt', session.user_id, safeText(input.context, 300));
    return { ok: false, allowed: false, error: 'DEVELOPER_PERMISSION_REQUIRED', message: DEV_WARNING, contact: DEV_CONTACT };
  }

  verifyRelease(release, verifyLocalFile) {
    if (!release || !/^[a-f0-9]{64}$/i.test(release.package_sha256 || '') || !release.signature) {
      return { ok: false, error: 'UNSIGNED_RELEASE', message: '更新包缺少 SHA-256 或数字签名。' };
    }
    if (!this.updatePublicKey) return { ok: false, error: 'SIGNING_NOT_CONFIGURED', message: '尚未配置 LF_UPDATE_PUBLIC_KEY。' };
    let signatureValid = false;
    try {
      signatureValid = crypto.verify('sha256', Buffer.from(`${release.version}:${String(release.package_sha256).toLowerCase()}`), this.updatePublicKey, Buffer.from(release.signature, 'base64'));
    } catch (_) { signatureValid = false; }
    if (!signatureValid) return { ok: false, error: 'INVALID_RELEASE_SIGNATURE', message: '更新包签名验证失败。' };
    if (verifyLocalFile && release.package_path && fs.existsSync(release.package_path)) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(release.package_path)).digest('hex');
      if (actual !== String(release.package_sha256).toLowerCase()) return { ok: false, error: 'PACKAGE_HASH_MISMATCH', message: '本地更新包 SHA-256 不匹配。' };
    }
    return { ok: true };
  }

  decideRelease(token, input = {}) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    const release = this.db.prepare('SELECT * FROM update_releases WHERE id=? OR version=?').get(safeText(input.releaseId, 100), safeText(input.version, 40));
    if (!release) return { ok: false, error: 'RELEASE_NOT_FOUND' };
    const decision = input.decision === 'publish' ? 'published' : input.decision === 'rollback' ? 'rolled_back' : 'rejected';
    if (decision === 'published') {
      const verification = this.verifyRelease(release, true);
      if (!verification.ok) return Object.assign({}, verification, { message: `发布被拒绝：${verification.message}` });
    }
    this.db.prepare('UPDATE update_releases SET status=?,decided_by=?,decided_at=? WHERE id=?').run(decision, admin.user_id, now(), release.id);
    this.audit(admin.user_id, 'update_release_decided', null, `${release.version}:${decision}`);
    return { ok: true, status: decision, version: release.version };
  }

  createRelease(token, input = {}) {
    const admin = this.requireAdmin(token);
    if (!admin) return { ok: false, error: 'FORBIDDEN' };
    const version = safeText(input.version, 40);
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return { ok: false, error: 'INVALID_VERSION' };
    const releaseId = id('release');
    try {
      this.db.prepare(`INSERT INTO update_releases(id,version,notes,mandatory,rollout_percent,package_path,package_sha256,signature,status,created_at,rollback_version)
        VALUES(?,?,?,?,?,?,?,?, 'pending',?,?)`).run(releaseId, version, safeText(input.notes, 4000), input.mandatory ? 1 : 0, Math.max(1, Math.min(100, Number(input.rolloutPercent) || 100)), safeText(input.packagePath, 500), safeText(input.packageSha256, 128).toLowerCase(), safeText(input.signature, 2000), now(), safeText(input.rollbackVersion, 40));
      this.audit(admin.user_id, 'update_release_created', null, version);
      return { ok: true, id: releaseId, version, status: 'pending', message: '软件版本已更改，是否需要同步到每个用户？' };
    } catch (error) { return { ok: false, error: 'VERSION_EXISTS', message: '该版本记录已存在。' }; }
  }

  availableUpdate(token, currentVersion) {
    const session = this.sessionByToken(token, true);
    if (!session) return { ok: false, error: 'INVALID_SESSION' };
    const release = this.db.prepare("SELECT * FROM update_releases WHERE status='published' ORDER BY created_at DESC").all()
      .find(item => compareSemver(item.version, safeText(currentVersion, 40)) > 0) || null;
    if (release) {
      const verification = this.verifyRelease(release, false);
      if (!verification.ok) return verification;
      const bucket = parseInt(hash(`${release.id}:${session.user_id}`).slice(0, 8), 16) % 100;
      if (bucket >= Number(release.rollout_percent || 100)) return { ok: true, update: null, userChooses: true, sessionPreserved: true, rolloutExcluded: true };
      this.db.prepare(`INSERT INTO update_targets(id,release_id,user_id,status,updated_at) VALUES(?,?,?,'offered',?)
        ON CONFLICT(release_id,user_id) DO UPDATE SET status='offered',updated_at=excluded.updated_at`)
        .run(id('target'), release.id, session.user_id, now());
    }
    return { ok: true, update: release || null, userChooses: true, sessionPreserved: true };
  }

  privacyNotice() {
    return {
      ok: true,
      version: LumiFieldLegalContent.version,
      effectiveDate: LumiFieldLegalContent.effectiveDate,
      title: LumiFieldLegalContent.privacy.title,
      intro: LumiFieldLegalContent.privacy.intro,
      sections: LumiFieldLegalContent.privacy.sections,
      collected: ['LF 用户 ID、昵称、登录账号类型、头像', '登录时间、登录方式、设备类型、软件版本、在线状态、最近活跃时间', '仅在授权后记录用户提供的定位文字；未授权显示“未授权”', '用户主动提交的反馈与已脱敏日志', '用于 LF 完整性保护的本机随机设备 ID，以及仅限 LF 安装文件的文件标识、相对路径、预期/实际 SHA-256 和异常事件时间'],
      neverCollected: ['明文密码', '未授权的 GPS 精准位置', '未由用户选择的私人文件正文', 'LF 安装目录之外的完整性文件哈希或正文', '完整进程列表或用户代码内容'],
      retention: '会话最长 90 天；验证码 5 分钟失效且仅能使用一次；反馈和审计记录由管理员维护。',
      contact: LumiFieldLegalContent.contact,
    };
  }
}

module.exports = {
  LFBackend,
  BLACKLIST_MESSAGE,
  DEV_WARNING,
  DEV_CONTACT,
  constants: { SESSION_TTL_MS, REFRESH_TTL_MS, OFFLINE_SESSION_MAX_MS, CODE_TTL_MS, QR_TTL_MS, FEEDBACK_LINK_TTL_MS },
  normalizeIdentity,
};
