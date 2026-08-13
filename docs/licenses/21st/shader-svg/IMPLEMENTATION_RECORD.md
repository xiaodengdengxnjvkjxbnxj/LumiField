# LumiField direct source adaptation record

New feature 10 directly adapts the user-supplied complete component source for
private development and testing. The adaptation retains:

- the exact `231 × 289` SVG and source clip path;
- the exact five-color `MeshGradient` order and speed `1`;
- two white `20 × 30` ellipse eyes at `(80,120)` and `(150,120)`, with no pupils;
- source pointer math `(pointer - center) × 0.08`, independently clamped to
  `±8`, and Framer Motion spring `stiffness=150`, `damping=15`;
- source float `y=[0,-8,0]`, `scaleY=[1,1.08,1]`, `2.8s`, infinite ease-in-out;
- source blink `3s` infinite ease-in-out with `ry=3` at 95%.

LumiField-only integration changes are limited to a unique clip id, an SVG ref
instead of the global `document.querySelector`, measured Home safe-area sizing,
private local bundling, reduced/background pause, and complete Home/modal/stage
mount/unmount lifecycle. The component remains `pointer-events:none`.

Product/source files:

- `public/lf-home-pet-source.jsx`
- `public/lf-home-pet-source.bundle.js`
- `public/lf-home-pet-source.bundle.js.LEGAL.txt`
- `public/lf-home-pet.js`
- `public/lf-home-pet.css`
- `public/index.html`
- `package.json` / `package-lock.json`
- `resources/licenses/Paper-Shaders-Apache-2.0.txt`
- `resources/licenses/React-Framer-Motion-MIT.txt`

The reference TXT/video are not copied into the runtime or installer. No
analytics, remote runtime dependency, preview media, font, or logo is imported.
