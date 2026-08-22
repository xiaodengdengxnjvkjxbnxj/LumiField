# Electronic Pet 2 AGPL release gate

Component decision: `ALLOW_WITH_AGPL_SOURCE_NOTICE_MODIFICATION_OBLIGATIONS`

This is a component-level compatibility decision, not a blanket v1.1.44 release
approval. Electronic Pet 2 may be distributed only when every check below passes:

- exact upstream commit `175691ab32cefe5faec7828af62f3d50210a8eb2` is recorded;
- exact corresponding source for core, Web Runtime, schema and imported avatar
  documents is present under `third_party/bible-strong-avatar-lab/`;
- copyright and `AGPL-3.0-only` identifiers are retained;
- the complete AGPL v3 text is present in both source and packaged license paths;
- LumiField wrapper source, import script, deterministic build script and
  modifications record are present;
- `SOURCE_SHA256SUMS.txt` matches every recorded source/runtime file;
- the production bundle's esbuild metafile proves it reads the vendored source
  and not `node_modules/@bible-strong/avatar-*`;
- `NOTICE.md`, `THIRD_PARTY_NOTICES.md` and `SOURCE_CODE_AVAILABILITY.md` expose
  author, source, license and corresponding-source availability;
- the Windows installer/source archive content audit confirms these materials
  are actually distributed;
- runtime verification confirms local execution, no iframe/CDN/remote fetch,
  complete lifecycle destruction and zero renderer errors.

The current unpacked Windows package passed the component content audit: all 60
files in `SOURCE_SHA256SUMS.txt`, the AGPL text, copyright, notices, exact source
identity and v1.1.44 runtime/lockfile bytes are present and match. The remaining
release-stage work is the final installer and source archive identity audit, so
the status is
`AGPL_SOURCE_NOTICE_AND_PACKAGE_CONTENT_PASS_FINAL_INSTALLER_SOURCE_ARCHIVE_PENDING`.
