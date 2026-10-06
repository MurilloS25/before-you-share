# Lossless segment and chunk rewriting instead of canvas re-encoding

- Status: accepted
- Date: 2026-10-05

## Context
Re-encoding through a canvas decodes and recompresses: quality changes, ICC profiles and colour management behaviour change, orientation can be baked in or lost, memory use is high and large images hit canvas limits. It also hides what was removed.

## Decision
JPEG and PNG copies are made by removing selected segments or chunks and copying every other byte unchanged. Picture data is verified byte-identical and decoded pixels are compared in the browser. Orientation is kept through an orientation-only EXIF/eXIf.

## Consequences
The copy keeps exactly the picture and structure it had. Anything this tool cannot understand is kept unless chosen, so remaining hidden data is possible and is disclosed. Metadata hidden inside the compressed picture (steganography) is out of scope.

## Alternatives considered
Canvas re-encode (rejected), offering both (rejected: more surface for the same goal).
