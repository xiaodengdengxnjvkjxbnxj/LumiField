const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const forge = require('node-forge');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const { LFBackend, constants } = require('../desktop/lf-backend');

const repoRoot = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repoRoot, 'test-results', 'lf-problem2', runId);
fs.mkdirSync(evidenceDir, { recursive: true });

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
    if (!listening) resolve();
    else server.close(resolve);
  });
}

function selfSignedCertificate() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

function tlsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem2-'));
  const dbPath = path.join(root, 'problem2.sqlite3');
  const smtpMessages = [];
  let smtpMode = 'accept';
  let temporaryFailures = 0;
  let backend = null;
  let smtpServer = null;
  let tlsServer = null;
  try {
    smtpServer = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      onRcptTo(address, _session, callback) {
        if (smtpMode === 'reject') {
          const error = new Error('recipient rejected by test SMTP');
          error.responseCode = 550;
          return callback(error);
        }
        if (smtpMode === 'temporary' && temporaryFailures > 0) {
          temporaryFailures -= 1;
          const error = new Error('temporary mailbox failure');
          error.responseCode = 451;
          return callback(error);
        }
        return callback();
      },
      onData(stream, _session, callback) {
        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => {
          smtpMessages.push(Buffer.concat(chunks));
          callback();
        });
        stream.on('error', callback);
      },
    });
    const smtpPort = await listen(smtpServer);

    const certificate = selfSignedCertificate();
    tlsServer = https.createServer(certificate, (request, response) => {
      const url = new URL(request.url, 'https://127.0.0.1');
      const result = backend.feedbackDownloadByGrant(url.searchParams.get('attachment'), url.searchParams.get('grant'));
      if (!result.ok) {
        response.writeHead(result.error === 'DOWNLOAD_LINK_EXPIRED' ? 410 : 404, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
        return;
      }
      response.writeHead(200, {
        'content-type': result.mime,
        'content-length': result.size,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name).replace(/'/g, '%27')}`,
        'x-lumifield-sha256': result.sha256,
      });
      fs.createReadStream(result.filePath).pipe(response);
    });
    const tlsPort = await listen(tlsServer);

    const env = {
      LF_BOOTSTRAP_ADMIN_EMAILS: 'admin@example.test',
      LF_BOOTSTRAP_ADMIN_PASSWORD: 'Problem2Admin123',
      LF_MAIL_HOST: '127.0.0.1',
      LF_MAIL_PORT: String(smtpPort),
      LF_MAIL_SECURE: '0',
      LF_MAIL_FROM: 'LumiField <no-reply@lumifield.test>',
      LF_MAIL_ALLOW_NO_AUTH: '1',
      LF_FEEDBACK_NOTIFY_TO: 'admin@example.test',
      LF_PUBLIC_API_URL: `https://127.0.0.1:${tlsPort}`,
    };
    backend = new LFBackend({ dbPath, appVersion: '2.0.0-problem2', env, allowLocalCodes: false });
    const login = backend.login({ account: 'admin@example.test', password: env.LF_BOOTSTRAP_ADMIN_PASSWORD, deviceType: 'pc' });
    assert(login.ok && login.user.role === 'admin');

    async function feedbackWithAttachment(name, mime, bytes, content) {
      const draft = backend.createFeedbackDraft(login.token, { clientVersion: '2.0.0-problem2', deviceInfo: 'Problem2 smoke' });
      assert(draft.ok);
      const upload = backend.createFeedbackUpload(login.token, draft.id, { name, type: mime, size: bytes.length });
      assert(upload.ok);
      let offset = 0;
      let chunkIndex = 0;
      while (offset < bytes.length) {
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + upload.chunkSize));
        const appended = backend.appendFeedbackUpload(login.token, upload.uploadId, { chunkIndex, data: chunk });
        assert(appended.ok);
        offset = appended.receivedSize;
        chunkIndex = appended.nextChunk;
      }
      const finalized = await backend.finalizeFeedbackUpload(login.token, upload.uploadId);
      assert(finalized.ok);
      const submitted = backend.submitFeedback(login.token, {
        draftId: draft.id,
        content,
        contact: 'problem2@example.test',
      });
      assert(submitted.ok);
      return { feedbackId: submitted.id, attachment: finalized };
    }

    const acceptedFeedback = backend.submitFeedback(login.token, {
      content: 'Problem2 accepted SMTP notification',
      contact: 'problem2@example.test',
    });
    const accepted = await backend.finalizeFeedback(login.token, acceptedFeedback.id);
    assert(accepted.mailDelivered);
    assert(accepted.smtp.messageId);
    assert.deepEqual(accepted.smtp.accepted, ['admin@example.test']);
    assert.deepEqual(accepted.smtp.rejected, []);
    assert(accepted.smtp.response);
    const acceptedNotice = backend.db.prepare('SELECT * FROM feedback_notifications WHERE feedback_id=?').get(acceptedFeedback.id);
    assert(acceptedNotice.last_message_id === accepted.smtp.messageId);
    assert.deepEqual(JSON.parse(acceptedNotice.last_accepted), ['admin@example.test']);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_notification_attempts WHERE feedback_id=? AND status=?').get(acceptedFeedback.id, 'delivered').n, 1);

    const chineseBytes = Buffer.from('LumiField 问题2 TLS 下载真实字节\n', 'utf8');
    const rejectedFeedback = await feedbackWithAttachment('中文记录.txt', 'text/plain', chineseBytes, 'Problem2 rejected SMTP keeps attachment');
    smtpMode = 'reject';
    const rejected = await backend.finalizeFeedback(login.token, rejectedFeedback.feedbackId);
    assert(!rejected.mailDelivered && rejected.mailStatus === 'retry');
    assert.equal(rejected.error, 'SMTP_RECIPIENT_REJECTED');
    assert(rejected.smtp.rejected.includes('admin@example.test'));
    const rejectedAttempt = backend.db.prepare('SELECT * FROM feedback_notification_attempts WHERE feedback_id=?').get(rejectedFeedback.feedbackId);
    assert(rejectedAttempt.status === 'retry' && JSON.parse(rejectedAttempt.rejected).includes('admin@example.test'));
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_download_grants WHERE attempt_id=?').get(rejectedAttempt.id).n, 0);

    const temporaryFeedback = await feedbackWithAttachment('temporary.txt', 'text/plain', Buffer.from('temporary retry bytes'), 'Problem2 temporary SMTP retry');
    smtpMode = 'temporary';
    temporaryFailures = 1;
    const temporary = await backend.finalizeFeedback(login.token, temporaryFeedback.feedbackId);
    assert(!temporary.mailDelivered && temporary.mailStatus === 'retry' && temporary.error === 'EMAIL_SEND_FAILED');
    const failedTemporaryAttempt = backend.db.prepare('SELECT * FROM feedback_notification_attempts WHERE feedback_id=?').get(temporaryFeedback.feedbackId);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_download_grants WHERE attempt_id=?').get(failedTemporaryAttempt.id).n, 0);
    backend.db.prepare('UPDATE feedback_notifications SET next_attempt_at=0 WHERE feedback_id=?').run(temporaryFeedback.feedbackId);
    smtpMode = 'accept';
    const retried = await backend.adminRetryFeedbackNotifications(login.token, 10);
    assert(retried.ok && retried.processed === 1 && retried.delivered === 1);
    const temporaryNotice = backend.db.prepare('SELECT * FROM feedback_notifications WHERE feedback_id=?').get(temporaryFeedback.feedbackId);
    assert(temporaryNotice.status === 'delivered' && temporaryNotice.attempts === 2);

    const quarantinedFeedback = await feedbackWithAttachment('待审核资料.zip', 'application/zip', Buffer.from('PK\x03\x04safe quarantine fixture'), 'Problem2 quarantined approval resend');
    const firstQuarantine = await backend.finalizeFeedback(login.token, quarantinedFeedback.feedbackId);
    assert(firstQuarantine.mailDelivered);
    assert.deepEqual(firstQuarantine.attachmentSummary, { total: 1, ready: 0, quarantined: 1, rejected: 0 });
    const quarantineMail = await simpleParser(smtpMessages.at(-1));
    assert((quarantineMail.text || '').includes('等待管理员安全审核'));
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_download_grants g JOIN feedback_attachments a ON a.id=g.attachment_id WHERE a.feedback_id=?').get(quarantinedFeedback.feedbackId).n, 0);

    const approvals = await Promise.all([
      backend.setFeedbackAttachmentStatus(login.token, { attachmentId: quarantinedFeedback.attachment.attachmentId, status: 'ready' }),
      backend.setFeedbackAttachmentStatus(login.token, { attachmentId: quarantinedFeedback.attachment.attachmentId, status: 'ready' }),
    ]);
    assert(approvals.every(item => item.ok && item.status === 'ready'));
    assert(approvals.some(item => item.resent) && approvals.some(item => item.idempotent));
    const approvedNotice = backend.db.prepare('SELECT * FROM feedback_notifications WHERE feedback_id=?').get(quarantinedFeedback.feedbackId);
    assert(approvedNotice.revision === 2 && approvedNotice.status === 'delivered');
    assert(approvedNotice.reason === `quarantine_approved:${quarantinedFeedback.attachment.attachmentId}`);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_notification_attempts WHERE feedback_id=? AND revision=2').get(quarantinedFeedback.feedbackId).n, 1);
    const approvalMail = await simpleParser(smtpMessages.at(-1));
    assert((approvalMail.text || '').includes('待审核资料.zip'));
    assert((approvalMail.text || '').includes('/v1/admin/feedback-download?attachment='));

    const rejectedAttachmentFeedback = await feedbackWithAttachment('拒绝资料.zip', 'application/zip', Buffer.from('PK\x03\x04rejected quarantine fixture'), 'Problem2 rejected attachment summary');
    const rejectedAttachmentDecision = await backend.setFeedbackAttachmentStatus(login.token, { attachmentId: rejectedAttachmentFeedback.attachment.attachmentId, status: 'rejected' });
    assert(rejectedAttachmentDecision.ok && rejectedAttachmentDecision.status === 'rejected');
    const rejectedSummaryDelivery = await backend.finalizeFeedback(login.token, rejectedAttachmentFeedback.feedbackId);
    assert(rejectedSummaryDelivery.mailDelivered);
    assert.deepEqual(rejectedSummaryDelivery.attachmentSummary, { total: 1, ready: 0, quarantined: 0, rejected: 1 });
    const rejectedSummaryMail = await simpleParser(smtpMessages.at(-1));
    assert((rejectedSummaryMail.text || '').includes('已拒绝 1'));

    const grant = backend.createFeedbackDownloadGrant(login.token, rejectedFeedback.attachment.attachmentId);
    assert(grant.ok);
    const downloadUrl = `https://127.0.0.1:${tlsPort}/v1/admin/feedback-download?attachment=${encodeURIComponent(grant.attachmentId)}&grant=${encodeURIComponent(grant.grant)}`;
    const downloaded = await tlsGet(downloadUrl);
    assert.equal(downloaded.status, 200);
    assert(downloaded.body.equals(chineseBytes));
    assert.equal(downloaded.headers['x-lumifield-sha256'], crypto.createHash('sha256').update(chineseBytes).digest('hex'));
    assert(String(downloaded.headers['content-disposition']).includes(encodeURIComponent('中文记录.txt')));
    const grantRow = backend.db.prepare('SELECT expires_at,created_at FROM feedback_download_grants WHERE id=?').get(grant.grantId);
    assert.equal(grantRow.expires_at - grantRow.created_at, 7 * 24 * 60 * 60 * 1000);
    backend.db.prepare('UPDATE feedback_download_grants SET expires_at=? WHERE id=?').run(Date.now() - 1, grant.grantId);
    const expired = await tlsGet(downloadUrl);
    assert.equal(expired.status, 410);

    const attemptsBeforeRestart = backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_notification_attempts').get().n;
    backend.close();
    backend = new LFBackend({ dbPath, appVersion: '2.0.0-problem2', env, allowLocalCodes: false });
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM feedback_notification_attempts').get().n, attemptsBeforeRestart);
    const persisted = backend.db.prepare('SELECT revision,reason,status,last_message_id FROM feedback_notifications WHERE feedback_id=?').get(quarantinedFeedback.feedbackId);
    assert(persisted.revision === 2 && persisted.status === 'delivered' && persisted.last_message_id);
    const dashboard = backend.adminDashboard(login.token);
    const monitored = dashboard.feedbacks.find(item => item.id === quarantinedFeedback.feedbackId);
    assert(monitored.notificationRevision === 2 && monitored.notificationStatus === 'delivered');
    assert(monitored.smtpMessageId && monitored.smtpAccepted.includes('admin@example.test') && monitored.smtpRejected.length === 0);
    const monitorSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'lf-monitor.js'), 'utf8');
    assert(monitorSource.includes('批准并重发') && monitorSource.includes('notificationRevision') && monitorSource.includes('smtpMessageId'));
    assert.equal(constants.FEEDBACK_LINK_TTL_MS, 7 * 24 * 60 * 60 * 1000);

    const blocked = new LFBackend({
      dbPath: path.join(root, 'blocked.sqlite3'),
      appVersion: '2.0.0-problem2',
      env: {
        LF_BOOTSTRAP_ADMIN_EMAILS: 'blocked@example.test',
        LF_BOOTSTRAP_ADMIN_PASSWORD: 'Problem2Blocked123',
      },
      allowLocalCodes: false,
    });
    const blockedLogin = blocked.login({ account: 'blocked@example.test', password: 'Problem2Blocked123' });
    const blockedFeedback = blocked.submitFeedback(blockedLogin.token, { content: 'Problem2 production configuration blocked', contact: 'blocked@example.test' });
    const blockedDelivery = await blocked.finalizeFeedback(blockedLogin.token, blockedFeedback.id);
    assert(!blockedDelivery.mailDelivered && blockedDelivery.externalState === 'BLOCKED_EXTERNAL_CONFIG');
    blocked.close();

    const result = {
      ok: true,
      runId,
      evidenceDir,
      smtpAccepted: true,
      smtpRejected: true,
      smtpTemporaryRetry: true,
      notificationAttempts: attemptsBeforeRestart,
      quarantineRevision: persisted.revision,
      quarantineIdempotent: true,
      grantRollback: true,
      tlsDownloadBytes: chineseBytes.length,
      utf8Filename: true,
      sha256Verified: true,
      expiryDays: 7,
      restartPersisted: true,
      externalState: 'BLOCKED_EXTERNAL_CONFIG',
      checks: {
        acceptedMessageIdPersisted: !!acceptedNotice.last_message_id,
        targetAccepted: accepted.smtp.accepted.includes('admin@example.test'),
        targetRejectedHandled: rejected.error === 'SMTP_RECIPIENT_REJECTED',
        failedAttemptGrantCount: 0,
        quarantineInitialState: firstQuarantine.attachmentSummary,
        approvedRevision: persisted.revision,
        approvalMailHasDownloadLink: (approvalMail.text || '').includes('/v1/admin/feedback-download?attachment='),
        downloadedContentType: downloaded.headers['content-type'],
        downloadedContentDisposition: downloaded.headers['content-disposition'],
        downloadedSha256: downloaded.headers['x-lumifield-sha256'],
        expiredStatus: expired.status,
      },
    };
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(result));
  } finally {
    if (backend) backend.close();
    await closeServer(tlsServer);
    await closeServer(smtpServer);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
