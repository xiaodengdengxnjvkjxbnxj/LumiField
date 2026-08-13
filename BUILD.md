# Build LumiField v1.1.43

## Requirements

- Windows 10/11 x64
- Git
- Node.js 24.x and npm 11.x
- PowerShell 5.1 or newer
- Network access for the first `npm ci`

The lockfile resolves Electron `42.9.0`, `@electron/rebuild` `4.2.0` and electron-builder `26.15.3`.

## Clean checkout

```powershell
git clone --branch v1.1.43 https://github.com/xiaodengdengxnjvkjxbnxj/LumiField.git
cd LumiField
npm ci
npm audit --omit=dev
npm audit
npm run test:lf
```

Run locally:

```powershell
npm start
```

Build the NSIS installer from scratch:

```powershell
npm run build:win
```

The main artifact is `dist/LumiField-1.1.43-Setup.exe`. The build also produces the separately scoped monitor installer; it is not the LumiField website's primary download.

## Build identity

`build/version-release.js` fingerprints tracked product source and writes `public/version-manifest.json`. `build/lf-integrity-after-pack.js` signs the packaged core-file manifest. The Release Manifest records the Tag, Commit, source fingerprint, `app.asar`, executable and installer SHA-256 values.

Release signing requires the project's private signing key through the documented environment/configuration path. The private key is deliberately absent from this repository. Public source builds remain possible without possessing the official release key, but they will not reproduce the official signature bytes.

## Verification

```powershell
node --check server.js
node --check music-platform-service.js
node scripts/lf-backend-smoke.js
node scripts/lf-ui-smoke.js
node scripts/lf-final-window-smoke.js
node scripts/lf-v4-license-audit.mjs . docs/licenses/dependencies
node scripts/lf-public-release-audit.mjs
```

Historical V4 visual-acceptance harnesses depended on external, privately held
reference media and are intentionally not part of the public source tree. Their
fixed source identities and outcomes remain represented by the public
provenance, implementation and golden-master records under `docs/licenses/`
and `docs/evidence/audio-echo/`.

For an official release, also install the generated setup into a temporary test environment, launch `LumiField.exe`, verify ProductVersion `1.1.43`, run the packaged integrity smoke, uninstall it, and compare all hashes with `RELEASE_MANIFEST.json` and `SHA256SUMS`.
