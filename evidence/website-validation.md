# LumiField website validation — 2026-08-22

## Scope and source lock

- Website branch: `gh-pages`
- Published release facts: `v1.1.44`, commit `72143cbc4f4b`, installer SHA-256 `8D68E554742F21A01B130CA76480E1F12070D45C1EEC71F794D9AFAFA00B63CA`
- React Bits repository: <https://github.com/DavidHDev/react-bits>
- Pinned upstream commit: `4e0e030193b563be6be33d928f77d0d01cefe237`
- Integrated source mapping: Galaxy → 星云, Aurora → 极光, Particles → 余烬 preset, Iridescence → 冰 preset, ColorBends → 色彩弯曲, DotField → 点场
- License/provenance: [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)

## Static gates

| Gate | Result |
| --- | --- |
| `node scripts/validate-site.mjs` | PASS — 8 sections, 6 lazy effects, all local assets, published release facts, provenance |
| `node --check app.js` | PASS |
| `node --check visual-effects.js` | PASS |
| `git diff --check` | PASS |
| `21st review index.html styles.css app.js visual-effects.js` | 0 errors/fixes; info-only legacy hardcoded-color findings |
| Runtime network model | No iframe, CDN, telemetry, cookie, remote script, or remote stylesheet |

## Browser automation

Browser: Codex in-app Chromium browser against a local Python static server.

### Cold first screen

Independent origin `http://127.0.0.1:4180/?cold=accepted`, normal cache state:

| Measurement | Result |
| --- | ---: |
| Navigation response start | 137.0 ms |
| DOM interactive | 197.3 ms |
| Site ready marker | 896.1 ms |
| Load event end | 915.4 ms |
| Browser navigation wall time | 1,073 ms |
| First-screen hero request | one `immersive-stage-1440.webp`, 49,540 encoded bytes |
| Visual effect module before scrolling | not requested |
| Effect canvases before scrolling | 0 |
| Console warning/error | 0 |

The local server did not compress responses, so the timing is a conservative check relative to GitHub Pages transfer compression.

### Effect switching and lifecycle

| Check | Result |
| --- | --- |
| Galaxy / 星云 | PASS — WebGL, one canvas |
| Aurora / 极光 | PASS — WebGL, one canvas |
| Particles / 余烬 | PASS — WebGL, one canvas |
| Iridescence / 冰 | PASS — WebGL, one canvas |
| ColorBends / 色彩弯曲 | PASS — WebGL, official no-color default branch restored; no additive overexposure |
| DotField / 点场 | PASS — Canvas 2D, one canvas |
| 50 complete six-effect cycles | PASS — 300 real activations in 113,512 ms |
| State after stress run | one live effect, one canvas, one RAF loop, no effect errors |
| WebGL disposal | PASS — ending on DotField reported 0 live WebGL contexts |
| Pointer response | PASS — two synthetic pointer moves reached the active Galaxy instance; normalized final point `(0.7598, 0.6999)` |
| Keyboard switching | PASS — ArrowRight moved Galaxy to Aurora |
| Offscreen pause | PASS — active RAF loops changed from 1 to 0 after leaving the visual section |
| Reduced motion | PASS — fixed rendered frame, 0 RAF loops, global signal field hidden |
| Console warning/error after all checks | 0 |

### Layout and controls

- Desktop 1600×1200: brand, centered navigation, and download actions occupy separate grid columns; no horizontal overflow.
- Mobile 390×844: full-width navigation opens/closes, effect layout stacks, and no horizontal overflow.
- Both sponsor QR images are visible directly in the support section; natural sizes are 900×1350 and 384×384.
- Experience tabs, screenshot carousel, SHA-256 copy, FAQ disclosure, sponsor dialog open/close, navigation anchors, and all six effect controls passed real clicks.
- Release, source, and download controls retain verified `href` targets; external navigation/download was not triggered during the local UI test.

## Visual evidence

- [Desktop visual lab](screenshots/visual-lab-desktop.png)
- [Mobile visual lab](screenshots/visual-lab-mobile.png)
- [Mobile visible sponsor area](screenshots/support-mobile.png)

## Performance design

- `visual-effects.js` is a dynamic import initialized only near the visual-lab viewport.
- Exactly one effect instance is mounted; every switch cancels RAF, removes listeners/observers, deletes GL objects, and loses the previous context.
- The effect backing store is capped by viewport pixel budget and device-pixel ratio.
- Hidden tabs and offscreen visual sections stop rendering; mobile rendering is capped below desktop FPS.
- 960px and 1440px local WebP variants back responsive non-first-screen screenshots; the first-screen image is a single optimized 1440px WebP with high fetch priority.
