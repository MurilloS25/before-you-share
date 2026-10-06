# Before You Share

See what a file may reveal before you share it.

Before You Share is an experimental, local-first web tool. You open a JPEG, PNG, PDF or DOCX; it lists the
hidden or easily overlooked information it can find (where a photo was taken, which device made it,
who is named as author, earlier versions, embedded thumbnails), shows where each item sits in the
file, and says plainly what it could not check. For JPEG and PNG it can build a **separate,
experimental copy** with selected metadata removed, inspect that copy again, compare it with the
original, and let you download it. The original is never modified.

Everything happens in the browser tab. There is no upload, backend, database, account, analytics,
telemetry, AI or third-party service.

## Status

Experimental MVP, ready for manual acceptance (see [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)). It is not
deployed.

| Format | Inspection | Experimental copy |
| --- | --- | --- |
| JPEG | Deep (JFIF, EXIF incl. GPS and thumbnail, XMP, IPTC/Photoshop, ICC, comments, MPF, unknown segments, trailing data, structure) | Yes, lossless metadata removal, verified |
| PNG | Deep (every chunk, CRC, order, text, XMP, EXIF, time, ICC, unknown chunks, data after IEND) | Yes, lossless metadata removal, verified |
| PDF | Bounded (Info, XMP, IDs, pages, annotations, forms, attachments, JavaScript and action indicators, layers, signatures flag, revisions) | **No**: inspection only |
| DOCX | Bounded, inspection only (properties, comments and tracked changes counted, embedded parts, external references, macro indicator, ZIP safety checks) | **No**: inspection only |

Details and honest coverage limits: [docs/FORMATS.md](docs/FORMATS.md) and
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## What it is not

Not antivirus, malware detection, digital forensics, legal or compliance advice, password recovery or a
guarantee of anonymity. A copy produced by this tool is experimental: other hidden information may
remain, so open and check the copy before sharing it, and keep your original. Wording rules:
[docs/CLAIMS.md](docs/CLAIMS.md).

## Run it

Requires Node 22 or newer.

```
npm ci
npm run build
npm run preview        # http://127.0.0.1:4173 with the real security headers
```

For development: `npm run dev`.

## Checks

```
npm run check          # typecheck, unit/component tests, fixtures match the generator
npm run test:fuzz      # property and mutation tests (fixed seed; FC_SEED / FC_RUNS to explore)
npm run build && npm run audit:build
npm run test:e2e       # production build in Microsoft Edge: flows, a11y, privacy, performance
```

See [docs/HARNESS.md](docs/HARNESS.md) for the exact commands and what each one proves.

## How it works (for developers)

- **Binary parsing.** JPEG markers, PNG chunks, TIFF/EXIF IFDs, XMP, IPTC-IIM and ICC headers are
  parsed by small modules built on a bounds-checked `Reader`. Every loop, entry count, decompression and
  string has a limit in one table (`src/core/limits.ts`). Evidence locations are real byte ranges.
- **Web Workers.** All parsing and transformation run in one dedicated worker. The page cancels,
  times out, supersedes or resets by terminating it, which frees memory for certain. Job ids and worker
  generations make stale results impossible to apply.
- **Streaming and slices.** The first bytes are read with `Blob.slice` to identify the format and refuse
  oversized files before anything else is read; the rest is streamed into one preallocated buffer with progress.
- **Cryptographic hashing.** SHA-256 through Web Crypto fingerprints the bytes. It is labelled as identity
  of bytes, never as proof of safety.
- **Local-only architecture.** A strict CSP (`connect-src 'none'`) is sent as a header, tests block and
  record every request, and a build audit scans the output for endpoints.
- **Transformation manifests.** Copies are made by removing byte ranges and copying everything else
  unchanged. A manifest lists every removed and rewritten range and the metadata-like structures deliberately preserved.
- **Round-trip verification.** The copy is parsed again by the same analysers; selected findings must be
  gone, nothing new may appear, picture data must be byte-identical, and the browser decodes both files and
  compares pixels.
- **Property and mutation testing.** fast-check generates random, structure-aware and mutated inputs
  against the JPEG, PNG and PDF analysers, the EXIF reader and the transformers. This is not coverage-guided fuzzing and is not claimed to be.

## Documentation

- [Architecture](docs/ARCHITECTURE.md), [Harness](docs/HARNESS.md), [Plan 0001](docs/plans/0001-local-file-privacy-mvp.md), [Decisions](docs/decisions/)
- [Formats and coverage](docs/FORMATS.md), [Limits](docs/LIMITS.md), [Known limitations](docs/LIMITATIONS.md)
- [Threat model](docs/THREAT_MODEL.md), [Privacy model](docs/PRIVACY.md), [Sanitisation](docs/SANITIZATION.md), [Claims](docs/CLAIMS.md)
- [Fixtures](docs/FIXTURES.md), [Dependencies](docs/DEPENDENCIES.md), [Browsers](docs/BROWSERS.md), [Design](docs/DESIGN.md)
- [Acceptance guide](docs/ACCEPTANCE.md), [Deployment (deferred)](docs/DEPLOYMENT.md), [Research notes](docs/RESEARCH.md)

## Licence

MIT. Dependencies and fonts keep their own licences: [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
