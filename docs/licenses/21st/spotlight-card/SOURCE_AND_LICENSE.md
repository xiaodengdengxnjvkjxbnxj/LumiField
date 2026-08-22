# Spotlight Card — source and rights record

Recorded: 2026-08-20
Distribution-boundary re-audit: 2026-08-22

| Evidence | Fixed identity | Rights status | Use in LumiField |
|---|---|---|---|
| User-supplied complete source | `卡片聚光灯.原组件页面链接以及完整源码.txt`, 6,304 bytes, SHA-256 `6389B777EB96E0EB2BE49632B452BAFD5BA53FCD5B6B0CBAC8CFE89836F38E6E` | Reference and source-comparison evidence only; the TXT is not packaged. | Defines the requested appearance and identifies the 21st page. |
| User-supplied reference video | `卡片聚光灯效果视频.mp4`, 91,634,390 bytes, 2,288×1,440, 687 decoded frames, 12.266646 seconds, SHA-256 `8C687FA283FDE45E469E0C575371818A454E2D750EC81AF23CC0ED7AB949BACE` | `REFERENCE_ONLY_NOT_PACKAGED`. | Confirms global pointer response, edge glow and cross-card color progression. |
| 21st catalog identity | Catalog id `2487`, component id `2358`, author `easemize` / Hossain Jahed; <https://21st.dev/@easemize/components/spotlight-card> | Provenance/back-link for the supplied reference; no EaseMize wrapper code or Marketplace media is distributed. | Reference identity only. |
| Traceable core effect | Jhey Tompkins, “React Glow Cards – Minimal”, <https://codepen.io/jh3y/pen/WNmQXyE>; CodePen licensing: <https://blog.codepen.io/docs/pens/licensing/> | The public Pen code is MIT. The retained notice is `resources/licenses/Jhey-CodePen-MIT.txt`. | Supplies the fixed-background pointer variables, hue progression, masked border gradients, brightness layer and blurred outer glow used by the weather effect. Status: `MIT_PASS_WITH_NOTICE`. |
| LumiField adapter | `public/lf-weather-tilt-spotlight.js` and `public/lf-weather-tilt-spotlight.css` | LF-authored lifecycle, shared-pointer scheduling, weather-panel targeting and DOM-layer integration. | `LUMIFIELD_ORIGINAL_PASS`; distributed under LumiField GPL-3.0-only. |

## Distribution-boundary result

The packaged product does not contain the EaseMize React wrapper or its API and
demo expression. The release inclusion paths were checked for wrapper-specific
identifiers, including `GlowCardProps`, `glowColorMap`, `sizeMap`, `customSize`,
`getSizeClasses`, and `getInlineStyles`; none occur in the runtime product.
React component packaging, Tailwind sizing/demo classes, Marketplace metadata,
preview media, and the supplied TXT/video are also excluded.

The effect actually distributed by LumiField is the MIT-covered Jhey Tompkins
core technique plus LF-authored integration. The Jhey Pen contains the same
`base=220`, `spread=200`, `size=200`, `border=3`, fixed-background masked
gradients, brightness layer, white inner light, and blurred outer glow used by
the LF adapter. Therefore an unlicensed EaseMize wrapper is not part of the
release and does not attach a component-license blocker to v1.1.44.

Current gate: `MIT_PASS_WITH_NOTICE` for the Jhey core and
`LUMIFIELD_ORIGINAL_PASS` for the LF adapter. Any future introduction of the
EaseMize wrapper-specific API or expression requires a new license review
before distribution.
