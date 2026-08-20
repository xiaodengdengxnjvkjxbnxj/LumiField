# Audio Echo V2 modification record

Fixed-source analysis was performed against Shape 1 commit
51afbac3d5978c112311fca38f7334578ca2b0e6 and Shape 2 commit
cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc. The following is a functional
modification record, not a public-release clearance.

## Product modules

### lf-audio-echo-shape1.js

- The user-designated Shape 1 source of record is
  `hgbhh258-spec/Sonic-Topography-Wallpaper@51afbac3d5978c112311fca38f7334578ca2b0e6`.
- The shipped module is an LF-native imperative Three.js adapter mounted by
  LumiField. It does not package or execute the upstream React, React Three
  Fiber, drei, UI, or source-owned player lifecycle.
- LF-native grid, audio mapping, event-pool, theme and camera behavior is
  documented in the Shape 1 golden contract. Those adapter values are not
  represented as a verbatim upstream port or exact upstream pixel/runtime
  match.
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
is `MIT_PERMISSIVE_PASS`; Shape 2 combines `GPL_NATIVE_PASS` for CmzYa's
original contributions with the retained confirmed downstream grant for its
historical inherited lineage. Preserve the listed attribution, fixed
revisions, authorization record and GPL obligations.
