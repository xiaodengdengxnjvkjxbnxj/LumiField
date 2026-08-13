'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATION_VERSION = 2;
const RECEIPT_FILE = 'legacy-upstream-platform-session-v2.json';
const ACCOUNT_SCOPE_MARKER = 'music-platform-account-owner-v1.json';
const VOLATILE_NAMES = new Set(['lock']);
const PLATFORM_PARTITIONS = Object.freeze([
  { provider: 'netease', suffix: 'netease-login', target: 'lumifield-netease-login' },
  { provider: 'qq', suffix: 'qqmusic-login', target: 'lumifield-qqmusic-login' },
]);
const COMPONENTS = Object.freeze([
  { name: 'cookies', kind: 'cookies' },
  { name: 'local-storage', kind: 'directory', directory: 'Local Storage' },
  { name: 'indexeddb', kind: 'directory', directory: 'IndexedDB' },
  { name: 'session-storage', kind: 'directory', directory: 'Session Storage' },
  { name: 'webstorage', kind: 'directory', directory: 'WebStorage' },
]);

function existsDirectory(value) {
  try { return fs.statSync(value).isDirectory(); } catch (_) { return false; }
}

function existsFile(value) {
  try { return fs.statSync(value).isFile(); } catch (_) { return false; }
}

function isVolatileFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return VOLATILE_NAMES.has(name) || name.endsWith('.lock') || name.startsWith('singleton');
}

function listFiles(root) {
  if (!existsDirectory(root)) return [];
  const files = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !isVolatileFile(absolute)) files.push(absolute);
    }
  };
  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fingerprintFiles(root, files) {
  const entries = files.map((filePath) => ({
    relativePath: path.relative(root, filePath).split(path.sep).join('/'),
    bytes: fs.statSync(filePath).size,
    sha256: hashFile(filePath),
  }));
  const digest = crypto.createHash('sha256');
  entries.forEach(entry => digest.update(`${entry.relativePath}\0${entry.bytes}\0${entry.sha256}\n`));
  return { entries, digest: digest.digest('hex'), fileCount: entries.length };
}

function fingerprintDirectory(root) {
  return fingerprintFiles(root, listFiles(root));
}

function ensureContained(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  throw new Error('MIGRATION_PATH_OUTSIDE_ALLOWED_ROOT');
}

function randomSibling(target, label) {
  return `${target}.${label}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
}

function writeFileVerified(source, target) {
  const targetDir = path.dirname(target);
  fs.mkdirSync(targetDir, { recursive: true });
  const temporary = randomSibling(target, 'lf-migrate');
  try {
    const sourceHash = hashFile(source);
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    if (hashFile(temporary) !== sourceHash) throw new Error('MIGRATION_COPY_HASH_MISMATCH');
    fs.renameSync(temporary, target);
    if (hashFile(target) !== sourceHash) throw new Error('MIGRATION_TARGET_HASH_MISMATCH');
  } finally {
    try { if (existsFile(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

function copyTreeVerified(sourceRoot, targetRoot, snapshot) {
  const before = snapshot || fingerprintDirectory(sourceRoot);
  for (const entry of before.entries) {
    const source = path.join(sourceRoot, ...entry.relativePath.split('/'));
    const target = path.join(targetRoot, ...entry.relativePath.split('/'));
    if (existsFile(target)) {
      const targetState = { bytes: fs.statSync(target).size, sha256: hashFile(target) };
      if (targetState.bytes !== entry.bytes || targetState.sha256 !== entry.sha256) {
        throw new Error('MIGRATION_STAGE_FILE_CONFLICT');
      }
      continue;
    }
    writeFileVerified(source, target);
  }
  const sourceAfter = fingerprintDirectory(sourceRoot);
  if (sourceAfter.digest !== before.digest) throw new Error('MIGRATION_SOURCE_CHANGED_DURING_COPY');
  const targetAfter = fingerprintDirectory(targetRoot);
  if (targetAfter.digest !== before.digest) throw new Error('MIGRATION_DIRECTORY_VALIDATION_FAILED');
  return targetAfter;
}

function cookieBundle(root) {
  const candidates = [path.join(root, 'Network', 'Cookies'), path.join(root, 'Cookies')];
  const main = candidates.find(existsFile);
  if (!main) return null;
  const files = [main, `${main}-journal`, `${main}-wal`, `${main}-shm`].filter(existsFile);
  const state = fingerprintFiles(root, files);
  return {
    root,
    files,
    state,
    modifiedAt: files.reduce((latest, filePath) => Math.max(latest, fs.statSync(filePath).mtimeMs), 0),
  };
}

function directoryComponent(root, directory) {
  const componentRoot = path.join(root, directory);
  const files = listFiles(componentRoot);
  if (!files.length) return null;
  return {
    root: componentRoot,
    files,
    state: fingerprintFiles(componentRoot, files),
    modifiedAt: files.reduce((latest, filePath) => Math.max(latest, fs.statSync(filePath).mtimeMs), 0),
  };
}

function componentState(partitionRoot, component) {
  return component.kind === 'cookies'
    ? cookieBundle(partitionRoot)
    : directoryComponent(partitionRoot, component.directory);
}

function copyComponentToStage(component, source, stageRoot) {
  if (component.kind === 'cookies') {
    for (const entry of source.state.entries) {
      const from = path.join(source.root, ...entry.relativePath.split('/'));
      const to = path.join(stageRoot, ...entry.relativePath.split('/'));
      writeFileVerified(from, to);
    }
    const sourceAfter = cookieBundle(source.root);
    const targetAfter = cookieBundle(stageRoot);
    if (!sourceAfter || sourceAfter.state.digest !== source.state.digest) throw new Error('MIGRATION_SOURCE_CHANGED_DURING_COPY');
    if (!targetAfter || targetAfter.state.digest !== source.state.digest) throw new Error('MIGRATION_COOKIE_VALIDATION_FAILED');
    return targetAfter.state;
  }
  const targetRoot = path.join(stageRoot, component.directory);
  return copyTreeVerified(source.root, targetRoot, source.state);
}

function componentReceiptState(candidate) {
  return candidate ? {
    label: candidate.label,
    digest: candidate.component.state.digest,
    fileCount: candidate.component.state.fileCount,
    modifiedAt: new Date(candidate.component.modifiedAt).toISOString(),
  } : null;
}

function selectComponentSource(candidates, component) {
  return candidates
    .map(candidate => ({ ...candidate, component: componentState(candidate.path, component) }))
    .filter(candidate => candidate.component)
    .sort((left, right) => {
      const time = right.component.modifiedAt - left.component.modifiedAt;
      return time || left.priority - right.priority;
    })[0] || null;
}

function stateIncludes(base, candidate) {
  const byPath = new Map(candidate.entries.map(entry => [entry.relativePath, entry]));
  return base.entries.every(entry => {
    const current = byPath.get(entry.relativePath);
    return !!current && current.bytes === entry.bytes && current.sha256 === entry.sha256;
  });
}

function callHook(hooks, name, payload) {
  if (hooks && typeof hooks[name] === 'function') hooks[name](payload);
}

function commitStagedPartition(stageRoot, targetRoot, targetBefore, hooks) {
  const backupRoot = randomSibling(targetRoot, 'lf-backup');
  const hadTarget = existsDirectory(targetRoot);
  let targetBackedUp = false;
  let stageCommitted = false;
  try {
    callHook(hooks, 'beforeTargetCommit', { stageRoot, targetRoot });
    if (hadTarget) {
      fs.renameSync(targetRoot, backupRoot);
      targetBackedUp = true;
      callHook(hooks, 'afterTargetBackup', { backupRoot, targetRoot });
    }
    fs.renameSync(stageRoot, targetRoot);
    stageCommitted = true;
    callHook(hooks, 'afterTargetCommit', { backupRoot: targetBackedUp ? backupRoot : '', targetRoot });
    const finalState = fingerprintDirectory(targetRoot);
    if (!stateIncludes(targetBefore, finalState)) throw new Error('MIGRATION_TARGET_PRESERVATION_FAILED');
    if (targetBackedUp) fs.rmSync(backupRoot, { recursive: true, force: true });
    return finalState;
  } catch (error) {
    if (stageCommitted && existsDirectory(targetRoot)) {
      const failedRoot = randomSibling(targetRoot, 'lf-failed');
      try { fs.renameSync(targetRoot, failedRoot); } catch (_) {}
      try { fs.rmSync(failedRoot, { recursive: true, force: true }); } catch (_) {}
    }
    if (targetBackedUp && existsDirectory(backupRoot) && !existsDirectory(targetRoot)) {
      try { fs.renameSync(backupRoot, targetRoot); } catch (_) {}
    }
    throw error;
  } finally {
    try { if (existsDirectory(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true }); } catch (_) {}
  }
}

function mergePartitionTransaction({ provider, targetRoot, sources, allowedRoot, hooks }) {
  ensureContained(allowedRoot, targetRoot);
  const targetBefore = fingerprintDirectory(targetRoot);
  const stageRoot = randomSibling(targetRoot, 'lf-stage');
  ensureContained(allowedRoot, stageRoot);
  const components = [];
  let changed = false;
  try {
    fs.mkdirSync(stageRoot, { recursive: true });
    if (targetBefore.fileCount) copyTreeVerified(targetRoot, stageRoot, targetBefore);
    for (const component of COMPONENTS) {
      const targetComponent = componentState(targetRoot, component);
      const available = sources
        .map(source => ({ ...source, component: componentState(source.path, component) }))
        .filter(source => source.component)
        .sort((left, right) => {
          const time = right.component.modifiedAt - left.component.modifiedAt;
          return time || left.priority - right.priority;
        });
      if (targetComponent) {
        components.push({
          name: component.name,
          status: 'target-preserved',
          target: { digest: targetComponent.state.digest, fileCount: targetComponent.state.fileCount },
          preservedSources: available.map(componentReceiptState),
        });
        continue;
      }
      const selected = available[0] || null;
      if (!selected) {
        components.push({ name: component.name, status: 'source-empty', selectedSource: null, preservedSources: [] });
        continue;
      }
      const copied = copyComponentToStage(component, selected.component, stageRoot);
      changed = true;
      components.push({
        name: component.name,
        status: 'copied',
        selectedSource: componentReceiptState(selected),
        target: { digest: copied.digest, fileCount: copied.fileCount },
        preservedSources: available.slice(1).map(componentReceiptState),
      });
    }
    const stagedState = fingerprintDirectory(stageRoot);
    if (!stateIncludes(targetBefore, stagedState)) throw new Error('MIGRATION_STAGE_DROPPED_TARGET_DATA');
    callHook(hooks, 'afterStageValidated', { provider, stageRoot, targetRoot, components });
    const finalState = changed
      ? commitStagedPartition(stageRoot, targetRoot, targetBefore, hooks)
      : targetBefore;
    for (const result of components) {
      if (result.status !== 'copied') continue;
      const descriptor = COMPONENTS.find(component => component.name === result.name);
      const finalComponent = componentState(targetRoot, descriptor);
      if (!finalComponent || finalComponent.state.digest !== result.target.digest) {
        throw new Error('MIGRATION_FINAL_COMPONENT_VALIDATION_FAILED');
      }
    }
    return {
      provider,
      targetPartition: path.basename(targetRoot),
      changed,
      validated: true,
      target: { digest: finalState.digest, fileCount: finalState.fileCount },
      components,
    };
  } finally {
    try { if (existsDirectory(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true }); } catch (_) {}
  }
}

function readClaimedScopeHash(userDataPath) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userDataPath, ACCOUNT_SCOPE_MARKER), 'utf8'));
    const hash = String(value && value.scopeHash || '');
    return value && value.version === 1 && value.state === 'claimed' && /^[a-f0-9]{64}$/.test(hash) ? hash : '';
  } catch (_) {
    return '';
  }
}

function archiveCandidates(archiveRoot, provider) {
  if (!existsDirectory(archiveRoot)) return [];
  return fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`${provider}-`))
    .map(entry => ({
      label: 'current-data-legacy-archive',
      path: path.join(archiveRoot, entry.name),
      priority: 1,
      readOnly: true,
    }));
}

function archiveCurrentLegacyPartition(sourcePath, archiveRoot, provider) {
  if (!existsDirectory(sourcePath)) return null;
  const before = fingerprintDirectory(sourcePath);
  const suffix = before.digest.slice(0, 12) || 'empty';
  let target = path.join(archiveRoot, `${provider}-${suffix}`);
  if (existsDirectory(target)) target = path.join(archiveRoot, `${provider}-${suffix}-${Date.now()}`);
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.renameSync(sourcePath, target);
  const after = fingerprintDirectory(target);
  if (before.digest !== after.digest) {
    try { fs.renameSync(target, sourcePath); } catch (_) {}
    throw new Error('MIGRATION_ARCHIVE_VALIDATION_FAILED');
  }
  return {
    result: { status: 'archived', digest: after.digest, fileCount: after.fileCount },
    sourcePath,
    archivePath: target,
  };
}

function restoreArchivedPartitions(operations) {
  for (const operation of operations.slice().reverse()) {
    if (!operation || !existsDirectory(operation.archivePath) || existsDirectory(operation.sourcePath)) continue;
    fs.renameSync(operation.archivePath, operation.sourcePath);
    if (!existsDirectory(operation.sourcePath)) throw new Error('MIGRATION_ARCHIVE_ROLLBACK_FAILED');
  }
}

function writeReceipt(receiptPath, receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporary = randomSibling(receiptPath, 'tmp');
  try {
    fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2), { encoding: 'utf8', mode: 0o600 });
    JSON.parse(fs.readFileSync(temporary, 'utf8'));
    fs.renameSync(temporary, receiptPath);
  } finally {
    try { if (existsFile(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

function readCompletedReceipt(receiptPath) {
  try {
    const value = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    return value && value.version === MIGRATION_VERSION && value.validated === true ? value : null;
  } catch (_) {
    return null;
  }
}

function migrateLegacyPlatformSessions({ appDataPath, userDataPath, hooks } = {}) {
  if (!appDataPath || !userDataPath) throw new Error('MIGRATION_PATH_REQUIRED');
  const receiptPath = path.join(userDataPath, 'migrations', RECEIPT_FILE);
  const completed = readCompletedReceipt(receiptPath);
  if (completed) return { ok: true, reusedReceipt: true, pendingScope: false, receipt: completed, results:completed.results || [] };

  const upstreamName = ['Mine', 'radio'].join('');
  const upstreamPrefix = upstreamName.toLowerCase();
  const previousUserData = path.join(appDataPath, upstreamName);
  const currentPartitions = path.join(userDataPath, 'Partitions');
  const previousPartitions = path.join(previousUserData, 'Partitions');
  const archiveRoot = path.join(userDataPath, 'legacy-upstream-session-archive');
  const claimedScopeHash = readClaimedScopeHash(userDataPath);
  ensureContained(appDataPath, previousUserData);
  ensureContained(userDataPath, currentPartitions);
  ensureContained(userDataPath, archiveRoot);

  const results = [];
  const currentLegacyPaths = [];
  for (const mapping of PLATFORM_PARTITIONS) {
    const currentLegacyPath = path.join(currentPartitions, `${upstreamPrefix}-${mapping.suffix}`);
    const previousPath = path.join(previousPartitions, `${upstreamPrefix}-${mapping.suffix}`);
    const targetName = claimedScopeHash ? `${mapping.target}-account-${claimedScopeHash}` : mapping.target;
    const targetPath = path.join(currentPartitions, targetName);
    ensureContained(userDataPath, currentLegacyPath);
    ensureContained(previousUserData, previousPath);
    ensureContained(userDataPath, targetPath);
    const sources = [
      { label: 'current-data-legacy-partition', path: currentLegacyPath, priority: 0, readOnly: false },
      ...archiveCandidates(archiveRoot, mapping.provider),
      { label: 'previous-product-user-data', path: previousPath, priority: 2, readOnly: true },
    ].filter(source => existsDirectory(source.path));
    results.push(mergePartitionTransaction({
      provider: mapping.provider,
      targetRoot: targetPath,
      sources,
      allowedRoot: userDataPath,
      hooks,
    }));
    currentLegacyPaths.push({ provider: mapping.provider, path: currentLegacyPath });
  }

  if (!claimedScopeHash) {
    return {
      ok: true,
      reusedReceipt: false,
      pendingScope: true,
      receipt: null,
      results,
    };
  }

  const archiveOperations = [];
  try {
    for (const source of currentLegacyPaths) {
      const archive = archiveCurrentLegacyPartition(source.path, archiveRoot, source.provider);
      const result = results.find(item => item.provider === source.provider);
      if (archive) archiveOperations.push(archive);
      if (result) result.currentLegacyArchive = archive ? archive.result : null;
    }
    callHook(hooks, 'beforeReceipt', { receiptPath, results });
    if (results.some(result => result.validated !== true)) throw new Error('MIGRATION_VALIDATION_INCOMPLETE');
    const receipt = {
      version: MIGRATION_VERSION,
      migratedAt: new Date().toISOString(),
      validated: true,
      accountScopeHash: claimedScopeHash,
      previousProductSourceWasReadOnly: true,
      independentPreviousProductDataPreserved: true,
      results,
    };
    writeReceipt(receiptPath, receipt);
    return { ok: true, reusedReceipt: false, pendingScope: false, receipt, results };
  } catch (error) {
    restoreArchivedPartitions(archiveOperations);
    throw error;
  }
}

module.exports = {
  MIGRATION_VERSION,
  migrateLegacyPlatformSessions,
  __test: Object.freeze({
    COMPONENTS,
    componentState,
    fingerprintDirectory,
    mergePartitionTransaction,
    readClaimedScopeHash,
    restoreArchivedPartitions,
    selectComponentSource,
  }),
};
