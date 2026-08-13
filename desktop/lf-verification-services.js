const nodemailer = require('nodemailer');

const CODE_TTL_SECONDS = 300;

function configured(value) { return String(value == null ? '' : value).trim(); }

function mailbox(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  const match = text.match(/<([^<>]+)>/);
  return (match ? match[1] : text).trim();
}

function smtpAddresses(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(item => typeof item === 'object' && item ? item.address : item)
    .map(item => String(item == null ? '' : item).trim()).filter(Boolean);
}

function smtpResult(info, target) {
  const accepted = smtpAddresses(info && info.accepted);
  const rejected = smtpAddresses(info && info.rejected);
  const recipient = mailbox(target);
  const acceptedTarget = accepted.some(item => mailbox(item) === recipient);
  const rejectedTarget = rejected.some(item => mailbox(item) === recipient);
  const common = {
    configured: true,
    provider: 'smtp',
    messageId: String(info && info.messageId || '').slice(0, 240),
    accepted,
    rejected,
    response: String(info && info.response || '').slice(0, 500),
  };
  if (!acceptedTarget || rejectedTarget) {
    return {
      ...common,
      ok: false,
      error: rejectedTarget ? 'SMTP_RECIPIENT_REJECTED' : 'SMTP_RECIPIENT_NOT_ACCEPTED',
      providerError: rejectedTarget ? 'SMTP_RECIPIENT_REJECTED' : 'SMTP_RECIPIENT_NOT_ACCEPTED',
    };
  }
  return { ...common, ok: true };
}

function smtpFailure(error, target) {
  const result = smtpResult({
    messageId: error && error.messageId,
    accepted: error && error.accepted,
    rejected: error && error.rejected,
    response: error && error.response,
  }, target);
  const temporary = Number(error && error.responseCode) >= 400 && Number(error && error.responseCode) < 500;
  return {
    ...result,
    ok: false,
    error: !temporary && result.error === 'SMTP_RECIPIENT_REJECTED' ? result.error : 'EMAIL_SEND_FAILED',
    providerError: String(error && (error.code || error.responseCode) || result.providerError || 'SMTP_SEND_FAILED').slice(0, 80),
  };
}

class MailProvider {
  configuration() { return { configured: false, missing: [] }; }
  async sendVerificationCode() { throw new Error('MAIL_PROVIDER_NOT_IMPLEMENTED'); }
}

class SmtpMailProvider extends MailProvider {
  constructor(env = process.env) {
    super();
    this.env = env;
  }

  configuration() {
    const required = ['LF_MAIL_HOST', 'LF_MAIL_PORT', 'LF_MAIL_FROM'];
    if (this.env.LF_MAIL_ALLOW_NO_AUTH !== '1') required.push('LF_MAIL_USER', 'LF_MAIL_PASSWORD');
    const missing = required.filter(key => !configured(this.env[key]));
    return { configured: missing.length === 0, missing, provider: 'smtp' };
  }

  async sendVerificationCode({ target, code, purpose }) {
    const status = this.configuration();
    if (!status.configured) return { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE', provider: 'smtp', missing: status.missing };
    const port = Number(this.env.LF_MAIL_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE', provider: 'smtp', missing: ['LF_MAIL_PORT'] };
    }
    const auth = this.env.LF_MAIL_ALLOW_NO_AUTH === '1' ? undefined : {
      user: configured(this.env.LF_MAIL_USER),
      pass: String(this.env.LF_MAIL_PASSWORD || ''),
    };
    const transport = nodemailer.createTransport({
      host: configured(this.env.LF_MAIL_HOST),
      port,
      secure: /^(1|true|yes)$/i.test(String(this.env.LF_MAIL_SECURE || '')),
      auth,
      connectionTimeout: Number(this.env.LF_MAIL_CONNECTION_TIMEOUT_MS || 8000),
      greetingTimeout: Number(this.env.LF_MAIL_GREETING_TIMEOUT_MS || 8000),
      socketTimeout: Number(this.env.LF_MAIL_SOCKET_TIMEOUT_MS || 12000),
      tls: this.env.LF_MAIL_TLS_REJECT_UNAUTHORIZED === '0' ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const info = await transport.sendMail({
        from: configured(this.env.LF_MAIL_FROM),
        to: target,
        subject: 'LumiField 验证码',
        text: `LumiField 验证码：${code}\n\n验证码 5 分钟内有效，仅可使用一次。\n如果不是您本人操作，请忽略本邮件。\n用途：${purpose === 'reset' ? '重置密码' : purpose === 'bind_email' ? '绑定邮箱' : '注册账号'}`,
        html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#132033"><h2>LumiField</h2><p>您的验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>验证码 <b>5 分钟</b>内有效，仅可使用一次。</p><p>如果不是您本人操作，请忽略本邮件。</p></div>`,
      });
      return smtpResult(info, target);
    } catch (error) {
      return smtpFailure(error, target);
    } finally {
      try { transport.close(); } catch (_) {}
    }
  }

  async sendFeedbackNotification(message = {}) {
    const status = this.configuration();
    if (!status.configured) return { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE', provider: 'smtp', missing: status.missing };
    const port = Number(this.env.LF_MAIL_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'EMAIL_SERVICE_UNAVAILABLE', provider: 'smtp', missing: ['LF_MAIL_PORT'] };
    const auth = this.env.LF_MAIL_ALLOW_NO_AUTH === '1' ? undefined : { user: configured(this.env.LF_MAIL_USER), pass: String(this.env.LF_MAIL_PASSWORD || '') };
    const transport = nodemailer.createTransport({
      host: configured(this.env.LF_MAIL_HOST), port,
      secure: /^(1|true|yes)$/i.test(String(this.env.LF_MAIL_SECURE || '')),
      auth,
      connectionTimeout: Number(this.env.LF_MAIL_CONNECTION_TIMEOUT_MS || 8000),
      greetingTimeout: Number(this.env.LF_MAIL_GREETING_TIMEOUT_MS || 8000),
      socketTimeout: Number(this.env.LF_MAIL_SOCKET_TIMEOUT_MS || 12000),
      tls: this.env.LF_MAIL_TLS_REJECT_UNAUTHORIZED === '0' ? { rejectUnauthorized: false } : undefined,
    });
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
    const links = Array.isArray(message.links) ? message.links.filter(item => item && item.url) : [];
    const lines = [
      `用户 ID：${message.userId || '未知'}`,
      `联系方式：${message.contact || '未填写'}`,
      `客户端版本：${message.clientVersion || '未知'}`,
      `设备信息：${message.deviceInfo || '未知'}`,
      '', '问题描述：', String(message.content || ''), '', '附件下载：',
      ...(links.length ? links.map(item => `${item.name || '附件'}：${item.url}（有效期至 ${item.expiresAt ? new Date(item.expiresAt).toISOString() : '未知'}）`) : ['无可用附件下载链接。']),
    ];
    const summary = message.attachmentSummary || {};
    lines.push(
      '',
      `附件状态：可下载 ${Number(summary.ready || 0)}；待审核 ${Number(summary.quarantined || 0)}；已拒绝 ${Number(summary.rejected || 0)}。`,
    );
    if (Number(summary.quarantined || 0) > 0) lines.push('隔离附件正在等待管理员安全审核；批准后系统会生成新的 7 天 HTTPS 链接并重新发送通知。');
    const target = configured(message.to || this.env.LF_FEEDBACK_NOTIFY_TO || '3599284614@qq.com');
    try {
      const info = await transport.sendMail({
        from: configured(this.env.LF_MAIL_FROM),
        to: target,
        subject: `LumiField 新反馈 · ${String(message.feedbackId || '').slice(0, 36)}`,
        text: lines.join('\n'),
        html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#132033"><h2>LumiField 新反馈</h2><p><b>用户 ID：</b>${escapeHtml(message.userId || '未知')}</p><p><b>联系方式：</b>${escapeHtml(message.contact || '未填写')}</p><p><b>客户端版本：</b>${escapeHtml(message.clientVersion || '未知')}</p><p><b>设备信息：</b>${escapeHtml(message.deviceInfo || '未知')}</p><h3>问题描述</h3><p style="white-space:pre-wrap">${escapeHtml(message.content || '')}</p><h3>附件下载</h3><ul>${links.length ? links.map(item => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name || '附件')}</a> · 7 天内有效</li>`).join('') : '<li>无可用附件下载链接</li>'}</ul><p><b>附件状态：</b>可下载 ${Number(summary.ready || 0)}；待审核 ${Number(summary.quarantined || 0)}；已拒绝 ${Number(summary.rejected || 0)}。</p>${Number(summary.quarantined || 0) > 0 ? '<p><b>隔离附件正在等待管理员安全审核；批准后系统会生成新的 7 天 HTTPS 链接并重新发送通知。</b></p>' : ''}</div>`,
      });
      return smtpResult(info, target);
    } catch (error) {
      return smtpFailure(error, target);
    } finally { try { transport.close(); } catch (_) {} }
  }
}

class EmailVerificationService {
  constructor(provider = new SmtpMailProvider()) { this.provider = provider; }
  configuration() { return this.provider.configuration(); }
  sendCode(target, code, purpose) { return this.provider.sendVerificationCode({ target, code, purpose }); }
  sendFeedbackNotification(message) { return this.provider.sendFeedbackNotification(message); }
}

function createVerificationServices(env = process.env) {
  return {
    email: new EmailVerificationService(new SmtpMailProvider(env)),
  };
}

module.exports = {
  CODE_TTL_SECONDS,
  MailProvider,
  SmtpMailProvider,
  EmailVerificationService,
  createVerificationServices,
};
