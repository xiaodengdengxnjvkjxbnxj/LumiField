const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const { LFBackend, constants } = require('../desktop/lf-backend');
const { createLFAPIServer } = require('../desktop/lf-api-server');

function tempDb(root, name) { return path.join(root, `${name}.sqlite3`); }
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = typeof server.address === 'function' ? server.address() : server.server.address();
      resolve(address.port);
    });
  });
}
function closeServer(server) {
  return new Promise(resolve => {
    const listening = server && (server.listening || server.server && server.server.listening);
    if (!listening) resolve(); else server.close(() => resolve());
  });
}
function bootstrapEnv(extra = {}) {
  return Object.assign({
    LF_BOOTSTRAP_ADMIN_EMAILS: 'admin-primary@example.test,admin-backup@example.test',
    LF_BOOTSTRAP_ADMIN_PASSWORD: 'BootstrapAdmin123',
  }, extra);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-auth-smoke-'));
  const smtpMessages = [];
  let smtpServer;
  const openedBackends = [];
  try {
    assert.equal(constants.CODE_TTL_MS, 5 * 60 * 1000);
    assert.equal(constants.OFFLINE_SESSION_MAX_MS, 7 * 24 * 60 * 60 * 1000);

    const locked = new LFBackend({ dbPath: tempDb(root, 'locked'), appVersion: '9.9.8', env: bootstrapEnv(), allowLocalCodes: false });
    openedBackends.push(locked);
    const unavailableEmail = await locked.sendVerificationCode({ target: 'safe@example.test', targetType: 'email', purpose: 'register', requestIp: 'locked-email' });
    assert.equal(unavailableEmail.error, 'EMAIL_SERVICE_UNAVAILABLE');
    assert.equal(unavailableEmail.message, '邮件服务暂时不可用。');
    assert.equal((await locked.sendVerificationCode({ target: '13900000000', targetType: 'phone', purpose: 'register', requestIp: 'locked-phone' })).error, 'INVALID_EMAIL');
    assert.equal(locked.oauthStart('wechat').error, 'FEATURE_REMOVED');
    assert.equal(locked.oauthStart('qq').error, 'FEATURE_REMOVED');
    assert.equal(Object.prototype.hasOwnProperty.call(unavailableEmail, 'localCode'), false);
    const unavailableAudit = locked.db.prepare("SELECT detail FROM audit_logs WHERE action='verification_provider_unavailable'").all().map(row => row.detail).join('|');
    assert(unavailableAudit.includes('LF_MAIL_HOST'));
    assert(!unavailableAudit.includes('BootstrapAdmin123'));
    const productionLocked = new LFBackend({ dbPath: tempDb(root, 'production-locked'), appVersion: '9.9.8', env: bootstrapEnv({ LF_ALLOW_LOCAL_CODES: '1' }), allowLocalCodes: false });
    openedBackends.push(productionLocked);
    const productionCode = await productionLocked.sendVerificationCode({ account: 'production@example.test', purpose: 'register', requestIp: 'production' });
    assert.equal(productionCode.error, 'EMAIL_SERVICE_UNAVAILABLE');
    assert.equal(Object.prototype.hasOwnProperty.call(productionCode, 'localCode'), false);

    smtpServer = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      onData(stream, _session, callback) {
        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => { smtpMessages.push(Buffer.concat(chunks)); callback(); });
        stream.on('error', callback);
      },
    });
    const smtpPort = await listen(smtpServer);
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
    const env = bootstrapEnv({
      LF_MAIL_HOST: '127.0.0.1', LF_MAIL_PORT: String(smtpPort), LF_MAIL_SECURE: '0',
      LF_MAIL_FROM: 'LumiField <no-reply@lumifield.test>', LF_MAIL_ALLOW_NO_AUTH: '1',
      LF_MAIL_PASSWORD: 'smtp-password-never-render',
      LF_WECHAT_APP_ID: 'wechat-public-123456', LF_WECHAT_APP_SECRET: 'wechat-secret-never-render',
      LF_WECHAT_REDIRECT_URI: 'https://account.lumifield.test/v1/auth/oauth/callback', LF_WECHAT_SCOPE: 'snsapi_login',
      LF_WECHAT_STATE_SECRET: 'wechat-state-secret-never-render-1234567890', LF_WECHAT_REVIEW_STATUS: 'approved',
      LF_QQ_APP_ID: 'qq-public-123456', LF_QQ_APP_KEY: 'qq-key-never-render',
      LF_MOBILE_AUTH_URL: 'https://account.lumifield.test',
      LF_PUBLIC_API_URL: 'https://account.lumifield.test',
      LF_QQ_REDIRECT_URI: 'https://account.lumifield.test/v1/auth/oauth/callback', LF_QQ_SCOPE: 'get_user_info',
      LF_QQ_STATE_SECRET: 'qq-state-secret-never-render-1234567890123', LF_QQ_REVIEW_STATUS: 'pending',
    });
    const dbPath = tempDb(root, 'main');
    let backend = new LFBackend({ dbPath, appVersion: '9.9.9', env, updatePublicKey: publicKey, allowLocalCodes: false });
    openedBackends.push(backend);

    const identities = backend.db.prepare('SELECT normalized_value,user_id FROM user_identities ORDER BY normalized_value').all();
    assert.equal(identities.length, 2);
    assert.equal(new Set(identities.map(item => item.user_id)).size, 1);
    const adminId = identities[0].user_id;
    const adminRow = backend.db.prepare('SELECT * FROM users WHERE id=?').get(adminId);
    assert.equal(adminRow.role, 'admin');
    assert.equal(adminRow.developer_permission, 1);
    assert(/^\$2[aby]\$/.test(adminRow.password_hash));
    assert.notEqual(adminRow.password_hash, env.LF_BOOTSTRAP_ADMIN_PASSWORD);

    const adminLogins = [' ADMIN-PRIMARY@EXAMPLE.TEST ', 'admin-backup@example.test']
      .map(account => backend.login({ account, password: env.LF_BOOTSTRAP_ADMIN_PASSWORD, deviceType: 'pc', deviceName: `Admin ${account}`, requestIp: 'admin-test' }));
    adminLogins.forEach(result => {
      assert(result.ok && result.user.id === adminId && result.user.role === 'admin' && result.user.developerPermission);
      assert.equal(result.adminMessage, '已拥有开发权限');
      assert.equal(result.passwordChangeRecommended, true);
    });
    const wrongAdmin = backend.login({ account: 'admin-primary@example.test', password: 'WrongPassword123' });
    assert.equal(wrongAdmin.error, 'INVALID_CREDENTIALS');
    assert.equal(wrongAdmin.message, '账号或密码错误。');
    for (const account of ['admin-primary@example.test', 'admin-backup@example.test']) {
      const blocked = backend.register({ account, password: 'NormalUser123', code: '000000', role: 'admin' });
      assert.equal(blocked.error, 'RESERVED_IDENTITY');
    }

    const mailStart = smtpMessages.length;
    const emailSent = await backend.sendVerificationCode({ target: 'mail-user@example.test', targetType: 'email', purpose: 'register', requestIp: 'email-send-1' });
    assert(emailSent.ok && emailSent.configured && emailSent.provider === 'smtp');
    assert.equal(Object.prototype.hasOwnProperty.call(emailSent, 'localCode'), false);
    assert.equal(smtpMessages.length, mailStart + 1);
    const parsedMail = await simpleParser(smtpMessages.at(-1));
    const mailText = `${parsedMail.subject}\n${parsedMail.text}\n${parsedMail.html || ''}`;
    const mailCode = (mailText.match(/\b\d{6}\b/) || [])[0];
    assert(mailText.includes('LumiField') && mailText.includes('5 分钟') && mailText.includes('如果不是您本人操作，请忽略本邮件'));
    assert(/^\d{6}$/.test(mailCode));
    assert.equal(backend.verifyVerificationCode({ target: 'mail-user@example.test', targetType: 'email', purpose: 'register', code: '000000' }).error, 'CODE_INVALID');
    const verified = backend.verifyVerificationCode({ target: 'mail-user@example.test', targetType: 'email', purpose: 'register', code: mailCode });
    assert(verified.ok && verified.ticket);
    assert.equal(backend.verifyVerificationCode({ target: 'mail-user@example.test', targetType: 'email', purpose: 'register', code: mailCode }).error, 'CODE_USED');
    const user = backend.register({ account: 'mail-user@example.test', nickname: 'Mail User', password: 'SecureUser123', verificationTicket: verified.ticket, role: 'admin', developerPermission: true });
    assert(user.ok && user.user.role === 'user' && !user.user.developerPermission);
    assert.equal(backend.adminDashboard(backend.login({ account: 'mail-user@example.test', password: 'SecureUser123' }).token).error, 'FORBIDDEN');

    const emailRate = await backend.sendVerificationCode({ account: 'rate@example.test', purpose: 'register', requestIp: 'rate-one' });
    assert(emailRate.ok);
    const repeated = await backend.sendVerificationCode({ account: 'rate@example.test', purpose: 'register', requestIp: 'rate-one' });
    assert.equal(repeated.error, 'RATE_LIMITED');
    assert(repeated.retryAfter > 0 && repeated.retryAfter <= 60);

    const preserved = await backend.sendVerificationCode({ account: 'preserved@example.test', purpose: 'register', requestIp: 'preserve-one' });
    assert(preserved.ok);
    const preservedMail = await simpleParser(smtpMessages.at(-1));
    const preservedCode = (`${preservedMail.text}\n${preservedMail.html || ''}`.match(/\b\d{6}\b/) || [])[0];
    backend.db.prepare("UPDATE verification_attempts SET created_at=? WHERE target='preserved@example.test'").run(Date.now() - 61000);
    const workingMailPort = env.LF_MAIL_PORT;
    env.LF_MAIL_PORT = '1';
    const failedReplacement = await backend.sendVerificationCode({ account: 'preserved@example.test', purpose: 'register', requestIp: 'preserve-two' });
    env.LF_MAIL_PORT = workingMailPort;
    assert.equal(failedReplacement.error, 'EMAIL_SEND_FAILED');
    assert(backend.verifyVerificationCode({ account: 'preserved@example.test', code: preservedCode, purpose: 'register' }).ok);

    const expiredSent = await backend.sendVerificationCode({ account: 'expired@example.test', purpose: 'register', requestIp: 'expired-one' });
    assert(expiredSent.ok);
    const expiredMail = await simpleParser(smtpMessages.at(-1));
    const expiredCode = (`${expiredMail.text}\n${expiredMail.html || ''}`.match(/\b\d{6}\b/) || [])[0];
    backend.db.prepare("UPDATE verification_codes SET expires_at=? WHERE target='expired@example.test'").run(Date.now() - 1);
    assert.equal(backend.verifyVerificationCode({ account: 'expired@example.test', code: expiredCode }).error, 'CODE_EXPIRED');

    const concurrentBefore = smtpMessages.length;
    const concurrent = await Promise.all([
      backend.sendVerificationCode({ account: 'parallel@example.test', purpose: 'register', requestIp: 'parallel-one' }),
      backend.sendVerificationCode({ account: 'parallel@example.test', purpose: 'register', requestIp: 'parallel-one' }),
    ]);
    assert.equal(concurrent.filter(item => item.ok).length, 1);
    assert.equal(concurrent.filter(item => item.error === 'RATE_LIMITED').length, 1);
    assert.equal(smtpMessages.length, concurrentBefore + 1);

    assert.equal(backend.register({ account: '13900000000', nickname: 'Phone User', password: 'PhoneUser123', code: '000000' }).error, 'INVALID_EMAIL');
    const legacyUserId = `user_${crypto.randomUUID()}`;
    const legacySalt = crypto.randomBytes(16).toString('hex');
    const legacyHash = crypto.pbkdf2Sync('LegacyPass123', legacySalt, 210000, 64, 'sha512').toString('hex');
    const legacyCreated = Date.now();
    backend.db.prepare(`INSERT INTO users
      (id,account,account_type,nickname,avatar,password_hash,password_salt,role,developer_permission,blacklisted,created_at,updated_at,display_name,status,bootstrap_admin,must_change_password)
      VALUES(?,?,'phone_legacy','Legacy Phone','',?,?,'user',0,0,?,?,'Legacy Phone','active',0,0)`)
      .run(legacyUserId, '+8613900000000', legacyHash, legacySalt, legacyCreated, legacyCreated);
    backend.db.prepare(`INSERT INTO user_identities(id,user_id,identity_type,normalized_value,verified_at,created_at,updated_at)
      VALUES(?,?,'phone_legacy',?,?,?,?)`).run(`identity_${crypto.randomUUID()}`, legacyUserId, '+8613900000000', legacyCreated, legacyCreated, legacyCreated);
    assert(backend.login({ account: '13900000000', password: 'LegacyPass123' }).ok);
    assert.equal((await backend.sendVerificationCode({ account: '13900000000', purpose: 'reset' })).error, 'INVALID_EMAIL');

    const reset = await backend.sendVerificationCode({ account: 'mail-user@example.test', purpose: 'reset', requestIp: 'reset-one' });
    assert(reset.ok);
    const resetMail = await simpleParser(smtpMessages.at(-1));
    const resetCode = (`${resetMail.text}\n${resetMail.html || ''}`.match(/\b\d{6}\b/) || [])[0];
    const resetVerified = backend.verifyResetCode({ account: 'mail-user@example.test', code: resetCode });
    assert(resetVerified.ok && resetVerified.ticket);
    assert(backend.resetPassword({ account: 'mail-user@example.test', ticket: resetVerified.ticket, password: 'BetterUser456' }).ok);
    assert.equal(backend.resetPassword({ account: 'mail-user@example.test', ticket: resetVerified.ticket, password: 'AgainUser789' }).error, 'INVALID_RESET_TICKET');

    assert(backend.login({ account: '13900000000', password: 'LegacyPass123' }).ok);
    assert(/^\$2[aby]\$/.test(backend.db.prepare('SELECT password_hash FROM users WHERE id=?').get(legacyUserId).password_hash));

    const adminSession = adminLogins[0];
    assert(backend.changePassword(adminSession.token, { currentPassword: env.LF_BOOTSTRAP_ADMIN_PASSWORD, newPassword: 'ChangedAdmin456' }).ok);
    assert.equal(backend.login({ account: 'admin-primary@example.test', password: env.LF_BOOTSTRAP_ADMIN_PASSWORD }).error, 'INVALID_CREDENTIALS');
    assert(backend.login({ account: 'admin-backup@example.test', password: 'ChangedAdmin456' }).ok);
    assert.equal(backend.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(adminId).must_change_password, 0);

    const activeAdmin = backend.login({ account: 'admin-primary@example.test', password: 'ChangedAdmin456', deviceType: 'pc' });
    const activeUser = backend.login({ account: 'mail-user@example.test', password: 'BetterUser456', deviceType: 'pc' });
    const offlineLastActive = Date.now() - 60 * 60 * 1000;
    backend.db.prepare('UPDATE user_sessions SET expires_at=?,refresh_expires_at=?,last_active_at=? WHERE id=?')
      .run(Date.now() - 1, Date.now() + 24 * 60 * 60 * 1000, offlineLastActive, activeUser.session.id);
    const offlineValid = backend.authStatus(activeUser.token, { offline: true });
    assert(offlineValid.ok && offlineValid.offline);
    assert.equal(backend.db.prepare('SELECT last_active_at FROM user_sessions WHERE id=?').get(activeUser.session.id).last_active_at, offlineLastActive);
    assert.equal(backend.authStatus(activeUser.token).error, 'INVALID_SESSION');
    backend.db.prepare('UPDATE user_sessions SET last_active_at=? WHERE id=?').run(Date.now() - constants.OFFLINE_SESSION_MAX_MS - 1, activeUser.session.id);
    assert.equal(backend.authStatus(activeUser.token, { offline: true }).error, 'OFFLINE_SESSION_EXPIRED');
    backend.db.prepare('UPDATE user_sessions SET last_active_at=?,refresh_expires_at=? WHERE id=?').run(Date.now(), Date.now() - 1, activeUser.session.id);
    assert.equal(backend.authStatus(activeUser.token, { offline: true }).error, 'OFFLINE_SESSION_EXPIRED');
    backend.db.prepare('UPDATE user_sessions SET expires_at=?,refresh_expires_at=?,last_active_at=? WHERE id=?')
      .run(Date.now() + constants.SESSION_TTL_MS, Date.now() + constants.REFRESH_TTL_MS, Date.now(), activeUser.session.id);
    const qr = backend.createQrToken();
    assert(qr.mobileAuthorizationConfigured && new URL(qr.qrContent).protocol === 'https:' && new URL(qr.qrContent).searchParams.get('token') === qr.token);
    assert(qr.ok && backend.confirmQr({ sessionToken: activeUser.token, qrToken: qr.token }).ok);
    const qrLogin = backend.pollQr(qr.token);
    assert(qrLogin.ok && qrLogin.status === 'confirmed' && qrLogin.user.id === activeUser.user.id && qrLogin.token && qrLogin.refreshToken);
    const qrSecondPoll = backend.pollQr(qr.token);
    const qrRejected = backend.createQrToken();
    const sessionsBeforeReject = backend.db.prepare('SELECT COUNT(*) AS count FROM user_sessions').get().count;
    assert(backend.rejectQr({ sessionToken: activeUser.token, qrToken: qrRejected.token }).ok);
    const rejectedPoll = backend.pollQr(qrRejected.token);
    assert(rejectedPoll.ok && rejectedPoll.status === 'rejected');
    assert(backend.db.prepare('SELECT COUNT(*) AS count FROM user_sessions').get().count === sessionsBeforeReject);
    assert(qrSecondPoll.ok && qrSecondPoll.status === 'consumed' && !qrSecondPoll.token);

    assert.equal(backend.oauthStart({ provider: 'qq', sessionToken: activeAdmin.token, currentPassword: 'ChangedAdmin456' }).error, 'FEATURE_REMOVED');
    assert.equal((await backend.oauthCallback({ state: 'legacy-state', code: 'legacy-code' })).error, 'FEATURE_REMOVED');
    assert.equal(backend.oauthPoll('legacy-poll-token').error, 'FEATURE_REMOVED');
    const boundIdentities = backend.userIdentities(activeUser.token);
    assert(boundIdentities.ok && boundIdentities.identities.some(identity => identity.type === 'email'));
    assert.equal(backend.adminLoginServices(activeUser.token).error, 'FORBIDDEN');
    const serviceConfig = backend.adminLoginServices(activeAdmin.token);
    const serviceConfigJson = JSON.stringify(serviceConfig);
    assert(serviceConfig.ok && serviceConfig.services.email.configured && !serviceConfig.services.wechat && !serviceConfig.services.qq);
    assert(!serviceConfigJson.includes(env.LF_MAIL_PASSWORD) && !serviceConfigJson.includes(env.LF_WECHAT_APP_SECRET) && !serviceConfigJson.includes(env.LF_QQ_APP_KEY));
    assert((await backend.testLoginService(activeAdmin.token, { service: 'email', action: 'validate' })).ok);
    const mailTestStart = smtpMessages.length;
    assert((await backend.testLoginService(activeAdmin.token, { service: 'email', action: 'send-test' })).ok);
    assert.equal(smtpMessages.length, mailTestStart + 1);
    assert.equal((await backend.testLoginService(activeAdmin.token, { service: 'wechat', action: 'validate' })).error, 'FEATURE_REMOVED');
    assert.equal((await backend.testLoginService(activeAdmin.token, { service: 'qq', action: 'test-login' })).error, 'FEATURE_REMOVED');

    assert.equal(backend.submitFeedback(activeUser.token, { content: 'Missing contact feedback', contact: '' }).error, 'CONTACT_REQUIRED');
    assert.equal(backend.submitFeedback(activeUser.token, { content: 'Whitespace contact feedback', contact: '   ' }).error, 'CONTACT_REQUIRED');
    assert.equal(backend.submitFeedback(activeUser.token, { content: 'Invalid contact feedback', contact: 'not-a-contact' }).error, 'INVALID_CONTACT');
    const phoneFeedback = backend.submitFeedback(activeUser.token, { content: 'Mainland phone contact feedback', contact: '13800138000' });
    assert(phoneFeedback.ok && (await backend.finalizeFeedback(activeUser.token, phoneFeedback.id)).mailDelivered);

    const feedbackDraft = backend.createFeedbackDraft(activeUser.token, { clientVersion: '9.9.9', deviceInfo: 'Backend smoke' });
    assert(feedbackDraft.ok && feedbackDraft.draft);
    assert.equal(backend.createFeedbackUpload(activeUser.token, feedbackDraft.id, { name: 'dangerous.exe', type: 'application/x-msdownload', size: 100 }).error, 'DANGEROUS_FILE_TYPE');

    const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV8AAAAASUVORK5CYII=', 'base64');
    const sampleText = Buffer.from('LumiField feedback plain-file fixture\r\n', 'utf8');
    const sampleVideo = Buffer.alloc(5 * 1024 * 1024, 0);
    sampleVideo.writeUInt32BE(24, 0);
    sampleVideo.write('ftyp', 4, 'ascii');
    sampleVideo.write('isom', 8, 'ascii');
    sampleVideo.writeUInt32BE(0x200, 12);
    sampleVideo.write('isom', 16, 'ascii');
    sampleVideo.write('mp41', 20, 'ascii');
    sampleVideo.writeUInt32BE(sampleVideo.length - 24, 24);
    sampleVideo.write('mdat', 28, 'ascii');

    async function uploadFixture(name, type, data) {
      const created = backend.createFeedbackUpload(activeUser.token, feedbackDraft.id, { name, type, size: data.length });
      assert(created.ok && created.resumable && created.chunkSize === 4 * 1024 * 1024);
      const initial = backend.feedbackUploadStatus(activeUser.token, created.uploadId);
      assert(initial.ok && initial.status === 'uploading' && initial.receivedSize === 0 && initial.nextChunk === 0);
      let offset = initial.receivedSize;
      let chunkIndex = initial.nextChunk;
      while (offset < data.length) {
        const chunk = data.subarray(offset, Math.min(data.length, offset + created.chunkSize));
        const appended = backend.appendFeedbackUpload(activeUser.token, created.uploadId, { chunkIndex, data: chunk });
        assert(appended.ok && appended.receivedSize === offset + chunk.length && appended.nextChunk === chunkIndex + 1);
        offset = appended.receivedSize;
        chunkIndex = appended.nextChunk;
      }
      const uploaded = backend.feedbackUploadStatus(activeUser.token, created.uploadId);
      assert(uploaded.ok && uploaded.status === 'uploading' && uploaded.receivedSize === data.length && uploaded.nextChunk === chunkIndex);
      const finalized = await backend.finalizeFeedbackUpload(activeUser.token, created.uploadId);
      assert(finalized.ok && finalized.status === 'ready' && finalized.sha256 === crypto.createHash('sha256').update(data).digest('hex'));
      const complete = backend.feedbackUploadStatus(activeUser.token, created.uploadId);
      assert(complete.ok && complete.status === 'complete' && complete.receivedSize === data.length);
      return { created, finalized };
    }

    const pngUpload = await uploadFixture('evidence.png', 'image/png', samplePng);
    const textUpload = await uploadFixture('notes.txt', 'text/plain', sampleText);

    const videoUpload = backend.createFeedbackUpload(activeUser.token, feedbackDraft.id, { name: 'evidence.mp4', type: 'video/mp4', size: sampleVideo.length });
    assert(videoUpload.ok && videoUpload.resumable && videoUpload.chunkSize === 4 * 1024 * 1024);
    assert.equal(backend.appendFeedbackUpload(activeUser.token, videoUpload.uploadId, { chunkIndex: 1, data: sampleVideo.subarray(0, 32) }).error, 'CHUNK_OUT_OF_ORDER');
    const firstVideoChunk = backend.appendFeedbackUpload(activeUser.token, videoUpload.uploadId, { chunkIndex: 0, data: sampleVideo.subarray(0, videoUpload.chunkSize) });
    assert(firstVideoChunk.ok && firstVideoChunk.progress > 0 && firstVideoChunk.progress < 100);
    const resumableVideo = backend.feedbackUploadStatus(activeUser.token, videoUpload.uploadId);
    assert(resumableVideo.ok && resumableVideo.status === 'uploading' && resumableVideo.receivedSize === videoUpload.chunkSize && resumableVideo.nextChunk === 1);
    const resumedVideoChunk = backend.appendFeedbackUpload(activeUser.token, videoUpload.uploadId, {
      chunkIndex: resumableVideo.nextChunk,
      data: sampleVideo.subarray(resumableVideo.receivedSize),
    });
    assert(resumedVideoChunk.ok && resumedVideoChunk.progress === 100);
    const finalizedVideo = await backend.finalizeFeedbackUpload(activeUser.token, videoUpload.uploadId);
    assert(finalizedVideo.ok && finalizedVideo.status === 'ready' && finalizedVideo.sha256 === crypto.createHash('sha256').update(sampleVideo).digest('hex'));
    assert.equal(backend.feedbackUploadStatus(activeUser.token, videoUpload.uploadId).status, 'complete');

    const removableUpload = await uploadFixture('remove-before-submit.txt', 'text/plain', Buffer.from('remove this attachment', 'utf8'));
    const removableRow = backend.db.prepare('SELECT stored_path FROM feedback_attachments WHERE id=?').get(removableUpload.finalized.attachmentId);
    assert(removableRow && fs.existsSync(removableRow.stored_path));
    const removedAttachment = backend.deleteFeedbackAttachment(activeUser.token, removableUpload.finalized.attachmentId);
    assert(removedAttachment.ok && removedAttachment.deleted && !fs.existsSync(removableRow.stored_path));

    const cancelledUpload = backend.createFeedbackUpload(activeUser.token, feedbackDraft.id, { name: 'cancel-me.txt', type: 'text/plain', size: 1024 });
    assert(cancelledUpload.ok);
    assert(backend.appendFeedbackUpload(activeUser.token, cancelledUpload.uploadId, { chunkIndex: 0, data: Buffer.alloc(256, 0x61) }).ok);
    assert.equal(backend.submitFeedback(activeUser.token, { draftId: feedbackDraft.id, content: 'Authentication smoke feedback', contact: 'feedback@example.test' }).error, 'UPLOADS_PENDING');
    const cancelledRow = backend.db.prepare('SELECT temp_path FROM feedback_uploads WHERE id=?').get(cancelledUpload.uploadId);
    const cancelled = backend.cancelFeedbackUpload(activeUser.token, cancelledUpload.uploadId);
    assert(cancelled.ok && cancelled.status === 'cancelled' && !fs.existsSync(cancelledRow.temp_path));
    assert.equal(backend.feedbackUploadStatus(activeUser.token, cancelledUpload.uploadId).status, 'cancelled');
    assert(!backend.appendFeedbackUpload(activeUser.token, cancelledUpload.uploadId, { chunkIndex: 1, data: Buffer.alloc(768, 0x62) }).ok);
    assert(backend.cancelFeedbackUpload(activeUser.token, cancelledUpload.uploadId).alreadyCancelled);

    const feedback = backend.submitFeedback(activeUser.token, {
      draftId: feedbackDraft.id,
      content: 'Authentication smoke feedback',
      contact: 'feedback@example.test',
      logExcerpt: 'token=secret cookie=secret password=secret',
    });
    assert(feedback.ok && feedback.draftCommitted && feedback.id === feedbackDraft.id);
    assert(!backend.db.prepare('SELECT log_excerpt FROM feedbacks WHERE id=?').get(feedback.id).log_excerpt.includes('secret'));

    const dashboardFeedback = backend.adminDashboard(activeAdmin.token).feedbacks.find(item => item.id === feedback.id);
    assert(dashboardFeedback && dashboardFeedback.contact === 'feedback@example.test' && dashboardFeedback.attachments.length === 3);
    const dashboardAttachments = new Map(dashboardFeedback.attachments.map(item => [item.file_name, item]));
    [
      ['evidence.png', 'image/png', samplePng, pngUpload.finalized],
      ['notes.txt', 'text/plain', sampleText, textUpload.finalized],
      ['evidence.mp4', 'video/mp4', sampleVideo, finalizedVideo],
    ].forEach(([name, mime, data, finalized]) => {
      const attachment = dashboardAttachments.get(name);
      assert(attachment && attachment.mime === mime && attachment.size === data.length && attachment.status === 'ready');
      assert(attachment.sha256 === crypto.createHash('sha256').update(data).digest('hex') && attachment.id === finalized.attachmentId);
    });

    const grant = backend.createFeedbackDownloadGrant(activeAdmin.token, finalizedVideo.attachmentId);
    assert(grant.ok && backend.feedbackDownloadByGrant(finalizedVideo.attachmentId, grant.grant).ok);
    const mailBeforeFeedback = smtpMessages.length;
    const feedbackDelivery = await backend.finalizeFeedback(activeUser.token, feedback.id);
    assert(feedbackDelivery.ok && feedbackDelivery.databaseSaved && feedbackDelivery.mailDelivered && feedbackDelivery.attachments === 3);
    assert.equal(smtpMessages.length, mailBeforeFeedback + 1);
    const feedbackMail = await simpleParser(smtpMessages.at(-1));
    const feedbackMailText = feedbackMail.text || '';
    assert.equal((feedbackMail.attachments || []).length, 0);
    assert(['evidence.png', 'notes.txt', 'evidence.mp4'].every(name => feedbackMailText.includes(name)));
    assert.equal((feedbackMailText.match(/\/v1\/admin\/feedback-download\?attachment=/g) || []).length, 3);
    assert(!feedbackMailText.includes(sampleText.toString('utf8').trim()));
    const retryFeedback = backend.submitFeedback(activeUser.token, { content: 'Retry notification smoke feedback', contact: '13900139000' });
    assert(retryFeedback.ok);
    const workingFeedbackMailPort = env.LF_MAIL_PORT;
    env.LF_MAIL_PORT = '1';
    const queuedDelivery = await backend.finalizeFeedback(activeUser.token, retryFeedback.id);
    env.LF_MAIL_PORT = workingFeedbackMailPort;
    assert(queuedDelivery.ok && !queuedDelivery.mailDelivered && queuedDelivery.mailStatus === 'retry');
    backend.db.prepare('UPDATE feedback_notifications SET next_attempt_at=0 WHERE feedback_id=?').run(retryFeedback.id);
    const retriedDelivery = await backend.adminRetryFeedbackNotifications(activeAdmin.token, 20);
    assert(retriedDelivery.ok && retriedDelivery.processed === 1 && retriedDelivery.delivered === 1);
    assert.equal(backend.db.prepare('SELECT mail_status FROM feedbacks WHERE id=?').get(retryFeedback.id).mail_status, 'delivered');
    const maxUpload = backend.createFeedbackUpload(activeUser.token, feedback.id, { name: 'maximum.mp4', type: 'video/mp4', size: 3 * 1024 * 1024 * 1024 });
    assert(maxUpload.ok);
    assert(backend.cancelFeedbackUpload(activeUser.token, maxUpload.uploadId).ok);
    assert(backend.setUserFlag(activeAdmin.token, { userId: user.user.id, flag: 'developerPermission', value: true }).ok);
    assert.equal(backend.adminDashboard(activeAdmin.token).users.find(item => item.id === user.user.id).developerPermission, true);

    const packagePath = path.join(root, 'LumiField-9.9.10-Setup.exe');
    fs.writeFileSync(packagePath, crypto.randomBytes(512));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
    const signature = crypto.sign('sha256', Buffer.from(`9.9.10:${digest}`), keys.privateKey).toString('base64');
    const release = backend.createRelease(activeAdmin.token, { version: '9.9.10', packagePath, packageSha256: digest, signature, notes: 'Auth smoke release' });
    assert(release.ok && backend.decideRelease(activeAdmin.token, { releaseId: release.id, decision: 'publish' }).ok);

    const api = createLFAPIServer(backend, { host: '127.0.0.1', port: 0, allowedOrigins: 'http://127.0.0.1' });
    const apiStatus = await api.start();
    const apiBase = `http://127.0.0.1:${apiStatus.port}`;
    const apiSend = await fetch(`${apiBase}/api/auth/email/send-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'api-user@example.test', purpose: 'register', requestIp: 'spoofed' }) });
    assert.equal(apiSend.status, 200);
    const apiMail = await simpleParser(smtpMessages.at(-1));
    const apiCode = (`${apiMail.text}\n${apiMail.html || ''}`.match(/\b\d{6}\b/) || [])[0];
    const apiVerify = await fetch(`${apiBase}/api/auth/email/verify-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'api-user@example.test', code: apiCode, purpose: 'register' }) });
    assert.equal(apiVerify.status, 200);
    const apiRate = await fetch(`${apiBase}/api/auth/email/send-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'api-user@example.test', purpose: 'register' }) });
    assert.equal(apiRate.status, 429);
    const apiSmsSend = await fetch(`${apiBase}/api/auth/sms/send-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '13700000000', purpose: 'register' }) });
    assert.equal(apiSmsSend.status, 404);
    const apiSmsVerify = await fetch(`${apiBase}/api/auth/sms/verify-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '+8613700000000', purpose: 'register', code: '000000' }) });
    assert.equal(apiSmsVerify.status, 404);
    const apiServiceStatus = await fetch(`${apiBase}/v1/admin/login-services`, { headers: { authorization: `Bearer ${activeAdmin.token}` } });
    const apiServiceJson = await apiServiceStatus.text();
    assert.equal(apiServiceStatus.status, 200);
    assert(!apiServiceJson.includes(env.LF_MAIL_PASSWORD) && !apiServiceJson.includes(env.LF_WECHAT_APP_SECRET) && !apiServiceJson.includes(env.LF_QQ_APP_KEY));
    assert.deepEqual(Object.keys(JSON.parse(apiServiceJson).services), ['email']);
    const apiServiceForbidden = await fetch(`${apiBase}/v1/admin/login-services`, { headers: { authorization: `Bearer ${activeUser.token}` } });
    assert.equal(apiServiceForbidden.status, 403);
    const mobilePage = await fetch(`${apiBase}/mobile/qr-login?token=opaque-token-never-reflected`);
    const mobilePageText = await mobilePage.text();
    assert.equal(mobilePage.status, 200);
    assert(mobilePage.headers.get('content-security-policy').includes("script-src 'self'"));
    assert(!mobilePageText.includes('opaque-token-never-reflected'));
    const apiRejectedQr = (await (await fetch(`${apiBase}/v1/auth/qr/create`, { method:'POST', headers:{ 'content-type':'application/json' }, body:'{}' })).json());
    assert(apiRejectedQr.ok && apiRejectedQr.token);
    const apiReject = await fetch(`${apiBase}/v1/auth/qr/reject`, { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${activeUser.token}` }, body:JSON.stringify({ qrToken:apiRejectedQr.token }) });
    assert.equal(apiReject.status, 200);
    const apiRejectedPoll = await (await fetch(`${apiBase}/v1/auth/qr/poll`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ token:apiRejectedQr.token }) })).json();
    assert(apiRejectedPoll.ok && apiRejectedPoll.status === 'rejected');
    const apiRetry = await fetch(`${apiBase}/v1/admin/feedback-notifications/retry`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${activeAdmin.token}` }, body: JSON.stringify({ limit: 20 }) });
    assert.equal(apiRetry.status, 200);
    const sourceIp = backend.db.prepare("SELECT request_ip FROM verification_attempts WHERE target='api-user@example.test' ORDER BY created_at DESC LIMIT 1").get().request_ip;
    assert.notEqual(sourceIp, 'spoofed');
    const forbiddenOrigin = await fetch(`${apiBase}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(forbiddenOrigin.status, 403);
    await api.close();

    const localEnv = bootstrapEnv({ LF_VERIFICATION_IP_HOURLY_LIMIT: '5' });
    const limited = new LFBackend({ dbPath: tempDb(root, 'limited'), appVersion: 'test', env: localEnv, allowLocalCodes: true });
    openedBackends.push(limited);
    for (let index = 0; index < 5; index += 1) {
      const sent = await limited.sendVerificationCode({ account: `ip-${index}@example.test`, purpose: 'register', requestIp: 'shared-ip' });
      assert(sent.ok && sent.developmentMode && /^\d{6}$/.test(sent.localCode));
    }
    assert.equal((await limited.sendVerificationCode({ account: 'ip-limit@example.test', purpose: 'register', requestIp: 'shared-ip' })).error, 'RATE_LIMITED');

    const hourly = new LFBackend({ dbPath: tempDb(root, 'hourly'), appVersion: 'test', env: bootstrapEnv(), allowLocalCodes: true });
    openedBackends.push(hourly);
    for (let index = 0; index < 5; index += 1) {
      const sent = await hourly.sendVerificationCode({ account: 'hourly@example.test', purpose: 'register', requestIp: `hourly-${index}` });
      assert(sent.ok);
      const lastAttempt = hourly.db.prepare("SELECT id FROM verification_attempts WHERE target='hourly@example.test' AND status='delivered' ORDER BY created_at DESC LIMIT 1").get();
      hourly.db.prepare('UPDATE verification_attempts SET created_at=? WHERE id=?').run(Date.now() - (index + 1) * 61000, lastAttempt.id);
    }
    assert.equal((await hourly.sendVerificationCode({ account: 'hourly@example.test', purpose: 'register', requestIp: 'hourly-last' })).error, 'RATE_LIMITED');

    const userSession = backend.login({ account: 'mail-user@example.test', password: 'BetterUser456' });
    assert(userSession.ok);
    const sessionRow = backend.db.prepare('SELECT token_hash,refresh_token_hash FROM user_sessions WHERE id=?').get(userSession.session.id);
    assert.notEqual(sessionRow.token_hash, userSession.token);
    assert.notEqual(sessionRow.refresh_token_hash, userSession.refreshToken);
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n, 1);
    const tables = backend.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
    assert(tables >= 18);

    backend.close();
    openedBackends.splice(openedBackends.indexOf(backend), 1);
    backend = new LFBackend({ dbPath, appVersion: '10.0.0', env, updatePublicKey: publicKey, allowLocalCodes: false });
    openedBackends.push(backend);
    const reopenedIdentities = backend.db.prepare('SELECT user_id FROM user_identities WHERE normalized_value IN (?,?)')
      .all('admin-primary@example.test', 'admin-backup@example.test');
    assert.equal(new Set(reopenedIdentities.map(item => item.user_id)).size, 1);
    assert.equal(reopenedIdentities[0].user_id, adminId);
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n, 1);
    assert.equal(backend.login({ account: 'admin-primary@example.test', password: env.LF_BOOTSTRAP_ADMIN_PASSWORD }).error, 'INVALID_CREDENTIALS');
    assert(backend.login({ account: 'admin-primary@example.test', password: 'ChangedAdmin456' }).ok);

    console.log(JSON.stringify({
      ok: true, smtpDelivered: smtpMessages.length, smsRemoved: true,
      bootstrapAdmin: true, identitiesUnified: true, bcrypt: true, legacyHashUpgraded: true,
      codeTTLSeconds: constants.CODE_TTL_MS / 1000, oneTimeCode: true, accountRateLimit: true,
      ipRateLimit: true, concurrentSendBlocked: true, independentRoutes: true,
      secureProviderErrors: true, reservedIdentities: true, normalUserIsolation: true,
      sessionHashesOnly: true, migrationIdempotent: true, regressionAdminAndUpdates: true,
      lfAccountOAuthRemoved: true, legacyIdentityCompatible: true, qrOneTimePoll: true, qrRejectNoSession:true, mobileQrPage:true, legacyPhonePreserved: true,
      feedbackChunkUpload: true, feedbackThreeGbBoundary: true, feedbackDangerousTypeBlocked: true, feedbackSignedGrant: true, feedbackMailDelivered: true,
      productionLocalCodesDisabled: true,
      failedDeliveryPreservesCode: true,
      offlineSessionStrict: true,
      adminOAuthRemoved: true,
      loginServiceStatusMasked: true,
      loginServiceTests: true,
      feedbackMailRetry: true,
    }));
  } finally {
    for (const backend of openedBackends.reverse()) { try { backend.close(); } catch (_) {} }
    await closeServer(smtpServer);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
