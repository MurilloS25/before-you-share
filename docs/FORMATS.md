# Formats and coverage

"Verified" means read directly from the file. "Counted" means detected and sized but not decoded.
Coverage is also shown to the person in the app ("What this tool did not fully check").

## JPEG

| Area | Coverage |
| --- | --- |
| Signature and structure | Marker walk from SOI to EOI without decoding image data. Truncation, impossible lengths, duplicate SOF, stray SOI, segment cap (4096) detected |
| JFIF / JFXX | Version, density, embedded thumbnail fields (verified) |
| EXIF | IFD0, Exif IFD, GPS IFD, IFD1 (thumbnail location), little- and big-endian. Decoded: make, model, software, dates and offsets, artist, copyright, description, orientation, lens, serial numbers, owner, unique ID, user comment, Windows XP fields, GPS position/altitude/other. **MakerNote: size only.** Uncommon tags: counted. Thumbnail JPEG: located, **not opened** |
| XMP | First packet: well-known properties (creator, rights, tool, agent, dates, title, description, keywords, document IDs, camera, location). Extended XMP: counted, **not reassembled** |
| IPTC / Photoshop | 8BIM resources: IPTC-IIM record 2 datasets (byline, credit, copyright, caption, headline, keywords, location, dates), thumbnails; other resources counted |
| ICC | Header and description tag only; split profiles reassembled |
| Adobe APP14, MPF, other APPn | Identified and sized; MPF additional images **not extracted** |
| Comments | Text |
| Trailing data | Measured and classified by first bytes (JPEG, PNG, ZIP, PDF, unknown) |
| Dimensions | From SOF; extreme sizes refused for decode |
| Not examined | Pixels, faces, text in the picture, steganography, data inside entropy-coded segments |

Experimental copy: removes selected groups (EXIF, XMP, IPTC/Photoshop, comments; opt-in: other
application segments including a JFIF embedded thumbnail, whose header is rewritten without it, and trailing data). Keeps JFIF, ICC, Adobe marker, all structural segments and image
data byte for byte. Keeps orientation via an orientation-only EXIF segment.

## PNG

| Area | Coverage |
| --- | --- |
| Structure | Signature, every chunk length, type code and CRC, IHDR validation, chunk order and duplicate rules, IDAT continuity, chunk cap (20000) |
| Text | tEXt, zTXt (bounded inflate), iTXt (UTF-8, compressed or not), keyword categories; text chunks whose keyword or layout is invalid are reported as such and are removable |
| XMP | iTXt `XML:com.adobe.xmp`, same well-known properties as JPEG |
| EXIF | eXIf with the same decoder as JPEG (GPS, device, dates) |
| tIME, pHYs, iCCP | Verified |
| Display chunks | gAMA, cHRM, sRGB, cICP, sBIT, bKGD, tRNS, hIST, sPLT, mDCV, cLLI listed |
| APNG | acTL/fcTL/fdAT preserved; preview shows the browser's rendering |
| Unknown chunks | Listed by name and size; a few associations by name (caBX, iDOT) marked **inferred** |
| Trailing data | After IEND, measured and classified |
| Not examined | Pixels, steganography, decoded IDAT |

Experimental copy: removes text/XMP, eXIf (orientation kept if present), tIME; opt-in: unknown ancillary
chunks, trailing data. Keeps IHDR, PLTE, IDAT, tRNS, colour and display chunks, pHYs, animation chunks.
Unknown **critical** chunks, damaged structure or broken critical CRCs: no copy is offered.

## PDF

| Area | Coverage |
| --- | --- |
| Library (pdf.js, hardened) | Info dictionary (title, author, subject, keywords, creator, producer, dates, custom keys), XMP, page count, annotations and their authors (first 200 pages), AcroForm fields and values, attachment **names** (contents never opened), document-level and page/widget JavaScript triggers, link URLs, optional content (layers), signatures flag |
| Raw scan (indicators, **inferred**) | `/JavaScript`, `/JS`, `/Launch`, `/OpenAction`, `/AA`, `/URI`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/EmbeddedFile`, `/Encrypt`, `/ByteRange`, rich media; `#xx` name escapes decoded; trailer `/ID`; `%%EOF` count for incremental updates; version |
| Encrypted | Reported; not opened; no passwords |
| Not examined | Page text, images, drawings, hidden content on pages, signature validity, attachment contents, previous revisions' content, objects inside compressed object streams (raw scan cannot see them) |

No PDF copy is offered. Preview is a PNG of page 1 drawn in the worker with annotations off; fonts that
are not embedded may not render because font data is not fetched.

## DOCX

Inspection only. A ZIP is treated as a DOCX only if its central directory contains `[Content_Types].xml` and
`word/document.xml`; any other ZIP, and a package whose directory is too damaged to show those two names, stays "not supported" (nothing is
guessed). A package whose directory is partly damaged but still lists them is inspected and reports what could not be read.

| Area | Coverage |
| --- | --- |
| Package safety | Own bounded ZIP directory reader: entry cap (2,000), ZIP64 reported not followed, encrypted entries reported, duplicate names, names that climb out of the package (`..`, absolute, backslash) flagged, declared sizes never trusted, compression ratio and declared total checked (flagged above 1000:1 or 512 MiB). **Nothing is extracted to disk.** Parts are read in memory with `DecompressionStream('deflate-raw')` capped at 512 KiB per part (2 MiB for the main document) and 6 MiB in total |
| Properties | `docProps/core.xml` (author, last modified by, dates, title, subject, keywords, description, category, revision), `app.xml` (application and version, company, manager, template, total editing time), `custom.xml` (names and values) |
| Comments and tracked changes | Counted, with authors and dates, in `word/document.xml` and `word/comments.xml` only (headers, footers, footnotes and extended comment parts are not examined). **The text of comments and of deleted content is not shown**. XML is tokenised, not parsed: comments and CDATA are neutralised and any namespace prefix works |
| Hidden text, editing sessions | `w:vanish` runs counted; distinct `w:rsidR` identifiers counted (not decoded) |
| External references | Relationship targets with `TargetMode="External"` (links, attached templates, linked files) shown as text, never followed |
| Embedded content | Media, embedded objects and ActiveX files, thumbnail, custom XML parts: listed from the directory by name and size, **not opened** |
| Active features | Macro project (`vbaProject`) or macro-enabled content type: reported, never run or analysed; signature parts noted, validity not checked |
| Not examined | Document text, headers, footers, footnotes, content and metadata inside embedded files, reconstruction of earlier versions |

No copy is offered and no preview is shown for DOCX.
