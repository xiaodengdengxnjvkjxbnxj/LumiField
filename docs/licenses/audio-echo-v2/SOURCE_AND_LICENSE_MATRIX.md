# Audio Echo V2 source and license matrix

Current review: 2026-08-13. This record supersedes the earlier blanket
`LICENSE_BLOCKED` description. The user confirmed on 2026-08-13 that the
original author has also supplied the GPLv3 downstream confirmation through
their retained WeChat conversation. The chat itself is private evidence and is
not fabricated or embedded in this repository; this record preserves the
user's provenance attestation and the already-public Issue #25 evidence.

| Item | Fixed source and attribution | Rights evidence | LumiField file/region | GPLv3 classification |
| --- | --- | --- | --- | --- |
| Shape 1 | Ajin; `yin-yizhen/sonic-topography@f14589172431fa1da66fc78dd1f6cc403ead545b` | Fixed `LICENSE` SHA-256 `2DFAC39FB6A692AFDCC0754C8C6028208FB2A90E803A2FA4299DF7807EE19242`. GitHub Issue #25 comments `5118636372` and OWNER confirmation `5118672629` expressly authorize LumiField use, modification and public source/installer distribution, including commercial distribution. The user further attested on 2026-08-13 that the original author confirmed GPLv3 downstream rights in retained WeChat correspondence. | `public/lf-audio-echo-shape1.js`, scene/shader/audio-response adapter | `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED` |
| Shape 2 — CmzYa contributions | CmzYa; `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc` | Fixed repository GPL-3.0 license SHA-256 `5199686BA1FA5624E6C68712611457B45D1A1347C011C51D6011DB20F02169CE` | Shape-2-specific portions of `public/lf-audio-echo-shape2.js` | `GPL_NATIVE_PASS` |
| Shape 2 — inherited Shape-1 portions | Same Shape 2 revision, with material derived from the fixed Shape 1 lineage | Covered by the Issue #25 authorization and the user's 2026-08-13 attestation of the original author's retained WeChat GPLv3 downstream confirmation | Inherited scene/shader/audio-response portions in `public/lf-audio-echo-shape2.js` | `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED` |
| LumiField manager and lyrics bridge | LumiField integration code | Repository history and source-boundary audit; no upstream lyric component, player, renderer, analyser or lifecycle owner was imported | `public/lumifield-audio-echo.js`; `public/lf-audio-echo-lyrics-bridge.js` | `LUMIFIELD_ORIGINAL_PASS` |
| Shape 3 | `XxHuberrr/Mineradio@411bce4e4a8e5add3d1f76ac4a9c19306f6a10df` reviewed only | No Shape-3 adapter, entry, resource or package artifact exists in LumiField | Not in release tree | `NOT_IN_RELEASE_TREE` |

## Fixed-source evidence

- Issue: <https://github.com/yin-yizhen/sonic-topography/issues/25>
- Issue API snapshot observed 2026-08-13: 4,397 UTF-8 bytes, SHA-256
  `274E3CED2BFD034473E1A3D29E1B12C39FCBA7FAA5E5F62B5E74C222A11B37FA`.
- Comments API snapshot observed 2026-08-13: 12,846 UTF-8 bytes, SHA-256
  `924B6CCFB52F8DEAD523252D0988CBD957606EE38E861C355744F8AE08FACAD0`.
- Shape 1 adapted-source manifest:
  `714BC22A826F5C8F510D9134A3930A0361E216749A0825B46E40BD3B22037D98`.
- Shape 2 adapted-source manifest:
  `D8BD8F35B12873A81654A171D3A203281DA4F67FD8856C3415529E6DA962AE64`.
- Individual fixed-source hashes remain in `SOURCE_SHA256SUMS.txt`.

## Excluded upstream material

No upstream demo/preview application, demo audio, lyrics, album media, font,
logo, telemetry, analytics, cloud credential, updater, account system, player,
renderer, AudioContext, audio element, RAF owner or listener owner is packaged.

## Retained private evidence boundary

The public Issue establishes the fixed source and broad LumiField authorization.
The user is responsible for retaining the original WeChat conversation that
confirms GPLv3 downstream rights. This repository records the fact and date of
that confirmation without inventing a screenshot, message identifier or hash.
