# Shape 1 golden-master contract

Status: LF_NATIVE_ADAPTER_GOLDEN_CONTRACT.

This directory defines the deterministic target for LumiField's native Shape 1
adapter. It does not claim a verbatim port, exact runtime behavior, or pixel
equivalence with the upstream React/R3F application. It contains no invented
upstream screenshot and does not claim human visual acceptance. No Electron
run was performed for the 2026-08-20 source-record update.

## Fixed target

- Source of record: https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper
  at `51afbac3d5978c112311fca38f7334578ca2b0e6` (eeegg).
- License: MIT; `Copyright (c) 2026 eeegg`; fixed `LICENSE` SHA-256
  `A56D7F54B15275F69BA6BA3A2E605183C79918D2DC6AB3BFEF976369CA916585`.
- Runtime target: LF-native `public/lf-audio-echo-shape1.js`, using LumiField's
  shared renderer, analyser, media element and animation frame.
- Viewport: 1280 by 720 CSS pixels; DPI/deviceScaleFactor profiles 1, 1.25, 1.5.
- Theme: fixed-source/LF-native `nocturnal` baseline (four themes available).
- Camera: LF-native baseline position
  [35,25,35], target [0,0,0].
- Audio: lawful test-generated local 48 kHz stereo PCM; no third-party media.
- Grid: fixed 160 by 160, 25,600 instances; spacing 1.05, box width 0.9.
- Pools: 10 ripple, 20 meteor and 200 impact-particle slots; no floating-block
  runtime exists in the current Shape 1 adapter.
- Interaction: mouse move, drag rotation, pan, wheel zoom, and reset.
- GPU, ANGLE, Chromium and pixels remain pending until the current LF adapter
  is deliberately run by the targeted harness.

## Upstream-only build evidence

An isolated temporary clone of the fixed source passed `npm ci` and
`npm run build` on 2026-08-20 with Node `v24.16.0` and npm `11.13.0`.
`npm audit --json` reported 7 vulnerabilities (2 low, 1 moderate, 4 high,
0 critical). This result belongs only to that upstream temporary clone and
does not describe LumiField's lockfile, packaged runtime or release gate.

## Frozen LumiField lyrics

The protected left lyric layer is the pre-V2 LumiField implementation at
#lf-mode1-left-lyrics-layer, not an upstream lyric component. DOM, classes,
computed styles, timing/index behavior, pointer pass-through, and pixels remain
frozen. The update cadence is 80 ms. Exact checkpoint hashes are in
metadata.json.

## Historical capture boundary

The 2026-08-08 harness run passed 40/40 checks with zero renderer/console
errors and a zero lyric pixel-change ratio, but it targeted the retired
`yin-yizhen/sonic-topography@f14589172431fa1da66fc78dd1f6cc403ead545b`
source record. It is retained as historical evidence only and does not verify
the current source or establish an exact match. The current Shape 1 source is
`MIT_PERMISSIVE_PASS`; see
`docs/licenses/audio-echo-v2/RELEASE_GATE.md`.
