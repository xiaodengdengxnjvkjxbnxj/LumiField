# Kinetic-grid splash adaptation record

The user-supplied component's grid geometry, pointer falloff, edge pinning,
node glow and click-ripple calculations are adapted into
`public/lf-splash.js`. React, utility imports, demo text, opaque component
background and the source component's private RAF are excluded. The opaque
background is intentionally omitted so the required ATC shader remains
visible below the grid. LumiField uses one shared splash RAF and one pointer
listener set, then releases both when the splash is destroyed.

Product files:

- `public/lf-splash.js`
- `public/lf-splash.html`
- `public/lf-splash.css`
