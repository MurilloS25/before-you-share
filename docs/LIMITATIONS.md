# Known limitations

Plain statements of what this tool does not do or cannot promise.

- **Not complete.** It reads common metadata. It does not decode MakerNote, extended XMP, thumbnails
  inside metadata, MPF additional images, PDF page content, attachment contents, PDF revisions'
  contents or objects inside compressed PDF object streams.
- **Not a detector of hidden pixel data.** Steganography, watermarks and information visible in the
  picture (faces, text, places) are out of scope.
- **PDF is inspection only.** No PDF copy is offered because it could not be rewritten and verified safely.
  PDF preview may lack text in fonts that are not embedded (font data is not fetched, to keep zero network).
- **Copies are experimental.** Removed data may be needed by other software; kept data may still identify.
  Verification compares what this tool can detect.
- **Browser decoder dependence.** Visual comparison uses the current browser's decoder and a pixel
  comparison up to 16 Mpx. Colour management differences between browsers are not tested.
- **Sizes.** 48 MiB images and 64 MiB PDFs. Very small devices may run out of memory earlier; the tool
  then reports a failure and keeps nothing.
- **Orientation in PNG.** How viewers treat an Orientation tag inside eXIf is not settled in the sources
  checked, so it is preserved rather than assumed.
- **DOCX and other formats** are not supported. WebP, GIF, HEIC, TIFF, ZIP and Office files are recognised
  by signature and refused with an explanation.
- **Not a security product.** It does not detect malware and does not say a file is safe to open.
- **Hash.** SHA-256 identifies bytes. It needs a secure browsing context (https or localhost).
- **No dark theme.** Only a designed light theme ships.
- **Large result lists** (hundreds of findings) can make the page unresponsive for a moment while they are drawn.
- **Fuzzing.** Property and mutation tests were run with fixed and varied seeds; they are not
  coverage-guided fuzzing and do not prove the absence of parser bugs.
- **Tested browsers.** Automated tests run in Microsoft Edge (Chromium). Firefox and Safari are
  supported by design (`docs/BROWSERS.md`) but were not run in this work.
