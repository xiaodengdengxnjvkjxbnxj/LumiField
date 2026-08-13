# Implementation record

- Product files: `public/lf-home-edge-glow.css`, `public/lf-home-edge-glow.js`, `public/index.html`
- Use: independent implementation of a continuously moving circular edge light and pointer-local highlight diffusion.
- Excluded: source video bytes, reference icon, reference button surface, and reference geometry.
- Preserved LumiField behavior: the existing `#home-btn` dimensions, SVG, position, hit area, and `goHome()` navigation.
- Runtime architecture: one decorative DOM layer, CSS animation, and the existing `LumiFieldLiquidGlass` shared pointer scheduler; no feature-owned pointer listener or requestAnimationFrame loop.
