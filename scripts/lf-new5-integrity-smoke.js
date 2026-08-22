'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const {
  createIntegrityStatusHook,
  createIntegrityVerifier,
  hashFile,
  manifestSigningPayload,
  stableDoubleHash,
  verifyInstalledApplication,
} = require('../desktop/lf-integrity');
const { generateIntegrityManifest } = require('../build/lf-integrity-after-pack');

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(
  process.env.LF_NEW5_INTEGRITY_OUT ||
  path.join(repo, 'test-results', 'lf-new5-integrity', runId)
);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-integrity-'));
const appOutDir = path.join(fixtureRoot, 'LumiField');
const resourcesPath = path.join(appOutDir, 'resources');
const appAsarPath = path.join(resourcesPath, 'app.asar');
const executablePath = path.join(appOutDir, 'LumiField.exe');
const ffmpegPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const nativeModulePath = path.join(resourcesPath, 'app.asar.unpacked', 'native', 'addon.node');
const manifestPath = path.join(resourcesPath, 'lf-integrity-manifest.json');
const publicKeyPath = path.join(fixtureRoot, 'lf-update-public.pem');
const privateKeyPath = path.join(fixtureRoot, 'update-private.pem');
const checks = {};

fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(resourcesPath, { recursive: true });

function pass(name, condition, detail) {
  assert.ok(condition, name + ': ' + JSON.stringify(detail));
  checks[name] = detail == null ? true : detail;
}

function signManifest(manifest, privateKey) {
  const next = JSON.parse(JSON.stringify(manifest));
  delete next.signature;
  next.signature = crypto.sign('sha256', manifestSigningPayload(next), privateKey).toString('base64');
  return next;
}

function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function staticAudit() {
  const runtime = fs.readFileSync(path.join(repo, 'desktop', 'lf-integrity.js'), 'utf8');
  const hook = fs.readFileSync(path.join(repo, 'build', 'lf-integrity-after-pack.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  pass('runtime has no private-root or process enumeration',
    !/(?:Get-Process|tasklist|wmic|processList|homedir\(\)|USERPROFILE|Documents|Desktop)/i.test(runtime) &&
      runtime.includes('listInstallModules(installPath)'),
    true);
  pass('runtime allowlist is restricted to app.asar, executable and pinned FFmpeg',
    /ALLOWED_FILE_IDS\s*=\s*Object\.freeze\(\[['"]app\.asar['"],\s*['"]executable['"],\s*['"]ffmpeg['"]\]\)/.test(runtime),
    true);
  pass('runtime performs stable two-pass hashing',
    (runtime.match(/await hashFile\(filePath\)/g) || []).length === 2 &&
      runtime.includes('FILE_CHANGED_DURING_HASH'),
    true);
  pass('manifest signature uses RSA SHA-256',
    hook.includes("crypto.sign('sha256'") &&
      runtime.includes("crypto.verify('sha256'") &&
      hook.includes("algorithm: 'RSA-SHA256'"),
    true);
  pass('main package uses composite integrity afterPack while monitor remains independent',
    pkg.build.afterPack === 'build/lf-integrity-after-pack.js',
    pkg.build.afterPack);
}

async function createFixture() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, 'utf8');
  fs.writeFileSync(appAsarPath, crypto.randomBytes(131077));
  fs.writeFileSync(executablePath, crypto.randomBytes(262151));
  fs.mkdirSync(path.dirname(ffmpegPath), { recursive: true });
  fs.writeFileSync(ffmpegPath, crypto.randomBytes(65539));
  fs.mkdirSync(path.dirname(nativeModulePath), { recursive: true });
  const nativeModuleBytes = crypto.randomBytes(32771);
  fs.writeFileSync(nativeModulePath, nativeModuleBytes);
  const generated = await generateIntegrityManifest({
    appOutDir,
    resourcesPath,
    executableName: 'LumiField.exe',
    version: '9.8.7',
    privateKeyPath,
    publicKeyPath,
    hashDelayMs: 0,
  });
  return { privateKey, publicKey, manifest: generated.manifest, nativeModuleBytes };
}

function verifyOptions(publicKey) {
  return {
    isPackaged: true,
    execPath: executablePath,
    resourcesPath,
    manifestPath,
    publicKey,
    hashDelayMs: 0,
  };
}

async function run() {
  staticAudit();
  const fixture = await createFixture();
  const directAsarHash = await hashFile(appAsarPath);
  const directExeHash = await hashFile(executablePath);
  const directFfmpegHash = await hashFile(ffmpegPath);
  const generatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  pass('build manifest contains true final fixture hashes',
    generatedManifest.files[0].sha256 === directAsarHash &&
      generatedManifest.files[0].size === fs.statSync(appAsarPath).size &&
      generatedManifest.files[1].sha256 === directExeHash &&
      generatedManifest.files[1].size === fs.statSync(executablePath).size &&
      generatedManifest.files[2].id === 'ffmpeg' &&
      generatedManifest.files[2].sha256 === directFfmpegHash &&
      generatedManifest.files[2].size === fs.statSync(ffmpegPath).size &&
      generatedManifest.modules.length === 1 &&
      generatedManifest.modules[0].path === 'resources/app.asar.unpacked/native/addon.node' &&
      generatedManifest.modules[0].sha256 === await hashFile(nativeModulePath),
    { files: generatedManifest.files, modules: generatedManifest.modules });

  const phases = [];
  const valid = await verifyInstalledApplication({
    ...verifyOptions(fixture.publicKey),
    onStatus(status) { phases.push(status.reason); },
  });
  pass('valid signed installation verifies all pinned files twice',
    valid.ok &&
      valid.enforced &&
      valid.reason === 'VERIFIED' &&
      valid.appVersion === '9.8.7' &&
      /^[a-f0-9]{64}$/.test(valid.manifestId) &&
      valid.files.length === 3 &&
      valid.modules.length === 1 &&
      valid.files.every((file) => file.passes === 2) &&
      phases.filter((item) => item === 'HASHING').length === 3,
    { valid, phases });

  fs.appendFileSync(nativeModulePath, Buffer.from('module-tamper'));
  const changedModule = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('signed native module replacement is detected inside the install directory only',
    !changedModule.ok &&
      changedModule.reason === 'UNAUTHORIZED_MODULE' &&
      changedModule.changedFileId === 'install-module' &&
      changedModule.path === 'resources/app.asar.unpacked/native/addon.node' &&
      /^[a-f0-9]{64}$/.test(changedModule.expectedHash) &&
      /^[a-f0-9]{64}$/.test(changedModule.actualHash),
    changedModule);
  fs.writeFileSync(nativeModulePath, fixture.nativeModuleBytes);

  const unexpectedScriptPath = path.join(resourcesPath, 'injected', 'runtime.mjs');
  fs.mkdirSync(path.dirname(unexpectedScriptPath), { recursive: true });
  fs.writeFileSync(unexpectedScriptPath, 'export default true;');
  const unexpectedScript = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('new unlisted script in the install directory is detected without reading private roots',
    !unexpectedScript.ok &&
      unexpectedScript.reason === 'UNEXPECTED_SCRIPT' &&
      unexpectedScript.changedFileId === 'unexpected-script' &&
      unexpectedScript.path === 'resources/injected/runtime.mjs' &&
      /^[a-f0-9]{64}$/.test(unexpectedScript.expectedHash) &&
      /^[a-f0-9]{64}$/.test(unexpectedScript.actualHash),
    unexpectedScript);
  fs.rmSync(path.dirname(unexpectedScriptPath), { recursive: true, force: true });

  const unsignedChange = JSON.parse(JSON.stringify(fixture.manifest));
  unsignedChange.version = '9.8.8';
  writeManifest(unsignedChange);
  const badSignature = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('unsigned manifest modification is rejected before hashing',
    !badSignature.ok &&
      badSignature.reason === 'MANIFEST_SIGNATURE_INVALID' &&
      badSignature.changedFileId === 'integrity-manifest' &&
      badSignature.path === 'resources/lf-integrity-manifest.json' &&
      /^[a-f0-9]{64}$/.test(badSignature.expectedHash) &&
      /^[a-f0-9]{64}$/.test(badSignature.actualHash) &&
      badSignature.files.length === 0,
    badSignature);

  const traversal = JSON.parse(JSON.stringify(fixture.manifest));
  traversal.files[0].path = '..\\private-user-file.txt';
  writeManifest(signManifest(traversal, fixture.privateKey));
  const traversalResult = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('signed traversal path is rejected without reading target',
    !traversalResult.ok &&
      traversalResult.reason === 'PATH_TRAVERSAL' &&
      traversalResult.fileId === 'app.asar',
    traversalResult);

  const extraFile = JSON.parse(JSON.stringify(fixture.manifest));
  extraFile.files.push({
    id: 'user-code',
    scope: 'install',
    path: 'user.js',
    size: 1,
    sha256: '0'.repeat(64),
  });
  writeManifest(signManifest(extraFile, fixture.privateKey));
  const extraResult = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('signed extra file declaration is rejected by exact file set',
    !extraResult.ok && extraResult.reason === 'MANIFEST_FILE_SET_INVALID',
    extraResult);

  writeManifest(fixture.manifest);
  const hiddenExecutablePath = executablePath + '.missing';
  fs.renameSync(executablePath, hiddenExecutablePath);
  const missingExecutable = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  fs.renameSync(hiddenExecutablePath, executablePath);
  pass('missing executable evidence includes signed expectation and safe relative path',
    !missingExecutable.ok &&
      missingExecutable.reason === 'FILE_MISSING' &&
      missingExecutable.fileId === 'executable' &&
      missingExecutable.relativePath === 'LumiField.exe' &&
      missingExecutable.version === '9.8.7' &&
      missingExecutable.appVersion === '9.8.7' &&
      /^[a-f0-9]{64}$/.test(missingExecutable.manifestId) &&
      missingExecutable.changedFileId === 'lumifield-exe' &&
      missingExecutable.path === 'LumiField.exe' &&
      missingExecutable.expectedHash === fixture.manifest.files[1].sha256 &&
      missingExecutable.actualHash === '' &&
      missingExecutable.expected.sha256 === fixture.manifest.files[1].sha256 &&
      missingExecutable.expected.size === fixture.manifest.files[1].size,
    missingExecutable);

  fs.appendFileSync(appAsarPath, Buffer.from('tamper'));
  const tampered = await verifyInstalledApplication(verifyOptions(fixture.publicKey));
  pass('tampered app.asar produces an accurate hash mismatch',
    !tampered.ok &&
      tampered.enforced &&
      tampered.reason === 'HASH_MISMATCH' &&
      tampered.fileId === 'app.asar' &&
      tampered.relativePath === 'app.asar' &&
      tampered.version === '9.8.7' &&
      tampered.appVersion === '9.8.7' &&
      /^[a-f0-9]{64}$/.test(tampered.manifestId) &&
      tampered.changedFileId === 'app-asar' &&
      tampered.path === 'resources/app.asar' &&
      tampered.expectedHash === fixture.manifest.files[0].sha256 &&
      tampered.actualHash === tampered.actual.sha256 &&
      tampered.expected.sha256 === fixture.manifest.files[0].sha256,
    tampered);
  fs.writeFileSync(appAsarPath, crypto.randomBytes(65537));

  let mutationCode = '';
  try {
    await stableDoubleHash(appAsarPath, {
      delayMs: 0,
      betweenReads() {
        fs.appendFileSync(appAsarPath, Buffer.from('changed-between-passes'));
      },
    });
  } catch (error) {
    mutationCode = error.code;
  }
  pass('two-pass hash detects a file changing between reads',
    mutationCode === 'FILE_CHANGED_DURING_HASH',
    mutationCode);

  const development = await verifyInstalledApplication({ isPackaged: false });
  pass('development mode is accurately non-enforced',
    development.ok && !development.enforced && development.reason === 'NOT_PACKAGED',
    development);

  const absentRoot = path.join(fixtureRoot, 'manifest-absent');
  fs.mkdirSync(path.join(absentRoot, 'resources'), { recursive: true });
  const missing = await verifyInstalledApplication({
    isPackaged: true,
    execPath: path.join(absentRoot, 'LumiField.exe'),
    resourcesPath: path.join(absentRoot, 'resources'),
    appVersion: '9.8.7',
    publicKey: fixture.publicKey,
  });
  pass('packaged installation rejects a missing signed manifest with policy-only evidence',
    !missing.ok && missing.enforced && missing.reason === 'MANIFEST_MISSING' &&
      missing.changedFileId === 'integrity-manifest' &&
      missing.path === 'resources/lf-integrity-manifest.json' &&
      /^[a-f0-9]{64}$/.test(missing.expectedHash) &&
      missing.actualHash === '' &&
      missing.appVersion === '9.8.7',
    missing);

  const sent = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, status) => sent.push({ channel, status }),
    },
  };
  const windowHook = createIntegrityStatusHook(() => fakeWindow);
  pass('window status hook publishes without owning window lifecycle',
    windowHook(valid) && sent.length === 1 && sent[0].channel === 'lf-integrity-status' && sent[0].status.reason === 'VERIFIED',
    sent);

  const verifierEvents = [];
  const verifier = createIntegrityVerifier({ isPackaged: false });
  const unsubscribe = verifier.subscribe((status) => verifierEvents.push(status.reason));
  const verifierStatus = await verifier.verify();
  unsubscribe();
  pass('verifier exposes subscription and last-status hooks',
    verifierStatus.reason === 'NOT_PACKAGED' &&
      verifier.getStatus().reason === 'NOT_PACKAGED' &&
      verifierEvents.includes('NOT_PACKAGED'),
    verifierEvents);

  const result = {
    ok: true,
    runId,
    output,
    checkCount: Object.keys(checks).length,
    checks,
  };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    output,
    checkCount: result.checkCount,
  }, null, 2));
}

run().catch((error) => {
  const failure = {
    ok: false,
    error: String(error && error.stack || error),
    output,
    checks,
  };
  try { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify(failure, null, 2)); } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch (_) {}
});
