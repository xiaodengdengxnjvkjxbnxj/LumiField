# Vapour Text Effect — LumiField adaptation record

Recorded: 2026-08-13

Files:

- `public/lf-vapour-lyrics.js`
- `public/index.html`
- `public/lumifield-task13.js`

Actual source use:

- Retains the supplied component's pixel-alpha text sampling.
- Retains `density=5` transformed from `[0,10]` to `[0.3,1]`.
- Retains the source spread interpolation and `spread=5` multiplier.
- Retains the left-to-right vaporization threshold.
- Retains random full-circle launch, speed range, displacement damping,
  organic random spread, velocity cap, asymmetric X/Y motion and the source's
  quick/normal fade equations.
- Retains the `2s` vaporization duration from the supplied demo.

LumiField integration changes:

- React, the standalone canvas lifecycle, ResizeObserver,
  IntersectionObserver and the component-owned requestAnimationFrame loop are
  replaced by LumiField's existing Three.js scene and shared render frame.
- Only the outgoing lyric is sampled. The current lyric remains the existing
  clear native lyric plane.
- One fixed `THREE.Points` pool (maximum 2,600 particles) is reused instead of
  allocating a renderer or particle system for every line.
- The real LumiField lyric timeline drives changes. Pause freezes the effect;
  seeks cancel stale particles; track changes, no-lyrics state, lyric-off and
  disposal clear or release the resource.
- The optional translated lyric texture is sampled into the same pool.
- No audio element, timer, RAF, event listener or second renderer is added.

These integration changes are required to preserve LumiField's unique player,
timeline, translation, rendering and resource-ownership architecture.
