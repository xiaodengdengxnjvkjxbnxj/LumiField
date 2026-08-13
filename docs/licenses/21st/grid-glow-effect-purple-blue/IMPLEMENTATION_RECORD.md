# LumiField independent implementation record

The implementation is limited to the six existing `.home-card` controls inside
the Home `.home-grid`:

- one non-interactive border-light layer per existing card;
- two non-interactive junction lights positioned from live card geometry;
- the existing Liquid Glass `pointermove` listener and its on-demand
  animation-frame update, extended through a single registered consumer;
- CSS-pixel geometry, so mixed DPI does not change the target mapping;
- reduced-motion support and immediate visual shutdown outside Home;
- no card cloning, layout mutation, text replacement, player changes, weather
  changes, hot-comment changes, or replacement click handlers.

Files:

- `public/lf-home-grid-glow.js`
- `public/lf-home-grid-glow.css`
- the shared-consumer extension in `public/lf-liquid-glass.js`
- the two one-time asset includes in `public/index.html`

No React, shadcn, lucide, Framer Motion, registry package, upstream source file,
image, audio, video, font or telemetry endpoint was imported.
