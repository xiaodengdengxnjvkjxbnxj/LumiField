# LumiField V4 production dependency license audit

- Generated: 2026-08-22T15:39:31.804Z
- Package lock: `768DF9A269CFDE26C8671404D06264DDDF29E88143D6801F5A212FA75A79687C`
- Production lock entries: **212**
- Installed here: **198**
- Optional platform entries not installed on this Windows host: **14**
- Electronic Pet 2 AGPL source/notice gate: **AGPL_SOURCE_AND_NOTICE_IMPLEMENTATION_PASS_INSTALLER_AUDIT_PENDING**
- Unknown license: **0**
- Release-blocking entries: **0**
- Required distribution license bundle: **complete**
- Release conclusion: `PASS_PRODUCTION_DEPENDENCY_LICENSE_GRAPH`

## Scope and interpretation

The 212 rows below are every non-root `package-lock.json.packages` entry whose `dev` flag is not true. This is a lock-graph audit, not a claim that every optional cross-platform binary is installed or shipped in the Windows installer.

A package declaration is evidence of its stated license, but the final release must also preserve and ship the exact copyright, license, NOTICE, source-offer and copyleft material required by each license. `ALLOW` below therefore always means “eligible subject to listed obligations”, not unconditional release approval.

## Findings

- `busboy@1.6.0`: lockfile and package manifest omit `license`; installed `LICENSE` SHA-256 `D06B5D27BBBBE22C36B1FD88406B1208876E2D37D795F5B8EAED951A459A3111` contains the canonical MIT grant.
- `streamsearch@1.1.0`: lockfile and package manifest omit `license`; installed `LICENSE` SHA-256 `7C28463B739E2E73A49BF127D0BDA427F8C55F0B37365A044C3C3F254716118B` contains the canonical MIT grant.
- `gsap` is absent from the production lock graph. LumiField uses its independently authored `public/lf-motion.js` compatibility runtime.
- `parse-cache-control@1.0.1`: its exact installed BSD-3-Clause license is identified by SHA-256 `111F42B37DAECC6C387D037EF25955BD269E7F9A46A736D5257A23560534763F`.
- `ffmpeg-static@5.3.0`: GPL-3.0-or-later is compatible with the LumiField GPLv3 release, subject to corresponding-source and notice obligations.
- Bible Strong Avatar Lab Electronic Pet 2: `AGPL_SOURCE_AND_NOTICE_IMPLEMENTATION_PASS_INSTALLER_AUDIT_PENDING`; fixed source `175691ab32cefe5faec7828af62f3d50210a8eb2`, complete AGPL/copyright/modification evidence and vendored-runtime build provenance are checked separately from the npm lock graph.
- 10 installed packages have no root license/NOTICE file; their manifest declaration is recorded in JSON, but the release license bundle must source and preserve the applicable authoritative text.

## License totals

| License | Entries |
|---|---:|
| (BSD-3-Clause OR GPL-2.0) | 1 |
| 0BSD | 1 |
| Apache-2.0 | 3 |
| BlueOak-1.0.0 | 1 |
| BSD-2-Clause | 4 |
| BSD-3-Clause | 8 |
| GPL-3.0-or-later | 1 |
| ISC | 12 |
| MIT | 175 |
| MIT-0 | 1 |
| MPL-2.0 | 5 |

## Full production lock graph

| # | Lock path | Version | License | Evidence | Decision |
|---:|---|---:|---|---|---|
| 1 | `node_modules/@borewit/text-codec` | 0.2.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 2 | `node_modules/@browsermt/bergamot-translator` | 0.4.9 | MPL-2.0 | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 3 | `node_modules/@derhuerst/http-basic` | 8.2.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 4 | `node_modules/@eshaz/web-worker` | 1.2.2 | Apache-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 5 | `node_modules/@koromix/koffi-darwin-arm64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 6 | `node_modules/@koromix/koffi-darwin-x64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 7 | `node_modules/@koromix/koffi-freebsd-arm64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 8 | `node_modules/@koromix/koffi-freebsd-ia32` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 9 | `node_modules/@koromix/koffi-freebsd-x64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 10 | `node_modules/@koromix/koffi-linux-arm64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 11 | `node_modules/@koromix/koffi-linux-ia32` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 12 | `node_modules/@koromix/koffi-linux-loong64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 13 | `node_modules/@koromix/koffi-linux-riscv64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 14 | `node_modules/@koromix/koffi-linux-x64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 15 | `node_modules/@koromix/koffi-openbsd-ia32` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 16 | `node_modules/@koromix/koffi-openbsd-x64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 17 | `node_modules/@koromix/koffi-win32-arm64` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 18 | `node_modules/@koromix/koffi-win32-ia32` | 3.1.2 | MIT | LOCKFILE_ONLY_OPTIONAL_PLATFORM_PACKAGE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 19 | `node_modules/@koromix/koffi-win32-x64` | 3.1.2 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 20 | `node_modules/@soundtouchjs/audio-worklet` | 2.1.0 | MPL-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 21 | `node_modules/@soundtouchjs/core` | 2.1.0 | MPL-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 22 | `node_modules/@soundtouchjs/interpolation-strategy-lanczos` | 2.1.0 | MPL-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 23 | `node_modules/@soundtouchjs/worklet-base` | 2.1.0 | MPL-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_MPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 24 | `node_modules/@tokenizer/inflate` | 0.4.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 25 | `node_modules/@tokenizer/token` | 0.3.0 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 26 | `node_modules/@tootallnate/quickjs-emscripten` | 0.23.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 27 | `node_modules/@wasm-audio-decoders/common` | 9.0.7 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 28 | `node_modules/accepts` | 1.3.8 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 29 | `node_modules/agent-base` | 7.1.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 30 | `node_modules/ansi-regex` | 5.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 31 | `node_modules/ansi-styles` | 4.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 32 | `node_modules/array-flatten` | 1.1.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 33 | `node_modules/ast-types` | 0.13.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 34 | `node_modules/asynckit` | 0.4.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 35 | `node_modules/axios` | 1.19.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 36 | `node_modules/basic-ftp` | 5.3.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 37 | `node_modules/bcryptjs` | 3.0.3 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 38 | `node_modules/body-parser` | 1.20.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 39 | `node_modules/body-parser/node_modules/debug` | 2.6.9 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 40 | `node_modules/body-parser/node_modules/ms` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 41 | `node_modules/buffer-from` | 1.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 42 | `node_modules/busboy` | 1.6.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 43 | `node_modules/bytes` | 3.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 44 | `node_modules/call-bind-apply-helpers` | 1.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 45 | `node_modules/call-bound` | 1.0.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 46 | `node_modules/camelcase` | 5.3.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 47 | `node_modules/caseless` | 0.12.0 | Apache-2.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 48 | `node_modules/charenc` | 0.0.2 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 49 | `node_modules/cliui` | 6.0.0 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 50 | `node_modules/color-convert` | 2.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 51 | `node_modules/color-name` | 1.1.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 52 | `node_modules/combined-stream` | 1.0.8 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 53 | `node_modules/concat-stream` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 54 | `node_modules/content-disposition` | 0.5.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 55 | `node_modules/content-type` | 1.0.5 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 56 | `node_modules/cookie` | 0.7.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 57 | `node_modules/cookie-signature` | 1.0.7 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 58 | `node_modules/crypt` | 0.0.2 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 59 | `node_modules/crypto-js` | 4.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 60 | `node_modules/data-uri-to-buffer` | 6.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 61 | `node_modules/debug` | 4.4.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 62 | `node_modules/decamelize` | 1.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 63 | `node_modules/degenerator` | 5.0.1 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 64 | `node_modules/delayed-stream` | 1.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 65 | `node_modules/depd` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 66 | `node_modules/destroy` | 1.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 67 | `node_modules/dijkstrajs` | 1.0.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 68 | `node_modules/dunder-proto` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 69 | `node_modules/ee-first` | 1.1.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 70 | `node_modules/emoji-regex` | 8.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 71 | `node_modules/encodeurl` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 72 | `node_modules/es-define-property` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 73 | `node_modules/es-errors` | 1.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 74 | `node_modules/es-object-atoms` | 1.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 75 | `node_modules/es-set-tostringtag` | 2.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 76 | `node_modules/escalade` | 3.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 77 | `node_modules/escape-html` | 1.0.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 78 | `node_modules/escodegen` | 2.1.0 | BSD-2-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 79 | `node_modules/esprima` | 4.0.1 | BSD-2-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 80 | `node_modules/estraverse` | 5.3.0 | BSD-2-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 81 | `node_modules/esutils` | 2.0.3 | BSD-2-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 82 | `node_modules/etag` | 1.8.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 83 | `node_modules/express` | 4.22.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 84 | `node_modules/express-fileupload` | 1.5.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 85 | `node_modules/express/node_modules/debug` | 2.6.9 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 86 | `node_modules/express/node_modules/ms` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 87 | `node_modules/ffmpeg-static` | 5.3.0 | GPL-3.0-or-later | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_GPL_SOURCE_AND_NOTICE_OBLIGATIONS |
| 88 | `node_modules/ffmpeg-static/node_modules/env-paths` | 2.2.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 89 | `node_modules/file-type` | 21.3.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 90 | `node_modules/finalhandler` | 1.3.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 91 | `node_modules/finalhandler/node_modules/debug` | 2.6.9 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 92 | `node_modules/finalhandler/node_modules/ms` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 93 | `node_modules/find-up` | 4.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 94 | `node_modules/follow-redirects` | 1.16.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 95 | `node_modules/form-data` | 4.0.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 96 | `node_modules/forwarded` | 0.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 97 | `node_modules/fresh` | 0.5.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 98 | `node_modules/function-bind` | 1.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 99 | `node_modules/get-caller-file` | 2.0.5 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 100 | `node_modules/get-intrinsic` | 1.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 101 | `node_modules/get-proto` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 102 | `node_modules/get-uri` | 6.0.5 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 103 | `node_modules/gopd` | 1.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 104 | `node_modules/has-symbols` | 1.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 105 | `node_modules/has-tostringtag` | 1.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 106 | `node_modules/hasown` | 2.0.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 107 | `node_modules/http-errors` | 2.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 108 | `node_modules/http-proxy-agent` | 7.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 109 | `node_modules/http-response-object` | 3.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 110 | `node_modules/http-response-object/node_modules/@types/node` | 10.17.60 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 111 | `node_modules/https-proxy-agent` | 5.0.1 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 112 | `node_modules/https-proxy-agent/node_modules/agent-base` | 6.0.2 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 113 | `node_modules/iconv-lite` | 0.4.24 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 114 | `node_modules/ieee754` | 1.2.1 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 115 | `node_modules/inherits` | 2.0.4 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 116 | `node_modules/ip-address` | 10.5.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 117 | `node_modules/ipaddr.js` | 1.9.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 118 | `node_modules/is-buffer` | 1.1.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 119 | `node_modules/is-fullwidth-code-point` | 3.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 120 | `node_modules/koffi` | 3.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 121 | `node_modules/locate-path` | 5.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 122 | `node_modules/math-intrinsics` | 1.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 123 | `node_modules/md5` | 2.3.0 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 124 | `node_modules/media-typer` | 0.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 125 | `node_modules/merge-descriptors` | 1.0.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 126 | `node_modules/methods` | 1.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 127 | `node_modules/mime` | 1.6.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 128 | `node_modules/mime-db` | 1.52.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 129 | `node_modules/mime-types` | 2.1.35 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 130 | `node_modules/mpg123-decoder` | 1.0.3 | MIT | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 131 | `node_modules/ms` | 2.1.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 132 | `node_modules/music-metadata` | 11.13.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 133 | `node_modules/music-metadata/node_modules/content-type` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 134 | `node_modules/music-metadata/node_modules/media-typer` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 135 | `node_modules/negotiator` | 0.6.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 136 | `node_modules/NeteaseCloudMusicApi` | 4.32.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 137 | `node_modules/NeteaseCloudMusicApi/node_modules/cliui` | 8.0.1 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 138 | `node_modules/NeteaseCloudMusicApi/node_modules/wrap-ansi` | 7.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 139 | `node_modules/NeteaseCloudMusicApi/node_modules/y18n` | 5.0.8 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 140 | `node_modules/NeteaseCloudMusicApi/node_modules/yargs` | 17.7.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 141 | `node_modules/NeteaseCloudMusicApi/node_modules/yargs-parser` | 21.1.1 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 142 | `node_modules/netmask` | 2.1.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 143 | `node_modules/node-forge` | 1.4.0 | (BSD-3-Clause OR GPL-2.0) | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 144 | `node_modules/nodemailer` | 9.0.3 | MIT-0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 145 | `node_modules/object-inspect` | 1.13.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 146 | `node_modules/on-finished` | 2.4.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 147 | `node_modules/p-limit` | 2.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 148 | `node_modules/p-locate` | 4.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 149 | `node_modules/p-try` | 2.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 150 | `node_modules/pac-proxy-agent` | 7.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 151 | `node_modules/pac-proxy-agent/node_modules/https-proxy-agent` | 7.0.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 152 | `node_modules/pac-resolver` | 7.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 153 | `node_modules/parse-cache-control` | 1.0.1 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 154 | `node_modules/parseurl` | 1.3.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 155 | `node_modules/path-exists` | 4.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 156 | `node_modules/path-to-regexp` | 0.1.13 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 157 | `node_modules/pngjs` | 5.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 158 | `node_modules/progress` | 2.0.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 159 | `node_modules/proxy-addr` | 2.0.7 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 160 | `node_modules/proxy-from-env` | 2.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 161 | `node_modules/qrcode` | 1.5.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 162 | `node_modules/qs` | 6.15.2 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 163 | `node_modules/range-parser` | 1.2.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 164 | `node_modules/raw-body` | 2.5.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 165 | `node_modules/readable-stream` | 3.6.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 166 | `node_modules/require-directory` | 2.1.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 167 | `node_modules/require-main-filename` | 2.0.0 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 168 | `node_modules/safe-buffer` | 5.2.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 169 | `node_modules/safe-decode-uri-component` | 1.2.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 170 | `node_modules/safer-buffer` | 2.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 171 | `node_modules/sax` | 1.6.0 | BlueOak-1.0.0 | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 172 | `node_modules/send` | 0.19.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 173 | `node_modules/send/node_modules/debug` | 2.6.9 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 174 | `node_modules/send/node_modules/debug/node_modules/ms` | 2.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 175 | `node_modules/serve-static` | 1.16.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 176 | `node_modules/set-blocking` | 2.0.0 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 177 | `node_modules/setprototypeof` | 1.2.0 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 178 | `node_modules/sherpa-onnx-win-x64` | 1.13.4 | Apache-2.0 | INSTALLED_PACKAGE_MANIFEST_ONLY | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 179 | `node_modules/side-channel` | 1.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 180 | `node_modules/side-channel-list` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 181 | `node_modules/side-channel-map` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 182 | `node_modules/side-channel-weakmap` | 1.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 183 | `node_modules/simple-yenc` | 1.0.4 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 184 | `node_modules/smart-buffer` | 4.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 185 | `node_modules/socks` | 2.8.9 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 186 | `node_modules/socks-proxy-agent` | 8.0.5 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 187 | `node_modules/source-map` | 0.6.1 | BSD-3-Clause | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 188 | `node_modules/statuses` | 2.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 189 | `node_modules/streamsearch` | 1.1.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 190 | `node_modules/string_decoder` | 1.3.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 191 | `node_modules/string-width` | 4.2.3 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 192 | `node_modules/strip-ansi` | 6.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 193 | `node_modules/strtok3` | 10.3.5 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 194 | `node_modules/toidentifier` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 195 | `node_modules/token-types` | 6.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 196 | `node_modules/tslib` | 2.8.1 | 0BSD | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 197 | `node_modules/tunnel` | 0.0.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 198 | `node_modules/type-is` | 1.6.18 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 199 | `node_modules/typedarray` | 0.0.6 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 200 | `node_modules/uint8array-extras` | 1.5.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 201 | `node_modules/unpipe` | 1.0.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 202 | `node_modules/util-deprecate` | 1.0.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 203 | `node_modules/utils-merge` | 1.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 204 | `node_modules/vary` | 1.1.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 205 | `node_modules/which-module` | 2.0.1 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 206 | `node_modules/win-guid` | 0.2.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 207 | `node_modules/wrap-ansi` | 6.2.0 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 208 | `node_modules/xml2js` | 0.6.2 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 209 | `node_modules/xmlbuilder` | 11.0.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 210 | `node_modules/y18n` | 4.0.3 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 211 | `node_modules/yargs` | 15.4.1 | MIT | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |
| 212 | `node_modules/yargs-parser` | 18.1.3 | ISC | INSTALLED_PACKAGE_LICENSE_FILE | ALLOW_WITH_NOTICE_OBLIGATIONS |

## Official references used for interpretation

- Mozilla MPL 2.0 FAQ: <https://www.mozilla.org/en-US/MPL/2.0/FAQ/>
- GNU license compatibility list: <https://www.gnu.org/licenses/license-list.html>
