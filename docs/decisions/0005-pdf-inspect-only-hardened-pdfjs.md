# PDF is inspect-only; pdf.js legacy build hardened and run in-worker

- Status: accepted
- Date: 2026-10-05

## Context
PDF sanitisation is not small or reliably verifiable: incremental updates, object streams, XMP, forms and signatures interact. pdf.js 6 modern build needs Promise.try (verified missing in Node 22.19).

## Decision
No PDF copy. pdf.js legacy build with isEvalSupported=false, no system fonts, no worker fetch, no XFA; its handler is supplied in-thread inside the analysis worker. Preview is page 1 rendered to a PNG bitmap with annotations off. Encrypted files are reported and not opened.

## Consequences
Honest, limited PDF support. Non-embedded standard fonts may not render in the preview because font data is not fetched (that would be a network request).

## Alternatives considered
Fetching font/cmap assets (violates zero-network), PDF rewriting libraries (unverifiable removal), rendering PDFs in an iframe (rejected: active content).
