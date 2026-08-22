# Corresponding source availability

LumiField v1.1.44 is distributed under GNU GPL v3. The complete corresponding
source for the official Windows installer is the Git tree identified by Tag
`v1.1.44` at:

<https://github.com/xiaodengdengxnjvkjxbnxj/LumiField/tree/v1.1.44>

The GitHub Release also contains `LumiField-1.1.44-Source.zip`, generated from
that same Tag. `RELEASE_MANIFEST.json` binds the source Commit, installer,
packaged `app.asar`, executable, source archive and SHA-256 values.

Included source covers Electron main/preload/renderer code, the local backend,
visual and audio systems, build/installer scripts, dependency lockfile,
licenses, notices, modification records and model files required by the
packaged application.

Electronic Pet 2 uses Bible Strong Avatar Lab's AGPL-3.0-only source at fixed
commit `175691ab32cefe5faec7828af62f3d50210a8eb2`. Its exact source snapshot,
schema, build manifests, official avatar documents and full license are under
`third_party/bible-strong-avatar-lab/`. LumiField's adapter, deterministic
build script, source hashes and dated modifications are under `public/`,
`scripts/` and `docs/licenses/bible-strong-avatar-lab/`. The installed
application carries the required AGPL and copyright files under
`resources/licenses/` and has no iframe, CDN or external Avatar Lab runtime
dependency.

The following are intentionally not source dependencies and are not included:

- user cookies, tokens, databases, histories, account partitions or AppData;
- private signing keys and service credentials;
- external reference videos/TXT/screenshots used only for visual comparison;
- Marketplace preview/demo media;
- third-party music content;
- `node_modules`, old installers and local test output.

Official release binaries may differ from a local rebuild in
signature/container bytes because the private release key and build timestamp
are not public. Product source identity is verified through the tracked-source
fingerprint and signed packaged manifest.

LumiField v1.1.43 and its public installer/source assets remain frozen at
commit `f20b09f2ab27dab7cfebe4aa2ffa3e17b8736fab`; this v1.1.44 source offer does
not alter that historical release.
