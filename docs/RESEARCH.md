# Research notes

Each statement is labelled **Verified** (checked during the work against a primary source or by running
code; the registry, advisory and spec checks cannot be re-run from this repository, while the "ran it" items are partly
covered by `tests/pdf.test.ts` and the PDF fixtures), **Recalled** (from specifications or documentation known to the author and not re-fetched),
**Decision**, **Inference** or **Unknown**. Recalled items are the ones most worth a second look.

## PDF / pdf.js

- **Verified (npm registry):** `pdfjs-dist` 6.4.299, licence Apache-2.0.
- **Verified (GitHub advisory GHSA-wgrm-67xf-hhpq):** CVE-2024-4367 (arbitrary JavaScript through font
  handling when `isEvalSupported` is true) affects 4.1.392 and earlier, fixed in 4.2.67. We pass
  `isEvalSupported: false` anyway.
- **Verified (ran it):** the modern `build/` output needs `Promise.try`, which Node 22.19 lacks; the
  `legacy/build/` output works. **Decision:** use the legacy build everywhere (wider browser support).
- **Verified (ran it):** in v6 `getAttachments`, `getJSActions` and `getFieldObjects` return `Map` or
  `null`; `getMetadata().info` carries `IsSignaturesPresent`, `IsAcroFormPresent`; encrypted files reject
  with `PasswordException`; truncated and garbage files reject with `InvalidPDFException`;
  `getOptionalContentConfig` iterates `[id, {name, visible}]`; `/Count` is ignored for `numPages`.
- **Verified (ran it):** `fingerprints[0]` equals the trailer `/ID` only when present, so IDs are read from
  the raw trailer.
- **Decision:** supplying `globalThis.pdfjsWorker.WorkerMessageHandler` makes pdf.js run in the calling
  thread (our analysis worker): no nested Worker, no script fetch, killable by terminating one worker.
- **Unknown:** whether future pdf.js releases keep these option names; the build gate re-checks behaviour.

## PNG

- **Verified (W3C PNG 3rd ed. Table 7):** cHRM, cICP, gAMA, iCCP, mDCV, cLLI, sBIT, sRGB must precede
  PLTE and IDAT.
- **Verified (spec text):** the safe-to-copy bit is for editors and defines handling of unrecognised
  chunks when modifying; **Decision:** it is a hint only, never the privacy criterion. Unknown ancillary
  chunks are kept unless the person opts in to removing them.
- **Recalled:** CRC covers chunk type and data; length max 2^31-1; tEXt/zTXt/iTXt layouts; XMP lives in
  iTXt `XML:com.adobe.xmp`; tIME is UTC.
- **Unknown (spec section not located in the fetched text):** whether decoders should apply an Orientation
  tag stored in eXIf. **Decision:** be conservative; if the person removes eXIf and the chunk carries an
  orientation other than 1, an orientation-only eXIf is written so behaviour cannot change.

## JPEG / EXIF / XMP / IPTC / ICC

- **Recalled:** marker structure (ITU-T T.81), APP segments (JFIF, Exif, XMP + extended XMP, ICC_PROFILE
  chunking, MPF, Photoshop 3.0 / 8BIM 0x0404 IPTC-NAA, Adobe APP14), EXIF IFD layout and tag numbers.
- **Decision:** keep Adobe APP14 and ICC because they affect colour decoding; remove EXIF/XMP/IPTC/COM on
  request; unknown APPn, MPF and trailing data are reported and kept unless chosen.
- **Recalled:** browsers honour EXIF orientation by default for `<img>` (`image-orientation: from-image`).
  **Decision:** never drop orientation silently; keep it via a minimal EXIF segment. The worker decodes
  both files with `imageOrientation: 'from-image'` so a change would show as a pixel difference.
- **Inference:** thumbnails inside EXIF may carry their own metadata; this tool locates but does not open them (disclosed).

## Browser APIs

- **Recalled:** `File.slice`/`stream` are lazy; `<a download>` with an object URL is the portable download
  path; File System Access (`showSaveFilePicker`) is Chromium-only so it is not used; canvas size limits
  differ by browser (hence the 36 Mpx and 16 Mpx caps); canvas re-encoding drops profiles and changes pixels.
- **Verified (ran it, Node):** `DecompressionStream('deflate')` can be cancelled mid-stream, which is how
  zip-bomb expansion is capped.
- **Decision:** Web Crypto SHA-256 for the fingerprint; labelled as identifying bytes only.

## Tooling

- **Recalled:** Playwright can drive installed Edge with `channel: 'msedge'`; axe via `@axe-core/playwright`.
  Both are exercised in phase 6.
- **Decision:** fast-check for property/mutation tests. These are **not** coverage-guided fuzzing and are
  never described as such.

## Hosting

- **Recalled, not verified:** Vercel `vercel.json` `headers` can set CSP for a static build; Hobby limits
  and over-limit behaviour were **not** verified and must be checked before any deployment
  (`docs/DEPLOYMENT.md`).
