# Offline lyric translation notices

LumiField includes the following unmodified runtime components and compressed
model data solely to provide on-device lyric translation:

- `@browsermt/bergamot-translator` 0.4.9, BrowserMT contributors, MPL-2.0.
  Source: https://github.com/browsermt/bergamot-translator
- Firefox Translations Models, Mozilla and contributors, MPL-2.0.
  Source: https://github.com/mozilla/firefox-translations-models
- Mozilla production model registry snapshot generated
  `2026-07-26T00:40:13Z`.
  Registry: https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json

Pinned models:

- `en-zh` Release `base-memory`
  (`llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g`)
- `ja-en` Release Android `base-memory`
  (`cjk_retrain_base-memory_NLRJLD_pQFyrvgKtbie2nA`)

Every compressed model part is verified against its pinned SHA-256 before it
is decompressed. Model files are not modified. The complete MPL-2.0 license is
distributed as `MPL-2.0.txt` in this directory.
