# Audio Echo V2 modification record

Fixed-source analysis was performed against Shape 1 commit
f14589172431fa1da66fc78dd1f6cc403ead545b and Shape 2 commit
cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc. The following is a functional
modification record, not a public-release clearance.

## Product modules

### lf-audio-echo-shape1.js

- Directly adapts the necessary Shape 1 map-scene, shader, eight-band analysis,
  beat/kick envelope, ground-EQ, ripple, meteor, impact-particle, floating-block,
  idle-motion, theme, and camera behavior into a vanilla Three.js adapter.
- Replaces React, React Three Fiber, drei, and source-owned player lifecycle
  with an imperative adapter mounted by LumiField.
- Preserves the fixed density calculation: density 46 produces a 155 by 155
  grid (24,025 instances), 10 ripple slots, 20 meteors, 200 impact particles,
  and 80 floating blocks.
- Allocates no renderer, AudioContext, analyser, audio element, animation loop,
  timer, or persistent event listener.

### lf-audio-echo-shape2.js

- Directly adapts the necessary Shape 2 map-scene, shader, eight-band analysis,
  ripple, meteor, impact-particle, idle-wave, theme, and camera behavior into a
  vanilla Three.js adapter.
- Replaces React/R3F, wallpaper preview/UI/media, and source-owned audio
  allocation with the LumiField manager contract.
- Uses a 160 by 160 grid (25,600 instances), 20 ripple slots, 40 meteors, and
  200 impact particles.
- Allocates no renderer, AudioContext, analyser, audio element, animation loop,
  timer, or persistent event listener.

### lf-audio-echo-lyrics-bridge.js

- Moves the pre-V2 LumiField Shape 1 left-lyrics implementation behind a
  preservation bridge without importing upstream lyrics.
- Preserves #lf-mode1-left-lyrics-layer, existing class/DOM/style behavior,
  interaction pass-through, lyric indexing, and the 80 ms update cadence.
- Frozen checkpoint hashes are recorded in the Shape 1 golden metadata.

### lumifield-audio-echo.js

- Converts the existing controller into the shared Shape 1/Shape 2 manager.
- Reuses the one existing LumiField renderer, audio element, AudioContext,
  analyser, frequency buffer, scene clock, and animation loop.
- Enforces one mounted adapter at a time; shape switching disposes the previous
  adapter and does not create per-shape listeners or media resources.
- Retains the public manager API and exposes truthful source/release debugging
  metadata. Shape 3 has no registration or fallback.

## Exclusions and deletions from the adaptation boundary

The port excludes all upstream demo and preview shells, demo audio, upstream
lyrics, album artwork/media, font files, logo/branding assets, telemetry,
analytics, account code, updater code, standalone player code, and any
source-owned renderer or audio lifecycle. No excluded media is copied into the
LumiField package.

## Release status

Audio Echo V2 is `AUDIO_ECHO_V2_GPL_PASS`; it is cleared for GPLv3 source and
installer distribution under the classifications in `RELEASE_GATE.md`. Shape 1
is `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED`; Shape 2 combines
`GPL_NATIVE_PASS` for CmzYa's original contributions with that same confirmed
Shape-1 downstream grant for inherited expression. Preserve the listed
attribution, fixed revisions, authorization record and GPL obligations.
