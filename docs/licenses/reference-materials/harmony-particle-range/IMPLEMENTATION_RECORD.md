# Implementation record

- Product files: `public/lf-particle-range-control.js`,
  `public/lf-particle-range-control.css`, `public/index.html`.
- Control inventory: 90 native `input[type=range]` controls when all dynamic
  modules are present, plus the existing custom `#progress-bar` timeline.
- Runtime architecture: one delegated behavior layer, one transparent
  pointer-inert overlay canvas, one capped shared particle pool and one
  on-demand animation scheduler for every control and deletion effect.
- Preserved behavior: the layer never writes a control value, min/max, step,
  disabled state, keyboard behavior, touch behavior, pointer capture, or ARIA
  state. Existing product listeners remain the only value owners.
- Deletion transaction: the secondary-interface Three.js 3D playlist
  source-card snapshot is captured only after the
  real delete/unsubscribe operation returns `ok:true`. The confirmation modal
  closes, the card slides and dissolves from right to left into wind-driven
  particles exactly once, and only then are the 2D/3D/cache/current-selection
  references removed. Cancel, authorization failure, backend failure and stale
  account scope never start the effect.
- Surface boundary: Home cards and every ordinary 2D playlist remain outside
  this deletion effect; snapshot creation fails closed unless the visual-stage
  secondary interface is active.
- Excluded: reference-video bytes, OpenHarmony assets/code, per-control canvas,
  per-control scheduler, additional audio/renderer, and generated visual media.
