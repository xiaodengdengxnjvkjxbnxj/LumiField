# LumiField independent implementation record

The existing `#search-box` is the only search component in LumiField and is
reused unchanged by the main and secondary interfaces. The implementation adds:

- one non-interactive, masked CSS border-light layer;
- purple, blue and pink orbiting light driven entirely by CSS;
- focus, hover, composition and non-empty intensity states without changing the
  search-box rectangle;
- one always-reserved clear-button slot, so showing the action never moves text
  or adjacent controls;
- explicit Chinese IME composition gating in the existing search pipeline;
- accessible focus-visible and reduced-motion behavior;
- no new search engine, request path, result list, history store, playlist-link
  parser, audio object, animation-frame loop or interval.

Files:

- `public/lf-animated-search.js`
- `public/lf-animated-search.css`
- the existing search DOM and IME event flow in `public/index.html`
- the existing soft-scan IME guard in `public/lumifield-fixes-v2.js`
- the existing voice-command search-value synchronization in
  `public/lf-voice-assistant.js`
- the offline search guard exception for the local clear action in
  `public/lf-auth-monitor.js`

No React, shadcn, Framer Motion, registry package, upstream component source,
image, video, font or telemetry endpoint was imported.
