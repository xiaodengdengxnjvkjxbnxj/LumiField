# Release gate

| Item | Status | Release obligation |
|---|---|---|
| Jhey Tompkins CodePen core pointer/glow technique | `MIT_PASS_WITH_NOTICE` | Preserve `resources/licenses/Jhey-CodePen-MIT.txt`, author name and Pen URL. |
| EaseMize/Hossain Jahed React wrapper, API and demo | `REFERENCE_ONLY_NOT_PACKAGED` | Keep wrapper-specific expression and Marketplace media out of release artifacts; re-audit before any future inclusion. |
| LumiField shared-pointer/weather lifecycle integration | `LUMIFIELD_ORIGINAL_PASS` | Preserve the documented single-surface and resource boundary. |
| User TXT/video | `REFERENCE_ONLY_NOT_PACKAGED` | Keep evidence files out of runtime and release artifacts. |

Result: `PASS_NO_COMPONENT_LICENSE_BLOCK`. The distributed implementation is
the MIT-covered Jhey core plus LF-authored integration; the unlicensed wrapper
layer is absent from the product and creates no v1.1.44 release blocker.
