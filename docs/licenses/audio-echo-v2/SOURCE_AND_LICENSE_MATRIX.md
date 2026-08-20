# Audio Echo V2 source and license matrix

Current review: 2026-08-20. Shape 1's source of record is the user-designated
`hgbhh258-spec/Sonic-Topography-Wallpaper` fixed revision below. Its fixed MIT
notice identifies `Copyright (c) 2026 eeegg`. The earlier
`yin-yizhen/sonic-topography` record is not the current Shape 1 source; it is
retained only for the historical lineage/rights record of inherited portions
in the fixed Shape 2 source.

| Item | Fixed source and attribution | Rights evidence | LumiField file/region | GPLv3 classification |
| --- | --- | --- | --- | --- |
| Shape 1 | eeegg; `hgbhh258-spec/Sonic-Topography-Wallpaper@51afbac3d5978c112311fca38f7334578ca2b0e6` | MIT at the fixed commit; `LICENSE` SHA-256 `A56D7F54B15275F69BA6BA3A2E605183C79918D2DC6AB3BFEF976369CA916585`; `Copyright (c) 2026 eeegg` | `public/lf-audio-echo-shape1.js` is an LF-native imperative Three.js adapter. The source is the fixed adaptation reference; no byte-for-byte React/R3F-application or exact runtime pixel-equivalence claim is made. | `MIT_PERMISSIVE_PASS` |
| Shape 2 — CmzYa contributions | CmzYa; `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc` | Fixed repository GPL-3.0 license SHA-256 `5199686BA1FA5624E6C68712611457B45D1A1347C011C51D6011DB20F02169CE` | Shape-2-specific portions of `public/lf-audio-echo-shape2.js` | `GPL_NATIVE_PASS` |
| Shape 2 — inherited historical lineage | Same Shape 2 revision, with material derived from the historical `yin-yizhen/sonic-topography` lineage | Covered by Issue #25 and the user's 2026-08-13 attestation of the original author's retained WeChat GPLv3 downstream confirmation | Inherited scene/shader/audio-response portions in `public/lf-audio-echo-shape2.js` | `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED` |
| LumiField manager and lyrics bridge | LumiField integration code | Repository history and source-boundary audit; no upstream lyric component, player, renderer, analyser or lifecycle owner was imported | `public/lumifield-audio-echo.js`; `public/lf-audio-echo-lyrics-bridge.js` | `LUMIFIELD_ORIGINAL_PASS` |
| Shape 3 | `XxHuberrr/Mineradio@411bce4e4a8e5add3d1f76ac4a9c19306f6a10df` reviewed only | No Shape-3 adapter, entry, resource or package artifact exists in LumiField | Not in release tree | `NOT_IN_RELEASE_TREE` |

## Shape 1 fixed-source and build evidence

- Repository: <https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper>.
- Fixed `main` commit: `51afbac3d5978c112311fca38f7334578ca2b0e6`.
- Commit author observed from the fixed Git object: `eeegg`; fixed MIT notice:
  `Copyright (c) 2026 eeegg`.
- Shape 1 canonical source-subset manifest:
  `CA6FD0557F779451BC7428F6DF4EADC12F970256C13678FC4116779B38E3E700`.
  It is SHA-256 over the UTF-8, LF-terminated, path-sorted `HASH  path`
  records listed for Shape 1 in `SOURCE_SHA256SUMS.txt` (excluding both
  manifest records).
- The runtime adapter also embeds its fixed adapted-file manifest identifier
  `985314D22C24EFEB4F629B623E6D494225F9063AE2FC11F9FD2F2AF539FEFAE1`.
  The individual Git-blob hashes are the normative byte evidence; the
  canonical audit-subset digest above additionally covers the upstream
  package/lock files used for the isolated build verification.
- Isolated temporary-clone verification on 2026-08-20 used Node `v24.16.0`
  and npm `11.13.0`: `npm ci` PASS; `npm run build` PASS (Vite, 2,471
  transformed modules). `npm audit --json` reported 7 vulnerabilities:
  2 low, 1 moderate, 4 high, 0 critical. These counts describe only the
  fixed upstream temporary clone and its lockfile; they are not a LumiField
  dependency-graph, packaged-runtime, or release-gate finding.

## Shape 2 fixed-source and retained rights evidence

- Shape 2 adapted-source manifest:
  `D8BD8F35B12873A81654A171D3A203281DA4F67FD8856C3415529E6DA962AE64`.
- Individual fixed-source hashes remain in `SOURCE_SHA256SUMS.txt`.
- Historical lineage authorization issue:
  <https://github.com/yin-yizhen/sonic-topography/issues/25>.
- Issue API snapshot observed 2026-08-13: 4,397 UTF-8 bytes, SHA-256
  `274E3CED2BFD034473E1A3D29E1B12C39FCBA7FAA5E5F62B5E74C222A11B37FA`.
- Comments API snapshot observed 2026-08-13: 12,846 UTF-8 bytes, SHA-256
  `924B6CCFB52F8DEAD523252D0988CBD957606EE38E861C355744F8AE08FACAD0`.

## Excluded upstream material

No upstream demo/preview application, demo audio, lyrics, album media, font,
logo, telemetry, analytics, cloud credential, updater, account system, player,
renderer, AudioContext, audio element, RAF owner or listener owner is packaged.

## Retained private evidence boundary

The public Issue and private-evidence attestation apply to the inherited
historical lineage in Shape 2, not to the new MIT-licensed Shape 1 source. The
user is responsible for retaining the original WeChat conversation that
confirms GPLv3 downstream rights. This repository records the fact and date of
that confirmation without inventing a screenshot, message identifier or hash.
