# Audio Echo V2 fixed-source validation — 2026-08-09

Historical evidence notice: the Shape 1 entry below covers the retired
`yin-yizhen` source decision only. It does not validate the current Shape 1
source of record. Current fixed-source/build evidence is in
`docs/licenses/audio-echo-v2/SOURCE_AND_LICENSE_MATRIX.md`.

This is build evidence for the two fixed upstream commits. It is separate from
LumiField runtime validation and does not clear either public-release license
gate.

## Shape 1

- Source: `yin-yizhen/sonic-topography@f14589172431fa1da66fc78dd1f6cc403ead545b`
- `npm ci`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS (2,501 modules; 10.59 s)
- Local preview root and main JavaScript: HTTP 200
- Lockfile and checkout remained clean.

## Shape 2

- Source: `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc`
- Frozen install initially stopped because pnpm blocked the `esbuild` lifecycle
  script; retry with `--ignore-scripts`: PASS
- `pnpm run build`: PASS (993 modules; 8.56 s)
- Local preview root and main JavaScript: HTTP 200
- `pnpm run lint`: upstream FAIL: `wallpaper/main.tsx` lacks declarations for
  `Window.__mediaState` and `MediaState` (five TS2339 and one TS2304). This is
  recorded as an upstream type defect; it does not alter the fixed source.
- Lockfile and checkout remained clean.

The detailed temporary log was written to
`%LOCALAPPDATA%\Temp\lf-audio-echo-v2-20260808224728\UPSTREAM_VALIDATION_20260809.md`
with SHA-256
`8F627C0358D2FE31FEFA5AF96C1C4D3334186BD126843451708CF77DEFCEEFBE`.
Both preview processes and ports were closed after verification.
