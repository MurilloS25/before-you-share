# DOCX is inspection-only, with an own bounded ZIP reader

- Status: accepted
- Date: 2026-10-05

## Context
Word documents carry authors, companies, templates, comments, tracked changes (including deleted text), editing
history and embedded parts. DOCX is a ZIP of XML parts, so it brings archive risks: compression bombs, lying size
fields, path traversal, huge entry counts and encrypted parts. Rewriting a DOCX safely (keeping relationships,
content types and signatures valid) and verifying it is much larger than the MVP can justify.

## Decision
DOCX is inspected only. A ZIP is accepted as DOCX only when its central directory has `[Content_Types].xml` and
`word/document.xml`. A small ZIP directory reader (`src/formats/zip.ts`) reads the directory under caps and reads
parts in memory through `DecompressionStream('deflate-raw')` with a hard output cap; nothing is extracted to disk. Comment
and tracked-change text is deliberately not displayed, only counts, authors and dates. No copy, no preview.

## Consequences
No new runtime dependency (JSZip and similar would add a larger trusted surface than 150 lines of bounded code).
Coverage is partial and stated. A damaged package is reported as an unsupported ZIP instead of guessed.
The DOCX code was added after the independent reviews of the main formats and has not had its own independent review.

## Alternatives considered
JSZip or fflate (larger surface, extraction-oriented APIs), a DOCX copy that strips properties (cannot be verified
to the standard required for JPEG and PNG), showing comment text (risky to render and not needed for the purpose).
