# eIsland voice-assistant independent implementation record

Record date: 2026-08-09 (Asia/Shanghai).

## Method

The LumiField feature is an independent Windows/Electron implementation of the
V4 requirements and observable behavior. No Python-island/eIsland source,
asset, binary, speech model, icon or branding is copied or packaged.

Expected implementation boundary:

- `public/index.html`: sixth visual-console tab, unified global-hotkey binding,
  and event-driven publication from LF's existing player;
- `public/lf-voice-assistant.js` and `.css`: user-scoped settings, bounded
  command parser, visible permission flow, and calls into existing LF search
  and transport functions;
- `public/lf-voice-overlay.html`, `.js` and `.css`: the independent transparent
  status/control surface;
- `desktop/lf-voice-assistant-main.js`: speech lifecycle, strict IPC routing,
  overlay ownership, bounded Windows foreground-geometry checks, mixed-DPI
  positioning and teardown;
- `desktop/lf-voice-overlay-preload.js`: overlay-only IPC allowlist;
- `desktop/main.js` and `desktop/preload.js`: lifecycle and narrow bridge
  wiring only.

The canonical renderer bridge is expected to expose only:

- `configureVoiceAssistant(config)`;
- `syncVoiceAssistantPlayback(snapshot)`;
- `showVoiceAssistant()`;
- `requestVoiceAssistantMicrophone()`;
- `openVoiceAssistantMicrophoneSettings()`;
- `onVoiceAssistantCommand(callback)`;
- `onVoiceAssistantStatus(callback)`;
- `getVoiceAssistantDebug()`, whose main-process result is disabled unless an
  explicit LF test environment is active.

## Product and security boundaries

- Recognition may dispatch only `search`, `play`, `pause`, `previous` and
  `next`. `show` is an internal UI reveal action, not an operating-system
  command.
- Search uses LF's existing `submitSearchInput`/`doSearch` path. Transport uses
  LF's existing `togglePlay`, `prevTrack`, `nextTrack`, `playQueue`,
  `currentIdx` and `audio`; it creates no second player or queue.
- Playback failure stays under `LumiFieldPlaybackFailureCoordinator`, so voice
  control cannot bypass the one-refresh/finite-skip policy.
- Playback synchronization is event-driven and contains only bounded display
  fields. It excludes cookies, credentials, raw local paths and playable audio
  URLs; a bounded cover-art URL may remain display metadata.
- No Apple Music, Spotify, Windows media-session or external-player discovery
  is permitted.
- The voice hotkey is merged into the existing global-hotkey registration
  batch. A separate registration pass would unregister the existing controls.
- Main-window and overlay IPC senders are validated against their exact
  `webContents`; actions and query length are allowlisted.
- Overlay content uses context isolation, sandboxing, no Node integration, a
  restrictive CSP, blocked navigation/new windows, and non-focus-stealing
  display.

## Permission and teardown contract

Enabling voice wake from the visible LF settings page must issue a real
audio-only `getUserMedia` request. A granted verification stream is stopped.
Windows denied/restricted status or a permission rejection routes to
`ms-settings:privacy-microphone` and leaves visible LF instructions;
`NotFoundError` and `NotReadableError` are reported separately.

Disabling the feature, changing LF users, closing the window or quitting the
app must stop recognition, microphone tracks and child processes; close audio
contexts; terminate workers; clear timers/listeners; destroy the overlay; and
omit the voice binding from the unified global-hotkey batch.

## Fullscreen and multi-monitor contract

One transparent, top-centred, focusless overlay is owned by the main process.
It hides when a real fullscreen foreground window covers the target display or
when an ordinary foreground window intersects its proposed bounds, and restores
when the obstruction moves. Foreground rectangles are converted from physical
pixels to Electron DIP coordinates, clamped to the target display work area,
and re-evaluated after display add/remove/metrics changes. Explicit wake,
hotkey or enabled top-edge dwell may reveal the overlay temporarily without
taking focus; afterward normal obstruction policy resumes. Geometry sampling
must use one bounded, state-diffed timer and must stop when disabled.

## Verification classification

The packaged independently authored LF implementation is
`LUMIFIELD_ORIGINAL_PASS` for source provenance and eIsland licensing: no
eIsland byte, asset, model or binary is in the release tree. The remaining
physical-device checks below are technical acceptance evidence only; they are
not an eIsland-source or third-party-license release blocker.

Automated source/Electron tests may prove source boundaries, DOM/API shape,
IPC rejection, parser allowlisting, LF-only transport delegation, deterministic
layout, cleanup instrumentation and synthetic geometry decisions. The
following remain `TECHNICAL_ACCEPTANCE_EVIDENCE_PENDING` and must not be
represented as physically verified by an injected transcript or mocked
permission result:

- speaking into a real microphone through the shipped recognizer;
- Windows privacy allow and deny flows on the installed build;
- browser, video and game fullscreen behavior;
- top-edge overlap/recovery and no-focus behavior;
- dual-display, negative-coordinate and mixed-DPI behavior;
- installed-build hotkey conflicts and persistence across restart;
- real LF search/transport plus the Problem 9 failed-track skip path;
- isolation while an unrelated desktop music player is active;
- operation without eIsland installation or login.
