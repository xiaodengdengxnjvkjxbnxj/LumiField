# Tilt Card — source and rights record

Recorded: 2026-08-20

| Evidence | Fixed identity | Rights status | Use in LumiField |
|---|---|---|---|
| User-supplied complete source | `倾斜卡.完整源码以及原组件页面链接.txt`, 4,479 bytes, SHA-256 `B25404B04AFD4348C464D24A2F68C8CA1BF88E2BD94150BEDFCEE61AE00616BB` | The supplied component matches the current public 21st catalog source. | Problem 20 directly adapts its pointer math, transform, reset timing and internal spotlight into the existing weather panel. |
| User-supplied reference video | `倾斜卡效果视频.mp4`, 168,112,883 bytes, 2,288×1,440, 1,242 decoded frames, 21.350016 seconds, SHA-256 `8DA14FC616FE83F9E45F362EA14007924961EB00DFD797886B2053B225E9827D` | Reference-only; not packaged. | Confirms that the supplied Demo uses the component default `effect="evade"`. |
| 21st catalog identity | Catalog id `12244`, component id `7933`, author `tom_ui`; <https://21st.dev/@tom_ui/components/tilt-card/gravitate> | Public component identity and required back-link. | Provenance only; Marketplace preview media and metadata are excluded. |
| Upstream component | Spell UI Tilt Card: <https://spell.sh/docs/tilt-card>; source repository <https://github.com/xxtomm/spell-ui> | MIT, Copyright (c) 2025 Spell UI. | Direct component-code grant; retained in `resources/licenses/Spell-UI-MIT.txt`. |

The page path says `gravitate`, but the complete source's Default Demo omits
that prop, the component default is `effect="evade"`, and the supplied video
shows the default behavior. Problem 20 therefore retains `evade` rather than
silently reversing the source/video motion.

The adapted Tilt component code is `MIT_PASS_WITH_NOTICE`. The supplied TXT,
reference video, Marketplace demo/preview media and metadata are not packaged.
