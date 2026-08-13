# LumiField independent implementation record

New feature 8 is applied only to the five existing Home `接着听` tiles. It
adds one pointer-transparent paint layer per current tile while retaining the
original cover, title, click-to-play handler, update data, card size, scrolling,
and the problem-17 rail offset.

The runtime:

- consumes LumiField's existing shared Liquid Glass pointer frame rather than
  adding a listener per card or a second RAF;
- converts the global pointer into each visible tile's local coordinates;
- clears offscreen, hidden, reduced-motion, low-power, non-Home, and distant
  tile effects immediately;
- refreshes after the existing dynamic five-tile render replaces its children;
- keeps all effect nodes `aria-hidden` and `pointer-events:none`, with tile
  content painted above the spotlight layer;
- exposes deterministic resource/debug state and an explicit cleanup method.

Product files:

- `public/lf-home-spotlight.js`
- `public/lf-home-spotlight.css`
- `public/index.html` (one render hook, one stylesheet and one script load)

No React, Tailwind component expression, upstream constants, 21st registry
package, preview media, analytics, or upstream runtime dependency was imported.
