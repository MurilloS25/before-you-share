# Acceptance guide

Goal: confirm by hand that the app does what it claims. About 15 minutes.

## Start

```
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4173 in a browser. Keep the browser's developer tools **Network** tab open with
"Preserve log" on, and clear it after the page has loaded. Safe sample files are in
`fixtures/generated/` (synthetic; see `docs/FIXTURES.md`). Do not use personal files for this check.

## Scenarios

1. **JPEG with GPS**: choose `jpeg-gps.jpg`. Expect a short page: the picture and a "Before you share" block saying the file contains an
   exact location (GPS coordinates), with no score and no verdict, a line "5 areas were only partly checked or not checked", and three
   buttons. No findings list, no SHA-256 and no file map are on the page. Press "Create experimental copy": a compact result appears
   (original and copy side by side, "No longer detected", "Still detected", Download) and focus lands on its heading. Press "Change what to
   remove" to discard it and see the single options panel. Press "View full technical report": only now do the findings, the Location
   section with `0.250000° N, 0.750000° E` (Verified), evidence, SHA-256 and the file map appear (the last two folded).
2. **PNG with text**: choose `png-text.png`. Expect author, software, creation time and a comment from
   tEXt entries, each with its source chunk.
3. **PDF with properties**: choose `pdf-basic.pdf`. Expect title, author, creator, producer, dates,
   document ID, page count (in the technical report) and, on the simple view, "This tool can only inspect PDF files". Press "Show page 1 as a picture" for
   the inert preview. Try `pdf-javascript.pdf` and `pdf-link-actions.pdf` for active features (reported,
   never run).
4. **Fake extension**: choose `jpeg-fake-extension.png`. Expect "JPEG image" detected from content and a
   finding about the name and type not matching.
5. **Unsupported**: choose `unsupported.gif`, `unsupported.txt` or `zip-not-docx.zip`. Expect a calm "not supported" screen.
   Then choose `docx-comments-tracked.docx` (inspection only: authors, tracked changes, comments counted, no copy button) and
   `docx-zipbomb.docx` (flagged as a possible compression bomb, inspected in well under a second).
6. **Cancellation**: generate a slow synthetic file with `npx tsx scripts/make-slow-pdf.ts slow-example.pdf`
   (a 60 MiB file of repeated objects that takes seconds to inspect), choose it and press Cancel. Expect the
   start screen and "Cancelled. Nothing was kept."
7. **Experimental copy**: choose `jpeg-kitchen-sink.jpg`. Press "Choose what to remove" (focus moves to the options), keep the
   defaults and press "Create copy with these choices". Open "All 10 verification checks" (all "Passed" in Chromium for the fixtures), the table comparing both files and the mutation manifest; they are folded until opened.
8. **Download**: press Download. The browser saves `jpeg-kitchen-sink.experimental-copy.jpg`. Open it in an
   image viewer; confirm the picture looks the same and is not rotated differently. Confirm the original
   file's modified time did not change.
9. **Reset**: press "Clear and start over". The page returns to the start; no findings remain on screen.
10. **Zero network**: during scenarios 1 to 9 the Network tab shows only the first page load, the app's own
    files under `/assets/` (worker, fonts, and for PDFs the PDF library chunks) and `blob:` previews. No
    other host, no POST, no request with a query string.

## Things to try on purpose

- **Many findings**: choose `many-findings.jpg` if the session folder provides it (generate one with
  `npx tsx scripts/make-many-findings.ts many-findings.jpg`). In the technical report the Document properties category shows 10 findings, "Showing 10 of 599
  findings" and "Show 50 more" / "Show all" buttons. Reveal them with the keyboard (focus moves to the first new item).
- **Focus by keyboard**: Tab to "Choose what to remove", press Enter; the options heading is focused. Open the technical report with
  Enter on "View full technical report"; its heading is focused, and Enter on "Hide technical report" returns focus to the button.
- **Find in page**: Ctrl+F does not see the closed technical report or closed details; open them first.
- **Inspection-only formats**: `pdf-basic.pdf` and `docx-comments-tracked.docx` show an honest sentence and no copy action.

- Drag a file onto the plate; then use the keyboard only (Tab to the plate, Enter to open the picker).
- Zoom the page to 400% and check there is no sideways scrolling.
- Enable "reduce motion" in your operating system and reload: the plate and scan line stop animating.
- `png-hostile-metadata.png`: markup is shown as text, nothing executes.
- `png-zbomb.png`: a 28 KB file that expands to 20 MiB inside; the text is cut and flagged.

## Report

Note any value that looks wrong, any claim that sounds stronger than the evidence, and any state where the
page is confusing. The known limitations are in `docs/LIMITATIONS.md`.
