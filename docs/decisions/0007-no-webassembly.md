# No WebAssembly in the MVP

- Status: accepted
- Date: 2026-10-05

## Context
WASM is justified only by a measured gain in format coverage, safety, performance or incremental processing. JavaScript parsers meet the size budgets and the memory-safe language reduces native-code risk. pdf.js optional WASM decoders (JPX/JBIG2) are not needed for metadata and are not loaded.

## Decision
No WASM and no wasm-unsafe-eval in the CSP.

## Consequences
Smaller trust surface and simpler CSP; some PDF images may not preview.

## Alternatives considered
exiftool/pdf tools compiled to WASM (large, no measured benefit).
