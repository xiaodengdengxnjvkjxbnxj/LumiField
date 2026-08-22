# Bible Strong Avatar Lab source and license record

## Fixed source identity

- Project: Bible Strong Avatar Lab
- Author: Stéphane Montlouis-Calixte
- Website: <https://avatars.bible-strong.app/>
- Repository: <https://github.com/smontlouis/bible-strong-avatar-lab>
- Integrated commit: `175691ab32cefe5faec7828af62f3d50210a8eb2`
- Runtime packages: `@bible-strong/avatar-core` and `@bible-strong/avatar-web`, source version `0.1.0`
- Upstream license: `AGPL-3.0-only`
- Copyright: `Copyright (C) 2026 Stéphane Montlouis-Calixte`

LumiField bundles the framework-independent official Web Runtime, not an iframe,
remote service, Studio shell, preview asset, analytics payload or CDN import. End
users do not need Node.js, Avatar Lab or any additional program.

## Corresponding source

The exact source snapshot used to build Electronic Pet 2 is tracked at
`third_party/bible-strong-avatar-lab/`. It contains the upstream core and Web
Runtime source, schema, build manifests, full AGPL text, README, the official
Strobi `.avatar.json` and the default Studio avatar document. The LumiField
wrapper and deterministic build script are tracked at:

- `public/lf-electronic-pet2-source.js`
- `scripts/lf-build-electronic-pet2.mjs`
- `scripts/lf-v1144-24-import-avatar-source.mjs`
- `public/lf-electronic-pet2.avatar.json`
- `public/lf-electronic-pet2-avatars.json`

The installed application also carries the full AGPL text and copyright notice
under `resources/licenses/`, all 60 files recorded in `SOURCE_SHA256SUMS.txt`,
and package-manager locks under `resources/corresponding-source/` when
electron-builder excludes lockfiles from `app.asar`. The public v1.1.44 source
distribution must include the paths above, this record, `MODIFICATIONS.md` and
`SOURCE_SHA256SUMS.txt`.

## Exact-commit runtime decision

The npm `@bible-strong/avatar-core@0.1.0` schema limits `roundness` to `1`, while
the fixed source commit permits `2` and its official Freddy, Citrus and Onee
presets contain values above `1`. LumiField therefore bundles the fixed-commit
source directly and resolves `@bible-strong/avatar-core` to that snapshot during
the local esbuild step. It neither substitutes the npm schema nor clamps avatar
values, so the official definitions retain their original geometry.

## GPLv3 combination boundary

The vendored Avatar source and `public/lf-electronic-pet2-source.js` remain under
AGPL-3.0-only. The rest of LumiField remains under GPL-3.0-only. GNU AGPL v3
section 13 permits linking or combining an AGPL-covered work with a GPLv3-covered
work and conveying the resulting combination while each covered part keeps its
applicable license. This record does not treat AGPL as permissive and does not
remove or replace upstream attribution.
