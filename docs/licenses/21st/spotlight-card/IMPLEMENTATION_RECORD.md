# Spotlight Card adaptation record

Problem 20 directly adapts the supplied Spotlight Card into the same existing
weather surface used by Tilt Card. The React wrapper is replaced by native DOM,
while the supplied component's visible mechanics remain:

- viewport pointer values and normalized `xp/yp` hue progression;
- `base=220`, `spread=200`, `size=200`, `border=3`, `outer=1`;
- fixed-background radial gradients;
- masked color and white border layers, `brightness(2)`, and the blurred outer
  layer;
- pointer response outside the panel rather than a hover-only approximation.

LumiField routes the existing shared document pointer frame into this adapter;
it does not add another listener or RAF. Real child layers avoid collisions with
the weather panel's existing Liquid Glass pseudo-elements. Every added layer is
`aria-hidden` and `pointer-events:none`.

The auto-rotating song/hot-comment child receives no effect marker, glow layer,
listener, or transform. It remains ordinary clickable content inside the one
parent surface.

The older five-tile `接着听` spotlight remains a separately documented LF-native
implementation and is not changed by Problem 20.

Product files:

- `public/lf-weather-tilt-spotlight.js`
- `public/lf-weather-tilt-spotlight.css`
- `public/index.html` (one stylesheet and one script load)
