'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let diskFs = fs;
try { diskFs = require('original-fs'); } catch (_) {}

const MANIFEST_FILE = 'lf-integrity-manifest.json';
const PUBLIC_KEY_RELATIVE_PATH = path.join('build', 'lf-update-public.pem');
const ALLOWED_FILE_IDS = Object.freeze(['app.asar', 'executable', 'ffmpeg']);
const INSTALL_MODULE_EXTENSIONS = Object.freeze(['.js', '.cjs', '.mjs', '.node', '.asar', '.wasm']);

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ':' + canonicalJson(value[key])
  ).join(',') + '}';
}

function manifestSignedFields(manifest) {
  return {
    schema: Number(manifest && manifest.schema) || 0,
    product: String(manifest && manifest.product || ''),
    version: String(manifest && manifest.version || ''),
    generatedAt: String(manifest && manifest.generatedAt || ''),
    algorithm: String(manifest && manifest.algorithm || ''),
    files: Array.isArray(manifest && manifest.files)
      ? manifest.files.map((file) => ({
        id: String(file && file.id || ''),
        scope: String(file && file.scope || ''),
        path: String(file && file.path || ''),
        size: Number(file && file.size) || 0,
        sha256: String(file && file.sha256 || '').toLowerCase(),
      }))
      : [],
    modules: Array.isArray(manifest && manifest.modules)
      ? manifest.modules.map((file) => ({
        path: String(file && file.path || '').replace(/\\/g, '/'),
        size: Number(file && file.size) || 0,
        sha256: String(file && file.sha256 || '').toLowerCase(),
      }))
      : [],
  };
}

function manifestSigningPayload(manifest) {
  return Buffer.from(canonicalJson(manifestSignedFields(manifest)), 'utf8');
}

function verifyManifestSignature(manifest, publicKey) {
  try {
    if (!manifest || manifest.algorithm !== 'RSA-SHA256') return false;
    const signature = Buffer.from(String(manifest.signature || ''), 'base64');
    if (!signature.length) return false;
    return crypto.verify('sha256', manifestSigningPayload(manifest), publicKey, signature);
  } catch (_) {
    return false;
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function installRelativePath(root, candidate) {
  return path.relative(path.resolve(root), path.resolve(candidate)).replace(/\\/g, '/');
}

function isInstallModulePath(relativePath) {
  const value = String(relativePath || '').replace(/\\/g, '/');
  return !!value &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split('/').includes('..') &&
    INSTALL_MODULE_EXTENSIONS.includes(path.extname(value).toLowerCase()) &&
    value.toLowerCase() !== 'resources/app.asar';
}

async function listInstallModules(installPath) {
  const root = path.resolve(installPath);
  const stack = [root];
  const modules = [];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = await diskFs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.resolve(directory, entry.name);
      if (!isPathInside(root, candidate)) continue;
      if (entry.isDirectory()) {
        stack.push(candidate);
      } else if (entry.isFile()) {
        const relativePath = installRelativePath(root, candidate);
        if (isInstallModulePath(relativePath)) modules.push(relativePath);
      }
    }
  }
  return modules.sort();
}

function resolveDeclaredFile(file, roots) {
  const id = String(file && file.id || '');
  const scope = String(file && file.scope || '');
  const relativePath = String(file && file.path || '');
  if (!ALLOWED_FILE_IDS.includes(id)) {
    const error = new Error('Manifest contains a file outside the LumiField integrity allowlist.');
    error.code = 'FILE_ID_NOT_ALLOWED';
    throw error;
  }
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    const error = new Error('Manifest path must be a safe relative path.');
    error.code = 'PATH_NOT_ALLOWED';
    throw error;
  }
  const root = scope === 'resources'
    ? roots.resourcesPath
    : scope === 'install'
      ? roots.installPath
      : '';
  if (!root) {
    const error = new Error('Manifest scope is not allowed.');
    error.code = 'SCOPE_NOT_ALLOWED';
    throw error;
  }
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(root, candidate)) {
    const error = new Error('Manifest path escapes its declared LumiField root.');
    error.code = 'PATH_TRAVERSAL';
    throw error;
  }

  const expected = id === 'app.asar'
    ? {
      scope: 'resources',
      path: 'app.asar',
      absolute: path.resolve(roots.resourcesPath, 'app.asar'),
    }
    : id === 'ffmpeg'
      ? {
        scope: 'resources',
        path: 'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe',
        absolute: path.resolve(roots.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
      }
      : {
      scope: 'install',
      path: path.basename(roots.execPath),
      absolute: path.resolve(roots.execPath),
    };
  if (
    scope !== expected.scope ||
    relativePath.replace(/[\\/]+/g, path.sep) !== expected.path.replace(/[\\/]+/g, path.sep) ||
    path.resolve(candidate) !== expected.absolute
  ) {
    const error = new Error('Manifest may only declare LumiField app.asar, its executable, and the pinned FFmpeg binary.');
    error.code = 'PATH_NOT_ALLOWED';
    throw error;
  }
  return candidate;
}

function statIdentity(stat) {
  return [
    Number(stat.size) || 0,
    Number(stat.mtimeMs) || 0,
    Number(stat.ctimeMs) || 0,
    Number(stat.ino) || 0,
  ].join(':');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = diskFs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

function integrityManifestPolicyHash(execPath) {
  return crypto.createHash('sha256')
    .update(`LumiField|required-signed-integrity-manifest|v1|${path.basename(execPath).toLowerCase()}`)
    .digest('hex');
}

async function stableDoubleHash(filePath, options = {}) {
  const statA = await diskFs.promises.stat(filePath);
  if (!statA.isFile()) {
    const error = new Error('Integrity target is not a regular file.');
    error.code = 'NOT_A_FILE';
    throw error;
  }
  const first = await hashFile(filePath);
  const statB = await diskFs.promises.stat(filePath);
  if (typeof options.betweenReads === 'function') await options.betweenReads();
  const delayMs = Math.max(0, Math.min(1000, Number(options.delayMs) || 0));
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const statC = await diskFs.promises.stat(filePath);
  const second = await hashFile(filePath);
  const statD = await diskFs.promises.stat(filePath);
  const stable = statIdentity(statA) === statIdentity(statB) &&
    statIdentity(statB) === statIdentity(statC) &&
    statIdentity(statC) === statIdentity(statD) &&
    first === second;
  if (!stable) {
    const error = new Error('Integrity target changed during the two-pass hash.');
    error.code = 'FILE_CHANGED_DURING_HASH';
    throw error;
  }
  return {
    sha256: first,
    size: statD.size,
    passes: 2,
    stable: true,
  };
}

function result(reason, fields = {}) {
  return {
    ok: reason === 'VERIFIED' || reason === 'NOT_PACKAGED',
    enforced: reason !== 'NOT_PACKAGED',
    reason,
    checkedAt: new Date().toISOString(),
    ...fields,
  };
}

async function verifyInstalledApplication(options = {}) {
  const notify = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  if (options.isPackaged !== true) {
    const status = result('NOT_PACKAGED', { files: [] });
    notify(status);
    return status;
  }
  const execPath = path.resolve(String(options.execPath || process.execPath));
  const resourcesPath = path.resolve(String(options.resourcesPath || path.join(path.dirname(execPath), 'resources')));
  const installPath = path.dirname(execPath);
  const manifestPath = path.resolve(String(options.manifestPath || path.join(resourcesPath, MANIFEST_FILE)));
  if (manifestPath !== path.resolve(resourcesPath, MANIFEST_FILE)) {
    const status = result('MANIFEST_PATH_NOT_ALLOWED', { ok: false, enforced: true, files: [] });
    notify(status);
    return status;
  }
  if (!diskFs.existsSync(manifestPath)) {
    const status = result('MANIFEST_MISSING', {
      fileId: 'integrity-manifest',
      changedFileId: 'integrity-manifest',
      path: 'resources/lf-integrity-manifest.json',
      relativePath: 'lf-integrity-manifest.json',
      expectedHash: integrityManifestPolicyHash(execPath),
      actualHash: '',
      appVersion: String(options.appVersion || ''),
      files: [],
    });
    notify(status);
    return status;
  }

  let manifest;
  let manifestBytes;
  let manifestActualHash = '';
  try {
    const stableManifest = await stableDoubleHash(manifestPath, {
      delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs,
    });
    manifestBytes = await diskFs.promises.readFile(manifestPath);
    manifestActualHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    if (manifestActualHash !== stableManifest.sha256) {
      const unstable = new Error('Integrity manifest changed while it was being verified.');
      unstable.code = 'FILE_CHANGED_DURING_HASH';
      throw unstable;
    }
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    if (error && error.code === 'FILE_CHANGED_DURING_HASH') {
      const status = result('MANIFEST_UNSTABLE', { ok: false, error: error.message, files: [] });
      notify(status);
      return status;
    }
    const status = result('MANIFEST_INVALID', {
      ok: false,
      fileId: 'integrity-manifest',
      changedFileId: 'integrity-manifest',
      path: 'resources/lf-integrity-manifest.json',
      relativePath: 'lf-integrity-manifest.json',
      expectedHash: integrityManifestPolicyHash(execPath),
      actualHash: manifestActualHash,
      appVersion: String(options.appVersion || ''),
      error: error.message,
      files: [],
    });
    notify(status);
    return status;
  }
  const publicKeyPath = path.resolve(String(
    options.publicKeyPath ||
    path.join(options.appPath || path.join(resourcesPath, 'app.asar'), PUBLIC_KEY_RELATIVE_PATH)
  ));
  let publicKey;
  try {
    publicKey = options.publicKey || await fs.promises.readFile(publicKeyPath, 'utf8');
  } catch (error) {
    const status = result('PUBLIC_KEY_MISSING', { ok: false, error: error.message, files: [] });
    notify(status);
    return status;
  }
  if (!verifyManifestSignature(manifest, publicKey)) {
    const status = result('MANIFEST_SIGNATURE_INVALID', {
      ok: false,
      fileId: 'integrity-manifest',
      changedFileId: 'integrity-manifest',
      path: 'resources/lf-integrity-manifest.json',
      relativePath: 'lf-integrity-manifest.json',
      expectedHash: integrityManifestPolicyHash(execPath),
      actualHash: manifestActualHash,
      appVersion: String(manifest && manifest.version || options.appVersion || ''),
      files: [],
    });
    notify(status);
    return status;
  }
  const manifestId = crypto.createHash('sha256').update(manifestSigningPayload(manifest)).digest('hex');
  const manifestVersion = String(manifest.version || '');
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (
    files.length !== ALLOWED_FILE_IDS.length ||
    files.map((file) => String(file && file.id || '')).sort().join(',') !== ALLOWED_FILE_IDS.slice().sort().join(',')
  ) {
    const status = result('MANIFEST_FILE_SET_INVALID', { ok: false, files: [] });
    notify(status);
    return status;
  }
  const declaredModules = Array.isArray(manifest.modules) ? manifest.modules.map((file) => ({
    path: String(file && file.path || '').replace(/\\/g, '/'),
    size: Number(file && file.size) || 0,
    sha256: String(file && file.sha256 || '').toLowerCase(),
  })) : [];
  const modulePaths = new Set();
  for (const moduleFile of declaredModules) {
    const absolute = path.resolve(installPath, moduleFile.path);
    if (
      !isInstallModulePath(moduleFile.path) ||
      !isPathInside(installPath, absolute) ||
      !/^[a-f0-9]{64}$/.test(moduleFile.sha256) ||
      modulePaths.has(moduleFile.path)
    ) {
      const status = result('MANIFEST_MODULE_SET_INVALID', {
        ok: false,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        files: [],
      });
      notify(status);
      return status;
    }
    modulePaths.add(moduleFile.path);
  }

  const verified = [];
  for (const file of files) {
    const fileId = String(file && file.id || '');
    const isAppAsar = fileId === 'app.asar';
    const isFfmpeg = fileId === 'ffmpeg';
    const relativePath = isAppAsar
      ? 'app.asar'
      : isFfmpeg
        ? 'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'
        : path.basename(execPath);
    const evidenceFileId = isAppAsar ? 'app-asar' : isFfmpeg ? 'ffmpeg' : 'lumifield-exe';
    const evidencePath = isAppAsar
      ? 'resources/app.asar'
      : isFfmpeg
        ? 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'
        : 'LumiField.exe';
    const expected = {
      size: Number(file && file.size) || 0,
      sha256: String(file && file.sha256 || '').toLowerCase(),
    };
    let filePath;
    try {
      filePath = resolveDeclaredFile(file, { execPath, resourcesPath, installPath });
    } catch (error) {
      const status = result(error.code || 'PATH_NOT_ALLOWED', {
        ok: false,
        fileId: String(file && file.id || ''),
        relativePath,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        files: verified,
      });
      notify(status);
      return status;
    }
    try {
      notify(result('HASHING', {
        ok: true,
        enforced: true,
        fileId: file.id,
        relativePath,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        files: verified.slice(),
      }));
      const actual = await stableDoubleHash(filePath, {
        delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs,
      });
      if (
        actual.size !== Number(file.size) ||
        actual.sha256 !== String(file.sha256 || '').toLowerCase()
      ) {
        const status = result('HASH_MISMATCH', {
          ok: false,
          fileId: file.id,
          relativePath,
          manifestId,
          version: manifestVersion,
          appVersion: manifestVersion,
          changedFileId: evidenceFileId,
          path: evidencePath,
          expectedHash: expected.sha256,
          actualHash: actual.sha256,
          files: verified,
          expected,
          actual,
        });
        notify(status);
        return status;
      }
      verified.push({ id: file.id, size: actual.size, sha256: actual.sha256, passes: actual.passes });
    } catch (error) {
      const status = result(error.code === 'ENOENT' ? 'FILE_MISSING' : error.code || 'HASH_FAILED', {
        ok: false,
        fileId: file.id,
        relativePath,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        changedFileId: evidenceFileId,
        path: evidencePath,
        expectedHash: expected.sha256,
        actualHash: '',
        expected,
        error: error.message,
        files: verified,
      });
      notify(status);
      return status;
    }
  }
  let actualModulePaths;
  try {
    actualModulePaths = await listInstallModules(installPath);
  } catch (error) {
    const status = result('INSTALL_MODULE_SCAN_FAILED', {
      ok: false,
      manifestId,
      version: manifestVersion,
      appVersion: manifestVersion,
      error: error.message,
      files: verified,
    });
    notify(status);
    return status;
  }
  const unexpectedModule = actualModulePaths.find(relativePath => !modulePaths.has(relativePath));
  if (unexpectedModule) {
    const absolute = path.resolve(installPath, unexpectedModule);
    try {
      const actual = await stableDoubleHash(absolute, {
        delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs,
      });
      const status = result('UNEXPECTED_SCRIPT', {
        ok: false,
        fileId: 'unexpected-script',
        changedFileId: 'unexpected-script',
        path: unexpectedModule,
        relativePath: unexpectedModule,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        expectedHash: crypto.createHash('sha256').update(canonicalJson(declaredModules)).digest('hex'),
        actualHash: actual.sha256,
        expected: { sha256: crypto.createHash('sha256').update(canonicalJson(declaredModules)).digest('hex') },
        actual,
        files: verified,
      });
      notify(status);
      return status;
    } catch (error) {
      const status = result('INSTALL_MODULE_SCAN_FAILED', {
        ok: false,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        error: error.message,
        files: verified,
      });
      notify(status);
      return status;
    }
  }
  for (const moduleFile of declaredModules) {
    const absolute = path.resolve(installPath, moduleFile.path);
    try {
      const actual = await stableDoubleHash(absolute, {
        delayMs: options.hashDelayMs == null ? 20 : options.hashDelayMs,
      });
      if (actual.size !== moduleFile.size || actual.sha256 !== moduleFile.sha256) {
        const status = result('UNAUTHORIZED_MODULE', {
          ok: false,
          fileId: 'install-module',
          changedFileId: 'install-module',
          path: moduleFile.path,
          relativePath: moduleFile.path,
          manifestId,
          version: manifestVersion,
          appVersion: manifestVersion,
          expectedHash: moduleFile.sha256,
          actualHash: actual.sha256,
          expected: moduleFile,
          actual,
          files: verified,
        });
        notify(status);
        return status;
      }
    } catch (error) {
      const status = result(error.code === 'ENOENT' ? 'FILE_MISSING' : error.code || 'HASH_FAILED', {
        ok: false,
        fileId: 'install-module',
        changedFileId: 'install-module',
        path: moduleFile.path,
        relativePath: moduleFile.path,
        manifestId,
        version: manifestVersion,
        appVersion: manifestVersion,
        expectedHash: moduleFile.sha256,
        actualHash: '',
        expected: moduleFile,
        error: error.message,
        files: verified,
      });
      notify(status);
      return status;
    }
  }
  const status = result('VERIFIED', {
    product: String(manifest.product || ''),
    version: manifestVersion,
    appVersion: manifestVersion,
    manifestId,
    manifestPath,
    files: verified,
    modules: declaredModules.map(file => ({ path: file.path, size: file.size })),
  });
  notify(status);
  return status;
}

function createIntegrityStatusHook(windowProvider, channel = 'lf-integrity-status') {
  return function publishIntegrityStatus(status) {
    try {
      const win = typeof windowProvider === 'function' ? windowProvider() : windowProvider;
      if (!win || win.isDestroyed && win.isDestroyed()) return false;
      if (!win.webContents || win.webContents.isDestroyed && win.webContents.isDestroyed()) return false;
      win.webContents.send(channel, status);
      return true;
    } catch (_) {
      return false;
    }
  };
}

function createIntegrityVerifier(defaults = {}) {
  let lastStatus = null;
  const listeners = new Set();
  return {
    async verify(overrides = {}) {
      return verifyInstalledApplication({
        ...defaults,
        ...overrides,
        onStatus(status) {
          lastStatus = status;
          listeners.forEach((listener) => {
            try { listener(status); } catch (_) {}
          });
          if (typeof defaults.onStatus === 'function') defaults.onStatus(status);
          if (typeof overrides.onStatus === 'function') overrides.onStatus(status);
        },
      });
    },
    getStatus() {
      return lastStatus;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  ALLOWED_FILE_IDS,
  INSTALL_MODULE_EXTENSIONS,
  MANIFEST_FILE,
  PUBLIC_KEY_RELATIVE_PATH,
  canonicalJson,
  createIntegrityStatusHook,
  createIntegrityVerifier,
  hashFile,
  installRelativePath,
  isInstallModulePath,
  isPathInside,
  listInstallModules,
  manifestSignedFields,
  manifestSigningPayload,
  resolveDeclaredFile,
  stableDoubleHash,
  verifyInstalledApplication,
  verifyManifestSignature,
};
