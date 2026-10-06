# Inert previews only

- Status: accepted
- Date: 2026-10-05

## Context
Previews are the easiest way to run attacker content in the app origin.

## Decision
Raster previews use an img element on a Blob re-wrapped with a forced image MIME type. PDFs become a PNG bitmap made in the worker. Metadata, names and values are only ever inserted as text. No iframes, no innerHTML, no SVG/HTML from files.

## Consequences
Previews are limited to formats the tool recognises by content. Object URLs are revoked on replace, reset and unmount.

## Alternatives considered
Embedding PDFs (rejected), sandboxed iframes (unneeded).
