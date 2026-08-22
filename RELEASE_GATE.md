# LumiField release gates

## v1.1.43 frozen historical release gate

`PASS_FULL_GPL_RELEASE_READY`

- Release Commit:
  `f20b09f2ab27dab7cfebe4aa2ffa3e17b8736fab`.
- Installer SHA-256:
  `695e54f6473f7ccbae811be9be4deaeacf0e7a9ca7461ffdb38261d6614375cb`.
- Tag, installer, source archive and public Release assets are frozen and must
  not be amended, moved, rebuilt or replaced.

## v1.1.44 release gate (published)

`PASS_FULL_GPL_RELEASE_READY`

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

Completed publication gates:

1. immutable Tag `v1.1.44` and the public Release resolve to commit
   `72143cbc4f4b67fc003c188c05ed243558d4c14c`;
2. all 9 public Release assets match the frozen local assets byte-for-byte and
   by SHA-256; all 7 `SHA256SUMS` entries pass and the installer release
   signature verifies;
3. the corresponding source archive contains the exact 432 tracked files, no
   forbidden build output, and has SHA-256
   `73897655ae78be60aedfcd99105b6882c172a118f6763f41192203c7757fb327`;
4. the public Release is available at
   <https://github.com/xiaodengdengxnjvkjxbnxj/LumiField/releases/tag/v1.1.44>;
5. GitHub Pages commit `b7eaeac62a5226ff9ac01ffa892ea511dafcdae2`
   serves HTTP 200 with the exact v1.1.44 installer link, commit and SHA-256 at
   <https://xiaodengdengxnjvkjxbnxj.github.io/LumiField/>.
