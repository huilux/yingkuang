# Offline font assets

These are unmodified font files from the official [Google Fonts repository](https://github.com/google/fonts), pinned to the revision in `sources.json`. Each family includes its original SIL Open Font License (`OFL.txt`). `sources.json` records exact download URLs and SHA-256 checksums; `scripts/font-assets.test.mjs` verifies files and licenses during the build.

Families: Noto Sans SC, Noto Serif SC, Montserrat, Lato, Playfair Display, Oswald, Space Mono, Ma Shan Zheng. Font copyright and author notices are preserved in each family's license and the original font metadata.

`src/font-catalog.json` maps the public editor names to these files. Noto Sans SC and Noto Serif SC use the editor's existing `Noto Sans CJK SC` and `Noto Serif CJK SC` aliases for compatibility with saved templates. Frontend previews and native exports use the same bundled bytes. Assets are loaded only when a document references their families; the complete font assets total approximately 49 MiB.
