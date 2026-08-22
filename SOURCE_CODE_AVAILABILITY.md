# Corresponding source availability

LumiField v1.1.43 is distributed under GNU GPL v3. The complete corresponding source for the official Windows installer is the Git tree identified by Tag `v1.1.43` at:

<https://github.com/xiaodengdengxnjvkjxbnxj/LumiField/tree/v1.1.43>

The GitHub Release also contains `LumiField-1.1.43-Source.zip`, generated from that same Tag. `RELEASE_MANIFEST.json` binds the source Commit, installer, packaged `app.asar`, executable and SHA-256 values.

Included source covers Electron main/preload/renderer code, the local backend, visual and audio systems, build/installer scripts, dependency lockfile, licenses, notices, source modifications and the model files required by the packaged application.

The following are intentionally not source dependencies and are not included:

- user cookies, tokens, databases, histories, account partitions or AppData;
- private signing keys and service credentials;
- external reference videos/TXT/screenshots used only for visual comparison;
- Marketplace preview/demo media;
- third-party music content;
- `node_modules`, old installers and local test output.

Official release binaries may differ from a local rebuild in signature/container bytes because the private release key and build timestamp are not public. Product source identity is verified through the tracked-source fingerprint and signed packaged manifest.

## v1.1.44 development additions

The frozen v1.1.43 release and assets above remain unchanged. New v1.1.44 work
adds Bible Strong Avatar Lab's AGPL-3.0-only Electronic Pet 2 component at fixed
commit `175691ab32cefe5faec7828af62f3d50210a8eb2`. Its exact corresponding source,
schema, build manifests, official avatar documents and full license are tracked
under `third_party/bible-strong-avatar-lab/`. LumiField's adapter, deterministic
build script, source hashes and dated modifications are tracked under
`public/`, `scripts/` and `docs/licenses/bible-strong-avatar-lab/`.

A future v1.1.44 source archive must contain all of those paths. The installed
application must contain the full AGPL and copyright files under
`resources/licenses/`; it must not depend on the external Avatar Lab website,
an iframe, a CDN or a separately installed runtime.
