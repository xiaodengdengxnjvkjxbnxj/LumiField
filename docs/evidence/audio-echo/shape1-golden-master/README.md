# Shape 1 golden-master contract

Status: SOURCE_ELECTRON_TARGETED_RUNTIME_VERIFIED.

This directory defines the deterministic capture target for the Shape 1 source
Electron run. It does not contain an invented upstream screenshot and does not
claim human visual acceptance. The targeted harness writes measured screenshots,
renderer/console results, Electron/Chromium versions, GPU/ANGLE strings, and
pixel comparisons under test-results after it is deliberately run.

## Fixed target

- Source: https://github.com/yin-yizhen/sonic-topography at
  f14589172431fa1da66fc78dd1f6cc403ead545b (Ajin).
- Source Electron application: LumiField 1.1.42 with installed Electron 42.4.1.
- Viewport: 1280 by 720 CSS pixels; DPI/deviceScaleFactor profiles 1, 1.25, 1.5.
- Theme: minimal-monochrome.
- Camera: source-tuned position
  [-37.5836298835141, 25.718921008284557, 92.25687558089541], target [0,0,0].
- Audio: lawful test-generated local 48 kHz stereo PCM; no third-party media.
- Grid: density 46, 155 by 155, 24,025 instances.
- Pools: 10 ripple, 20 meteor, 200 impact-particle, 80 floating-block slots.
- Interaction: mouse move, drag rotation, pan, wheel zoom, and reset.
- GPU, ANGLE, and Chromium: captured from the actual targeted runtime; no value
  is fabricated in this baseline.

## Frozen LumiField lyrics

The protected left lyric layer is the pre-V2 LumiField implementation at
#lf-mode1-left-lyrics-layer, not an upstream lyric component. DOM, classes,
computed styles, timing/index behavior, pointer pass-through, and pixels remain
frozen. The update cadence is 80 ms. Exact checkpoint hashes are in
metadata.json.

The unique targeted source Electron harness passed 40/40 checks with zero
renderer and console errors. The frozen lyric before/after images were byte
identical and had a zero pixel-change ratio. Evidence run:
`test-results/lf-v4-audio-echo-v2-source-electron/2026-08-08T23-33-55-894Z`.
This is automated source-runtime evidence, not human visual acceptance. The
separate source-rights review now classifies Shape 1 as
`LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED`; see
`docs/licenses/audio-echo-v2/RELEASE_GATE.md`.
