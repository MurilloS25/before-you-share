# Own bounded parsers for JPEG and PNG; pdf.js for PDF

- Status: accepted
- Date: 2026-10-05

## Context
Metadata libraries typically return values, not byte offsets, and are not built to refuse hostile inputs by a single limits table. Transformations need exact segment and chunk ranges, and the analyser and transformer must share one classification so policy and report cannot disagree. PDF is far larger than the product can responsibly re-implement.

## Decision
JPEG, PNG, EXIF/TIFF, XMP, IPTC and ICC readers are written in this repository around a bounds-checked reader. pdf.js (Apache-2.0, maintained) is used for PDF with a bounded raw scan as a complement.

## Consequences
Full evidence locations and testability, at the cost of maintaining parsers. Coverage is deliberately partial and stated (MakerNote not decoded, extended XMP not reassembled, thumbnails not opened). Fixtures are built independently of the parser where possible (CRC from node:zlib) but share the author's reading of the specifications.

## Alternatives considered
exifr / piexifjs / exif-reader (no byte ranges for removal, mixed hostile-input behaviour), WASM tools such as exiftool builds (large, no measured benefit, see ADR 0007).
