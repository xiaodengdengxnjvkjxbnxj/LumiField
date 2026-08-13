const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LFBackend, DEV_WARNING, DEV_CONTACT } = require('../desktop/lf-backend');

const projectRoot = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW5_BACKEND_OUT || path.join(projectRoot, 'test-results', 'lf-new5-backend', runId));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new5-backend-'));
const dbPath = path.join(root, 'new5.sqlite3');
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
const sourceManifestId = '3'.repeat(64);
const env = {
  LF_BOOTSTRAP_ADMIN_EMAILS: 'new5-admin@example.test',
  LF_BOOTSTRAP_ADMIN_PASSWORD: 'New5Admin123',
};
let backend;
fs.mkdirSync(evidenceDir, { recursive: true });

function writeResult(result) {
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function registerUser(account, nickname) {
  const sent = await backend.sendVerificationCode({ account, purpose: 'register', requestIp: `new5-${nickname}` });
  assert(sent.ok && sent.developmentMode && /^\d{6}$/.test(sent.localCode));
  const verified = backend.verifyVerificationCode({ account, purpose: 'register', code: sent.localCode });
  assert(verified.ok && verified.ticket);
  const registered = backend.register({
    account,
    nickname,
    password: 'NormalUser123',
    verificationTicket: verified.ticket,
  });
  assert(registered.ok && !registered.user.developerPermission && !registered.user.blacklisted);
  return registered.user;
}

function login(account, deviceName) {
  const result = backend.login({ account, password: 'NormalUser123', deviceType: 'pc', deviceName });
  assert(result.ok);
  return result;
}

function event(overrides = {}) {
  return {
    deviceId: 'device-new5-user-a-0001',
    manifestId: 'manifest-new5-1.2.3',
    appVersion: '1.2.3',
    changedFileId: 'app-asar',
    path: 'resources/app.asar',
    expectedHash: 'a'.repeat(64),
    actualHash: 'b'.repeat(64),
    eventType: 'hash_mismatch',
    timestamp: Date.now(),
    confirmed: true,
    ...overrides,
  };
}

function publishRelease(version) {
  const releaseId = `release-new5-${version}`;
  const digest = crypto.createHash('sha256').update(`installer-${version}`).digest('hex');
  const signature = crypto.sign('sha256', Buffer.from(`${version}:${digest}`), keyPair.privateKey).toString('base64');
  backend.db.prepare(`INSERT INTO update_releases
    (id,version,notes,mandatory,rollout_percent,package_path,package_sha256,signature,status,created_at,rollback_version)
    VALUES(?,?, '',0,100,'',?,?,'published',?,'')`)
    .run(releaseId, version, digest, signature, Date.now());
  return { releaseId, digest };
}

(async () => {
  try {
    backend = new LFBackend({ dbPath, appVersion: '1.2.3', env, updatePublicKey: publicKey, allowLocalCodes: true });
    const admin = backend.login({ account: 'new5-admin@example.test', password: env.LF_BOOTSTRAP_ADMIN_PASSWORD, deviceName: 'New5 Admin' });
    assert(admin.ok && admin.user.role === 'admin');
    const userA = await registerUser('new5-a@example.test', 'New5 A');
    const userB = await registerUser('new5-b@example.test', 'New5 B');
    let sessionA = login(userA.account, 'A PC');
    const secondSessionA = login(userA.account, 'A PC 2');
    const sessionB = login(userB.account, 'B PC');

    const initialA = backend.integrityStatus(sessionA.token, { deviceId: 'device-new5-user-a-0001' });
    const initialB = backend.integrityStatus(sessionB.token, { deviceId: 'device-new5-user-b-0001' });
    assert(initialA.ok && initialA.state === 'clean' && !initialA.developerPermission);
    assert(initialB.ok && initialB.state === 'clean' && !initialB.developerPermission);
    assert.equal(backend.setUserFlag(sessionB.token, { userId: userA.id, flag: 'developerPermission', value: true }).error, 'FORBIDDEN');
    assert.equal(backend.setUserFlag(admin.token, null).error, 'INVALID_USER_FLAG');
    assert.equal(backend.setUserFlag(admin.token, { userId: userA.id, flag: 'blacklisted', value: 'false' }).error, 'INVALID_USER_FLAG');
    assert.equal(backend.setUserFlag(admin.token, { userId: userA.id, flag: 'blacklisted', value: false, extra: true }).error, 'USER_FLAG_FIELD_REJECTED');
    assert.equal(backend.reportIntegrityEvent(sessionA.token, event({ fileContents: 'forbidden' })).error, 'INTEGRITY_FIELD_REJECTED');
    assert.equal(backend.reportIntegrityEvent(sessionA.token, event({ path: '../private.txt' })).error, 'INTEGRITY_PATH_NOT_ALLOWED');
    assert.equal(backend.reportIntegrityEvent(sessionA.token, event({ actualHash: 'not-a-hash' })).error, 'INVALID_INTEGRITY_HASH');
    const missingManifest = backend.validateIntegrityEvent(event({
      changedFileId: 'integrity-manifest',
      path: 'resources/lf-integrity-manifest.json',
      actualHash: 'missing',
      eventType: 'file_missing',
    }));
    assert(missingManifest.ok && missingManifest.relativePath === 'resources/lf-integrity-manifest.json');
    const manifestBypass = backend.validateIntegrityEvent(event({
      changedFileId: 'integrity-manifest',
      path: 'resources/lf-integrity-manifest.json',
      actualHash: '9'.repeat(64),
      eventType: 'integrity_bypass',
    }));
    assert(manifestBypass.ok && manifestBypass.eventType === 'integrity_bypass');
    const unexpectedScript = backend.validateIntegrityEvent(event({
      changedFileId: 'unexpected-script',
      path: 'resources/app.asar.unpacked/injected/runtime.mjs',
      actualHash: '8'.repeat(64),
      eventType: 'unexpected_script',
    }));
    assert(unexpectedScript.ok && unexpectedScript.fileId === 'unexpected-script');
    const installModule = backend.validateIntegrityEvent(event({
      changedFileId: 'install-module',
      path: 'resources/app.asar.unpacked/native/addon.node',
      actualHash: '7'.repeat(64),
      eventType: 'unauthorized_module',
    }));
    assert(installModule.ok && installModule.fileId === 'install-module');
    const missingInstallModule = backend.validateIntegrityEvent(event({
      changedFileId: 'install-module',
      path: 'resources/app.asar.unpacked/native/addon.node',
      actualHash: 'missing',
      eventType: 'file_missing',
    }));
    assert(missingInstallModule.ok && missingInstallModule.actualHash === 'missing');
    assert.equal(backend.validateIntegrityEvent(event({
      changedFileId: 'unexpected-script',
      path: 'C:\\Users\\private.js',
      eventType: 'unexpected_script',
    })).error, 'INTEGRITY_PATH_NOT_ALLOWED');
    assert.equal(backend.validateIntegrityEvent(event({
      changedFileId: 'install-module',
      path: '../private/addon.node',
      eventType: 'unauthorized_module',
    })).error, 'INTEGRITY_PATH_NOT_ALLOWED');
    assert.equal(backend.validateIntegrityEvent(event({
      changedFileId: 'unexpected-script',
      path: 'resources/private.txt',
      eventType: 'unexpected_script',
    })).error, 'INTEGRITY_PATH_NOT_ALLOWED');
    assert.equal(backend.validateIntegrityEvent(event({
      changedFileId: 'unexpected-script',
      path: `${'a'.repeat(241)}.js`,
      eventType: 'unexpected_script',
    })).error, 'INTEGRITY_PATH_NOT_ALLOWED');
    assert.equal(backend.validateIntegrityEvent(event({
      changedFileId: 'unexpected-script',
      path: 'resources/injected.js',
      eventType: 'unauthorized_module',
    })).error, 'INTEGRITY_EVENT_TYPE_REJECTED');

    const pending = backend.reportIntegrityEvent(sessionA.token, event({ actualHash: '1'.repeat(64), confirmed: false }));
    assert(pending.ok && pending.disposition === 'pending' && pending.state === 'clean');
    const first = backend.reportIntegrityEvent(sessionA.token, event());
    assert(first.ok && !first.blocked && first.disposition === 'warned' && first.state === 'warned_pending_ack');
    assert.equal(first.warning.message, DEV_WARNING);
    assert.equal(first.warning.contact, DEV_CONTACT);
    assert.equal(DEV_WARNING, '您没有权限对此软件进行开发，如若继续您的账户将会被自动拉黑。');
    assert.equal(DEV_CONTACT, '如执意开发/进行二创，请联系作者：3599284614@qq.com / 15037841583@139.com。');

    const duplicate = backend.reportIntegrityEvent(sessionA.token, event({ timestamp: Date.now() }));
    assert(duplicate.ok && duplicate.duplicate && duplicate.eventId === first.eventId && duplicate.state === 'warned_pending_ack');
    const beforeAck = backend.reportIntegrityEvent(sessionA.token, event({ actualHash: 'c'.repeat(64) }));
    assert(beforeAck.ok && beforeAck.disposition === 'pending_ack' && !beforeAck.blocked);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM integrity_events WHERE user_id=?').get(userA.id).n, 3);

    const statusBeforeAck = backend.integrityStatus(sessionA.token, { deviceId: 'device-new5-user-a-0001' });
    assert(statusBeforeAck.ok && statusBeforeAck.warning.requiresAcknowledgement, JSON.stringify(statusBeforeAck));
    assert.equal(statusBeforeAck.firstEventId, first.eventId);
    const acknowledged = backend.ackIntegrityWarning(sessionA.token, {
      deviceId: 'device-new5-user-a-0001',
      eventId: first.eventId,
      generation: statusBeforeAck.generation,
    });
    assert(acknowledged.ok && acknowledged.state === 'warned', JSON.stringify(acknowledged));
    const duplicateAck = backend.ackIntegrityWarning(sessionA.token, {
      deviceId: 'device-new5-user-a-0001',
      eventId: first.eventId,
      generation: statusBeforeAck.generation,
    });
    assert(duplicateAck.ok && duplicateAck.duplicate);

    while (Date.now() <= acknowledged.warningAckAt) {}
    const second = backend.reportIntegrityEvent(sessionA.token, event({
      actualHash: 'd'.repeat(64),
      timestamp: acknowledged.warningAckAt - 1000,
    }));
    assert(second.ok && second.blocked && second.disposition === 'blocked' && second.state === 'blocked');
    const blockedUser = backend.db.prepare('SELECT blacklisted,status FROM users WHERE id=?').get(userA.id);
    assert.equal(blockedUser.blacklisted, 1);
    assert.equal(blockedUser.status, 'blocked');
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=? AND revoked_at IS NULL').get(userA.id).n, 0);
    assert.equal(backend.authStatus(secondSessionA.token).error, 'INVALID_SESSION');
    assert(['INVALID_REFRESH', 'BLACKLISTED'].includes(backend.refreshSession(secondSessionA.refreshToken).error));
    assert(backend.authStatus(sessionB.token).ok);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM ban_records WHERE user_id=? AND active=1').get(userA.id).n, 1);

    const unblocked = backend.setUserFlag(admin.token, { userId: userA.id, flag: 'blacklisted', value: false });
    assert(unblocked.ok && !unblocked.user.blacklisted && unblocked.user.status === 'active');
    assert.equal(backend.db.prepare('SELECT state FROM integrity_enforcement WHERE user_id=?').get(userA.id).state, 'clean');
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM ban_records WHERE user_id=? AND active=1').get(userA.id).n, 0);
    sessionA = login(userA.account, 'A PC after unban');

    const granted = backend.setUserFlag(admin.token, { userId: userA.id, flag: 'developerPermission', value: true });
    assert(granted.ok && granted.user.developerPermission);
    const permissionRow = backend.db.prepare("SELECT enabled,updated_by FROM user_permissions WHERE user_id=? AND permission='developer'").get(userA.id);
    assert.equal(permissionRow.enabled, 1);
    assert.equal(permissionRow.updated_by, admin.user.id);
    const authorizedEvent = backend.reportIntegrityEvent(sessionA.token, event({ actualHash: 'e'.repeat(64) }));
    assert(authorizedEvent.ok && authorizedEvent.disposition === 'authorized_development' && !authorizedEvent.blocked);
    assert.equal(backend.db.prepare('SELECT blacklisted FROM users WHERE id=?').get(userA.id).blacklisted, 0);
    assert.equal(backend.db.prepare('SELECT developer_permission FROM users WHERE id=?').get(userB.id).developer_permission, 0);
    const revoked = backend.setUserFlag(admin.token, { userId: userA.id, flag: 'developerPermission', value: false });
    assert(revoked.ok && !revoked.user.developerPermission);
    const persistentAfterPermissionRevoked = backend.reportIntegrityEvent(sessionA.token, event({
      actualHash: 'e'.repeat(64),
      timestamp: Date.now() + 1,
    }));
    assert(persistentAfterPermissionRevoked.ok && persistentAfterPermissionRevoked.rechecked);
    assert(persistentAfterPermissionRevoked.disposition === 'warned' && persistentAfterPermissionRevoked.state === 'warned_pending_ack');

    const release = publishRelease('1.2.4');
    assert.equal(backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: release.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.4',
      sourceManifestId,
      targetManifestId: '0'.repeat(64),
    }).error, 'UPDATE_TARGET_MISMATCH');
    const windowStart = backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: release.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.4',
      sourceManifestId,
      targetManifestId: release.digest,
    });
    assert(windowStart.ok && windowStart.state === 'active' && !windowStart.duplicate);
    const storedWindow = backend.db.prepare('SELECT source_manifest_id,target_manifest_id FROM integrity_update_windows WHERE id=?').get(windowStart.id);
    assert.equal(storedWindow.source_manifest_id, sourceManifestId);
    assert.equal(storedWindow.target_manifest_id, release.digest);
    const windowDuplicate = backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: release.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.4',
      sourceManifestId,
      targetManifestId: release.digest,
    });
    assert(windowDuplicate.ok && windowDuplicate.duplicate && windowDuplicate.id === windowStart.id);
    const mismatchedSource = backend.reportIntegrityEvent(sessionB.token, event({
      deviceId: 'device-new5-user-b-0001',
      manifestId: '4'.repeat(64),
      actualHash: '6'.repeat(64),
    }));
    assert(mismatchedSource.ok && mismatchedSource.disposition === 'warned' && !mismatchedSource.updateSuppressed);
    assert(backend.setUserFlag(admin.token, { userId: userB.id, flag: 'developerPermission', value: true }).ok);
    assert(backend.setUserFlag(admin.token, { userId: userB.id, flag: 'developerPermission', value: false }).ok);
    const suppressed = backend.reportIntegrityEvent(sessionB.token, event({
      deviceId: 'device-new5-user-b-0001',
      manifestId: sourceManifestId,
      actualHash: 'f'.repeat(64),
    }));
    assert(suppressed.ok && suppressed.disposition === 'suppressed_update' && suppressed.updateSuppressed);
    assert.equal(backend.integrityStatus(sessionB.token, { deviceId: 'device-new5-user-b-0001' }).state, 'clean');
    assert.equal(backend.completeIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      windowId: windowStart.id,
      installedVersion: '1.2.3',
      targetManifestId: release.digest,
    }).error, 'UPDATE_TARGET_MISMATCH');
    const completed = backend.completeIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      windowId: windowStart.id,
      installedVersion: '1.2.4',
      targetManifestId: release.digest,
    });
    assert(completed.ok && completed.state === 'completed' && !completed.duplicate);
    const completedAgain = backend.completeIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      windowId: windowStart.id,
      installedVersion: '1.2.4',
      targetManifestId: release.digest,
    });
    assert(completedAgain.ok && completedAgain.duplicate);
    const completedReopen = backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: release.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.4',
      sourceManifestId,
      targetManifestId: release.digest,
    });
    assert.equal(completedReopen.error, 'UPDATE_WINDOW_REOPEN_DENIED');
    assert.equal(completedReopen.state, 'completed');
    const persistentAfterUpdate = backend.reportIntegrityEvent(sessionB.token, event({
      deviceId: 'device-new5-user-b-0001',
      manifestId: sourceManifestId,
      actualHash: 'f'.repeat(64),
      timestamp: completed.completedAt + 1,
    }));
    assert(persistentAfterUpdate.ok && persistentAfterUpdate.rechecked && !persistentAfterUpdate.duplicate);
    assert(persistentAfterUpdate.disposition === 'warned' && persistentAfterUpdate.state === 'warned_pending_ack');
    const persistentDuplicate = backend.reportIntegrityEvent(sessionB.token, event({
      deviceId: 'device-new5-user-b-0001',
      manifestId: sourceManifestId,
      actualHash: 'f'.repeat(64),
      timestamp: completed.completedAt + 2,
    }));
    assert(persistentDuplicate.ok && persistentDuplicate.duplicate && persistentDuplicate.eventId === persistentAfterUpdate.eventId);

    const expiringRelease = publishRelease('1.2.5');
    const expiringWindow = backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: expiringRelease.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.5',
      sourceManifestId,
      targetManifestId: expiringRelease.digest,
    });
    assert(expiringWindow.ok);
    backend.db.prepare('UPDATE integrity_update_windows SET expires_at=? WHERE id=?').run(Date.now() - 1, expiringWindow.id);
    const expiredReopen = backend.startIntegrityUpdateWindow(sessionB.token, {
      deviceId: 'device-new5-user-b-0001',
      releaseId: expiringRelease.releaseId,
      fromVersion: '1.2.3',
      toVersion: '1.2.5',
      sourceManifestId,
      targetManifestId: expiringRelease.digest,
    });
    assert.equal(expiredReopen.error, 'UPDATE_WINDOW_REOPEN_DENIED');
    assert.equal(backend.db.prepare('SELECT state FROM integrity_update_windows WHERE id=?').get(expiringWindow.id).state, 'expired');

    const dashboard = backend.adminDashboard(admin.token);
    const dashboardUserB = dashboard.users.find(user => user.id === userB.id);
    assert(dashboard.ok && dashboardUserB.abnormalBehavior && dashboardUserB.integrityState === 'warned_pending_ack');
    const privacy = backend.privacyNotice();
    assert(privacy.collected.some(item => item.includes('随机设备 ID') && item.includes('SHA-256')));
    assert(privacy.neverCollected.some(item => item.includes('完整进程列表')));
    assert(fs.readFileSync(path.join(projectRoot, 'public', 'lf-monitor.js'), 'utf8').includes('异常行为 · '));

    const auditActions = backend.db.prepare(`SELECT action FROM audit_logs WHERE action LIKE 'security_integrity_%'
      OR action IN ('developer_permission_changed','blacklist_changed')`).all().map(row => row.action);
    for (const action of [
      'security_integrity_warning',
      'security_integrity_warning_acknowledged',
      'security_integrity_auto_blocked',
      'security_integrity_update_started',
      'security_integrity_update_completed',
      'developer_permission_changed',
      'blacklist_changed',
    ]) assert(auditActions.includes(action), `missing audit ${action}`);

    const tableNames = ['integrity_events', 'integrity_enforcement', 'integrity_update_windows'];
    tableNames.forEach(name => assert(backend.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)));
    backend.close();
    backend = null;
    backend = new LFBackend({ dbPath, appVersion: '1.2.4', env, updatePublicKey: publicKey, allowLocalCodes: false });
    tableNames.forEach(name => assert(backend.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)));
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM integrity_events').get().n, 7);

    const checks = {
      migrationIdempotent: true,
      strictPayload: true,
      strictAdminFlagPayload: true,
      integrityManifestEvidenceAllowed: true,
      strictUnexpectedScriptEvidence: true,
      strictInstallModuleEvidence: true,
      independentPermissions: true,
      developerAuthorizedWithoutPunishment: true,
      persistentTamperRecheckedAfterPermissionRevoked: true,
      duplicateEvidenceIdempotent: true,
      warningRequiresAck: true,
      secondDistinctEventBlocks: true,
      serverReceivedTimeEnforced: true,
      allSessionsRevoked: true,
      adminUnblockResetsEnforcement: true,
      updateWindowSuppressesAndCompletes: true,
      updateWindowBoundToReleaseAndSource: true,
      updateWindowCannotReopen: true,
      persistentTamperRecheckedAfterUpdate: true,
      adminShowsIntegrityState: true,
      adminMonitorShowsAbnormalBehavior: true,
      privacyDisclosesIntegrityMetadata: true,
      auditComplete: true,
    };
    const result = {
      ok: true,
      checkedAt: new Date().toISOString(),
      runId,
      evidenceDir,
      checks,
      counts: {
        integrityEvents: 7,
        integrityTables: tableNames.length,
        requiredAuditActions: 7,
      },
    };
    writeResult(result);
    console.log(JSON.stringify({ ok: true, evidenceDir, checks: Object.keys(checks).length, counts: result.counts }));
  } finally {
    if (backend) backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  writeResult({
    ok: false,
    checkedAt: new Date().toISOString(),
    runId,
    evidenceDir,
    error: String(error && error.message || error).slice(0, 500),
  });
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
