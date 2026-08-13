# Audio Echo V2 third-party notices

This file supplements the repository-level NOTICE.md. It records attribution
and the exact scope of the Audio Echo V2 private integration. It does not grant
rights beyond those granted by the respective copyright holders.

## Shape 1 — Sonic Topography

- Author attribution: Ajin.
- Source: https://github.com/yin-yizhen/sonic-topography
- Fixed commit: f14589172431fa1da66fc78dd1f6cc403ead545b.
- License at that commit: Non-Commercial Learning License.
- Canonical LF-byte license SHA-256:
  2DFAC39FB6A692AFDCC0754C8C6028208FB2A90E803A2FA4299DF7807EE19242.
- Additional evidence: upstream Issue #25 comments `5118636372` and OWNER
  confirmation `5118672629` explicitly authorize LumiField use, modification,
  integration and source/installer distribution, including commercial and
  closed-source distribution, worldwide and royalty-free, subject to the
  recorded conditions.
- LumiField use: Shape 1 scene/shader and audio-response behavior is adapted to
  the existing LumiField Three.js renderer and shared audio analyser.
- Classification: `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED`. On
  2026-08-13 the user attested that the original author supplied the GPLv3
  downstream confirmation in retained WeChat correspondence.

## Shape 2 — Sonic Topography fork

- Author attribution: CmzYa.
- Source: https://github.com/CmzYa/sonic-topography
- Fixed commit: cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc.
- Declared repository license at that commit: GPL-3.0.
- Canonical LF-byte license SHA-256:
  5199686BA1FA5624E6C68712611457B45D1A1347C011C51D6011DB20F02169CE.
- Chain finding: Shape 2 contains substantial Shape 1-derived material. The
  downstream repository's GPL notice does not by itself establish authority to
  relicense every upstream portion.
- LumiField use: Shape 2 scene/shader and eight-band response behavior is
  adapted to the existing LumiField Three.js renderer and shared audio
  analyser.
- Classification: CmzYa's contributions are `GPL_NATIVE_PASS`; inherited
  Shape-1 expression is `LUMIFIELD_AUTHORIZED +
  GPLV3_DOWNSTREAM_CONFIRMED`.

## Shape 3 — provenance reference only

- Reference: https://github.com/XxHuberrr/Mineradio
- Fixed commit: 411bce4e4a8e5add3d1f76ac4a9c19306f6a10df.
- Declared upstream reference: yin-yizhen/sonic-topography commit
  3ff303e18493359d99c47eeeef7fe7943c8fe64e.
- Shape 3 is not imported, exposed, executed, or packaged by Audio Echo V2.
- Release-tree status: `NOT_IN_RELEASE_TREE`; any future import requires a new
  provenance and rights audit.

## Deliberately excluded material

No upstream demo, demo audio, lyrics, album media, font, logo, telemetry, or
analytics asset/code path is copied or distributed by this integration. No
upstream wallpaper preview, account system, updater, player UI, AudioContext,
audio element, renderer, animation-frame owner, or listener owner is imported.

Existing notices for Three.js and the rest of LumiField's third-party stack
remain in the repository-level NOTICE.md and are unaffected by this record.
