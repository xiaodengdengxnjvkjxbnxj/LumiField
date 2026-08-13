const http = require('http');
const fs = require('fs');
const path = require('path');

const MOBILE_ASSETS = Object.freeze({
  '/mobile/qr-login': { file: 'lf-mobile-qr.html', type: 'text/html; charset=utf-8' },
  '/mobile/lf-mobile-qr.css': { file: 'lf-mobile-qr.css', type: 'text/css; charset=utf-8' },
  '/mobile/lf-mobile-qr.js': { file: 'lf-mobile-qr.js', type: 'application/javascript; charset=utf-8' },
});

function mobileAsset(res, route) {
  const asset = MOBILE_ASSETS[route];
  if (!asset) return false;
  const file = path.join(__dirname, '..', 'public', asset.file);
  let data;
  try { data = fs.readFileSync(file); }
  catch (_) { return false; }
  res.writeHead(200, {
    'content-type': asset.type,
    'content-length': data.length,
    'cache-control': asset.file.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(data);
  return true;
}

function requestOrigin(req) {
  const trusted = process.env.LF_API_TRUST_PROXY === '1';
  const proto = trusted ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const protocol = /^(?:http|https)$/.test(proto) ? proto : (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers.host || '').trim();
  try { return host ? new URL(`${protocol}://${host}`).origin : ''; } catch (_) { return ''; }
}

function json(res, status, value, origin) {
  const body = JSON.stringify(value == null ? {} : value);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function oauthPage(res, result) {
  const ok = !!(result && result.ok);
  const text = String(result && (result.message || result.error) || (ok ? '授权成功' : '授权失败')).replace(/[&<>"']/g, value => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[value]);
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumiField 官方登录</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#071019;color:#edf8ff;font:16px system-ui}.card{max-width:520px;padding:32px;border:1px solid #ffffff20;border-radius:22px;background:#ffffff0b;text-align:center}b{display:block;font-size:24px;margin-bottom:12px}p{color:#cde4f0}</style><div class="card"><b>${ok ? '授权成功' : '授权未完成'}</b><p>${text}</p><p>现在可以关闭此页面并返回 LumiField。</p></div>`;
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
  res.end(body);
}

function fileDownload(res, result) {
  if (!result || !result.ok) return json(res, result && result.error === 'DOWNLOAD_LINK_EXPIRED' ? 410 : 404, result || { ok: false, error: 'ATTACHMENT_NOT_FOUND' });
  const encoded = encodeURIComponent(String(result.name || 'attachment')).replace(/'/g, '%27');
  res.writeHead(200, {
    'content-type': result.mime || 'application/octet-stream',
    'content-length': result.size,
    'content-disposition': `attachment; filename*=UTF-8''${encoded}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-lumifield-sha256': result.sha256 || '',
  });
  const stream = require('fs').createReadStream(result.filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : '';
}

function requestIp(req) {
  const socketIp = String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  if (process.env.LF_API_TRUST_PROXY !== '1') return socketIp;
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '') || socketIp;
}

function body(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (_) { reject(Object.assign(new Error('INVALID_JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function coarseLocation(req) {
  const template = String(process.env.LF_IP_GEO_ENDPOINT || '').trim();
  if (!template) return '未知';
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ip || ['127.0.0.1', '::1'].includes(ip)) return '本机';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const endpoint = template.includes('{ip}') ? template.replace(/\{ip\}/g, encodeURIComponent(ip)) : `${template}${template.includes('?') ? '&' : '?'}ip=${encodeURIComponent(ip)}`;
    const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (!response.ok) return '未知';
    const value = await response.json();
    return [value.country, value.region || value.province, value.city].filter(Boolean).join(' · ').slice(0, 100) || '未知';
  } catch (_) { return '未知'; }
}

function createLFAPIServer(backend, options = {}) {
  if (!backend) throw new Error('LF backend is required');
  const allowedOrigins = new Set(String(options.allowedOrigins || process.env.LF_API_ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  const rate = new Map();
  const limitRequest = (req, maximum = 180) => {
    const key = String(req.socket.remoteAddress || 'unknown');
    const minute = Math.floor(Date.now() / 60000);
    const item = rate.get(key);
    if (!item || item.minute !== minute) { rate.set(key, { minute, count: 1 }); return false; }
    item.count += 1;
    return item.count > maximum;
  };

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    const sameOrigin = origin && origin === requestOrigin(req);
    const corsOrigin = origin && (sameOrigin || allowedOrigins.has(origin)) ? origin : '';
    if (origin && !corsOrigin) return json(res, 403, { ok: false, error: 'ORIGIN_FORBIDDEN' });
    if (req.method === 'OPTIONS') {
      if (!corsOrigin) return json(res, 403, { ok: false, error: 'ORIGIN_FORBIDDEN' });
      res.writeHead(204, {
        'access-control-allow-origin': corsOrigin,
        'access-control-allow-methods': 'GET,POST',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch (_) { return json(res, 400, { ok: false, error: 'INVALID_URL' }, corsOrigin); }
    if (req.method === 'GET' && mobileAsset(res, url.pathname)) return;
    if (limitRequest(req, url.pathname === '/v1/feedback/upload/chunk' ? 1800 : 180)) return json(res, 429, { ok: false, error: 'RATE_LIMIT', message: '请求过于频繁。' }, corsOrigin);
    const route = `${req.method || 'GET'} ${url.pathname}`;
    try {
      let payload = {};
      if (req.method === 'POST') payload = await body(req, url.pathname === '/v1/feedback/upload/chunk' ? 7 * 1024 * 1024 : 2 * 1024 * 1024);
      const token = bearer(req);
      const sourceIp = requestIp(req);
      let result;
      switch (route) {
        case 'GET /health':
          result = { ok: true, service: 'lf-backend', version: backend.appVersion, database: 'sqlite', time: Date.now() };
          break;
        case 'POST /v1/auth/code': result = await backend.sendVerificationCode({ ...payload, requestIp: sourceIp }); break;
        case 'POST /api/auth/email/send-code':
        case 'POST /v1/auth/email/send-code': result = await backend.sendVerificationCode({ ...payload, targetType: 'email', requestIp: sourceIp }); break;
        case 'POST /api/auth/email/verify-code':
        case 'POST /v1/auth/email/verify-code': result = backend.verifyVerificationCode({ ...payload, targetType: 'email' }); break;
        case 'POST /v1/auth/register': result = backend.register(payload); break;
        case 'POST /v1/auth/login':
          if (!payload.locationAuthorized) payload.ipLocation = await coarseLocation(req);
          result = backend.login({ ...payload, requestIp: sourceIp });
          break;
        case 'POST /v1/auth/status': result = backend.authStatus(token, payload); break;
        case 'POST /v1/auth/refresh': result = backend.refreshSession(payload.refreshToken); break;
        case 'POST /v1/auth/logout': result = backend.logout(token); break;
        case 'POST /v1/auth/verify-reset': result = backend.verifyResetCode(payload); break;
        case 'POST /v1/auth/reset-password': result = backend.resetPassword(payload); break;
        case 'POST /v1/auth/change-password': result = backend.changePassword(token, payload); break;
        case 'POST /v1/auth/qr/create': result = backend.createQrToken(); break;
        case 'POST /v1/auth/qr/poll': result = backend.pollQr(payload.token); break;
        case 'POST /v1/auth/qr/confirm': result = backend.confirmQr({ ...payload, sessionToken: token }); break;
        case 'POST /v1/auth/qr/reject': result = backend.rejectQr({ ...payload, sessionToken: token }); break;
        case 'POST /v1/auth/oauth/start': result = backend.oauthStart({ ...payload, sessionToken: token }); break;
        case 'GET /v1/auth/oauth/callback':
          result = await backend.oauthCallback({ state: url.searchParams.get('state'), code: url.searchParams.get('code'), error: url.searchParams.get('error') });
          return oauthPage(res, result);
        case 'POST /v1/auth/oauth/callback': result = await backend.oauthCallback(payload); break;
        case 'POST /v1/auth/oauth/poll': result = backend.oauthPoll(payload.pollToken); break;
        case 'GET /v1/me': result = backend.profile(token); break;
        case 'GET /v1/me/identities': result = backend.userIdentities(token); break;
        case 'POST /v1/me/identities/email': result = backend.bindEmail(token, payload); break;
        case 'POST /v1/me/identities/unbind': result = backend.unbindIdentity(token, payload); break;
        case 'POST /v1/me/online': result = backend.setOnline(token, payload.online); break;
        case 'POST /v1/feedback/draft': result = backend.createFeedbackDraft(token, payload); break;
        case 'POST /v1/feedback': result = backend.submitFeedback(token, payload); break;
        case 'POST /v1/feedback/upload/create': result = backend.createFeedbackUpload(token, payload.feedbackId, payload); break;
        case 'POST /v1/feedback/upload/chunk': result = backend.appendFeedbackUpload(token, payload.uploadId, payload); break;
        case 'POST /v1/feedback/upload/finalize': result = await backend.finalizeFeedbackUpload(token, payload.uploadId); break;
        case 'GET /v1/feedback/upload/status': result = backend.feedbackUploadStatus(token, url.searchParams.get('uploadId')); break;
        case 'POST /v1/feedback/upload/cancel': result = backend.cancelFeedbackUpload(token, payload.uploadId); break;
        case 'POST /v1/feedback/attachment/delete': result = backend.deleteFeedbackAttachment(token, payload.attachmentId); break;
        case 'POST /v1/feedback/finalize': result = await backend.finalizeFeedback(token, payload.feedbackId); break;
        case 'GET /v1/privacy': result = backend.privacyNotice(); break;
        case 'POST /v1/developer/access': result = backend.requestDeveloperAccess(token, payload); break;
        case 'GET /v1/integrity/status':
          result = backend.integrityStatus(token, { deviceId: url.searchParams.get('deviceId') || '' });
          break;
        case 'POST /v1/integrity/report': result = backend.reportIntegrityEvent(token, payload); break;
        case 'POST /v1/integrity/warning/ack': result = backend.ackIntegrityWarning(token, payload); break;
        case 'POST /v1/integrity/update/start': result = backend.startIntegrityUpdateWindow(token, payload); break;
        case 'POST /v1/integrity/update/complete': result = backend.completeIntegrityUpdateWindow(token, payload); break;
        case 'POST /v1/preset-share/create':
          result = backend.createPresetShare(token, { ...payload, requestIp: sourceIp });
          break;
        case 'POST /v1/preset-share/redeem':
          result = backend.redeemPresetShare(token, { ...payload, requestIp: sourceIp });
          break;
        case 'GET /v1/preset-share/mine':
          result = backend.listPresetShares(token, { requestIp: sourceIp });
          break;
        case 'POST /v1/preset-share/revoke':
          result = backend.revokePresetShare(token, { ...payload, requestIp: sourceIp });
          break;
        case 'GET /v1/admin/dashboard': result = backend.adminDashboard(token); break;
        case 'GET /v1/admin/login-services': result = backend.adminLoginServices(token); break;
        case 'POST /v1/admin/login-services/test': result = await backend.testLoginService(token, payload); break;
        case 'POST /v1/admin/feedback-notifications/retry': result = await backend.adminRetryFeedbackNotifications(token, payload.limit); break;
        case 'GET /v1/admin/feedback-attachment': result = backend.feedbackAttachmentData(token, url.searchParams.get('id')); break;
        case 'POST /v1/admin/feedback-download-grant': result = backend.createFeedbackDownloadGrant(token, payload.attachmentId); break;
        case 'POST /v1/admin/feedback-attachment-status': result = await backend.setFeedbackAttachmentStatus(token, payload); break;
        case 'GET /v1/admin/feedback-download': return fileDownload(res, backend.feedbackDownloadByGrant(url.searchParams.get('attachment'), url.searchParams.get('grant')));
        case 'POST /v1/admin/user-flag': result = backend.setUserFlag(token, payload); break;
        case 'POST /v1/admin/releases': result = backend.createRelease(token, payload); break;
        case 'POST /v1/admin/releases/decision': result = backend.decideRelease(token, payload); break;
        case 'POST /v1/updates/available': result = backend.availableUpdate(token, payload.currentVersion); break;
        default: return json(res, 404, { ok: false, error: 'NOT_FOUND' }, corsOrigin);
      }
      const unavailable = result && result.error === 'EMAIL_SERVICE_UNAVAILABLE';
      const sendFailed = result && result.error === 'EMAIL_SEND_FAILED';
      const status = result && result.ok ? 200
        : result && result.error === 'INVALID_SESSION' ? 401
          : result && ['FORBIDDEN','ADMIN_REAUTH_REQUIRED'].includes(result.error) ? 403
            : result && result.error === 'NOT_FOUND' ? 404
              : result && result.error === 'REVOKED' ? 410
                : result && ['PRESET_SCHEMA_INVALID','PRESET_SCHEMA_UNSUPPORTED'].includes(result.error) ? 422
          : result && result.error === 'BLACKLISTED' ? 423
            : result && result.error === 'RATE_LIMITED' ? 429
              : unavailable ? 503
                : sendFailed ? 502 : 400;
      return json(res, status, result, corsOrigin);
    } catch (error) {
      return json(res, error.status || 500, { ok: false, error: error.status ? error.message : 'INTERNAL_ERROR' }, corsOrigin);
    }
  });

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        const requestedHost = String(options.host || process.env.LF_API_HOST || '127.0.0.1');
        const host = requestedHost === '127.0.0.1' || requestedHost === '::1' || process.env.LF_API_ALLOW_LAN === '1' ? requestedHost : '127.0.0.1';
        const port = Number(options.port == null ? (process.env.LF_API_PORT || 0) : options.port);
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({ ok: true, host, port: address && address.port, lanEnabled: host !== '127.0.0.1' && host !== '::1' });
        });
      });
    },
    close() {
      return new Promise(resolve => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}

module.exports = { createLFAPIServer };
