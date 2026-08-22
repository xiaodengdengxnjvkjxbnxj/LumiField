#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const root = path.resolve(process.argv[2] || process.cwd());
const entry = path.join(root, 'public', 'lf-electronic-pet2-source.js');
const outfile = path.join(root, 'public', 'lf-electronic-pet2.bundle.js');
const metaFile = path.join(root, 'docs', 'licenses', 'bible-strong-avatar-lab', 'ESBUILD_META.json');
const coreSource = path.join(
  root,
  'third_party',
  'bible-strong-avatar-lab',
  'packages',
  'avatar-core',
  'src',
  'index.ts',
);

for (const required of [entry, coreSource]) {
  if (!fs.existsSync(required)) throw new Error(`Missing required Avatar source: ${required}`);
}
fs.mkdirSync(path.dirname(metaFile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'LumiFieldPet2Runtime',
  platform: 'browser',
  target: ['chrome134'],
  minify: true,
  legalComments: 'linked',
  metafile: true,
  alias: {
    '@bible-strong/avatar-core': coreSource,
  },
  banner: {
    js: '/*! Bible Strong Avatar Lab Web Runtime | Copyright (C) 2026 Stephane Montlouis-Calixte | AGPL-3.0-only | source commit 175691ab32cefe5faec7828af62f3d50210a8eb2 | LumiField modifications: docs/licenses/bible-strong-avatar-lab/MODIFICATIONS.md */',
  },
});

function canonicalMetadataPath(value) {
  const normalized = value.replaceAll('\\', '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? `node_modules/${normalized.slice(index + marker.length)}` : normalized;
}

function canonicalMetadata(value) {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [canonicalMetadataPath(key), canonicalMetadata(item)]));
  }
  return typeof value === 'string' ? canonicalMetadataPath(value) : value;
}

fs.writeFileSync(metaFile, `${JSON.stringify(canonicalMetadata(result.metafile), null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outfile, bytes: fs.statSync(outfile).size, metaFile }, null, 2)}\n`);
