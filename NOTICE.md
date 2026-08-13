# NOTICE

LumiField 是基于 Mineradio 修改的发行版本，并使用了以下第三方项目或服务。各项目版权归其原作者所有。

原 Mineradio 项目的版权声明、署名与 GPL-3.0 许可条款均予保留。

## Third-party Libraries

- Electron
- Three.js r128 (MIT), bundled as `public/vendor/three.r128.min.js` and used by
  the shared LumiField scene, including the independently implemented golden
  atomic star-trail renderer. Fixed file SHA-256:
  `9274BBCEC8D96168626C732B5D31C775AA8CFB7EAA0599BEC0C175908A2C1CE2`.
  The retained license text is `public/vendor/three.LICENSE.txt`.
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder
- `@browsermt/bergamot-translator` 0.4.9 (MPL-2.0), plus pinned Mozilla
  Firefox Translations `en-zh` and `ja-en` model data (MPL-2.0). Exact source,
  snapshot, hashes and license are included under
  `desktop/assets/translation/`.
- `@soundtouchjs/audio-worklet`, `@soundtouchjs/core`,
  `@soundtouchjs/interpolation-strategy-lanczos` and
  `@soundtouchjs/worklet-base` 2.1.0 (MPL-2.0), by Steve 'Cutter' Blades and
  the SoundTouch/SoundTouchJS contributors. LumiField loads the unmodified
  published processor through a local versioned route. Upstream source:
  `https://github.com/cutterbl/SoundTouchJS/tree/v2.1.0`; the complete MPL-2.0
  text is included at `desktop/assets/translation/MPL-2.0.txt`.
- `sherpa-onnx-win-x64` 1.13.4 (Apache-2.0) and its bundled ONNX Runtime
  1.27.0 (MIT), used only for local offline source separation.
- `koffi` 3.1.2 (MIT), used to call the sherpa-onnx C API in an isolated
  helper process.
- `ffmpeg-static` 5.3.0 (GPL-3.0-or-later), used unchanged for cancellable
  local wallpaper-video probing and high-quality cache transcoding. Upstream:
  `https://github.com/eugeneware/ffmpeg-static`; its license is retained in
  `node_modules/ffmpeg-static/LICENSE`. The Windows package currently resolves
  FFmpeg 6.1.1 essentials build; executable SHA-256:
  `04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`.
- `sherpa-onnx-spleeter-2stems-fp16` converted model (MIT), from
  `csukuangfj/sherpa-onnx-spleeter-2stems-fp16` commit
  `93ba771920ade509f8cbd6825b1a90856c797e08`. Exact source, SHA-256 hashes,
  provenance, and license texts are included under `resources/spleeter/`.

## Referenced Implementations

- User-supplied `回到Home.mp4`, SHA-256
  `0199EA08879E07FE8E5314E3FC362290AF9F6F59D8A38496F44208609147856B`,
  was used only as an observable-behavior reference for the independent Home
  button edge-light implementation. The video is not packaged and is
  `REFERENCE_ONLY_NOT_PACKAGED`, so it is not a distribution dependency;
  provenance and the isolated evidence record are retained under
  `docs/licenses/reference-materials/home-button-glow/`.

- `21st.dev/@xordev/components/atc-shader` and
  `21st.dev/@satoriui/components/kinetic-grid` were integrated into the
  independent Electron splash from user-supplied complete source. Underlying
  Marketplace component code is MIT under official 21st Community license
  documentation; Kinetic Grid also reports MIT at item level. Status:
  `MIT_OR_PERMISSIVE_PASS`. Authors, original component links, exact hashes and
  modifications are retained under `docs/licenses/21st/`; Marketplace demos,
  preview media and metadata are not packaged.

- LumiField-original final brand animation `签名.完整版.mp4`, SHA-256
  `9749824C7620C471666CBE97FC46C6394CF05CAFE5B7EA492B5DFC9E17246148`,
  is packaged byte-for-byte as the splash signature and is only screen-blended
  to remove its black rectangle. The project owner confirmed on 2026-08-13 that
  they personally created it with Adobe After Effects. It is
  `LUMIFIELD_ORIGINAL_PASS`; provenance is retained under
  `docs/licenses/splash-brand/` and
  `docs/licenses/lumifield-original-assets/`.

- `21st.dev/@reuno-ui/components/shader-svg`, live component id `4265`, revision
  92, is directly adapted from the user-supplied complete source. Underlying
  Marketplace component code is MIT under official 21st Community license
  documentation. Status: `MIT_OR_PERMISSIVE_PASS`. The
  bundled renderer uses `@paper-design/shaders-react` / Paper Shaders `0.0.80`
  (Apache-2.0; Copyright 2026 Paper), React / React DOM `19.2.8` (MIT), and
  Framer Motion `13.1.0` (MIT). License texts are retained under
  `resources/licenses/`; exact material hashes and release conditions are under
  `docs/licenses/21st/shader-svg/`. Reference TXT/video are not packaged.

- `21st.dev/@tom_ui/components/tilt-card/gravitate` was reviewed from the
  user-supplied location image, source/reference text, and updated behavior
  video. No fixed compatible component redistribution license was disclosed,
  so LumiField packages none of that React expression, dependency, or preview
  media. The six-card Home interaction is independently authored with native
  CSS transforms and LumiField's existing shared pointer scheduler; exact
  material hashes and the separate upstream-copy gate are retained under
  `docs/licenses/21st/tilt-card/`.

- `21st.dev/@easemize/components/spotlight-card` was reviewed from the
  user-supplied location image, source/reference text, and behavior video. No
  fixed compatible component redistribution license was disclosed, so
  LumiField packages none of that React/Tailwind expression, dependency, or
  preview media. The five-tile `接着听` spotlight is independently authored
  with native DOM/CSS and LumiField's existing shared pointer scheduler; exact
  material hashes and the separate upstream-copy gate are retained under
  `docs/licenses/21st/spotlight-card/`.

- `21st.dev/@minhxthanh/components/interactive-neural-vortex-background` is
  directly adapted from the user-supplied complete source. LumiField retains
  the source WebGL shader and behavior,
  replaces only the React/demo wrapper with the existing profile lifecycle,
  and excludes the VR demo, source TXT, preview video, fonts, network requests
  and analytics. Underlying Marketplace component code is MIT under official
  21st Community license documentation, so this component is
  `MIT_OR_PERMISSIVE_PASS`; exact material hashes and obligations are under
  `docs/licenses/21st/interactive-neural-vortex-background/`.

- `21st.dev/@minhxthanh/components/gradient-menu` was reviewed from the
  user-supplied source/reference text and 12.80-second behavior video. No fixed
  compatible component redistribution license was disclosed, so LumiField
  packages none of that React/Tailwind expression, icon dependency or preview
  media. The eight-field account-profile menu is independently authored with
  native DOM/CSS; exact material hashes and the separate upstream-copy gate
  are retained under `docs/licenses/21st/gradient-menu/`.

- `21st.dev/@jatin-yadav05/animated-radio` was reviewed from the user-supplied
  source/reference text and 682-frame behavior video. Neither the supplied
  component expression nor the live page disclosed a fixed compatible
  redistribution license, so LumiField packages none of that React expression
  or its assets. The Three.js playlist highlight and interaction state machine
  are independently authored; exact material hashes and the separate
  upstream-copy gate are retained under
  `docs/licenses/21st/animated-radio/`.

- `21st.dev/@jatin-yadav05/components/vapour-text-effect` (catalog item `2189`,
  component id `2060`) was adapted from the complete user-supplied component
  source for the secondary-screen outgoing-lyric vaporization effect. The
  adaptation retains the source pixel sampling and particle physics while
  replacing its standalone React/canvas/RAF lifecycle with LumiField's single
  Three.js lyric resource and shared render frame. Underlying Marketplace
  component code is MIT under official 21st Community license documentation,
  so the component is `MIT_OR_PERMISSIVE_PASS`. Fixed source/video hashes,
  modifications and obligations are recorded under
  `docs/licenses/21st/vapour-text-effect/`.

- 21st.dev catalog ID `5408`, `ravikatiyar162/glass-radio-group`, was reviewed
  from the user-supplied behavior video and source/reference text. The supplied
  implementation and live component page disclose no fixed upstream version,
  commit or component redistribution license, so LumiField packages none of
  that React/styled-components source or its assets. The six-slot account
  indicator is independently authored; exact material hashes and the separate
  upstream-copy gate are retained under
  `docs/licenses/21st/glass-radio-group/`.

- `21st.dev/@minhxthanh/animated-glowing-search-bar` was reviewed from the
  user-supplied behavior video and CLI/demo text. The supplied text contains no
  component implementation or license declaration, and the live route exposed
  no fixed source version or redistribution grant on 2026-08-11. LumiField
  packages none of its code or assets. The shared main/secondary search effect
  is independently authored; exact material hashes and the separate
  upstream-copy gate are retained under
  `docs/licenses/21st/animated-glowing-search-bar/`.

- `21st.dev/@dev.yadhakim/animated-weather-icons` (registry id `10051`,
  component id `6844`) was reviewed for observable weather-part motion. Its
  page exposed no component license or redistribution grant, so LumiField
  packages none of that implementation, preview media, React code or assets.
  The WMO-driven inline SVG/CSS replacement is independently authored; source
  identity, material hashes and the upstream-copy release gate are retained in
  `docs/licenses/21st/animated-weather-icons/`.

- `21st.dev/@dadopelanosvela/grid-glow-effect-purple-blue` was reviewed from
  user-supplied demo/video evidence for observable pointer-local purple/blue
  card-edge lighting. The live page returned `Component Not Found` on
  2026-08-09, the supplied text contains no imported component implementation
  or license declaration, and LumiField packages none of its code or assets.
  The Home-card effect is independently authored; exact material hashes and the
  separate upstream-copy gate are retained under
  `docs/licenses/21st/grid-glow-effect-purple-blue/`.

- `Python-island/Python-island`, fixed `MacIsland` commit
  `af99413667a8192daa895bd206e9e862cb05dc3d`, was reviewed only for observable
  voice-assistant behavior. That branch contains no software-license grant, so
  LumiField copies or packages none of its source, assets, models or binaries.
  The Windows/Electron voice assistant is independently authored, restricted
  to LF search and LF's existing playback transport, and is
  `LUMIFIELD_ORIGINAL_PASS`. Exact source hashes, implementation boundary and
  the conditional future upstream-copy/model gates are retained under
  `docs/licenses/eisland/`.

- LumiField-original configuration input `LF金色量子自由星轨粒子.json`, fixed for
  this task at SHA-256
  `D9E02280314EB58109741A7A9FFBF397AD6F24F239CE3B75C25A572D75AAB79E`.
  LumiField consumes its declared fields through an independently implemented
  renderer and interaction controller; no third-party renderer source was
  copied from the configuration. The project owner confirmed on 2026-08-13
  that they created the preset through ChatGPT specifically for LumiField and
  that it is not a third-party component, Marketplace resource or external
  project asset. OpenAI output is not treated as a separately licensed LF
  component dependency. The preset is `LUMIFIELD_ORIGINAL_PASS`.
  The normalized runtime derivative is
  `public/lf-golden-atomic-star-trail-preset.json`, SHA-256
  `82C9BBC2100D9543261EDCBC9692C51321ACEE6116DAF13B4F25982859F6DC37`;
  it is derived only from that owner-originated configuration. Exact provenance
  is retained under `docs/licenses/lumifield-original-assets/`.

- `daaimengermengzhu/Mineradio-Extended` commits `2ef52687eb04c4bff03e0632630e237998f977d0`、`ea1fdae906cd3c28ecda9fe45f2635299e237f10`（GPL-3.0）：参考酷狗标准版协议及汽水音乐官方客户端本机会话互操作思路；实现已按 LumiField 架构独立重写。
- `moli-xia/mineradio-kugou` commit `84d6d580dc5b3ccacc1986c8da64925d7a137676`（GPL-3.0）：候选4参考实现，移植并重写标准版资料、会员三态、云歌单及歌曲同步逻辑。
- `MakcRe/KuGouMusicApi` commit `283f1e97b110726b208a64b486a657c0fc0a6126`（MIT）：候选4协议模块上游。
- `sanctuary-x/Mineradio` commit `3a825c4eaea28484cfe377c456ff2223b65ed2c5`（GPL-3.0）：仅参考酷狗概念版二维码、独立会话及云歌单协议数据流，并按 LumiField 安全边界重写。
- `zws84952324-create/Mineradio-Kugou-Modified` commit `c3fa7848214ebcfde8546de7433c0ceefd842be2`（GPL-3.0）：交叉核对酷狗概念版协议参数、歌单分页与合法播放链路；未采用其明文凭据、全网监听或会员推测逻辑。
- 汽水音乐 3.5.1 官方 Windows 客户端：仅用于互操作协议审计及读取用户本人已建立的本机会话；LumiField 未复制、打包或分发其专有源码、资源及原生模块。

Copyright (c) 2023 MakcRe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Audio Echo V2 source adaptations

- Shape 1 credits Ajin and
  `yin-yizhen/sonic-topography@f14589172431fa1da66fc78dd1f6cc403ead545b`.
  GitHub Issue #25 confirms the broad LumiField authorization. On 2026-08-13
  the project owner additionally confirmed that the original author supplied
  GPLv3 downstream confirmation through retained WeChat correspondence. Status:
  `LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED`.
- Shape 2 credits CmzYa and
  `CmzYa/sonic-topography@cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc`.
  Its original contributions are `GPL_NATIVE_PASS`; Shape-1-derived portions
  are covered by the authorization and downstream confirmation above.
- Shape 3 provenance was reviewed at
  `XxHuberrr/Mineradio@411bce4e4a8e5add3d1f76ac4a9c19306f6a10df`,
  but Shape 3 is not imported, exposed, executed, or packaged. Status:
  `NOT_IN_RELEASE_TREE`; any future import requires a new audit.
- The V2 adapters exclude upstream demo/audio, lyrics, album media, font,
  logo, telemetry, analytics, preview shells, and source-owned player/runtime
  allocations. Exact commits, hashes, modifications, notices, golden capture
  contracts, and release gates are retained under
  `docs/licenses/audio-echo-v2/` and `docs/evidence/audio-echo/`.

## Third-party Services

LumiField 当前与网易云音乐、QQ 音乐、酷狗音乐、酷狗概念版及汽水音乐进行用户自有账号相关的本地客户端交互。

LumiField 不是任何音乐平台的官方客户端，也不隶属于上述音乐平台或其关联公司。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。

## Original Design

- User-supplied `鸿蒙.mp4`, fixed at SHA-256
  `47074935E9D21BE26F38579C324BB1A08932F65DBB9E61E802AFC9358EBB9E87`,
  was reviewed only for observable control-trajectory particles and a
  right-edge-to-left, wind-dispersed card deletion. LumiField packages none of
  the video or OpenHarmony assets/code. The shared range-control and confirmed
  secondary-interface 3D playlist deletion effects are independently authored;
  Home cards and ordinary 2D playlists are excluded. The exact evidence,
  implementation boundary, and asset-only release gate are retained under
  `docs/licenses/reference-materials/harmony-particle-range/`.

Mineradio 名称、MR Logo、界面视觉设计、启动动画方向、粒子视觉体验和电影镜头系统的产品表达属于作者原创设计。

emily 作为 Mineradio 早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。
