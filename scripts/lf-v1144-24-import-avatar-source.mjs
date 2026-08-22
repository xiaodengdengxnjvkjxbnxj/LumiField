#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXPECTED_COMMIT = '175691ab32cefe5faec7828af62f3d50210a8eb2';
const UPSTREAM_URL = 'https://github.com/smontlouis/bible-strong-avatar-lab';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] || '');

if (!process.argv[2] || !fs.existsSync(path.join(source, '.git'))) {
  throw new Error('Pass a Bible Strong Avatar Lab Git checkout as the first argument.');
}

const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (commit !== EXPECTED_COMMIT) {
  throw new Error(`Expected ${EXPECTED_COMMIT}, received ${commit}.`);
}

const snapshotRoot = path.join(root, 'third_party', 'bible-strong-avatar-lab');
if (fs.existsSync(snapshotRoot)) {
  throw new Error(`Refusing to replace existing source snapshot: ${snapshotRoot}`);
}

const copy = (from, to) => {
  const sourcePath = path.join(source, from);
  const targetPath = path.join(root, to);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true });
};

[
  'LICENSE',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vitest.config.ts',
  'packages/avatar-core',
  'packages/avatar-web',
  'examples/react-vite-consumer/src/strobi.avatar.json',
  'src/features/avatar',
  'src/features/studio/defaultStudioDocument.json',
].forEach(relativePath => copy(relativePath, path.join('third_party/bible-strong-avatar-lab', relativePath)));

copy(
  'examples/react-vite-consumer/src/strobi.avatar.json',
  'public/lf-electronic-pet2.avatar.json',
);
copy('LICENSE', 'resources/licenses/Bible-Strong-Avatar-Lab-AGPL-3.0-only.txt');

const document = JSON.parse(
  fs.readFileSync(path.join(source, 'src/features/studio/defaultStudioDocument.json'), 'utf8'),
);
const allowedSurfaceFields = [
  'type',
  'width',
  'height',
  'depth',
  'roundness',
  'morphRoundness',
  'tipRoundness',
  'baseRoundness',
];
const surface = value => Object.fromEntries(
  allowedSurfaceFields.flatMap(field => value?.[field] === undefined ? [] : [[field, value[field]]]),
);
const avatars = document.library.avatars.map(avatar => ({
  id: avatar.id,
  name: avatar.name,
  body: {
    primary: surface(avatar.body.primary),
    nodes: (avatar.body.nodes || []).map(node => ({
      surface: surface(node.surface),
      position: [...node.position],
      rotation: [...node.rotation],
    })),
  },
  colors: { ...avatar.colors },
  eyes: { ...avatar.eyes },
}));
const presets = {
  schemaVersion: 1,
  source: { repository: UPSTREAM_URL, commit: EXPECTED_COMMIT },
  activeAvatarId: document.library.activeAvatarId,
  baseEyeDefaults: { ...document.library.avatars[0].eyes },
  avatars,
};
fs.writeFileSync(
  path.join(root, 'public', 'lf-electronic-pet2-avatars.json'),
  `${JSON.stringify(presets, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(snapshotRoot, 'UPSTREAM_SNAPSHOT.json'),
  `${JSON.stringify({ repository: UPSTREAM_URL, commit: EXPECTED_COMMIT, license: 'AGPL-3.0-only' }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({ commit, avatars: avatars.length, snapshotRoot }, null, 2));
