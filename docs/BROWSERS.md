# Supported browsers

Design targets: current Chromium (Chrome, Edge), Firefox and Safari releases. Only Edge has been tested.

Required platform features: ES2022 modules, module Web Workers, `Blob.slice` and `File.stream`,
`DecompressionStream('deflate')`, Web Crypto `subtle.digest` (secure context: https or localhost),
`createImageBitmap` and `OffscreenCanvas` in workers (for the visual comparison and the PDF preview),
CSS custom properties, `min()`, grid.

If a feature is missing the tool degrades visibly: no SHA-256 (reported as unavailable), visual
comparison skipped (reported as skipped, never passed), PDF preview error message.

**Tested in this work: Microsoft Edge (Chromium) only**, on Windows, through Playwright. Firefox and
Safari were not run. Known risks to check there: worker `OffscreenCanvas` 2D support in older Safari,
`DecompressionStream` in Safari before 16.4, module workers in Firefox before 114, and
`createImageBitmap` orientation handling differences between engines.

Narrow screens: layouts are tested at viewport widths of 320, 390 and 1440 CSS px in desktop Edge (no real mobile device was used). Memory limits on phones are lower than the
48/64 MiB caps imply; failures are reported without keeping state.
