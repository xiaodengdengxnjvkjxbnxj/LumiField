# LumiField website third-party notices

This notice applies to the interactive visual lab in `visual-effects.js`. It does not change the GPL-3.0-only license of the separately distributed LumiField desktop application.

## React Bits visual effects

- Project: React Bits
- Author: David Haz
- Repository: <https://github.com/DavidHDev/react-bits>
- Pinned source commit: `4e0e030193b563be6be33d928f77d0d01cefe237`
- Commit date: 2026-08-15
- License at the pinned commit: **MIT + Commons Clause License Condition v1.0**
- Integration form: part of the LumiField website; these components are not offered or distributed as a standalone component library

| LumiField label | Official component | Official page | Pinned source | SHA-256 of upstream JSX |
| --- | --- | --- | --- | --- |
| 星云 | Galaxy | <https://reactbits.dev/backgrounds/galaxy> | [Galaxy.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/Galaxy/Galaxy.jsx) | `1BAF1C8BA7D79BCE6005977CACD04C7D7E66134FAAE9D5F40CD4B3E67262FBFA` |
| 极光 | Aurora | <https://reactbits.dev/backgrounds/aurora> | [Aurora.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/Aurora/Aurora.jsx) | `C1CA757270D3EFD24C077FB9795B51B7BA53073621DF631014AD0C13933D13E7` |
| 余烬 | Particles | <https://reactbits.dev/backgrounds/particles> | [Particles.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/Particles/Particles.jsx) | `76CD0D675AE34B057B7C6D9F82429427CE8AB4F9A1A80DC3F392B174C9254114` |
| 冰 | Iridescence | <https://reactbits.dev/backgrounds/iridescence> | [Iridescence.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/Iridescence/Iridescence.jsx) | `786BE4094CF7121024C51FB74B300ED218A01FADC2BC49C9FF68D98208653A36` |
| 色彩弯曲 | ColorBends | <https://reactbits.dev/backgrounds/color-bends> | [ColorBends.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/ColorBends/ColorBends.jsx) | `C8C8E1FDC396E1BC3DCD515DBCC61AFDF665ABCC82F499C0498E23A8D3E10624` |
| 点场 | DotField | <https://reactbits.dev/backgrounds/dot-field> | [DotField.jsx](https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/src/content/Backgrounds/DotField/DotField.jsx) | `62931AC9D74B79173B7865C0D13D003110BFF805A96788F1FCB8837AB4849740` |

### Integration modifications

- Preserved the official shader equations, star-layer logic, particle motion, iridescence phase loop, color-band warp, and dot-field displacement model.
- Replaced React, OGL, and Three.js lifecycle/rendering wrappers with local, dependency-free WebGL 1 and Canvas 2D hosts.
- Added deterministic particle seeding, one-effect-at-a-time disposal, visibility pausing, a bounded pixel ratio, a reduced-motion frame, keyboard tabs, and local error/status reporting.
- Configured LumiField color presets. The “余烬” and “冰” names describe local color configurations of the official `Particles` and `Iridescence` components; they are not claimed as separate upstream components.
- No React Bits package, remote iframe, CDN script, font, image, or network runtime dependency is used.

### License text supplied by the upstream project

> MIT + Commons Clause License Condition v1.0
>
> Copyright (c) 2026 David Haz
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, and distribute the Software as part of an application, website, or product, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> Commons Clause Restriction: You may use this Software, including for any commercial purpose, so long as you do not sell, sublicense, or redistribute the components themselves, whether alone, in a bundle, or as a ported version.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Upstream license file at the pinned commit: <https://github.com/DavidHDev/react-bits/blob/4e0e030193b563be6be33d928f77d0d01cefe237/LICENSE.md>
