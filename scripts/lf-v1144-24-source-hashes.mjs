#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] || process.cwd());
const output = path.join(root, 'docs', 'licenses', 'bible-strong-avatar-lab', 'SOURCE_SHA256SUMS.txt');
const includeFiles = [
  'public/lf-electronic-pet2-source.js',
  'public/lf-electronic-pet2.bundle.js',
  'public/lf-electronic-pet2.avatar.json',
  'public/lf-electronic-pet2-avatars.json',
  'resources/licenses/Bible-Strong-Avatar-Lab-AGPL-3.0-only.txt',
  'resources/licenses/Bible-Strong-Avatar-Web-COPYRIGHT.txt',
  'scripts/lf-build-electronic-pet2.mjs',
  'scripts/lf-v1144-24-import-avatar-source.mjs',
];

function walk(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relative = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...walk(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const files = [...includeFiles, ...walk('third_party/bible-strong-avatar-lab')]
  .filter((file, index, values) => values.indexOf(file) === index)
  .sort();
const rows = files.map(relative => {
  const absolute = path.join(root, ...relative.split('/'));
  if (!fs.existsSync(absolute)) throw new Error(`Missing source evidence: ${relative}`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').toUpperCase();
  return `${hash}  ${relative}`;
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${rows.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output, files: rows.length }, null, 2)}\n`);
