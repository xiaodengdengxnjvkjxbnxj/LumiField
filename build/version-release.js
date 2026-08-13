const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const statePath = path.join(__dirname, 'version-state.json');
const manifestPath = path.join(root, 'public', 'version-manifest.json');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

function fingerprint() {
  const files = childProcess.execFileSync('git', [
    'ls-files', '-z', '--', 'server.js', 'dj-analyzer.js', 'desktop', 'public'
  ], { cwd: root }).toString('utf8').split('\0').filter(Boolean)
    .filter(file => path.resolve(root, file) !== manifestPath)
    .sort((a, b) => a.localeCompare(b));
  const digest = crypto.createHash('sha256');
  files.forEach(file => {
    const blob = childProcess.execFileSync('git', [
      'hash-object', `--path=${file}`, '--', file
    ], { cwd: root, encoding: 'utf8' }).trim();
    digest.update(file.replace(/\\/g, '/'));
    digest.update('\0');
    digest.update(blob);
    digest.update('\0');
  });
  return digest.digest('hex');
}

function bumpPatch(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Cannot auto-increment non-semver version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentFingerprint = fingerprint();
let previous = null;
try { previous = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}

if (previous && previous.fingerprint && previous.fingerprint !== currentFingerprint) {
  pkg.version = bumpPatch(pkg.version);
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = pkg.version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = pkg.version;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  } catch (_) {}
  console.log(`  • LumiField source changed; version advanced to ${pkg.version}`);
}

const builtAt = previous
  && previous.version === pkg.version
  && previous.fingerprint === currentFingerprint
  && previous.builtAt
  ? previous.builtAt
  : new Date().toISOString();
const nextState = { version: pkg.version, fingerprint: currentFingerprint, builtAt };
fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify({ version: pkg.version, sourceSha256: currentFingerprint, builtAt, releaseRequiresAdminConfirmation: true }, null, 2) + '\n');
console.log(`  • LumiField version manifest ready  version=${pkg.version}`);
