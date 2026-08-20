# LumiField AI Provider and LF Tool security record

Record date: 2026-08-20 (Asia/Shanghai).

## Implementation boundary

The v1.1.44 AI Provider layer is original LumiField code. It does not copy
Python-island/eIsland source and does not bundle a provider SDK, model, API
credential or developer billing credential. The implementation uses explicit
HTTPS requests from Electron's trusted main process.

Product files:

- `desktop/lf-ai-provider-main.js`: account-scoped settings, encrypted
  credentials, provider requests, result validation and the LF Tool allowlist;
- `desktop/main.js`: authenticated LF account scope and trusted developer
  permission revalidation;
- `desktop/preload.js`: narrow, value-sanitizing renderer bridge;
- `public/lf-ai-assistant.js` and `.css`: Provider settings and explicit user
  command UI inside the existing voice-assistant page;
- `public/lf-voice-assistant.js`: local fixed voice commands first, with only
  an explicitly woken unrecognised LF command delegated to the configured
  model.

## Fixed provider identities

| Provider | LumiField label | Official API model ID | Default Base URL | Primary documentation |
| --- | --- | --- | --- | --- |
| Zhipu | GLM-4.7-Flash / LF default AI | `glm-4.7-flash` | `https://open.bigmodel.cn/api/paas/v4` | <https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash> |
| Zhipu | GLM-4.6V-Flash / visual AI | `glm-4.6v-flash` | `https://open.bigmodel.cn/api/paas/v4` | <https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash> |
| Groq | advanced reasoning AI | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` | <https://console.groq.com/docs/overview> |
| Groq | high-speed AI | `openai/gpt-oss-20b` | `https://api.groq.com/openai/v1` | <https://console.groq.com/docs/overview> |
| Alibaba Cloud Model Studio | Qwen/Qwen3.6-27b / multimodal AI | `qwen3.6-27b` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | <https://help.aliyun.com/zh/model-studio/qwen3-6-27b> |

The user-facing Qwen label intentionally retains `Qwen/Qwen3.6-27b`; the API
request uses the official `qwen3.6-27b` identifier. A custom Base URL is
accepted only when it remains HTTPS, contains no embedded credential and uses
the provider's allowlisted official host.

## Credential and account isolation

- The renderer can set or clear a Key but can never read it back.
- Keys are encrypted through Electron `safeStorage` and stored separately from
  non-secret settings under a SHA-256 LF account scope in `userData`.
- Plaintext Keys are excluded from settings JSON, renderer state, diagnostics,
  console output and error messages.
- Every IPC call validates the exact main-window sender. Every asynchronous
  request rechecks both the account scope and session generation before using
  its result.
- Corrupt, oversized or non-regular settings/credential files fail closed.

Persisted non-secret state includes the voice enable switch, voice wake,
wake word, song sync, top-edge wake, hotkey, selected Provider, model, Base URL
and explicit free-tier acknowledgement. It is stored in `userData`, so local
web-server port/origin changes do not lose it.

## LF Tool allowlist

The model never receives Electron, Node, shell or filesystem capability. Its
JSON response is parsed and sanitized in the main process. An action is
returned to the renderer only when all of the following are true:

1. it is an exact LF Tool allowlist member;
2. its arguments pass strict type, range and identifier validation;
3. the user's current command explicitly requests that action;
4. at most four approved actions remain.

The allowlist covers LF playback/search/volume/seek, lyrics, visual presets,
weather, wallpaper, playlists, LF panels, available equalizer presets and
strictly bounded existing LF controls. Source, Git, shell, arbitrary code,
files, dependencies, Windows and other applications are denied by default.

`developer.open-tools` is a separate exceptional action. Text from the model
or a renderer boolean is insufficient: the user's current command must
explicitly request development tools and the main process must revalidate the
current LF account's trusted administrator/developer permission before opening
DevTools.

## Cost boundary

LumiField supplies no developer Key, performs no background or automatic
model call, retries no failed request automatically, and exposes no purchase,
recharge or payment path. Each call requires a current explicit user action,
the user's own encrypted Key and an explicit confirmation that the selected
request is covered by the user's free tier or free quota. Paid-required,
unavailable and quota/rate-limit responses fail closed with no fallback to a
paid model. Provider terms, prices and quotas remain the user's Provider-side
responsibility and must be checked before acknowledgement.

## Distribution status

`LUMIFIELD_ORIGINAL_PASS`: the Provider integration and LF Tool policy are
original project code and contain no eIsland or model-provider source. Network
service access and user-supplied credentials are runtime configuration, not
bundled third-party source or model assets.
