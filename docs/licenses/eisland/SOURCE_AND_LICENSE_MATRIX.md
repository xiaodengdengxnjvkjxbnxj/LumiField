# eIsland voice-assistant source and license matrix

Audit date: 2026-08-09 (Asia/Shanghai).

This record separates source discovery, the right to copy source, private
development, and public GPLv3 distribution. An unknown or missing grant is not
reported as a prohibition on independent development.

| Item | Fixed source | License/right evidence | LumiField use | Public-distribution status |
| --- | --- | --- | --- | --- |
| Python-island repository identity | <https://github.com/Python-island/Python-island>; remote snapshot: 9 heads and 37 unique tag names; default `pyisland_side` tip `74a3c3b54e550a91bd76632285a262766f4a9270` | The default branch has no repository-root software license at the captured revision. Release binaries and sibling-branch licenses do not create a grant for another branch. | Repository identity and observable product behavior were researched only. No repository source, asset, model or binary is packaged. | `NO_COPY_NO_DISTRIBUTION_GRANT` for unlicensed upstream material; independent implementation is not blocked. |
| Relevant eIsland implementation | `MacIsland` commit `af99413667a8192daa895bd206e9e862cb05dc3d` | No `LICENSE`, `COPYING` or equivalent software-license grant exists in the fixed branch tree. Exact relevant-file Git blob IDs and byte SHA-256 values are retained in `SOURCE_SHA256SUMS.txt`. | Used only to establish that the observable feature exists: editable wake phrase, continuous recognition, cooldowns and media commands. No source expression or assets were copied. | `LICENSE_BLOCKED_UPSTREAM_COPY`; this status does not apply to independently authored LF code. |
| Sibling branch licenses | `pyislandPyside6` tip `fbbbd420c95af11f96ac498b93f872b2ca6e48f3` contains an MIT license; `pyislandQT` tip `2a440cb3e467bb166996978421f1eb7b04d5f872` contains GPL-3.0 | A license is revision- and material-specific. Neither sibling branch supplies evidence that its grant covers the distinct `MacIsland` files. | None. | Not applicable to the LF implementation and not used to clear `MacIsland`. |
| LumiField Windows/Electron implementation | Files and interfaces listed in `IMPLEMENTATION_RECORD.md`; authored for the existing LF renderer, transport and Electron main process | Original LF implementation constrained by the V4 specification and observable behavior; no upstream eIsland bytes are present. | Voice controls call only LF search and LF's existing play/pause/previous/next transport. The overlay reads only a bounded LF playback snapshot. | `LUMIFIELD_ORIGINAL_PASS`. Technical/packaging evidence is tracked separately; no eIsland source-license blocker attaches to these independently authored bytes. |
| Windows speech service | Windows-installed `System.Speech` APIs, invoked at runtime | Operating-system component; LumiField does not copy or redistribute the Windows assembly, speech engine or language data. Availability depends on the user's Windows installation and installed speech language. | Local speech recognition backend only. It is not used to enumerate or control other players. | No third-party model payload is added to the installer by this integration. Windows/platform prerequisites must remain documented. |
| Electron/Chromium microphone path | Existing Electron dependency and `navigator.mediaDevices.getUserMedia({audio:true})` | Covered by the project's existing Electron dependency records; the call is used to obtain a real, user-visible microphone permission decision. | Permission bootstrap and status reporting only; a granted stream is stopped after verification. | Subject to the existing Electron notices and the technical permission tests. |
| Existing `sherpa-onnx-win-x64` dependency | Package version `1.13.4`, Apache-2.0; existing project dependency | No ASR/KWS model is added for this feature. The currently bundled Spleeter model is source-separation data and is not a speech-recognition model. | Not used by the eIsland voice-assistant implementation recorded here. | `NOT_USED`. Any later ASR/KWS model is a new release-gated component requiring its own immutable source, SHA-256, model license, training-data license and NOTICE. |

## Rights conclusion

The fixed `MacIsland` source is discoverable but is not licensed for copying or
redistribution on the evidence available. LumiField therefore implements the
specified Windows behavior independently and must not package eIsland source,
assets, models or binaries. The actual independently authored release-tree
implementation is `LUMIFIELD_ORIGINAL_PASS`; only a future proposal to import
upstream material remains separately `LICENSE_BLOCKED_UPSTREAM_COPY` until a
valid grant is retained.
