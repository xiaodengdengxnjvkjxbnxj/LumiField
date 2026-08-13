# Release gate

| Item | Status | Release condition |
|---|---|---|
| Exact signature runtime asset | `LUMIFIELD_ORIGINAL_PASS` | Preserve the user's 2026-08-13 AE authorship statement and the matching source/package SHA-256. |
| Superseded pixel and active button reference videos | `REFERENCE_ONLY_NOT_PACKAGED` | Keep them outside runtime and release packages; no pixel implementation remains. |
| LumiField window/control/cleanup integration | `LUMIFIELD_ORIGINAL_CODE` | May be released under the repository license, subject to the two component-code gates recorded separately. |
