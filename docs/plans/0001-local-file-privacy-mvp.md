# 0001 Local file privacy MVP

Status: MVP implemented; awaiting manual acceptance. Written after the parser core and the fixture generator existed
(the first slices were built to de-risk the format decisions below); the plan is the
record of scope, gates and risks that the rest of the work is held to.

## Outcome

A static web app that, entirely inside the browser, shows what a JPEG, PNG or PDF may reveal
before it is shared; for JPEG and PNG it can build a separate, experimental copy with selected
metadata removed, re-inspect that copy, compare it with the original and let the person
download it. The original is never modified. Nothing leaves the device.

## Scope by format

| Format | Inspect | Copy | Notes |
| --- | --- | --- | --- |
| JPEG | Deep: marker walk, JFIF, EXIF (IFD0, Exif, GPS, IFD1 thumbnail), XMP (+extended pointer), IPTC/Photoshop, ICC header, comments, MPF, unknown APPn, trailing data, dimensions | Lossless segment removal (no re-encode); orientation kept via minimal EXIF | Extension / MIME mismatch, truncation, bad lengths, duplicates, extreme dimensions |
| PNG | Deep: every chunk, CRC, order, tEXt/zTXt/iTXt (bounded inflate), XMP, eXIf, tIME, pHYs, iCCP, APNG, unknown chunks, data after IEND | Lossless chunk removal by explicit policy table | Representation chunks always kept |
| PDF | Bounded: pdf.js (hardened) for Info, XMP, pages, annotations, forms, attachments names, JS actions, layers, signatures flag; raw byte scan for indicators; page-1 inert bitmap preview | **None** (inspect-only) | Encrypted files are reported, never opened |
| DOCX | Bounded: ZIP safety, core/app/custom properties, comments and tracked changes (counts, authors, dates), hidden text, external references, embedded parts, macro indicator | **None** (inspect-only) | See "DOCX decision" below |

Excluded: any upload, backend, account, analytics, AI, malware claims, password recovery,
steganography detection, in-place edits, automatic downloads.

## Threat model (summary; full text in `docs/THREAT_MODEL.md`)

Everything about the file is hostile: bytes, name, declared MIME, metadata strings, compressed
payloads, parser output, even the copy we generate. Defences: bounded parsers with a single
limits table; analysis in a killable worker; strict CSP; metadata only ever rendered as text;
raster previews through `<img>` of a blob with a forced MIME type; PDFs only as a PNG bitmap
made inside the worker; every network path blocked and tested.

## Limits

Defined in `src/core/limits.ts` and documented in `docs/LIMITS.md`: 48 MiB JPEG/PNG, 64 MiB PDF,
36 Mpx decode ceiling, 16 Mpx exact compare, segment/chunk/IFD/entry caps, 256 KiB inflate per
chunk and 2 MiB per file, 200 PDF pages inspected, 600 findings, 30 s job budget, 1 job at once.

## Architecture

`core` (limits, errors, bytes, detect, findings, explain catalogue, analyse) ->
`formats` (jpeg, png, exif, xmp, iptc, icc, inflate, pdf) -> `transform` (groups, jpeg, png,
verify) -> `worker` (protocol, analysis.worker, client, decode, pdfPreview) -> `ui` (Preact).
Parsers return normalised findings plus explicit coverage; the catalogue supplies wording; the UI
only renders. See `docs/ARCHITECTURE.md`.

## Phases and gates

1. **Core and parsers.** Gate: all fixtures analysed; evidence locations point at the real bytes;
   bounded property/mutation tests pass. *Done.*
2. **Transformations.** Gate: deterministic output, manifest accounts for every removed and rewritten byte, picture data
   byte-identical, selected findings no longer detected, tamper tests fail as expected. *Done.*
3. **Worker and coordination.** Gate: cancel, timeout, supersede, stale-result tests. *Done (unit).*
   Real-browser cancel and succession E2E tests are in phase 6 (done); a late-message-from-a-terminated-worker case is covered only by the unit test with a fake worker.
4. **UI.** Gate: component tests for every state; keyboard operable; no HTML injection from metadata. *Done.*
5. **Privacy and security gates.** CSP, zero-network tests (analysis, copy, preview), build audit
   for URLs, dependency audit and licences. *Done.* (No secret scan tool was run; the repository contains no environment files and no credentials.)
6. **E2E on the production build** (Playwright with installed Edge) including axe and viewport/zoom checks. *Done.*
7. **Independent reviews** (parser correctness, security/privacy, UX/copy/accessibility, claims) and fixes. *Done; findings and fixes are listed in the pull request.*
8. **Docs, PR, acceptance session.** *Done when the PR is opened.*

## Verification matrix

Unit, property/mutation (fast-check, fixed seed, not coverage-guided), component, E2E on `vite build`
output, axe, network interception, build-output URL audit, bundle budget with lazy PDF chunk,
timing of the worker and of main-thread responsiveness, cancellation, object-URL revocation.

## Sanitisation rules

A copy is offered only for JPEG and PNG, only when the structure is sound and the declared size is
decodable. Before running, the UI lists what will be removed, kept and may change (from the same
policy table the transformer uses). After running it re-parses the copy with the same analysers,
checks that selected findings are gone, nothing new appeared, picture data and display-related data are
byte-identical, dimensions and orientation are unchanged, and (in the browser) both files decode to
identical pixels.
Wording never says "clean", "safe" or "all metadata removed".

## DOCX decision

Started only after JPEG, PNG and PDF were finished, reviewed and green. Implemented as inspection only with an own bounded ZIP reader (ADR 0010). It was added after the four independent reviews of the main formats, so the DOCX code has had the automated tests, property/mutation tests and e2e/axe/privacy gates but **not** a separate independent review.

## Risks

- A parser misreads a field -> mitigated by evidence locations, fixtures built independently of the
  parser (CRC from `node:zlib`), and honest coverage statements. Residual: fixtures share the author's
  understanding of the specs.
- pdf.js bug or hang on hostile PDFs -> runs only in a killable worker with hardened options and a timeout.
- Browser memory on small devices -> single read into one buffer, caps by format, refusal before reading.
- Users over-trust the copy -> copy and verification language is deliberately limited.

## Deferred deployment

Static hosting (for example Vercel Hobby) with the CSP as response headers. Documented in
`docs/DEPLOYMENT.md`; nothing is deployed by this work.
