'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const unpacked = path.resolve(process.argv[2] || path.join(root, 'dist', 'win-unpacked'));
const appAsar = path.join(unpacked, 'resources', 'app.asar');
const integrityPath = path.join(unpacked, 'resources', 'lf-integrity-manifest.json');
const evidenceDir = path.join(root, 'test-results', 'lf-v1144-24-package-audit');
const fixedCommit = '175691ab32cefe5faec7828af62f3d50210a8eb2';
const checks = {};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
}

assert.ok(fs.existsSync(appAsar), `Missing app.asar: ${appAsar}`);
assert.ok(fs.existsSync(integrityPath), `Missing integrity manifest: ${integrityPath}`);

const entries = new Set(asar.listPackage(appAsar).map(entry =>
  entry.replace(/^[/\\]+/, '').replaceAll('\\', '/')));
function extract(relative) {
  const normalized = relative.replaceAll('\\', '/').replace(/^\/+/, '');
  assert.ok(entries.has(normalized), `Missing packaged file: ${normalized}`);
  return asar.extractFile(appAsar, normalized.replaceAll('/', '\\'));
}
function packaged(relative) {
  const normalized = relative.replaceAll('\\', '/').replace(/^\/+/, '');
  if (entries.has(normalized)) return extract(normalized);
  const correspondingSource = path.join(unpacked, 'resources', 'corresponding-source', ...normalized.split('/'));
  assert.ok(fs.existsSync(correspondingSource), `Missing packaged file: ${normalized}`);
  return fs.readFileSync(correspondingSource);
}
function text(relative) { return extract(relative).toString('utf8'); }

const packagedPackage = JSON.parse(text('package.json'));
const integrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
const asarRecord = integrity.files.find(entry => entry.id === 'app.asar');
const actualAsarHash = sha256(fs.readFileSync(appAsar));
pass('unpacked package and integrity manifest are v1.1.44', packagedPackage.version === '1.1.44' && integrity.version === '1.1.44', { packageVersion:packagedPackage.version, integrityVersion:integrity.version });
pass('integrity manifest matches the packaged app.asar', !!asarRecord && String(asarRecord.sha256).toUpperCase() === actualAsarHash, { actualAsarHash, recordedAsarHash:asarRecord && asarRecord.sha256 });

const hashRows = text('docs/licenses/bible-strong-avatar-lab/SOURCE_SHA256SUMS.txt').trim().split(/\r?\n/);
const sourceMismatches = [];
for (const row of hashRows) {
  const match = row.match(/^([A-F0-9]{64})  (.+)$/);
  if (!match) { sourceMismatches.push({ row, reason:'INVALID_ROW' }); continue; }
  try {
    const actual = sha256(packaged(match[2]));
    if (actual !== match[1]) sourceMismatches.push({ path:match[2], expected:match[1], actual });
  } catch (error) {
    sourceMismatches.push({ path:match[2], reason:String(error.message || error) });
  }
}
pass('all corresponding-source hash rows are packaged exactly', hashRows.length >= 60 && sourceMismatches.length === 0, { files:hashRows.length, mismatches:sourceMismatches });

const notice = text('NOTICE.md');
const thirdParty = text('THIRD_PARTY_NOTICES.md');
const availability = text('SOURCE_CODE_AVAILABILITY.md');
const agpl = text('resources/licenses/Bible-Strong-Avatar-Lab-AGPL-3.0-only.txt');
const copyright = text('resources/licenses/Bible-Strong-Avatar-Web-COPYRIGHT.txt');
const modifications = text('docs/licenses/bible-strong-avatar-lab/MODIFICATIONS.md');
const snapshot = JSON.parse(text('third_party/bible-strong-avatar-lab/UPSTREAM_SNAPSHOT.json'));
pass('packaged AGPL attribution and exact upstream identity are complete', snapshot.commit === fixedCommit && notice.includes(fixedCommit) && thirdParty.includes(fixedCommit) && availability.includes('third_party/bible-strong-avatar-lab/') && agpl.includes('GNU AFFERO GENERAL PUBLIC LICENSE') && copyright.includes('Copyright (C) 2026 Stéphane Montlouis-Calixte') && modifications.includes('Modification date: 2026-08-22'), true);

const exactWorkspaceFiles = [
  'public/lf-electronic-pet2-source.js',
  'public/lf-electronic-pet2.bundle.js',
  'public/lf-electronic-pet2.avatar.json',
  'public/lf-electronic-pet2-avatars.json',
  'public/lf-home-pet.js',
  'public/lf-home-pet.css',
  'public/index.html',
  'package-lock.json',
];
const workspaceMismatches = exactWorkspaceFiles.filter(relative =>
  sha256(packaged(relative)) !== sha256(fs.readFileSync(path.join(root, ...relative.split('/')))));
pass('packaged runtime and lockfile match the audited workspace exactly', workspaceMismatches.length === 0, { files:exactWorkspaceFiles.length, mismatches:workspaceMismatches });

const manager = text('public/lf-home-pet.js');
pass('packaged settings remain below Audio Echo and outside My profile', manager.includes('.fx-tab-page[data-fx-page="presets"]') && manager.includes("querySelector('#lf-t13-echo-block')") && !manager.includes("querySelectorAll('#lf-profile-modal .lf-profile-section')"), true);

const result = {
  task:'v1.1.44-problem-24-package-audit',
  status:'PASS',
  unpacked,
  appAsar:{ bytes:fs.statSync(appAsar).size, sha256:actualAsarHash },
  checks,
};
fs.mkdirSync(evidenceDir, { recursive:true });
fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
