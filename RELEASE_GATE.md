# LumiField release gates

## v1.1.43 frozen historical release gate

`PASS_FULL_GPL_RELEASE_READY`

- Release Commit:
  `f20b09f2ab27dab7cfebe4aa2ffa3e17b8736fab`.
- Installer SHA-256:
  `695e54f6473f7ccbae811be9be4deaeacf0e7a9ca7461ffdb38261d6614375cb`.
- Tag, installer, source archive and public Release assets are frozen and must
  not be amended, moved, rebuilt or replaced.

## v1.1.44 release gate (pre-publication)

`PENDING_FINAL_INSTALLER_SOURCE_ARCHIVE_AND_ONLINE_VERIFICATION`

Completed source gates:

- full feature regression, core backend/UI and four-DPI window checks pass;
- production and complete npm audits report zero vulnerabilities;
- production dependency graph: 212 entries, unknown licenses 0, release
  blockers 0;
- Jhey Spotlight core: `MIT_PASS_WITH_NOTICE`; EaseMize wrapper:
  `REFERENCE_ONLY_NOT_PACKAGED`;
- Audio Echo V2: `AUDIO_ECHO_V2_GPL_PASS`;
- Electronic Pet 2: source, AGPL, copyright, modification and hash gates pass;
- golden star trail remains removed from v1.1.44 and its owner-origin record is
  `LUMIFIELD_ORIGINAL_PASS`;
- reference-only media, private paths, secrets and Marketplace previews are not
  packaged.

Remaining publication gates:

1. build the exact v1.1.44 installer and source archive from the frozen commit;
2. pass unpacked-package, actual install/start/exit/uninstall and installed
   runtime checks;
3. generate and verify final signatures, hashes, Release Manifest and
   `SHA256SUMS`;
4. publish the v1.1.44 Tag/Release/assets and update GitHub Pages;
5. verify the remote Release assets, checksums and live website download link.

Only after all five items pass may this section be changed to
`PASS_FULL_GPL_RELEASE_READY`.
