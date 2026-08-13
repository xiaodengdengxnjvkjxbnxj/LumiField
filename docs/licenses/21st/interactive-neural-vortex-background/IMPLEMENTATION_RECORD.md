# LumiField direct WebGL adaptation record

New feature 7 now uses the complete component source supplied by the user,
rather than the earlier independently drawn SVG approximation.

Retained from the supplied component source:

- the source WebGL canvas architecture, sized to the existing `我的` panel;
- the original four-vertex `TRIANGLE_STRIP` geometry;
- the original vertex shader;
- the original fragment shader, including `rotate`, fifteen `neuro_shape`
  iterations, pointer-distance field, noise exponents, scroll-driven purple/
  cyan color mixing and alpha output;
- the original DPR cap of 2;
- the original `0.2` pointer smoothing coefficient and continuous RAF while
  the profile is visible.

LumiField-only integration changes:

- React mounting and the unrelated VR hero/demo content are omitted;
- the existing authenticated `我的` dialog remains the only host and foreground
  UI; the canvas is a direct child of `.lf-profile-dialog`, is clipped to its
  rounded boundary and cannot render in the full-screen modal mask or another
  panel;
- all blur/backdrop-filter effects are explicitly disabled on the host dialog
  and vortex canvas so the source shader stays sharp;
- the existing Liquid Glass pointer bus supplies the component pointer target,
  avoiding a second document-level pointer listener; only pointer coordinates
  inside the `我的` panel update the shader;
- dialog scroll maps to the source `u_scroll_progress` uniform so the effect
  remains active at the top, middle and bottom of the profile;
- hidden, reduced-motion and low-power states stop the RAF without removing
  the dialog;
- close/dispose deletes the WebGL buffer, program and shaders, loses the
  context, removes the canvas and unsubscribes the shared pointer consumer.

Product files:

- `public/lf-profile-neural-vortex.js`
- `public/lf-profile-neural-vortex.css`
- `public/lf-auth-monitor.js` (existing profile lifecycle hooks)
- `public/index.html` (one stylesheet and one script load)

No upstream demo text, React runtime, font, preview video, analytics, network
request or registry package is included.
