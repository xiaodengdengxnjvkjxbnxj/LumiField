# ATC splash adaptation record

The WebGL2 vertex/fragment shader from the user-supplied complete-source file is
adapted into `public/lf-splash.js`. React ownership, demo text, preview media and
the source component's own RAF are excluded. LumiField supplies one shared
splash RAF, bounded DPR, cleanup and a Canvas2D fallback. The ATC canvas stays
below the transparent kinetic-grid canvas.

Product files:

- `public/lf-splash.js`
- `public/lf-splash.html`
- `public/lf-splash.css`
- `desktop/lf-splash-main.js`
- `desktop/lf-splash-preload.js`

Material source hash and page identity are fixed in `SOURCE_AND_LICENSE.md`.
