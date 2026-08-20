# Tilt Card adaptation record

Problem 20 directly adapts the supplied Tilt Card source to the one existing
`.lf-weather-shell`. The React state/wrapper is replaced by LumiField's native
lifecycle, but source behavior remains unchanged:

- `tiltLimit=15`, `scale=1.05`, `perspective=1200`, `effect="evade"`;
- the source rectangle-normalized two-axis pointer equations;
- one `perspective + rotateX + rotateY + scale3d` transform surface;
- a 200% internal white radial spotlight and 0.3-second opacity transition;
- a 0.2-second `ease-out` return to neutral on pointer leave.

LumiField reuses its existing shared pointer frame rather than adding another
document listener or RAF. The weather text, inputs, buttons and the existing
auto-rotating song/hot-comment region stay inside that one transformed surface.
No child region receives another Tilt transform.

The older six-card Home tilt remains a separately documented LF-native
implementation; Problem 20 does not change its target or lifecycle.

Product files:

- `public/lf-weather-tilt-spotlight.js`
- `public/lf-weather-tilt-spotlight.css`
- `public/index.html` (one stylesheet and one script load)
