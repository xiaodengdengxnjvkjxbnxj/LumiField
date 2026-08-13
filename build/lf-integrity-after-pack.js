'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const standardAfterPack = require('./after-pack');
const {
  MANIFEST_FILE,
  listInstallModules,
  manifestSigningPayload,
  stableDoubleHash,
  verifyManifestSignature,
} = require('../desktop/lf-integrity');

function defaultPrivateKeyPath() {
  return path.resolve(
    process.env.LF_UPDATE_PRIVATE_KEY ||
    path.join(os.homedir(), '.lumifield-release', 'update-private.pem')
  );
}

async function generateIntegrityManifest(options) {
  const appOutDir = path.resolve(options.appOutDir);
  const resourcesPath = path.resolve(options.resourcesPath || path.join(appOutDir, 'resources'));
  const executableName = String(options.executableName || 'LumiField.exe');
  if (path.basename(executableName) !== executableName) {
    throw new Error('Integrity executableName must be a filename.');
  }
  const appAsarPath = path.join(resourcesPath, 'app.asar');
  const ffmpegPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  const executablePath = path.join(appOutDir, executableName);
  const privateKeyPath = path.resolve(options.privateKeyPath || defaultPrivateKeyPath());
  const publicKeyPath = path.resolve(options.publicKeyPath);
  for (const filePath of [appAsarPath, executablePath, ffmpegPath, privateKeyPath, publicKeyPath]) {
    if (!fs.existsSync(filePath)) throw new Error(`Integrity build input is missing: ${filePath}`);
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  const derivedPublic = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const configuredPublic = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  if (!Buffer.from(derivedPublic).equals(Buffer.from(configuredPublic))) {
    throw new Error('Integrity signing key does not match build/lf-update-public.pem.');
  }

  const appAsar = await stableDoubleHash(appAsarPath, { delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs });
  const executable = await stableDoubleHash(executablePath, { delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs });
  const ffmpeg = await stableDoubleHash(ffmpegPath, { delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs });
  const modulePaths = await listInstallModules(appOutDir);
  const modules = [];
  for (const relativePath of modulePaths) {
    const moduleFile = await stableDoubleHash(path.resolve(appOutDir, relativePath), {
      delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs,
    });
    modules.push({
      path: relativePath,
      size: moduleFile.size,
      sha256: moduleFile.sha256,
    });
  }
  const manifest = {
    schema: 1,
    product: 'LumiField',
    version: String(options.version || ''),
    generatedAt: new Date().toISOString(),
    algorithm: 'RSA-SHA256',
    files: [
      {
        id: 'app.asar',
        scope: 'resources',
        path: 'app.asar',
        size: appAsar.size,
        sha256: appAsar.sha256,
      },
      {
        id: 'executable',
        scope: 'install',
        path: executableName,
        size: executable.size,
        sha256: executable.sha256,
      },
      {
        id: 'ffmpeg',
        scope: 'resources',
        path: 'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe',
        size: ffmpeg.size,
        sha256: ffmpeg.sha256,
      },
    ],
    modules,
  };
  manifest.signature = crypto.sign('sha256', manifestSigningPayload(manifest), privateKey).toString('base64');
  if (!verifyManifestSignature(manifest, publicKey)) {
    throw new Error('Integrity manifest signature self-check failed.');
  }
  const manifestPath = path.join(resourcesPath, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifest, manifestPath, appAsarPath, executablePath };
}

module.exports = async function integrityAfterPack(context) {
  await standardAfterPack(context);
  if (context.electronPlatformName !== 'win32') return;
  const executableName = `${context.packager.appInfo.productFilename || 'LumiField'}.exe`;
  const result = await generateIntegrityManifest({
    appOutDir: context.appOutDir,
    resourcesPath: path.join(context.appOutDir, 'resources'),
    executableName,
    version: context.packager.appInfo.version,
    privateKeyPath: defaultPrivateKeyPath(),
    publicKeyPath: path.join(context.packager.projectDir, 'build', 'lf-update-public.pem'),
  });
  console.log(`  • signed LumiField integrity manifest  ${result.manifestPath}`);
};

module.exports.defaultPrivateKeyPath = defaultPrivateKeyPath;
module.exports.generateIntegrityManifest = generateIntegrityManifest;
