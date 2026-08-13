'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { verifyInstalledApplication } = require('../desktop/lf-integrity');

const repo = path.resolve(__dirname, '..');
const installRoot = path.resolve(process.env.LF_NEW5_INSTALL_ROOT || path.join(repo, 'dist', 'win-unpacked'));
const executablePath = path.join(installRoot, 'LumiField.exe');
const resourcesPath = path.join(installRoot, 'resources');
const publicKeyPath = path.join(repo, 'build', 'lf-update-public.pem');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(
  process.env.LF_NEW5_PACKAGED_OUT ||
  path.join(repo, 'test-results', 'lf-new5-packaged', runId)
);

async function run() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const status = await verifyInstalledApplication({
    isPackaged: true,
    execPath: executablePath,
    resourcesPath,
    appPath: path.join(resourcesPath, 'app.asar'),
    publicKey: fs.readFileSync(publicKeyPath, 'utf8'),
    hashDelayMs: 20,
  });
  assert.equal(status.reason, 'VERIFIED');
  assert(status.ok && status.enforced);
  assert(/^[a-f0-9]{64}$/.test(status.manifestId));
  assert.deepEqual(status.files.map(file => file.id).sort(), ['app.asar', 'executable', 'ffmpeg']);
  assert(status.files.every(file => file.passes === 2));
  assert(Array.isArray(status.modules));
  const result = {
    ok: true,
    runId,
    evidenceDir,
    installRoot,
    version: status.version,
    manifestId: status.manifestId,
    coreFiles: status.files.map(file => ({ id: file.id, size: file.size, passes: file.passes })),
    signedModules: status.modules,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
}

run().catch(error => {
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify({
      ok: false,
      runId,
      evidenceDir,
      installRoot,
      error: String(error && error.stack || error),
    }, null, 2)}\n`, 'utf8');
  } catch (_) {}
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
