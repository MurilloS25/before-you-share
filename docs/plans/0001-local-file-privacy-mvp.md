# 0001 Local file privacy MVP

Status: completed and accepted (automated gates passed; manual acceptance of the final build recorded below). Written after the parser core and the fixture generator existed
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

## Follow-up round: results hierarchy and large lists

A limited UX and performance pass after the first acceptance review. No new formats, services or limits. Changes: a "Before you share"
block (categories, not findings; one primary action to the single copy panel with a real focus move), progressive disclosure of technical
detail (SHA-256, reported type, status legend, file map; evidence, manifest and the structural category are built only when opened),
and bounded finding lists ("Show more", 10 first, everything still reachable). Gate: presenting the 600-finding result keeps the main
thread under a 250 ms budget (measured in `e2e/performance.spec.ts`; numbers in `docs/LIMITS.md`). `maxFindings` and parser limits are unchanged.

## Follow-up round: restructured results flow

The second pass still left the technical findings dominating the page (about 4,970 px for the GPS JPEG, 7,170 px after the copy). The flow
was restructured, not decorated: (1) the default view is the simple result (preview, "Before you share", coverage line, actions); (2)
"Create experimental copy" is a real one-click action on the recommended groups of the single selection state, and "Choose what to remove"
reveals the one options panel, closed until asked; (3) the full technical report is closed and not mounted until opened (find-in-page
cannot see it before; documented); (4) the copy result is compact, with the ten checks, comparison and manifest folded. PDF and DOCX stay
inspect-only with no copy action. No parser, limit, format, dependency or CSP change.

Measured (desktop Edge, `jpeg-gps.jpg`): 1,254 px simple, 2,072 px after the copy, 4,849 px with the report open at 1440 x 900; 1,971 / 3,038 /
6,347 px at 390 px. The simple view of the 600-finding file builds 62 nodes and no findings; opening the report takes about 70 ms. The copy is
still experimental and its verification covers only what the tool can detect. Gates: all checks listed in `docs/HARNESS.md`.

## Acceptance

Two kinds of evidence are kept apart on purpose.

- **Automated.** The checks listed in `docs/HARNESS.md` (typecheck, unit tests, fixture check, fuzz tests, build, build audit,
  dependency audit, and the end-to-end suite in Microsoft Edge including axe, privacy and performance) passed on the final build.
  Four independent read-only code reviews found no blocking defect; their P1 and reasonable P2 findings were fixed.
- **Manual.** A person ran the final build locally in their own browser and approved the flow: the simple result, one-click
  experimental copy, choosing what to remove, the technical report, PDF and DOCX inspection, and reset. This was a human check of
  that flow only. It is not an independent audit and not a guarantee about any particular file.

Remaining limitations, all documented in `docs/LIMITATIONS.md` and not resolved by this acceptance:

- Firefox and Safari were not tested; automated tests ran in Microsoft Edge (Chromium) only.
- No screen-reader testing was done. Accessibility was checked with axe, keyboard and focus tests, and layout checks at 320, 390 and
  1440 px, 200% text and reduced motion.
- Heading levels inside the technical report are flat (all level 2).
- The browser's find-in-page (Ctrl+F) cannot see the technical report, or any closed details, until they are opened.
- The experimental copy remains experimental: its verification covers only what this tool can detect, and other hidden information
  may remain.

Nothing is deployed. Publishing is a separate, later decision (`docs/DEPLOYMENT.md`).
