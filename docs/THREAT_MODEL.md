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
| Decompression bomb (zTXt/iTXt/iCCP, PDF streams) | `DecompressionStream` with a hard output cap and cancel; per-chunk and per-file budgets; bomb fixture expands to 20 MiB and is cut at 256 KiB | `tests/png.test.ts` |
| Absurd image dimensions | Declared size above 36 Mpx (or 16384 per edge) is never decoded, previewed or copied | extreme-dimension fixtures, unit + e2e |
| Active content in a PDF | pdf.js with `isEvalSupported:false`, no XFA, no worker fetch; no viewer or scripting sandbox loaded; PDF only ever shown as a PNG bitmap | `tests/pdf.test.ts`, CSP exfiltration test |
| Active content in an image (SVG, HTML) | Detection by content; an SVG is not recognised and not rendered; preview uses `<img>` of a Blob whose MIME type we set | e2e unsupported test |
| XSS through metadata, file names, XMP, IPTC, PDF strings | Values are inserted only as text; control and bidi characters replaced; no `innerHTML`/`dangerouslySetInnerHTML` (source guard test); CSP forbids inline script and eval | `tests/audit.test.ts`, hostile fixtures in e2e |
| Hostile file name | Shown as text; download name rebuilt from a sanitised stem with a fixed suffix and detected extension | e2e hostile-name test |
| Exfiltration by the app or a dependency | CSP `connect-src 'none'`, `default-src 'none'` as headers (also on the worker script); source and build audits; requests recorded and asserted in the browser | `e2e/privacy.spec.ts` |
| Stale or late worker result shown for the wrong file | Worker generation + job id check; worker terminated on cancel/reset/new file | `tests/client.test.ts`, e2e succession tests |
| Original modified | The app never writes to the file; the worker only reads; the copy is a new buffer; an in-memory hash check | transform tests, e2e hash check on disk |
| Misleading claim of safety | Wording rules, limitations shown with every result, copy status text, banned-phrase test | `docs/CLAIMS.md`, `tests/claims.test.ts` |
| Copy loses display-affecting data | Policy keeps ICC, colour and display chunks, JFIF/Adobe; picture data byte-identical; browser pixel comparison | verification checks |
| Memory exhaustion on small devices | Caps (48/64 MiB), single buffer, no duplicate copies of the original in the main thread | `e2e/performance.spec.ts` (heap growth) |
| Object URLs leak the file after reset | Registry revokes every URL; counted in e2e | `e2e/flows.spec.ts` |
| Vulnerable dependency | Two runtime dependencies; pinned lockfile; `npm audit` clean at the time of writing | `docs/DEPENDENCIES.md` |

## Residual risks (stated, not solved)

- A compromised host or build can serve different code. Verify the build you run (the acceptance guide
  shows how to inspect network activity) and prefer a host that sends the headers in `docs/DEPLOYMENT.md`.
- Browser engine bugs in image or PDF decoding are outside this tool's control; the browser decodes
  images for preview and comparison. Do not open files you are not entitled to inspect.
- Hidden information outside the decoded areas (pixels, steganography, vendor-specific blobs, earlier PDF
  revisions) is not found.
- A `<script>`-capable environment other than a normal browser tab (for example a file:// context without
  Web Crypto) may make the SHA-256 unavailable; the tool reports that.
