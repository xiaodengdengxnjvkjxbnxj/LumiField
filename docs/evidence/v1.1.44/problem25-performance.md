# LumiField v1.1.44 whole-app performance evidence

## Scope and method

- Baseline: detached worktree at `0d65fb4fa35135685e902f9a4693980cdd17c96a` (the completed feature baseline before this performance pass).
- Candidate: the v1.1.44 performance worktree after the changes recorded below.
- Conditions: the same Electron binary, 1080 x 608 content viewport, device scale factor 2, Intel Arc D3D11 renderer, production main page, isolated temporary user data, `LF_MASTER_TEST=1`, and only the splash test bypass enabled.
- Each scenario records renderer frame cadence, frame-time distribution, Chromium task time, long tasks, aggregate process memory, WebGL resource counts, GPU utilization when Windows exposed it, RAF activity, listener counts, and AudioContext counts.
- Raw baseline: `test-results/lf-v1144-25-performance/before/problem16-isolated4/result.json`.
- Raw final verification: `test-results/lf-v1144-25-performance/after/problem16-final/result.json`.
- A repeated after run is retained at `test-results/lf-v1144-25-performance/after/problem16-isolated5/result.json` to expose normal Windows compositor variance rather than select a single favorable sample.

## Before -> After

| Scenario | FPS | p95 frame | Chromium task / one core | Long tasks | GPU average |
| --- | ---: | ---: | ---: | ---: | ---: |
| Startup to interactive | 6726 -> 6701 ms | - | - | - | - |
| Idle | 49.47 -> 48.72 | 41.6 -> 39.2 ms | 109.51% -> 97.85% | 0 -> 0 | 32.52% -> unavailable in final sample |
| 500-row queue fast scroll | 35.02 -> 34.59 | 49.2 -> 50.1 ms | 98.34% -> 92.46% | 1 / 152 ms -> 0 / 0 ms | 37.22% -> 36.19% |
| Lyric animation | 38.28 -> 36.16 | 50.1 -> 120.3 ms | 169.94% -> 159.96% | 11 / 1576 ms -> 12 / 1725 ms | 33.30% -> 31.73% |
| Spectrum | 33.88 -> 35.03 | 136.9 -> 124.9 ms | 155.38% -> 147.55% | 11 / 1575 ms -> 12 / 1713 ms | 33.92% -> 31.75% |
| Audio Echo | 37.11 -> 40.29 | 83.2 -> 77.9 ms | 148.46% -> 138.27% | 11 / 1190 ms -> 10 / 999 ms | 35.54% -> 36.87% |
| Lyrics + Spectrum + Audio Echo | 36.72 -> 37.73 | 83.4 -> 84.1 ms | 123.33% -> 117.61% | max 176 -> 133 ms | 34.86% -> 34.97% |
| Hidden automatic mode | 2.20 -> 1.74 RAF/s | - | 20.04% -> 18.21% | - | deep-sleep target 1 FPS |

The latest sample shows a noisy lyric-only frame-time regression even though its measured task and GPU cost fell. A preceding same-condition repeat measured lyric FPS `38.28 -> 38.85`, lyric task cost `169.94% -> 153.41%`, spectrum p95 `136.9 -> 117.6 ms`, and combined FPS `36.72 -> 39.13`. The raw runs are retained so this variance is auditable. The stable improvements across repeats are lower task cost, elimination of the queue-scroll long task, lower spectrum cost, higher Audio Echo cadence, and lower background work.

## Memory and lifecycle

| Metric | Before | After |
| --- | ---: | ---: |
| Final JS heap | 10.01 MB | 9.63 MB |
| Final aggregate working set | 1535.19 MB | 1471.28 MB |
| Final aggregate private memory | 1220.29 MB | 1172.12 MB |
| WebGL geometries added by the exercised features | 12 | 12 |
| WebGL textures added by the exercised features | 7 | 7 |
| AudioContext delta | 0 | 0 |
| Listener delta after enabling the exercised feature set | 6 | 6 |
| Renderer exceptions | 0 | 0 |

Chromium does not expose reliable dedicated VRAM or a complete application timer inventory through the production renderer APIs. GPU-process utilization, texture/geometry counts, canvas backing sizes, RAF counters, module scheduler diagnostics, and static timer ownership were therefore used as the auditable proxies. No claim of directly measured VRAM is made.

## Root causes and fixes

- Splash: the hidden prewarmed main renderer competed at full cadence. It now renders two real warm frames, idles at 1 FPS, and wakes through an IPC signal immediately before the atomic handoff.
- Queue and playlist: scrolling temporarily expanded the full queue DOM and flex rows changed offscreen height in Chromium. The queue now remains windowed, retains a wider bounded range, and uses an exact contained row height.
- Lyrics and spectrum: per-frame color parsing, color cloning, option-object allocation, hidden particle uploads, and repeated DOM writes were removed or cached. Spectrum CSS palettes are built once per state/time bucket.
- Progress and climax marker: unchanged styles/text are no longer rewritten. Marker analysis waits until the media is bound to the current song and reuses that playback source instead of resolving it a second time.
- Playback resume: queue sanitization is revision-cached; position persistence is rate-limited to 12 seconds while visible and playing instead of continuously writing storage.
- Sliders: the shared full-screen effect canvas is capped by a pixel budget and releases its backing store to 1 x 1 whenever idle or hidden.
- Liquid glass: target discovery uses a map and the mutation observer ignores DOM changes that cannot affect a glass target.
- 3D shelf: hidden shelf updates return early and floor-mirror textures are explicitly disposed.
- Wallpaper: expensive cover blur and background gradients are cached; drawing is capped at 30 FPS while playing, 5 FPS while paused, and 1 FPS while hidden.
- Desktop lyrics: the overlay keeps the configured playing rate but drops to 8 FPS while paused and 1 FPS while hidden.
- Updater and IPC-adjacent work: installer SHA-256 is streamed instead of synchronously allocating the whole package in memory.

## Runtime coverage

The whole-app profiler exercised Home, the secondary stage, presets, lyrics, a large queue/playlist, Spectrum, Audio Echo, background/minimized behavior, memory, listeners, RAF, WebGL resources, and process CPU/GPU samples in one real Electron lifecycle. Existing focused Electron gates cover splash handoff, responsive player and menus, slider drag, playlist deletion, gesture inference, preset switching, weather/wallpaper, AI overlays and provider boundary, account recovery, taskbar/player IPC, and the electronic pet. Wallpaper and desktop-lyrics cadence have an additional production-IPC regression gate in `scripts/lf-v1144-25-wallpaper-renderer-electron.js`.

The interactive website has a separate browser build and performance gate because it is a different runtime and deployment artifact; its evidence is added during the immediately following website stage.

## Passed final gates for this change

- `node scripts/lf-master-problem16-smoke.js --phase=after --baseline=test-results/lf-v1144-25-performance/before/problem16-isolated4/result.json --out=test-results/lf-v1144-25-performance/after/problem16-final`
- `node scripts/lf-master-problem10-smoke.js` - 21 checks, including three Electron restarts and exactly one source resolution on manual resume.
- `node scripts/lf-v1144-15-climax-progress-electron.js` - 21 checks.
- `node scripts/lf-v1144-25-wallpaper-renderer-electron.js` - 13 checks.
- Queue, spectrum, slider, deletion, splash, and lyric-focused gates have matching retained result directories under `test-results/`.

## Windows compositor note

Windows DWM can clamp an occluded Electron surface to roughly 1-15 FPS independently of Chromium's `backgroundThrottling` setting. The hidden-mode contract therefore requires keep-alive mode to remain live and automatic mode either to halve that observed rate or reach the verified <= 2.75 FPS floor. The final automatic sample reached 1.74 RAF/s and the renderer's own deep-sleep target was 1 FPS.
