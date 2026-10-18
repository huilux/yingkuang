# Offline watermark fonts

Unmodified font files from the official [Google Fonts repository](https://github.com/google/fonts), pinned to the revision in `sources.json`. Each family includes its original copyright notice and SIL Open Font License 1.1 (`OFL.txt`). The manifest records exact download URLs and SHA-256 checksums; `scripts/font-assets.test.mjs` verifies them during the build.

| Family | Watermark use | Bundled weights |
| --- | --- | --- |
| Cormorant Garamond | Elegant Latin names and larger titles | Variable 400–700 |
| Allura | Short Latin handwritten signatures | Regular only |
| Long Cang | Chinese cursive signatures | Regular only |
| Sacramento | Thin Latin handwritten signatures | Regular only |
| Cinzel | Classical inscription-style Latin names | Variable 400–700 |
| Space Mono | Consistent offline monospace parameters | Regular, Bold |

Allura, Long Cang and Sacramento use their original regular outlines for every editor weight. Cormorant Garamond and Cinzel provide variable weights; Space Mono maps 400/500 to Regular and 600/700 to Bold. All six families remain complete, unmodified and available offline. No fonts have been subsetted.

Preview and export share an offline fallback chain: the selected family, Long Cang for Chinese, then Space Mono for additional symbols. Missing glyphs are reported before export; users can import a supporting TTF/OTF locally. Some uncommon or traditional Chinese characters may require an imported font.

## Redistribution

Keep every family's `OFL.txt` with the font in source and binary distributions. The files are copied into the frontend distribution by Vite. Font copyright and license remain separate from the application's license. OFL permits use, embedding and bundling with commercial or open-source software; fonts cannot be sold on their own. Modified fonts must follow OFL terms, including any Reserved Font Names. Images created using the fonts do not inherit OFL. See the [official OFL FAQ](https://openfontlicense.org/ofl-faq/).

`src/retired-fonts.json` maps saved family names to replacements and contains no old font data. User-imported fonts remain local and are not included in this repository's redistribution grant.
