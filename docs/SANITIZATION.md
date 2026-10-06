# Sanitisation (experimental copies)

The tool calls the output an **experimental copy**. It never says a file is "clean", "safe" or that "all
metadata was removed".

## Method

Copies are made by **removing byte ranges** from the original and copying every other byte unchanged.
Nothing is decoded and re-encoded. Canvas re-encoding was rejected (ADR 0003): it recompresses,
changes colours and profiles, bakes in or loses orientation, uses much memory and hides what changed.

When is a copy offered? Only for JPEG and PNG whose structure is sound (no truncation, invalid lengths,
duplicate frame headers, unknown critical PNG chunks, broken critical CRCs, order violations that make the
file invalid) and whose declared size is decodable (so the copy can be checked in the browser). Otherwise
the app says why and offers nothing. PDF: never.

## Policy

| | JPEG | PNG |
| --- | --- | --- |
| Removed by default | EXIF, XMP (+extended), Photoshop/IPTC, comments | tEXt/zTXt/iTXt (incl. XMP), eXIf, tIME |
| Found, kept unless chosen | Other application segments (MPF, JFXX, unknown APPn), data after EOI | Unknown ancillary chunks, data after IEND |
| Always kept | Picture data and structural segments, JFIF, ICC, Adobe APP14 | IHDR, PLTE, IDAT, IEND, tRNS and display/colour chunks (gAMA, cHRM, sRGB, iCCP, cICP, sBIT, bKGD, hIST, sPLT, mDCV, cLLI), pHYs, animation chunks, unknown critical chunks |
| Orientation | If EXIF is removed and orientation is not 1, an orientation-only EXIF segment is written | Same with an orientation-only eXIf |

Why unknown structures are opt-in: the repository rule is to preserve unsupported structures by default
or refuse, never silently discard. They are listed, labelled, and removable by choice.

The safe-to-copy bit in PNG chunk names is a hint for editors, not a privacy criterion, and is not used
to decide anything.

## Before it runs

The panel lists, from the same policy table the transformer uses: what will be removed, what will stay
(by category and count), what is always kept, and what may change. Nothing runs automatically and nothing
downloads automatically. The job can be cancelled.

## After it runs (verification)

The copy is parsed again with the same analysers and compared with the original:

1. The copy is the same format and structurally sound.
2. Every finding in a selected group is no longer detected.
3. No finding appears that the original did not have.
4. Display-related findings (colour profile, orientation) are still present.
5. Compressed picture data and structural headers are byte-identical.
6. Dimensions are unchanged.
7. Orientation is unchanged.
8. The in-memory original did not change (SHA-256 before and after).
9. In the browser, both files decode and every decoded pixel is identical (up to 16 Mpx; larger images
   report that the exact comparison was skipped).

Download is disabled if any check fails. A passing result means "these checks found no problem", not
"nothing hidden remains".

## Mutation manifest

Every removed range (offset and size), every rewritten segment, and every deliberately preserved
metadata-like structure is listed, with the policy statements. The manifest is shown in the app.

## Limitations

- Hidden data in places this tool does not decode survives: MakerNote, uncommon fields kept inside segments
  that are preserved, thumbnails inside kept structures, ICC profile text, unknown segments and chunks you
  did not select, pixel data and steganography.
- The copy's byte layout differs; software that checks hashes or signatures of the original will not match.
- Removing EXIF removes date and place data that photo libraries rely on.
- Round-trip decoding is checked with this browser's decoder only.
