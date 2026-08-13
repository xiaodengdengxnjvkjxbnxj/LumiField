# eIsland voice-assistant release gate

Audit date: 2026-08-09 (Asia/Shanghai).

This is a component gate, not a declaration that the complete LumiField
distribution is GPL-release-ready. For the actual release-tree implementation,
the eIsland source-rights status is `LUMIFIELD_ORIGINAL_PASS`: it is an
independently authored LF implementation and contains no eIsland material.

| Component or evidence | Status | Reason | Condition for release/change |
| --- | --- | --- | --- |
| Copying or adapting `MacIsland@af99413667a8192daa895bd206e9e862cb05dc3d` | `LICENSE_BLOCKED_UPSTREAM_COPY` | The fixed tree has no software-license grant. | Retain a rightsholder grant that expressly covers the exact source, modification and intended redistribution, then repeat source/dependency review. |
| Independently authored LF voice-assistant source | `LUMIFIELD_ORIGINAL_PASS` | No eIsland source, asset, binary or model is copied; behavior is implemented against LF and OS/Electron APIs. | Preserve the clean boundary, project license/notices and successful automated source/security checks. |
| Windows `System.Speech` runtime | `SYSTEM_PREREQUISITE_NOT_BUNDLED` | The implementation invokes the user's Windows-installed speech component and does not redistribute it. | Keep it external to the package; document supported Windows/speech-language prerequisites and a clear unavailable state. |
| Real microphone/recognizer acceptance | `TECHNICAL_ACCEPTANCE_EVIDENCE_PENDING` | Synthetic transcripts or mocked permission results cannot prove that physical capture and shipped recognition work. This is not an eIsland licensing blocker. | Complete the real-device matrix recorded in `IMPLEMENTATION_RECORD.md` and retain installed-build evidence. |
| Fullscreen/top-edge/mixed-DPI acceptance | `TECHNICAL_ACCEPTANCE_EVIDENCE_PENDING` | Window-manager, game and physical monitor behavior cannot be established by source inspection alone. This is not an eIsland licensing blocker. | Complete the physical Windows matrix and retain screenshots/logs without exposing private content. |
| Future third-party ASR/KWS model | `CONDITIONAL_FUTURE_LICENSE_GATE` | No such model is included by this implementation or current release. A future model would add separate code/model/training-data rights. | Fix repository/commit, exact model files and SHA-256, model and training-data licenses, notices and distribution conditions before packaging. |

## Mandatory release checks

1. `SOURCE_SHA256SUMS.txt` still identifies the exact upstream material that
   was reviewed but not copied.
2. The product package contains no file from Python-island/eIsland and no
   unrecorded speech model.
3. The command path remains LF-only and rejects every non-whitelisted action
   and spoofed IPC sender.
4. One LF player, one queue and the Problem 9 playback-failure coordinator
   remain authoritative.
5. Disable, account switch, window close and app quit release the microphone,
   recognizer/child process, timer, overlay and voice hotkey.
6. Automated evidence and `TECHNICAL_ACCEPTANCE_EVIDENCE_PENDING` evidence
   are reported separately; a transcript-injection parser test is never
   labelled real-microphone PASS.
