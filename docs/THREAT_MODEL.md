# Threat model

Scope: a person opens a file they are entitled to inspect, on their own device, in a current browser.
Assets: the file's contents and metadata (confidentiality), the person's original file (integrity), the
page's origin (no execution of file content), the person's trust in the tool's statements (honesty).

Adversary: the **file itself** (crafted by a third party), and mistakes in this tool. There is no
network adversary model for file data because the file data never goes on the network. A malicious
host serving a modified app is out of scope (see "Residual risks").

| Threat | Mitigation | Evidence |
| --- | --- | --- |
| Parser reads outside the buffer, integer overflow, huge allocation | One bounds-checked `Reader`; sizes validated before slicing; per-entry, per-IFD, per-segment, per-chunk caps; refusal by size before reading | `tests/jpeg|png|fuzz`, `docs/LIMITS.md` |
| Parser hangs or loops (IFD cycles, giant counts) | Visited-offset set for IFDs, caps, job timeout (30 s) that terminates the worker | unit + fuzz + `e2e/performance` cancel tests |
| Decompression bomb | PNG zTXt/iTXt/iCCP: `DecompressionStream` with a hard output cap and cancel, per-chunk and per-file budgets; the bomb fixture expands to 20 MiB and is cut at 256 KiB. **PDF streams are inflated inside pdf.js and are not capped by this tool**: they are bounded only by the file size limit, pdf.js `maxImageSize` and the 30 s job kill | `tests/png.test.ts` (PNG only) |
| ZIP/DOCX bombs, path traversal, lying sizes | Own bounded ZIP reader: entry cap, per-part and total inflate caps, declared sizes never trusted, nothing extracted to disk (names are only text), ZIP64 not followed | `tests/docx.test.ts` (200 MiB bomb read capped at 512 KiB) |
| Absurd image dimensions | Declared size above 36 Mpx (or 16384 per edge) is never decoded, previewed or copied | extreme-dimension fixtures, unit + e2e |
| Active content in a PDF | pdf.js with `isEvalSupported:false`, no XFA, no worker fetch; no viewer or scripting sandbox loaded; PDF only ever shown as a PNG bitmap | `tests/pdf.test.ts`, CSP exfiltration test |
| Active content in an image (SVG, HTML) | Detection by content; an SVG is not recognised and not rendered; preview uses `<img>` of a Blob whose MIME type we set | e2e unsupported test |
| XSS through metadata, file names, XMP, IPTC, PDF strings | Values are inserted only as text; control and bidi characters replaced; no `innerHTML`/`dangerouslySetInnerHTML` (source guard test); CSP forbids inline script and eval | `tests/audit.test.ts`, hostile fixtures in e2e |
| Hostile file name | Shown as text; download name rebuilt from a sanitised stem with a fixed suffix and detected extension | e2e hostile-name test |
| Exfiltration by the app or a dependency | CSP `connect-src 'none'` and `default-src 'none'` as headers (also on the worker script) block cross-origin connections and fetch/XHR/WebSocket/beacon. The CSP does **not** stop same-origin requests or navigation by itself, so source guard tests, a build audit, and browser tests asserting that every request after load is a body-less, query-less GET of a built static file carry that part. On a host that does not send the headers (including `vite dev`) the CSP protection is absent | `e2e/privacy.spec.ts`, `tests/audit.test.ts`, `scripts/audit-build.ts` |
| Stale or late worker result shown for the wrong file | Worker generation + job id check; worker terminated on cancel/reset/new file | `tests/client.test.ts`, e2e succession tests |
| Original modified | The app never writes to the file; the worker only reads; the copy is a new buffer; an in-memory hash check | transform tests, e2e hash check on disk |
| Misleading claim of safety | Wording rules, limitations shown with every result, copy status text, banned-phrase test | `docs/CLAIMS.md`, `tests/claims.test.ts` |
| Copy loses display-affecting data | Policy keeps ICC, colour and display chunks, JFIF/Adobe; picture data byte-identical; browser pixel comparison | verification checks |
| Memory exhaustion on small devices | Caps (48/64 MiB), single buffer, the worker is terminated to release memory | `e2e/performance.spec.ts` measures main-thread JS heap growth only; worker and buffer memory are not measured |
| Object URLs leak the file after reset | Registry revokes every URL; counted in e2e | `e2e/flows.spec.ts` |
| Vulnerable dependency | Two runtime code dependencies (preact, pdfjs-dist) plus bundled fonts; pinned lockfile; `npm audit` clean at the time of writing | `docs/DEPENDENCIES.md` |

## Residual risks (stated, not solved)

- A compromised host or build can serve different code. Verify the build you run (the acceptance guide
  shows how to inspect network activity) and prefer a host that sends the headers in `docs/DEPLOYMENT.md`.
- Browser engine bugs in image or PDF decoding are outside this tool's control; the browser decodes
  images for preview and comparison. Do not open files you are not entitled to inspect.
- Hidden information outside the decoded areas (pixels, steganography, vendor-specific blobs, earlier PDF
  revisions) is not found.
- A `<script>`-capable environment other than a normal browser tab (for example a file:// context without
  Web Crypto) may make the SHA-256 unavailable; the tool reports that.
