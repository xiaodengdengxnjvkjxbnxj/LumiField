# eIsland source-gap report

Audit date: 2026-08-09 (Asia/Shanghai).

## Result

The requested voice-assistant behavior is not absent from the official
repository. It exists in the fixed `MacIsland` revision
`af99413667a8192daa895bd206e9e862cb05dc3d`. The actionable gap is that the
source cannot be used as a Windows/Electron implementation or as licensed
copyable input for LumiField.

## Gaps at the fixed revision

1. **Rights gap.** The `MacIsland` tree has no software-license grant. MIT and
   GPL files on sibling branches cannot be presumed to cover its Swift files.
2. **Platform gap.** Recognition depends on Apple `Speech` and
   `AVFoundation`; the music integration depends on macOS notifications,
   window APIs and AppleScript. Those APIs are not portable to Windows
   Electron.
3. **Scope gap.** The upstream music service discovers or controls Apple
   Music, Spotify and other desktop players. V4 explicitly permits only LF's
   existing player, queue and search path.
4. **Command-safety gap.** The upstream assistant exposes commands outside the
   LF whitelist. LF permits only search, play, pause, previous and next, plus
   an internal overlay-reveal action.
5. **Window-behavior gap.** The required Windows overlay must handle normal
   top-edge intersection, real fullscreen, mixed-DPI multi-monitor geometry,
   non-focus-stealing reveal and complete teardown. The macOS implementation
   does not satisfy this Windows contract.
6. **Permission gap.** V4 requires a real Electron microphone request, an LF
   explanation and automatic routing to Windows microphone settings when the
   operating system blocks access.

## Resolution boundary

LumiField uses an independently authored Windows/Electron controller. It may
study observable behavior, but it must not translate, adapt or mechanically
rewrite the unlicensed Swift expression. It must not scan external players,
allocate a second LF player, or treat an injected transcript as proof that a
real microphone and recognizer work.

The source and rights gap is therefore resolved for implementation by a clean
independent boundary, not by importing upstream code. The upstream-copy gate
remains open until an actual license grant is supplied.
