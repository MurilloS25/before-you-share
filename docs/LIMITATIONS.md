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
- **Sizes.** 48 MiB images and 64 MiB PDFs. Very small devices may run out of memory earlier. If the browser raises an error the tool reports a failure and keeps nothing; a crashed tab cannot be reported. Out-of-memory is not tested.
- **Orientation in PNG.** How viewers treat an Orientation tag inside eXIf is not settled in the sources
  checked, so it is preserved rather than assumed.
- **DOCX is inspection only.** Document text, headers and footers, the text of comments and tracked changes, and
  the contents of embedded files are not read. Other Office files (XLSX, PPTX, legacy .doc) are not supported.
  WebP, GIF, HEIC, TIFF and ordinary ZIP files are recognised by signature and refused with an explanation.
- **Not a security product.** It does not detect malware and does not say a file is safe to open.
- **Hash.** SHA-256 identifies bytes. It needs a secure browsing context (https or localhost).
- **No dark theme.** Only a designed light theme ships.
- **JFIF thumbnails** are removable only through "Other application segments" (the JFIF header is rewritten without them).
- **Closed technical report.** The findings, evidence, SHA-256, file map and detailed coverage are not in the page until "View full technical report" is opened, so the browser's find-in-page (Ctrl+F) cannot find them before. The simple view summarises categories and always states how many areas were only partly checked. The experimental copy is still experimental: its verification covers only what this tool can detect, and other hidden information may remain.
- **Large result lists.** A category with more than 12 findings shows the first 10 and a control to reveal 50 more or all the rest, so a
  600-finding result no longer blocks the page while it is drawn. Findings that are not shown yet are not in the page, so the browser's find-in-page
  cannot see them until they are revealed. The same holds for the contents of closed "Evidence and limits" sections, the file map and the mutation
  manifest, which are built when opened. "Show all" on a 600-finding category is a deliberate action and takes a few hundred milliseconds.
- **Fuzzing.** The suite runs property and mutation tests with a fixed seed; other seeds and larger run counts were tried by hand during development and not recorded. They are not coverage-guided fuzzing and do not prove the absence of parser bugs. XMP, IPTC and ICC readers are exercised only through the JPEG/PNG analysers.
- **Tested browsers.** Automated tests run in Microsoft Edge (Chromium). Firefox and Safari are
  targeted by design (`docs/BROWSERS.md`) but untested: they were not run in this work.
