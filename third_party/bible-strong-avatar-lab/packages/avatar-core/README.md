# @bible-strong/avatar-core

Framework-independent validation, semantic playback and renderer-neutral SVG scene generation for
Bible Strong procedural avatars. The package has no React, DOM, Motion or browser-storage
dependency.

## Install and validate

```sh
pnpm add @bible-strong/avatar-core
```

Use `parseAvatarDefinition` for untrusted JSON text. It enforces the 256 KiB/depth limits and
detects duplicate object keys before validating against the v1 schema. Use
`validateAvatarDefinition` when the value is already materialized.

```ts
import { parseAvatarDefinition } from '@bible-strong/avatar-core'

const parsed = parseAvatarDefinition(jsonText)
if (!parsed.ok) {
  throw new Error(`${parsed.errors[0].path}: ${parsed.errors[0].message}`)
}
const definition = parsed.value
```

Both functions return a non-mutating discriminated result. Successful values are deeply frozen;
errors include an RFC 6901 JSON Pointer, code and message. The committed JSON Schema is exported as
`@bible-strong/avatar-core/schema`.

Definitions from the earlier pre-release runtime export may still contain
`standardAnimationSet: 1`; the marker is accepted for compatibility but does not add any
implicit animations.

## Semantic lookup and playback

Public calls use semantic keys only. `resolveExpression` and `resolveAnimation` return typed errors
for keys that are not present in the validated definition. Every animation is explicit in the
definition, so the JSON remains the single source of truth for what an avatar can play.

```ts
import {
  advanceAvatarPlayback,
  playAvatarAnimation,
  renderAvatarFrame,
} from '@bible-strong/avatar-core'

const started = playAvatarAnimation(definition, 'idle', 0)
if (!started.ok) throw new Error(started.error.message)

const state = advanceAvatarPlayback(definition, started.value, 500, {
  random: () => 0.5,
})
const scene = renderAvatarFrame(definition, state, 500, {
  random: () => 0.5,
  reduceMotion: false,
})
```

`advanceAvatarPlayback` is a pure state transition driven by a monotonic timestamp and injected
random source. The timeline for each step is transition then hold. `pauseAvatarPlayback` and
`resumeAvatarPlayback` preserve exact progress. With `reduceMotion: true`, transitions and ambient
motion jump deterministically to their target while configured blinks remain active.

`renderAvatarDefinition` renders a static semantic expression. `renderAvatarFrame` renders an
animated frame. Both return paths, visibility and resolved colors without creating DOM nodes.

## Entry points

- `@bible-strong/avatar-core`: contract, validation, semantic catalog, playback and scene APIs.
- `@bible-strong/avatar-core/schema`: the v1 Draft 2020-12 JSON Schema.
- `@bible-strong/avatar-core/geometry`, `/body`, `/surfaces`, `/ambient-motion`: advanced pure
  primitives for renderer authors.

Application integrations are kept in separate packages: `@bible-strong/avatar-react` renders with
React 19, while `@bible-strong/avatar-web` mounts the same definition directly into the DOM. Both
depend on this package and use the same playback and scene implementation.

The package follows Semantic Versioning. While it remains below `1.0.0`, breaking API changes
increment the minor version and fixes increment the patch version.
