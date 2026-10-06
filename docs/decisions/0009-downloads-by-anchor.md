# Downloads through an anchor and a Blob URL

- Status: accepted
- Date: 2026-10-05

## Context
File System Access is Chromium-only and adds permission prompts.

## Decision
A new Blob is downloaded with an anchor download attribute under a clearly different file name; nothing downloads automatically. The URL is revoked after the click and on reset.

## Consequences
Works in every supported browser. The person chooses where to save.

## Alternatives considered
showSaveFilePicker (not portable).
