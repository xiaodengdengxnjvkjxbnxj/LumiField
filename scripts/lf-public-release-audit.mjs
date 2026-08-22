#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] || process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const sha256 = (file) => crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(root, file)))
  .digest("hex")
  .toUpperCase();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const required = [
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "BUILD.md",
  "THIRD_PARTY_NOTICES.md",
  "MODIFICATIONS.md",
  "SOURCE_CODE_AVAILABILITY.md",
  "RELEASE_GATE.md",
  "README_RELEASE.md",
  "package.json",
  "package-lock.json",
  "public/version-manifest.json",
  "docs/licenses/dependencies/production-dependency-license-audit.json",
];
const forbiddenTracked = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.(?!example$)/i,
  /(^|\/)(?:node_modules|dist|test-results|updates|backups)(\/|$)/i,
  /(^|\/)(?:cookies?|tokens?|credentials?|sessions?)\.(?:json|txt|db|sqlite3?)$/i,
  /(^|\/)AGENTS\.md$/,
  /(^|\/)(?:AI_HANDOFF|HANDOFF_NEXT_CHAT|PROJECT_MEMORY)\.md$/,
  /(^|\/)docs\/task-status\//,
];
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".mjs", ".md",
  ".nsh", ".ps1", ".txt", ".xml", ".yml", ".yaml",
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
const privatePathPatterns = [
  /C:\\Users\\35992/i,
  /C:\/Users\/35992/i,
  /\.codex[\\/]attachments/i,
  /Desktop[\\/]文件13/i,
];
const activeLicenseBlockPattern = /LICENSE_BLOCKED_PENDING_AUTHOR_AUTHORIZATION/;

const findings = [];
for (const file of required) {
  if (!exists(file)) findings.push({ type: "missing-required-file", file });
}
for (const file of tracked) {
  if (forbiddenTracked.some((pattern) => pattern.test(file))) {
    findings.push({ type: "forbidden-tracked-path", file });
  }
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const body = read(file);
  for (const pattern of secretPatterns) {
    if (pattern.test(body)) findings.push({ type: "secret-pattern", file, pattern: String(pattern) });
  }
  for (const pattern of privatePathPatterns) {
    if (pattern.test(body)) findings.push({ type: "private-path", file, pattern: String(pattern) });
  }
  if ((file.startsWith("docs/licenses/") || ["NOTICE.md", "THIRD_PARTY_NOTICES.md"].includes(file)) &&
      activeLicenseBlockPattern.test(body)) {
    findings.push({ type: "active-component-license-block", file });
  }
}

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const versionManifest = JSON.parse(read("public/version-manifest.json"));
const licenseAudit = JSON.parse(read("docs/licenses/dependencies/production-dependency-license-audit.json"));
if (pkg.version !== "1.1.44") findings.push({ type: "version", source: "package.json", actual: pkg.version });
if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
  findings.push({ type: "version", source: "package-lock.json", actual: [lock.version, lock.packages?.[""]?.version] });
}
if (versionManifest.version !== pkg.version) {
  findings.push({ type: "version", source: "public/version-manifest.json", actual: versionManifest.version });
}
if (pkg.license !== "GPL-3.0-only") findings.push({ type: "license-field", actual: pkg.license });
if (licenseAudit.summary?.unknownLicenses !== 0 || licenseAudit.summary?.releaseBlockingEntries !== 0) {
  findings.push({ type: "dependency-license-gate", summary: licenseAudit.summary });
}
if (licenseAudit.distributionBundle?.complete !== true) {
  findings.push({ type: "distribution-license-bundle", detail: licenseAudit.distributionBundle });
}
for (const [key, file] of [["packageJson", "package.json"], ["packageLock", "package-lock.json"], ["notice", "NOTICE.md"]]) {
  const record = licenseAudit.inputs?.[key];
  const actual = sha256(file);
  if (!record || record.sha256 !== actual) {
    findings.push({ type: "stale-dependency-license-audit-input", file, recorded: record?.sha256 || null, actual });
  }
}
const avatarGate = licenseAudit.focusChecks?.bibleStrongAvatarLab;
if (avatarGate && (String(avatarGate.status || "").startsWith("BLOCK_") || avatarGate.failedChecks?.length)) {
  findings.push({ type: "agpl-component-gate", detail: avatarGate });
}
const v1144ReleaseGate = read("RELEASE_GATE.md").match(
  /(?:^|\r?\n)## v1\.1\.44 release gate[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/
);
if (!v1144ReleaseGate || !v1144ReleaseGate[1].includes("`PASS_FULL_GPL_RELEASE_READY`")) {
  findings.push({ type: "release-gate", file: "RELEASE_GATE.md" });
}
if (tracked.includes("public/vendor/gsap.min.js") || Object.hasOwn(lock.packages || {}, "node_modules/gsap")) {
  findings.push({ type: "gsap-present" });
}

const report = {
  ok: findings.length === 0,
  version: pkg.version,
  trackedFiles: tracked.length,
  requiredFiles: required.length,
  dependencyLicenses: {
    entries: licenseAudit.summary?.totalProductionLockEntries,
    unknown: licenseAudit.summary?.unknownLicenses,
    blockers: licenseAudit.summary?.releaseBlockingEntries,
  },
  sourceFingerprint: versionManifest.sourceSha256,
  noticeSha256: sha256("NOTICE.md"),
  findings,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
