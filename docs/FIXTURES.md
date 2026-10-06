# Fixture policy

- Every fixture is **generated** by `scripts/generate-fixtures.ts` from code in `fixtures/lib/`. Nothing is
  downloaded and no personal file, real photo or real document is used.
- All content is fictional and evidently so: "Example Person", "Example Maker", "Fixture Camera One",
  GPS 0.25 N 0.75 E (open ocean), dates in 2000, `example.invalid` URLs, a "fixture" document ID.
- Fixtures are committed in `fixtures/generated/` with `MANIFEST.json` (SHA-256 of each file; hashes
  identify bytes only). `npm run fixtures:check` fails if a committed file differs from the generator.
- `.gitattributes` marks them binary so line endings are never rewritten.
- The base picture is a small synthetic gradient with a bright block in one corner so orientation changes
  are visible. JPEG data comes from the `jpeg-js` encoder (dev dependency); PNG and PDF are written byte by
  byte; PNG CRCs come from `node:zlib`, independent of the code under test.
- Hostile fixtures contain markup, bidi controls and control characters as inert text, and a PDF with a
  JavaScript action that is never run.
- Large and absurd cases (a 20 MiB decompression bomb in 28 KB, 65535 x 65535 and 2^31-1 declared sizes)
  are small files on disk. Files near the size limits are generated in memory or in a temporary folder by
  the tests and removed afterwards.

## Catalogue

JPEG: clean, EXIF (big and little endian), GPS, orientation 6, thumbnail, XMP, comment, ICC, IPTC,
kitchen sink (everything, an MPF-like segment, trailing data), trailing data, duplicate segments,
truncated, invalid length, too-small length, fake extension, extreme dimensions, hostile metadata.

PNG: clean, text, compressed text, international text, EXIF with GPS, time, ICC, pHYs, XMP, unknown
chunks, bad CRC, bad length, trailing data, truncated, fake extension, extreme dimensions, decompression
bomb, out-of-order chunks, kitchen sink, hostile metadata.

PDF: basic Info, XMP, annotation, form, attachment, JavaScript, link and Launch actions, encryption
dictionary, incremental update, truncated, malformed, count mismatch, 300 pages, layers, fake extension,
hostile metadata, minimal.

Other: GIF header, plain text, empty file.

`MANIFEST.json` lists each file with a one-line description.
