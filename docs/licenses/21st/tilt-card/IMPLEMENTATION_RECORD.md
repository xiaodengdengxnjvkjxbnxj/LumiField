# LumiField independent implementation record

New feature 9 is applied only to the six existing landscape Home cards located
by the supplied `图.120.png`. It does not apply to the five `接着听` tiles,
weather panel, hot comments, player, search, or stage view.

The implementation:

- consumes LumiField's existing shared Liquid Glass pointer frame and owns no
  document pointer listener or RAF;
- maps the pointer around each card's fixed center to a gravitate-style X/Y
  perspective transform capped at 7.5 degrees, safely below the 18-degree
  ceiling and tuned for LumiField's compact text and cover layout;
- uses only CSS transforms, so grid placement, offset dimensions, click
  handlers, and scroll layout remain unchanged;
- returns through a bounded spring-like transition when the pointer leaves;
- disables perceptible tilt for coarse-pointer, touch-oriented,
  reduced-motion, hidden, low-power, non-Home, and keyboard-focus states;
- exposes deterministic resource/debug state and explicit cleanup.

Product files:

- `public/lf-home-tilt.js`
- `public/lf-home-tilt.css`
- `public/index.html` (one stylesheet and one script load)

No React component, upstream constants, Tailwind expression, 21st registry
package, preview media, analytics, or upstream runtime dependency was imported.
