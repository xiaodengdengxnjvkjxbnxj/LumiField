# LumiField release gates

## v1.1.43 frozen historical release gate

`PASS_FULL_GPL_RELEASE_READY`

- Release Commit:
  `f20b09f2ab27dab7cfebe4aa2ffa3e17b8736fab`.
- Installer SHA-256:
  `695e54f6473f7ccbae811be9be4deaeacf0e7a9ca7461ffdb38261d6614375cb`.
- Tag, installer, source archive and public Release assets are frozen and must
  not be amended, moved, rebuilt or replaced.

## v1.1.44 release gate (publication pending)

`PENDING_GITHUB_RELEASE_AND_ONLINE_VERIFICATION`

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
- exact clean-checkout `npm ci` and Windows x64 NSIS builds pass with Electron
  42.9.0;
- final installer SHA-256:
  `8d68e554742f21a01b130ca76480e1f12070d45c1eec71f794d9afafa00b63ca`;
- unpacked package, signed integrity manifest, actual install/start/exit,
  installed runtime and uninstall/reinstall gates pass with zero renderer
  errors;
- installed main `app.asar` SHA-256:
  `a49ba90a7df46c3c1c9946f4ae9dcbe3df5ca229d68ba588009e493c41360965`.

Remaining publication gates:

1. create the source archive, Release Manifest and `SHA256SUMS` from the final
   immutable Tag commit;
2. publish the v1.1.44 Tag/Release/assets and update GitHub Pages;
3. verify the remote Release assets, checksums and live website download link.

Only after all three items pass may this section be changed to
`PASS_FULL_GPL_RELEASE_READY`.
