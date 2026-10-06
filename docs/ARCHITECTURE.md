# Architecture

## Product boundary

Before You Share inspects a user-selected file locally and explains information that may not be obvious
from its ordinary visible content. For JPEG and PNG it can create a separate, experimental copy with
selected metadata removed and verify what changed. PDF is inspection only.

It is an educational and experimental privacy tool. It is not malware scanning, legal or compliance
advice, certified digital forensics, evidence preservation, password recovery, or a guarantee that a file
is anonymous or safe.

## Core interaction contract

1. Explain local processing before selection.
2. Let the user choose a file without uploading it.
3. Identify the format from bounded file evidence, not extension alone.
4. Display visible identity separately from hidden or structural findings.
5. Explain each finding, its evidence, its confidence, and why it may matter.
6. Clearly disclose unsupported regions or incomplete analysis.
7. If sanitization is supported, describe the exact transformation before it runs and generate a distinct copy.
8. Reinspect the generated copy and compare it with the original.
9. Remind the user to open and verify the copy before sharing it.
10. Provide an obvious reset that releases references and clears local state.

## Components (as built)

```
 page (main thread)                              analysis worker (killable)
 ─────────────────                               ──────────────────────────
 ui/App ── ui/components ── ui/lib               core/detect ─ core/analyze
   │                                               formats/{jpeg,png,exif,xmp,iptc,icc,inflate}
   │  worker/client.ts  ◄── messages ──►           formats/pdf  (lazy: pdf.js + raw scan)
   │  (jobs, cancel, timeout,                      transform/{groups,jpeg,png,verify,policy}
   │   generation + job-id guard)                  worker/{analysis.worker,decode,pdfPreview}
```

| Boundary | Module(s) | Responsibility |
| --- | --- | --- |
| Intake | `ui/components/DropZone`, `worker/analysis.worker` | File input and drag-and-drop; `Blob.slice` for the first bytes; size refusal before reading; streaming read into one buffer |
| Format detection | `core/detect` | Content signatures only; extension and MIME are compared and reported, never trusted |
| Fingerprinting | `core/analyze` | Size, declared vs detected type, SHA-256 via Web Crypto |
| Worker coordination | `worker/client`, `worker/protocol` | One job at a time, progress, cancel, timeout, supersede, stale-result protection, termination on reset |
| Parsers | `formats/*` | Bounds-checked, bounded, return normalised findings plus explicit coverage; no UI |
| Finding model | `core/types`, `core/findings`, `core/explain` | Category, normalised value, source, evidence location, status, confidence, privacy explanation, removable, transformation support, limitations. Wording lives in the catalogue, not in parsers |
| Safe preview | `ui/App` (`img` of a Blob with a forced MIME type), `worker/pdfPreview` | Raster images through `<img>`; PDF page 1 as a PNG made in the worker |
| Transformations | `transform/{jpeg,png}` + `transform/groups`, `transform/policy` | Removal by byte range from one shared policy table; mutation manifest |
| Verification | `transform/verify`, `worker/decode` | Re-parse, compare findings, byte-identical picture data, dimensions, orientation, browser decode and pixel comparison |
| Presentation | `ui/*` | Calm, factual, accessible; renders values only as text |

## Trust boundaries

- The selected file, its name, declared type, structure, metadata, embedded content, previews, parser
  results and even the generated copy are untrusted.
- Complex parsers can hang or allocate heavily. They run in a worker that the page can terminate, under
  limits listed in `docs/LIMITS.md`, and are exercised with hostile fixtures and property tests.
- Browser memory is the only place file bytes live. Nothing is written to storage, caches or cookies.
- Downloads cross back to the user's filesystem under a clearly different name and never replace the original.
- Third-party code runs in the application's trust boundary: `preact` (UI) and `pdfjs-dist` (PDF only,
  lazy, worker-only, hardened options). See `docs/DEPENDENCIES.md`.
- Any network request containing file-derived data would violate the product boundary. The CSP
  (`connect-src 'none'`) is delivered as a response header, including for the worker script.

## Constraints that hold

- Essential analysis needs no backend, account, provider or network connection after the static files load.
- File bytes are retained only for the active session, inside the worker, and released by terminating it.
- Sanitisation is enabled per format only after round-trip integrity, unsupported-content behaviour and
  failure recovery are defined and tested (JPEG and PNG yes; PDF no).
- The build is plain static files.

## Decisions

Recorded in `docs/decisions/`: stack (0001), parsers (0002), lossless rewrite instead of canvas
re-encoding (0003), killable worker (0004), PDF scope and pdf.js hardening (0005), enforced local-only
(0006), no WebAssembly (0007), inert previews (0008), downloads by anchor (0009).

Still open: OPFS or any persistence (not needed, therefore not added); PDF page-content analysis; DOCX
(not started; see plan 0001); native font data for PDF preview without network.
