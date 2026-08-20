# Audio Echo V2 third-party notices

This file supplements the repository-level NOTICE.md. It records attribution
and the exact scope of the Audio Echo V2 private integration. It does not grant
rights beyond those granted by the respective copyright holders.

## Shape 1 — Sonic Topography Wallpaper

- Author/copyright attribution: eeegg; `Copyright (c) 2026 eeegg`.
- Source: https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper
- Fixed `main` commit: 51afbac3d5978c112311fca38f7334578ca2b0e6.
- License at that commit: MIT.
- Fixed Git-blob license SHA-256:
  A56D7F54B15275F69BA6BA3A2E605183C79918D2DC6AB3BFEF976369CA916585.
- LumiField use: the fixed source is Shape 1's adaptation source of record.
  `public/lf-audio-echo-shape1.js` is an LF-native imperative Three.js adapter
  that reuses LumiField's renderer, analyser and frame lifecycle. It is not the
  upstream React/R3F application; this documentation does not claim a verbatim
  whole-application port or exact runtime pixel match.
- Classification: `MIT_PERMISSIVE_PASS`.
- Upstream-only verification: an isolated fixed-commit temporary clone passed
  `npm ci` and `npm run build` on 2026-08-20. Its `npm audit` result was 7
  vulnerabilities (2 low, 1 moderate, 4 high, 0 critical). This result does
  not describe LumiField's lockfile or packaged dependency graph.

## Shape 2 — Sonic Topography fork

- Author attribution: CmzYa.
- Source: https://github.com/CmzYa/sonic-topography
- Fixed commit: cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc.
- Declared repository license at that commit: GPL-3.0.
- Canonical LF-byte license SHA-256:
  5199686BA1FA5624E6C68712611457B45D1A1347C011C51D6011DB20F02169CE.
- Chain finding: Shape 2 contains substantial material from the historical
  `yin-yizhen/sonic-topography` lineage. The downstream repository's GPL notice
  does not by itself establish authority to relicense every inherited portion.
- LumiField use: Shape 2 scene/shader and eight-band response behavior is
  adapted to the existing LumiField Three.js renderer and shared audio
  analyser.
- Classification: CmzYa's contributions are `GPL_NATIVE_PASS`; inherited
  historical-lineage expression is `LUMIFIELD_AUTHORIZED +
  GPLV3_DOWNSTREAM_CONFIRMED`.
- Rights evidence for those inherited portions: upstream Issue #25 comments
  `5118636372` and OWNER confirmation `5118672629`, plus the user's 2026-08-13
  attestation that the original author supplied the GPLv3 downstream
  confirmation in retained WeChat correspondence.

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
