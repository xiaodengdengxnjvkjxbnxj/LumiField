'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validRedirect } = require('./lf-oauth-providers');

const FIELD_MAP = Object.freeze({
  wechat: Object.freeze({
    appId: 'LF_WECHAT_APP_ID',
    secret: 'LF_WECHAT_APP_SECRET',
    redirectUri: 'LF_WECHAT_REDIRECT_URI',
    scope: 'LF_WECHAT_SCOPE',
    reviewStatus: 'LF_WECHAT_REVIEW_STATUS',
    stateSecret: 'LF_WECHAT_STATE_SECRET',
  }),
  qq: Object.freeze({
    appId: 'LF_QQ_APP_ID',
    secret: 'LF_QQ_APP_KEY',
    redirectUri: 'LF_QQ_REDIRECT_URI',
    scope: 'LF_QQ_SCOPE',
    reviewStatus: 'LF_QQ_REVIEW_STATUS',
    stateSecret: 'LF_QQ_STATE_SECRET',
  }),
});

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }

function validate(provider, input = {}) {
  if (!FIELD_MAP[provider]) return { ok: false, error: 'UNKNOWN_PROVIDER' };
  const appId = clean(input.appId, 180);
  const secret = clean(input.secret, 500);
  const redirectUri = clean(input.redirectUri, 800);
  const expectedScope = provider === 'wechat' ? 'snsapi_login' : 'get_user_info';
  const scope = clean(input.scope, 120) || expectedScope;
  const reviewStatus = clean(input.reviewStatus, 40).toLowerCase() || 'not_submitted';
  if (appId && !/^[A-Za-z0-9._-]{3,180}$/.test(appId)) return { ok: false, error: 'INVALID_APP_ID' };
  if (secret && /[\x00-\x1f\x7f]/.test(secret)) return { ok: false, error: 'INVALID_SECRET' };
  if (redirectUri && !validRedirect(redirectUri)) return { ok: false, error: 'INVALID_REDIRECT_URI', message: '回调地址必须是 HTTPS；本地开发仅允许 loopback HTTP。' };
  if (scope !== expectedScope) return { ok: false, error: 'INVALID_SCOPE', message: `当前登录方式只允许官方 Scope：${expectedScope}` };
  if (!['not_submitted', 'pending', 'approved', 'rejected'].includes(reviewStatus)) return { ok: false, error: 'INVALID_REVIEW_STATUS' };
  return { ok: true, values: { appId, secret, redirectUri, scope, reviewStatus } };
}

function decryptFile(safeStorage, filePath) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS_ENCRYPTION_UNAVAILABLE', values: {} };
  try {
    if (!fs.existsSync(filePath)) return { ok: true, values: {} };
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
    return { ok: true, values: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch (_) { return { ok: false, error: 'SECURE_CONFIG_READ_FAILED', values: {} }; }
}

function applyToEnvironment(values, env = process.env) {
  Object.keys(FIELD_MAP).forEach((provider) => {
    const record = values && values[provider];
    if (!record || typeof record !== 'object') return;
    const fields = FIELD_MAP[provider];
    Object.keys(fields).forEach((key) => {
      const value = clean(record[key], key === 'redirectUri' ? 800 : 500);
      if (value) env[fields[key]] = value;
    });
  });
}

function loadSecureLoginConfig(options = {}) {
  const result = decryptFile(options.safeStorage, path.resolve(options.filePath));
  if (result.ok) applyToEnvironment(result.values, options.env || process.env);
  return result;
}

function saveSecureLoginConfig(options = {}) {
  const provider = clean(options.provider, 20).toLowerCase();
  const checked = validate(provider, options.input || {});
  if (!checked.ok) return checked;
  if (!options.safeStorage || !options.safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS_ENCRYPTION_UNAVAILABLE' };
  const filePath = path.resolve(options.filePath);
  const current = decryptFile(options.safeStorage, filePath);
  if (!current.ok) return current;
  const values = current.values;
  const previous = values[provider] && typeof values[provider] === 'object' ? values[provider] : {};
  const next = { ...previous, ...checked.values, updatedAt: Date.now() };
  if (!checked.values.secret) next.secret = previous.secret || '';
  if (!next.stateSecret) next.stateSecret = crypto.randomBytes(32).toString('base64url');
  values[provider] = next;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const nonce = crypto.randomBytes(8).toString('hex');
    const tempPath = `${filePath}.${process.pid}.${nonce}.tmp`;
    const backupPath = `${filePath}.${process.pid}.${nonce}.bak`;
    fs.writeFileSync(tempPath, options.safeStorage.encryptString(JSON.stringify(values)), { mode: 0o600, flag: 'wx' });
    let movedPrevious = false;
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, backupPath);
        movedPrevious = true;
      }
      fs.renameSync(tempPath, filePath);
      if (movedPrevious) {
        try { fs.unlinkSync(backupPath); } catch (_) {}
      }
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      try {
        if (movedPrevious && !fs.existsSync(filePath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, filePath);
      } catch (_) {}
      throw error;
    }
    applyToEnvironment({ [provider]: next }, options.env || process.env);
    return { ok: true, provider, configured: !!(next.appId && next.secret && next.redirectUri), secretStored: !!next.secret };
  } catch (_) { return { ok: false, error: 'SECURE_CONFIG_WRITE_FAILED' }; }
}

module.exports = { FIELD_MAP, validate, applyToEnvironment, loadSecureLoginConfig, saveSecureLoginConfig };
