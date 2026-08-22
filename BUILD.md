# Build LumiField v1.1.44

## Requirements

- Windows 10/11 x64
- Git
- Node.js 24.x and npm 11.x
- PowerShell 5.1 or newer
- Network access for the first `npm ci`

The lockfile resolves Electron `42.9.0`, `@electron/rebuild` `4.2.0` and
electron-builder `26.15.3`.

## Clean checkout

```powershell
git clone --branch v1.1.44 https://github.com/xiaodengdengxnjvkjxbnxj/LumiField.git
cd LumiField
npm ci
npm audit --omit=dev
npm audit
npm run test:lf
npm run audit:public-release
```

Run locally:

```powershell
npm start
```

Build the NSIS installers from scratch:

```powershell
npm run build:win
```

The primary artifact is `dist/LumiField-1.1.44-Setup.exe`. The same command
also builds the separately scoped monitor installer; it is not the primary
LumiField website download.

## Build identity

`build/version-release.js` fingerprints tracked product source and writes
`public/version-manifest.json`. `build/lf-integrity-after-pack.js` signs the
packaged core-file manifest. The Release Manifest binds the Tag, Commit, source
fingerprint, `app.asar`, executable, installer and source archive SHA-256
values.

Release signing requires the project's private signing key through the
documented environment/configuration path. The private key is deliberately
absent from the repository. Public source builds remain possible without it,
but do not reproduce official signature bytes.

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

For the official release, install the generated setup into the test target,
launch `LumiField.exe`, verify ProductVersion `1.1.44`, run the packaged
integrity and installed-runtime smokes, uninstall it, and compare every final
hash with `RELEASE_MANIFEST.json` and `SHA256SUMS`.

LumiField v1.1.43 remains a frozen historical release. These commands and
artifacts apply only to v1.1.44 and must not replace or rewrite v1.1.43 assets.
