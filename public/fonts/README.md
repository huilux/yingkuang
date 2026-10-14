# Offline watermark fonts

Unmodified font files from the official [Google Fonts repository](https://github.com/google/fonts), pinned to the revision in `sources.json`. Each family includes its original copyright notice and SIL Open Font License 1.1 (`OFL.txt`). The manifest records exact download URLs and SHA-256 checksums; `scripts/font-assets.test.mjs` verifies them during the build.

| Family | Watermark use | Bundled weights |
| --- | --- | --- |
| Manrope | Clear, restrained photographer names and captions | Variable 400–700 |
| Barlow Semi Condensed | Compact camera names and EXIF parameters | 400, 500, 600, 700 |
| Cormorant Garamond | Elegant Latin names and larger titles | Variable 400–700 |
| Allura | Short Latin handwritten signatures | Regular only |
| LXGW WenKai TC | Chinese captions and titles; Chinese fallback | Regular, Bold |
| ZCOOL XiaoWei | Decorative Chinese titles | Regular only |
| Long Cang | Chinese cursive signatures | Regular only |
| Sacramento | Thin Latin handwritten signatures | Regular only |
| Cinzel | Classical inscription-style Latin names | Variable 400–700 |
| Rajdhani | Technical camera names and EXIF parameters | 400, 500, 600, 700 |
| Bebas Neue | Condensed uppercase Latin titles | Regular only |

Allura, ZCOOL XiaoWei, Long Cang, Sacramento and Bebas Neue use their original regular outlines for every editor weight; WenKai maps 400/500 to Regular and 600/700 to Bold. No fonts have been modified or subsetted. The system monospace option does not bundle a font file.

## Redistribution

Keep every family's `OFL.txt` with the font in source and binary distributions. The files are copied into the frontend distribution by Vite. Font copyright and license remain separate from the application's license. OFL permits use, embedding and bundling with commercial or open-source software; fonts cannot be sold on their own. Modified fonts must follow OFL terms, including any Reserved Font Names. Images created using the fonts do not inherit OFL. See the [official OFL FAQ](https://openfontlicense.org/ofl-faq/).

The previous eight bundled families have been removed. `src/retired-fonts.json` only maps saved family names to replacements; it contains no old font data. User-imported fonts remain local and are not included in this repository's redistribution grant.
