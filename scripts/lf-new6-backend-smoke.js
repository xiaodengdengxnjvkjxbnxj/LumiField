const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LFBackend } = require('../desktop/lf-backend');
const presetSchema = require('../public/lumifield-preset-schema');

const projectRoot = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW6_BACKEND_OUT ||
  path.join(projectRoot, 'test-results', 'lf-new6-backend', runId));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new6-backend-'));
const dbPath = path.join(root, 'new6.sqlite3');
const env = { LF_PRESET_SHARE_HMAC_SECRET: 'new6-test-server-hmac-secret-32-bytes-minimum' };
let backend;

fs.mkdirSync(evidenceDir, { recursive: true });

function writeResult(result) {
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function register(account, nickname) {
  const sent = await backend.sendVerificationCode({ account, purpose: 'register', requestIp: `new6-${nickname}` });
  assert(sent.ok && /^\d{6}$/.test(sent.localCode));
  const verified = backend.verifyVerificationCode({ account, purpose: 'register', code: sent.localCode });
  assert(verified.ok);
  const result = backend.register({
    account,
    nickname,
    password: 'NormalUser123',
    verificationTicket: verified.ticket,
  });
  assert(result.ok);
  return result.user;
}

function login(account, deviceName) {
  const result = backend.login({ account, password: 'NormalUser123', deviceType: 'pc', deviceName });
  assert(result.ok);
  return result;
}

function validPreset(name = 'Aurora Field') {
  return {
    type: presetSchema.TYPE,
    schema: presetSchema.SCHEMA,
    version: presetSchema.VERSION,
    presetId: 'local-only-preset-id',
    createdAt: 1710000000000,
    name,
    visual: { preset: 3, intensity: 1.12, visualTintMode: 'custom', visualTintColor: '#3366ff' },
    particles: { point: 1.1, speed: 0.9, bloom: true },
    lyrics: { mode: 'animation', translate: true, lyricFont: 'Microsoft YaHei' },
    spectrum: { enabled: true, mode: 3, bandCount: 96 },
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

(async () => {
  try {
    backend = new LFBackend({ dbPath, appVersion: '1.2.4', env, allowLocalCodes: true });
    const userA = await register('new6-a@example.test', 'New6 A');
    const userB = await register('new6-b@example.test', 'New6 B');
    const userC = await register('new6-c@example.test', 'New6 C');
    const sessionA = login(userA.account, 'New6 A PC');
    const sessionB = login(userB.account, 'New6 B PC');
    const sessionC = login(userC.account, 'New6 C PC');

    assert.equal(backend.createPresetShare('', { canonical: validPreset() }).error, 'INVALID_SESSION');
    assert.equal(backend.createPresetShare(sessionA.token, { preset: validPreset() }).error, 'PRESET_SHARE_FIELD_REJECTED');
    assert.equal(backend.createPresetShare(sessionA.token, { canonical: validPreset(), unknown: true }).error, 'PRESET_SHARE_FIELD_REJECTED');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), mystery: { enabled: true } },
    }).error, 'PRESET_SCHEMA_INVALID');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), version: 99 },
    }).error, 'PRESET_SCHEMA_UNSUPPORTED');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), accessToken: 'must-not-share' },
    }).error, 'PRESET_SENSITIVE_DATA');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: validPreset('C:\\Users\\private\\preset.json'),
    }).error, 'PRESET_SENSITIVE_DATA');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), lyrics: { ...validPreset().lyrics, lyricFont: 'file:///private/font.ttf' } },
    }).error, 'PRESET_SENSITIVE_DATA');
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: validPreset('x'.repeat(70 * 1024)),
    }).error, 'PRESET_PAYLOAD_TOO_LARGE');

    let deep = { value: true };
    for (let index = 0; index < 10; index += 1) deep = { nested: deep };
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), deep },
    }).error, 'PRESET_SCHEMA_INVALID');
    const manyKeys = {};
    for (let index = 0; index < 520; index += 1) manyKeys[`key${index}`] = index;
    assert.equal(backend.createPresetShare(sessionA.token, {
      canonical: { ...validPreset(), manyKeys },
    }).error, 'PRESET_SCHEMA_INVALID');

    const created = backend.createPresetShare(sessionA.token, {
      canonical: validPreset(),
      requestIp: '198.51.100.10',
    });
    assert(created.ok);
    assert(/^LF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(created.code));
    assert(created.share && created.share.status === 'active' && !Object.hasOwn(created.share, 'ownerUserId'));
    const stored = backend.db.prepare('SELECT * FROM preset_shares WHERE id=?').get(created.share.id);
    assert.equal(stored.code_hash, hash(created.code));
    assert(!stored.preset_json.includes('local-only-preset-id'));
    assert(!stored.preset_json.includes('1710000000000'));
    assert(!JSON.stringify(stored).includes(created.code));
    const ipAttempt = backend.db.prepare("SELECT request_key FROM preset_share_attempts WHERE action='create' AND status='created' ORDER BY created_at DESC LIMIT 1").get();
    const hmacKey = crypto.createHash('sha256').update(env.LF_PRESET_SHARE_HMAC_SECRET).digest();
    const expectedRequestKey = crypto.createHmac('sha256', hmacKey).update('preset-share-ip:198.51.100.10').digest('hex');
    assert.equal(ipAttempt.request_key, expectedRequestKey);
    assert.notEqual(ipAttempt.request_key, hash('preset-share-ip:198.51.100.10'));

    const mineA = backend.listPresetShares(sessionA.token, {});
    const mineB = backend.listPresetShares(sessionB.token, {});
    assert(mineA.ok && mineA.shares.length === 1 && !Object.hasOwn(mineA.shares[0], 'code'));
    assert(mineB.ok && mineB.shares.length === 0);
    assert.equal(backend.revokePresetShare(sessionB.token, { shareId: created.share.id }).error, 'NOT_FOUND');

    const redeemed = backend.redeemPresetShare(sessionB.token, {
      code: created.code.toLowerCase(),
      requestIp: '198.51.100.11',
    });
    assert(redeemed.ok && redeemed.share.redemptionCount === 1);
    assert.deepEqual(redeemed.preset, JSON.parse(stored.preset_json));
    assert(!JSON.stringify(redeemed).includes(userA.account));
    assert(!Object.hasOwn(redeemed.share, 'ownerUserId'));

    const corruptHashShare = backend.createPresetShare(sessionC.token, { canonical: validPreset('Hash Check') });
    assert(corruptHashShare.ok);
    backend.db.prepare("UPDATE preset_shares SET preset_json=preset_json||' ' WHERE id=?").run(corruptHashShare.share.id);
    assert.equal(backend.redeemPresetShare(sessionB.token, { code: corruptHashShare.code }).error, 'PRESET_SHARE_CORRUPT');

    const unsupportedSchemaShare = backend.createPresetShare(sessionC.token, { canonical: validPreset('Version Check') });
    assert(unsupportedSchemaShare.ok);
    backend.db.prepare('UPDATE preset_shares SET schema_version=99 WHERE id=?').run(unsupportedSchemaShare.share.id);
    assert.equal(backend.redeemPresetShare(sessionB.token, { code: unsupportedSchemaShare.code }).error, 'PRESET_SCHEMA_UNSUPPORTED');

    const corruptSchemaShare = backend.createPresetShare(sessionC.token, { canonical: validPreset('Schema Check') });
    assert(corruptSchemaShare.ok);
    const invalidStoredPreset = JSON.stringify({
      type: presetSchema.TYPE,
      schema: presetSchema.SCHEMA,
      version: presetSchema.VERSION,
      name: 'Schema Check',
      visual: { preset: 3 },
      unknownPrivateField: 'not-allowed',
    });
    backend.db.prepare('UPDATE preset_shares SET preset_json=?,preset_hash=? WHERE id=?')
      .run(invalidStoredPreset, hash(invalidStoredPreset), corruptSchemaShare.share.id);
    assert.equal(backend.redeemPresetShare(sessionB.token, { code: corruptSchemaShare.code }).error, 'PRESET_SCHEMA_INVALID');

    const revoked = backend.revokePresetShare(sessionA.token, { shareId: created.share.id });
    assert(revoked.ok && revoked.revoked && !revoked.duplicate && revoked.share.status === 'revoked');
    const revokeAgain = backend.revokePresetShare(sessionA.token, { shareId: created.share.id });
    assert(revokeAgain.ok && revokeAgain.duplicate);
    assert.equal(backend.redeemPresetShare(sessionB.token, { code: created.code }).error, 'REVOKED');
    const missingCode = created.code === 'LF-0000-0000-0000' ? 'LF-1111-1111-1111' : 'LF-0000-0000-0000';
    assert.equal(backend.redeemPresetShare(sessionB.token, { code: missingCode }).error, 'NOT_FOUND');

    let limited = null;
    for (let index = 1; index <= 12; index += 1) {
      const code = `LF-2222-2222-${String(index).padStart(4, '0')}`;
      const attempt = backend.redeemPresetShare(sessionB.token, { code });
      if (attempt.error === 'RATE_LIMITED') {
        limited = attempt;
        break;
      }
      assert.equal(attempt.error, 'NOT_FOUND');
    }
    assert(limited && limited.retryAfterMs >= 1000);
    const attemptsAtLimit = backend.db.prepare('SELECT COUNT(*) AS count FROM preset_share_attempts').get().count;
    const rateLimitAuditsAtLimit = backend.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action='preset_share_rate_limited'",
    ).get().count;
    for (let index = 0; index < 200; index += 1) {
      const repeated = backend.redeemPresetShare(sessionB.token, {
        code: 'LF-3333-3333-3333',
        requestIp: '198.51.100.11',
      });
      assert.equal(repeated.error, 'RATE_LIMITED');
    }
    assert.equal(
      backend.db.prepare('SELECT COUNT(*) AS count FROM preset_share_attempts').get().count,
      attemptsAtLimit,
    );
    assert.equal(
      backend.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='preset_share_rate_limited'").get().count,
      rateLimitAuditsAtLimit,
    );

    const expiredAttemptAt = Date.now() - 2 * 60 * 60 * 1000;
    backend.db.prepare(`INSERT INTO preset_share_attempts(id,user_id,action,request_key,code_hash,status,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(
      'preset_attempt_expired_new6',
      userC.id,
      'mine',
      'expired-request-key',
      '',
      'listed',
      expiredAttemptAt,
    );
    backend.presetShareAttemptsCleanedAt = 0;
    backend.listPresetShares(sessionC.token, { requestIp: '198.51.100.12' });
    assert.equal(
      backend.db.prepare("SELECT COUNT(*) AS count FROM preset_share_attempts WHERE id='preset_attempt_expired_new6'").get().count,
      0,
    );

    const attemptsBeforeRestart = backend.db.prepare('SELECT COUNT(*) AS count FROM preset_share_attempts').get().count;
    assert(attemptsBeforeRestart >= 10);
    const auditActions = backend.db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'preset_share_%'").all()
      .map(row => row.action);
    for (const action of [
      'preset_share_created',
      'preset_share_redeemed',
      'preset_share_revoked',
      'preset_share_redeem_abuse',
      'preset_share_rate_limited',
      'preset_share_integrity_failed',
      'preset_share_schema_failed',
    ]) assert(auditActions.includes(action), `missing audit ${action}`);

    backend.close();
    backend = null;
    const databaseBytes = fs.readFileSync(dbPath);
    for (const shareResult of [created, corruptHashShare, unsupportedSchemaShare, corruptSchemaShare]) {
      assert(!databaseBytes.includes(Buffer.from(shareResult.code, 'utf8')));
    }
    assert(!databaseBytes.includes(Buffer.from('198.51.100.10', 'utf8')));
    backend = new LFBackend({ dbPath, appVersion: '1.2.4', env, allowLocalCodes: false });
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS count FROM preset_share_attempts').get().count, attemptsBeforeRestart);
    const restoredMine = backend.listPresetShares(sessionA.token, {});
    assert(restoredMine.ok && restoredMine.shares.some(share => share.id === created.share.id && share.status === 'revoked'));
    for (const table of ['preset_shares', 'preset_share_attempts']) {
      assert(backend.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    const fallbackDbPath = path.join(root, 'new6-fallback-secret.sqlite3');
    const fallbackA = new LFBackend({ dbPath: fallbackDbPath, appVersion: '1.2.4', env: {} });
    const fallbackKey = Buffer.from(fallbackA.presetShareHmacKey);
    const storedSecret = fallbackA.db.prepare("SELECT value FROM system_meta WHERE key='preset_share_hmac_secret_v1'").get();
    assert(storedSecret && storedSecret.value && !storedSecret.value.includes('198.51.100.10'));
    fallbackA.close();
    const fallbackB = new LFBackend({ dbPath: fallbackDbPath, appVersion: '1.2.4', env: {} });
    assert(fallbackKey.equals(fallbackB.presetShareHmacKey));
    fallbackB.close();

    const checks = {
      crockfordCSPRNGCode: true,
      plaintextCodeNeverPersisted: true,
      canonicalNormalizeAndSanitize: true,
      canonicalTransportContractStrict: true,
      unsupportedSchemaDistinguished: true,
      strictUnknownAndSensitiveRejection: true,
      privatePathAndUriRejected: true,
      payloadDepthAndKeyLimits: true,
      twoAccountIsolation: true,
      redeemContractHasNoOwnerAccount: true,
      notFoundAndRevokedDistinct: true,
      ownerRevokeAndIdempotency: true,
      persistentAttemptsAndRateLimit: true,
      requestIpProtectedByStableHmac: true,
      abuseAuditRecorded: true,
      rateLimitedAttemptsAndAuditsBounded: true,
      expiredAttemptsCleaned: true,
      redeemRevalidatesHash: true,
      redeemRevalidatesSchema: true,
      migrationIdempotent: true,
    };
    const result = {
      ok: true,
      checkedAt: new Date().toISOString(),
      runId,
      evidenceDir,
      checks,
      counts: {
        shares: backend.db.prepare('SELECT COUNT(*) AS count FROM preset_shares').get().count,
        attempts: backend.db.prepare('SELECT COUNT(*) AS count FROM preset_share_attempts').get().count,
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
