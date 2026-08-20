# Third-party notices and GPLv3 compatibility

This file is the public release summary. The canonical detailed notice is [NOTICE.md](./NOTICE.md); exact component records are under [docs/licenses](./docs/licenses).

| Module | LumiField files | Fixed source | License / authorization | GPLv3 status |
| --- | --- | --- | --- | --- |
| Mineradio base | Electron/backend/renderer base | `XxHuberrr/Mineradio` history | GPL-3.0 | `GPL_NATIVE_PASS` |
| Audio Echo Shape 1 | `public/lf-audio-echo-shape1.js` LF-native adapter | `hgbhh258-spec/Sonic-Topography-Wallpaper@51afbac3d5978c112311fca38f7334578ca2b0e6` | MIT; Copyright 2026 eeegg | `MIT_PERMISSIVE_PASS` |
| Audio Echo Shape 2 | `public/lf-audio-echo-shape2.js` | `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc` | GPL-3.0 for CmzYa additions; inherited historical `yin-yizhen` lineage covered by Issue #25 and the retained GPLv3 downstream confirmation | `GPL_NATIVE_PASS` + confirmed authorization |
| Shader SVG | `public/lf-home-pet-source.jsx` and bundle | `reuno-ui/shader-svg`, component 4265, revision 92 | 21st Marketplace MIT; Paper Shaders Apache-2.0; React/Framer Motion MIT | `MIT_OR_PERMISSIVE_PASS` |
| Neural vortex | `public/lf-profile-vortex.js` | `minhxthanh/interactive-neural-vortex-background` | 21st Marketplace MIT | `MIT_OR_PERMISSIVE_PASS` |
| Splash ATC | `public/lf-splash.js` | `xordev/atc-shader` | 21st Marketplace MIT | `MIT_OR_PERMISSIVE_PASS` |
| Splash kinetic grid | `public/lf-splash.js` | `satoriui/kinetic-grid` | MIT (item and Marketplace) | `MIT_OR_PERMISSIVE_PASS` |
| Lyric vapour | stage-lyric integration in `public/index.html` | `jatin-yadav05/vapour-text-effect`, catalog 2189 | 21st Marketplace MIT | `MIT_OR_PERMISSIVE_PASS` |
| Voice assistant | `public/lf-voice-assistant.*`, `desktop/lf-voice-assistant-main.js` | eIsland behavior review only | No eIsland code/assets packaged; LF independent implementation | `LUMIFIELD_ORIGINAL_PASS` |
| Golden star trail (removed from product in v1.1.44) | Historical provenance record only; no v1.1.44 runtime file or renderer entry | Project-owner ChatGPT-generated LF preset | Owner-originated configuration, no third-party payload; evidence retained without packaging the removed preset | `LUMIFIELD_ORIGINAL_PASS` |
| Signature animation | `public/assets/splash/lf-signature.mp4` | Project-owner Adobe After Effects render | Owner attestation; exact source/package hash recorded | `LUMIFIELD_ORIGINAL_PASS` |
| Three.js r128 | `public/vendor/three.r128.min.js` | Three.js r128 | MIT | `MIT_OR_PERMISSIVE_PASS` |
| FFmpeg | `ffmpeg-static@5.3.0` | npm locked dependency | GPL-3.0-or-later | `GPL_NATIVE_PASS` |
| Translation runtime/models | `@browsermt/bergamot-translator@0.4.9`, fixed local models | npm and Mozilla model snapshots | MPL-2.0 | GPLv3-compatible Larger Work with source/notice obligations |
| Spleeter / sherpa-onnx | `resources/spleeter`, locked runtime dependencies | fixed model/runtime manifests | MIT / Apache-2.0 | `MIT_OR_PERMISSIVE_PASS` |

The five directly adapted 21st component implementations retain author names, original page links, exact supplied/live source identities and the Marketplace MIT evidence at `docs/licenses/21st/MARKETPLACE_MIT_EVIDENCE.md`. Marketplace demos, previews, videos, screenshots and metadata are excluded.

The full production lock graph and every detected license declaration are generated into `docs/licenses/dependencies/`. The official release requires unknown licenses = 0 and release blockers = 0.
