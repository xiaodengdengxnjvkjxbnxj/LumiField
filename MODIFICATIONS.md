# LumiField modification record

LumiField is a modified GPL-3.0-only distribution of Mineradio. Major LumiField changes include:

- Electron desktop lifecycle, installer safety, packaged integrity signing and reproducible source fingerprints;
- a redesigned Home experience, weather radio, account scope isolation and five-platform status integration;
- one shared Three.js visual stage with particle presets, secondary-screen spectrum, 3D playlist shelf and lyrics;
- LF-native Audio Echo V2 Shape 1/Shape 2 adapters using the existing renderer, analyser and frame lifecycle;
- an interactive splash, animated search/weather/profile controls and performance/reduced-motion policies;
- local translation, voice-assistant, source-separation and media-processing integration;
- replacement of the GSAP runtime with the independently authored `public/lf-motion.js` compatibility layer.

Component-level modifications, fixed source identities and exclusions are recorded under `docs/licenses/`. In particular:

- Audio Echo V2: `docs/licenses/audio-echo-v2/MODIFICATIONS.md`
- Shader SVG, neural vortex, ATC, kinetic grid and vapour text: corresponding `docs/licenses/21st/*/IMPLEMENTATION_RECORD.md`
- eIsland behavior review / independent Windows implementation: `docs/licenses/eisland/IMPLEMENTATION_RECORD.md`
- original signature and golden star-trail preset: `docs/licenses/lumifield-original-assets/PROVENANCE.md`

No external reference video, Marketplace demo page or preview media is included in the release tree.
