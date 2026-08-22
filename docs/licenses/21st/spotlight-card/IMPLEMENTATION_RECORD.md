# Spotlight Card implementation record

Problem 20 reproduces the supplied Spotlight Card appearance on the existing
weather surface. Source comparison established that the distributed mechanics
come from Jhey Tompkins' public MIT CodePen “React Glow Cards – Minimal”; the
EaseMize React wrapper supplied as reference is not present in the product.

The retained MIT core mechanics are:

- viewport pointer values and normalized `xp/yp` hue progression;
- `base=220`, `spread=200`, `size=200`, `border=3`, `outer=1`;
- fixed-background radial gradients;
- masked color and white border layers, `brightness(2)`, and the blurred outer
  layer.

LumiField replaces the standalone React lifecycle with its existing shared
document-pointer frame and weather lifecycle. It adds no private listener or
RAF. Real child layers avoid collisions with the weather panel's existing
Liquid Glass pseudo-elements; every effect layer is `aria-hidden` and
`pointer-events:none`.

The following reference-wrapper expression is deliberately absent from the
distribution: `GlowCardProps`, color and size maps, custom width/height API,
sizing helpers, React refs/effect/component export, Tailwind demo classes, and
the three-card demo. The supplied TXT/video and Marketplace preview material
are not packaged.

The auto-rotating song/hot-comment child receives no effect marker, glow layer,
listener, or transform. It remains ordinary clickable content inside the one
parent surface. The older five-tile `接着听` spotlight remains a separate
LF-native implementation.

Product files:

- `public/lf-weather-tilt-spotlight.js`
- `public/lf-weather-tilt-spotlight.css`
- `public/index.html` (one stylesheet and one script load)

Retained third-party notice:

- `resources/licenses/Jhey-CodePen-MIT.txt`
