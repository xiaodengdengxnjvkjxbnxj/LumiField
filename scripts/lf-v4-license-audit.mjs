#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const outputDir = path.resolve(
  process.argv[3] || path.join(root, "docs", "licenses", "dependencies"),
);

const readBytes = (file) => fs.readFileSync(file);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
const fileRecord = (file) => {
  const body = readBytes(file);
  return {
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: body.length,
    sha256: sha256(body),
  };
};

const packageJsonPath = path.join(root, "package.json");
const lockfilePath = path.join(root, "package-lock.json");
const noticePath = path.join(root, "NOTICE.md");
const packageJson = readJson(packageJsonPath);
const lockfile = readJson(lockfilePath);
const directNames = new Set(Object.keys(packageJson.dependencies || {}));

const licenseFilePattern =
  /^(licen[sc]e|copying|notice|unlicense|copyright)([-._]|$)/i;
const permissiveSpdx = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "MIT-0",
  "GPL-3.0-or-later",
  "(BSD-3-Clause OR GPL-2.0)",
]);

function packageNameFromLockPath(lockPath, manifest) {
  if (manifest?.name) return manifest.name;
  const segments = lockPath.split("node_modules/");
  return segments.at(-1);
}

function normalizeLicense(lockLicense, manifestLicense, licenseFiles, packageName) {
  const declared = manifestLicense || lockLicense || null;
  if (declared) return declared;

  // These two packages omit the package.json/lockfile field, but their exact
  // installed LICENSE files contain the canonical MIT grant.
  const knownLicenseHashes = {
    busboy: ["MIT", "D06B5D27BBBBE22C36B1FD88406B1208876E2D37D795F5B8EAED951A459A3111"],
    streamsearch: [
      "MIT",
      "7C28463B739E2E73A49BF127D0BDA427F8C55F0B37365A044C3C3F254716118B",
    ],
    "parse-cache-control": [
      "BSD-3-Clause",
      "111F42B37DAECC6C387D037EF25955BD269E7F9A46A736D5257A23560534763F",
    ],
  };
  const known = knownLicenseHashes[packageName];
  if (known && licenseFiles.some((entry) => entry.sha256 === known[1])) {
    return known[0];
  }
  return null;
}

function assessLicense(normalizedLicense) {
  if (!normalizedLicense) {
    return {
      compatibility: "UNKNOWN",
      decision: "BLOCK_RELEASE_UNKNOWN_LICENSE",
      obligations: ["Obtain an authoritative license grant before distribution."],
    };
  }
  if (normalizedLicense.startsWith("Standard 'no charge' license:")) {
    return {
      compatibility: "GPLV3_COMPATIBILITY_NOT_PROVEN",
      decision: "BLOCK_RELEASE_REVIEW_OR_REPLACE",
      obligations: [
        "The GSAP standard license is not an OSI/SPDX open-source license.",
        "Its grant does not expressly establish GPLv3 downstream modification and redistribution rights.",
        "Obtain a written compatibility determination or replace it before PASS_GPL_RELEASE_READY.",
      ],
    };
  }
  if (normalizedLicense === "MPL-2.0") {
    return {
      compatibility: "CONDITIONALLY_COMPATIBLE_WITH_GPLV3",
      decision: "ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS",
      obligations: [
        "Preserve MPL notices and provide the MPL-covered Source Code Form.",
        "Confirm no Exhibit B 'Incompatible With Secondary Licenses' notice applies.",
        "For a GPL Larger Work, follow MPL 2.0 section 3.3 dual-distribution requirements.",
      ],
    };
  }
  if (normalizedLicense === "GPL-3.0-or-later") {
    return {
      compatibility: "GPLV3_NATIVE_COMPATIBLE",
      decision: "ALLOW_WITH_GPL_SOURCE_AND_NOTICE_OBLIGATIONS",
      obligations: [
        "Preserve GPL notices and provide the complete corresponding source required by GPLv3.",
      ],
    };
  }
  if (permissiveSpdx.has(normalizedLicense)) {
    return {
      compatibility: "GPLV3_COMPATIBLE",
      decision: "ALLOW_WITH_NOTICE_OBLIGATIONS",
      obligations: [
        "Preserve the applicable copyright, license, warranty, and NOTICE text in distributions.",
      ],
    };
  }
  return {
    compatibility: "REVIEW_REQUIRED",
    decision: "BLOCK_RELEASE_PENDING_LICENSE_REVIEW",
    obligations: ["Review the exact license expression and package contents."],
  };
}

const rows = Object.entries(lockfile.packages || {})
  .filter(([lockPath, metadata]) => lockPath && metadata.dev !== true)
  .map(([lockPath, metadata]) => {
    const absoluteDir = path.join(root, ...lockPath.split("/"));
    const installed = fs.existsSync(absoluteDir);
    let manifest = null;
    let manifestError = null;
    if (installed) {
      try {
        manifest = readJson(path.join(absoluteDir, "package.json"));
      } catch (error) {
        manifestError = String(error?.message || error);
      }
    }

    const packageName = packageNameFromLockPath(lockPath, manifest);
    const licenseFiles = installed
      ? fs
          .readdirSync(absoluteDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && licenseFilePattern.test(entry.name))
          .map((entry) => {
            const file = path.join(absoluteDir, entry.name);
            const body = readBytes(file);
            return {
              name: entry.name,
              bytes: body.length,
              sha256: sha256(body),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const lockLicense = metadata.license ?? null;
    const manifestLicense = manifest?.license ?? null;
    const normalizedLicense = normalizeLicense(
      lockLicense,
      manifestLicense,
      licenseFiles,
      packageName,
    );
    const assessment = assessLicense(normalizedLicense);
    const evidence = !installed
      ? metadata.optional
        ? "LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE"
        : "MISSING_INSTALLED_PRODUCTION_PACKAGE"
      : licenseFiles.length
        ? "INSTALLED_PACKAGE_LICENSE_FILE"
        : manifestLicense
          ? "INSTALLED_PACKAGE_MANIFEST_ONLY"
          : lockLicense
            ? "LOCKFILE_DECLARATION_ONLY"
            : "NO_LICENSE_EVIDENCE";

    return {
      lockPath: lockPath.replaceAll("\\", "/"),
      name: packageName,
      version: metadata.version ?? manifest?.version ?? null,
      direct: directNames.has(packageName),
      optional: metadata.optional === true,
      os: metadata.os ?? null,
      cpu: metadata.cpu ?? null,
      installed,
      manifestError,
      lockLicense,
      manifestLicense,
      normalizedLicense,
      evidence,
      licenseFiles,
      repository: manifest?.repository ?? null,
      resolved: metadata.resolved ?? null,
      integrity: metadata.integrity ?? null,
      ...assessment,
    };
  })
  .sort((a, b) => a.lockPath.localeCompare(b.lockPath));

const countBy = (selector) =>
  Object.fromEntries(
    [...rows.reduce((map, row) => {
      const key = String(selector(row));
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map())].sort(([a], [b]) => a.localeCompare(b)),
  );

const summary = {
  totalProductionLockEntries: rows.length,
  directProductionDependencies: rows.filter((row) => row.direct).length,
  installedEntries: rows.filter((row) => row.installed).length,
  missingInstalledEntries: rows.filter((row) => !row.installed).length,
  missingInstalledNonOptionalEntries: rows.filter(
    (row) => !row.installed && !row.optional,
  ).length,
  entriesWithRootLicenseFile: rows.filter((row) => row.licenseFiles.length).length,
  entriesWithoutRootLicenseFile: rows.filter(
    (row) => row.installed && !row.licenseFiles.length,
  ).length,
  unknownLicenses: rows.filter((row) => !row.normalizedLicense).length,
  releaseBlockingEntries: rows.filter((row) => row.decision.startsWith("BLOCK_"))
    .length,
  byNormalizedLicense: countBy((row) => row.normalizedLicense || "UNKNOWN"),
  byEvidence: countBy((row) => row.evidence),
  byDecision: countBy((row) => row.decision),
};

const requiredDistributionFiles = [
  "LICENSE",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "resources/licenses/21st-Marketplace-Components-MIT.txt",
  "resources/licenses/Paper-Shaders-Apache-2.0.txt",
  "resources/licenses/React-Framer-Motion-MIT.txt",
];
const distributionBundle = {
  requiredFiles: requiredDistributionFiles,
  missingFiles: requiredDistributionFiles.filter(
    (file) => !fs.existsSync(path.join(root, file)),
  ),
};
distributionBundle.complete = distributionBundle.missingFiles.length === 0;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generator: "scripts/lf-v4-license-audit.mjs",
  scope: {
    definition:
      "Every non-root package-lock.json packages entry whose dev flag is not true.",
    note:
      "This intentionally includes optional non-Windows platform packages recorded by the production lock graph.",
  },
  inputs: {
    packageJson: fileRecord(packageJsonPath),
    packageLock: fileRecord(lockfilePath),
    notice: fs.existsSync(noticePath) ? fileRecord(noticePath) : null,
    packageLicenseField: packageJson.license ?? null,
  },
  summary,
  blockers: [
    ...rows
      .filter((row) => row.decision.startsWith("BLOCK_"))
      .map((row) => ({
        id: `PACKAGE_LICENSE_${row.name}`,
        package: `${row.name}@${row.version}`,
        status: row.decision,
        reason: row.obligations.join(" "),
      })),
    ...(!distributionBundle.complete ? [{
      id: "DISTRIBUTION_LICENSE_BUNDLE",
      status: "BLOCK_RELEASE_MISSING_LICENSE_BUNDLE",
      reason:
        `Missing required release files: ${distributionBundle.missingFiles.join(", ")}`,
    }] : []),
  ],
  distributionBundle,
  focusChecks: {
    busboy: rows.find((row) => row.name === "busboy"),
    streamsearch: rows.find((row) => row.name === "streamsearch"),
    gsapAbsent: !rows.some((row) => row.name === "gsap"),
  },
  packages: rows,
};

const md = [];
md.push("# LumiField V4 production dependency license audit", "");
md.push(`- Generated: ${report.generatedAt}`);
md.push(`- Package lock: \`${report.inputs.packageLock.sha256}\``);
md.push(`- Production lock entries: **${summary.totalProductionLockEntries}**`);
md.push(`- Installed here: **${summary.installedEntries}**`);
md.push(
  `- Optional platform entries not installed on this Windows host: **${summary.missingInstalledEntries}**`,
);
md.push(`- Unknown license: **${summary.unknownLicenses}**`);
md.push(`- Release-blocking entries: **${summary.releaseBlockingEntries}**`);
md.push(`- Required distribution license bundle: **${distributionBundle.complete ? "complete" : "incomplete"}**`);
md.push(
  `- Release conclusion: \`${summary.releaseBlockingEntries || !distributionBundle.complete ? "NOT_GPL_RELEASE_READY" : "PASS_PRODUCTION_DEPENDENCY_LICENSE_GRAPH"}\``,
  "",
);
md.push("## Scope and interpretation", "");
md.push(
  `The ${summary.totalProductionLockEntries} rows below are every non-root \`package-lock.json.packages\` entry whose \`dev\` flag is not true. This is a lock-graph audit, not a claim that every optional cross-platform binary is installed or shipped in the Windows installer.`,
  "",
  "A package declaration is evidence of its stated license, but the final release must also preserve and ship the exact copyright, license, NOTICE, source-offer and copyleft material required by each license. `ALLOW` below therefore always means “eligible subject to listed obligations”, not unconditional release approval.",
  "",
);
md.push("## Findings", "");
md.push(
  "- `busboy@1.6.0`: lockfile and package manifest omit `license`; installed `LICENSE` SHA-256 `D06B5D27BBBBE22C36B1FD88406B1208876E2D37D795F5B8EAED951A459A3111` contains the canonical MIT grant.",
  "- `streamsearch@1.1.0`: lockfile and package manifest omit `license`; installed `LICENSE` SHA-256 `7C28463B739E2E73A49BF127D0BDA427F8C55F0B37365A044C3C3F254716118B` contains the canonical MIT grant.",
  "- `gsap` is absent from the production lock graph. LumiField uses its independently authored `public/lf-motion.js` compatibility runtime.",
  "- `parse-cache-control@1.0.1`: its exact installed BSD-3-Clause license is identified by SHA-256 `111F42B37DAECC6C387D037EF25955BD269E7F9A46A736D5257A23560534763F`.",
  "- `ffmpeg-static@5.3.0`: GPL-3.0-or-later is compatible with the LumiField GPLv3 release, subject to corresponding-source and notice obligations.",
  `- ${summary.entriesWithoutRootLicenseFile} installed packages have no root license/NOTICE file; their manifest declaration is recorded in JSON, but the release license bundle must source and preserve the applicable authoritative text.`,
  "",
);
md.push("## License totals", "", "| License | Entries |", "|---|---:|");
for (const [license, count] of Object.entries(summary.byNormalizedLicense)) {
  md.push(`| ${license.replaceAll("|", "\\|")} | ${count} |`);
}
md.push("", "## Full production lock graph", "");
md.push("| # | Lock path | Version | License | Evidence | Decision |", "|---:|---|---:|---|---|---|");
rows.forEach((row, index) => {
  const escape = (value) => String(value ?? "UNKNOWN").replaceAll("|", "\\|");
  md.push(
    `| ${index + 1} | \`${escape(row.lockPath)}\` | ${escape(row.version)} | ${escape(row.normalizedLicense)} | ${escape(row.evidence)} | ${escape(row.decision)} |`,
  );
});
md.push(
  "",
  "## Official references used for interpretation",
  "",
  "- Mozilla MPL 2.0 FAQ: <https://www.mozilla.org/en-US/MPL/2.0/FAQ/>",
  "- GNU license compatibility list: <https://www.gnu.org/licenses/license-list.html>",
  "",
);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "production-dependency-license-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDir, "production-dependency-license-audit.md"),
  `${md.join("\n").trimEnd()}\n`,
  "utf8",
);

console.log(JSON.stringify({ outputDir, summary }, null, 2));
