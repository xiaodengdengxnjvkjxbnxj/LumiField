# Audio Echo upstream audit

Audit date: 2026-07-28

The four repositories below were inspected only to establish provenance and
observable behavior. No source, shader, bundle, media, icon, preset file, or
asset from them is included in LumiField.

| Mode reference | Pinned source | Classification | Decision |
| --- | --- | --- | --- |
| Classic energy island | `hgbhh258-spec/Sonic-Topography-Wallpaper@51afbac3d5978c112311fca38f7334578ca2b0e6` | `REJECTED_AS_CODE_SOURCE` | Its README identifies a fork of `yin-yizhen/sonic-topography`; that upstream uses a non-commercial learning license. The downstream MIT file does not establish authority to relicense the upstream core. |
| Neon topology | `Zhang-le-zun/sonic-topography-remix@5868d183edd5d87042382cab984f3107372ce040` | `REFERENCE_ONLY` | MIT file exists, but the repository contains only a compiled distribution, and its README/dev log describes a Steam Workshop derivative and copied project metadata without a complete rights chain. |
| Dark preview | `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc` | `REFERENCE_ONLY` | GPL-3.0 code was not imported because the current LumiField distribution is not being relicensed as GPL-3.0. Preview media has no separate asset grant. |
| Wide impact | `Alex-zeya/sonic-topography@f9b81fbc2dbf976d98a61671b03cd990221530fd` | `REFERENCE_ONLY` | No LICENSE/COPYING/NOTICE or package license. A core shader file is byte-identical to the first repository, without provenance or permission evidence. |

Additional findings:

- None of the four repositories contains both a complete preferred source tree
  and a rights chain that is compatible with LumiField's current distribution.
- None contains `COPYING` or `NOTICE`. The first, third, and fourth
  repositories omit a `license` field from `package.json`; the second
  repository has no `package.json`.
- None of the four repositories supplies an independent license for its custom
  shaders.
- Audio, LRC, preview GIF, icons, and other media in those repositories are not
  redistributed.
- `CustomShaderMaterial.ts` in the first and fourth repositories had the same
  SHA-256:
  `1B7AD8F4CD9E5DD37F992C868D2D36F3FEF7FBF5C32E5BCABEFE72A5BBEB4090`.
- Public descriptions and rendered demonstrations were treated as behavioral
  references only.

LumiField reuse boundary:

- No repository file, source fragment, shader expression, class/function
  structure, bundle, project metadata, preset, media, icon, font, texture, or
  model may be copied into the production implementation.
- Observable composition, topology, interaction, and timing may constrain an
  independently written implementation.
- React, Three.js, and other general-purpose dependencies must be consumed from
  their official packages under their own licenses, never extracted from these
  repositories' bundles.

Primary audit links:

- https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper/tree/51afbac3d5978c112311fca38f7334578ca2b0e6
- https://github.com/yin-yizhen/sonic-topography/blob/f14589172431fa1da66fc78dd1f6cc403ead545b/LICENSE
- https://github.com/Zhang-le-zun/sonic-topography-remix/tree/5868d183edd5d87042382cab984f3107372ce040
- https://github.com/CmzYa/sonic-topography/tree/cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc
- https://github.com/Alex-zeya/sonic-topography/tree/f9b81fbc2dbf976d98a61671b03cd990221530fd
