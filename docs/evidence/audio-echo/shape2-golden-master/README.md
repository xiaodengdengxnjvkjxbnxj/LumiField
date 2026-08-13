# Shape 2 golden-master contract

Status: SOURCE_ELECTRON_TARGETED_RUNTIME_VERIFIED.

This directory defines the deterministic capture target for the Shape 2 source
Electron run. It does not contain an invented upstream screenshot and does not
claim human visual acceptance. The targeted harness writes measured screenshots,
renderer/console results, Electron/Chromium versions, GPU/ANGLE strings, and
visual-difference evidence under test-results after it is deliberately run.

## Fixed target

- Source: https://github.com/CmzYa/sonic-topography at
  cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc (CmzYa).
- Source Electron application: LumiField 1.1.42 with installed Electron 42.4.1.
- Viewport: 1280 by 720 CSS pixels; DPI/deviceScaleFactor profiles 1, 1.25, 1.5.
- Theme: nocturnal.
- Camera: distance 85, azimuth 120 degrees, elevation 25 degrees, auto-rotate
  disabled at reset.
- Audio: lawful test-generated local 48 kHz stereo PCM; no third-party media.
- Grid: 160 by 160, 25,600 instances, total range 168.
- Bands: eight source-defined analysis bands.
- Pools: 20 ripple slots (10 shader-loop slots), 40 meteors, and 200 impact
  particles.
- Interaction: mouse move, drag rotation, pan, wheel zoom, and reset.
- GPU, ANGLE, and Chromium: captured from the actual targeted runtime; no value
  is fabricated in this baseline.

The unique targeted source Electron harness passed 40/40 checks with zero
renderer and console errors. Evidence run:
`test-results/lf-v4-audio-echo-v2-source-electron/2026-08-08T23-33-55-894Z`.
This is automated source-runtime evidence, not human visual acceptance. The
separate source-rights review now classifies CmzYa's additions as
`GPL_NATIVE_PASS` and inherited Shape-1 expression as
`LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED`; see
`docs/licenses/audio-echo-v2/RELEASE_GATE.md`.
