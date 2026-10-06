# Privacy model

## What the tool does with a file

1. The browser gives the page a `File` handle. The first 1,032 bytes are read to identify the format.
2. If the size is within the limit, the rest is read into one buffer **inside a Web Worker**.
3. Analysis produces findings. They exist only in memory of this tab.
4. If you ask for a copy, a new buffer is built in the worker and handed to the page as a Blob.
5. Nothing is saved until you press Download, which saves a new file you choose to keep.
6. "Clear and start over", a new file, cancel, or closing the tab terminates the worker and revokes
   every object URL.

## What it never does

- Upload, post, beacon or otherwise transmit any byte, name, hash, metadata value or result.
- Store anything: no localStorage, sessionStorage, IndexedDB, Cache API, cookies or service workers.
- Log: no console output, no analytics, no telemetry, no error reporting service. Error messages are
  fixed strings and never include file-derived text.
- Use a backend, database, account, AI service or any third-party runtime resource (fonts are bundled).

## Technical evidence (re-run it yourself)

| Claim | How it is enforced | How to see it |
| --- | --- | --- |
| No request after the app loads except its own static files | `Content-Security-Policy: default-src 'none'; connect-src 'none'; script-src 'self'; worker-src 'self'; img-src 'self' blob:; font-src 'self'; style-src 'self'; frame-ancestors 'none'` sent as a header on every response including the worker script | `npm run test:e2e` (`e2e/privacy.spec.ts`), or the browser's Network panel |
| A page-level fetch, beacon, WebSocket, remote image, iframe or eval is blocked | Same CSP; reported violations asserted | privacy e2e test |
| Flows work with every non-own request aborted | Playwright routes abort anything except built assets | privacy e2e test |
| No file-derived data in any request | All post-load requests are `GET` of built assets with no body or query; asserted | privacy e2e test |
| No storage | Asserted empty after use | privacy e2e test |
| No endpoints in the build | `scripts/audit-build.ts` scans every chunk; every URL must match an allowlist with a reason; first-party chunks may not contain `fetch`, XHR, WebSocket, beacon, EventSource | `npm run audit:build` |
| No network or storage APIs in first-party source | `tests/audit.test.ts` | `npm test` |
| PDF library cannot fetch | Run in-thread with `useWorkerFetch:false`, data input only, `connect-src 'none'` | pdf test stubs `fetch` and XHR and asserts they are never called |

The PDF library's bundle still contains network loader code (it is a general PDF viewer library). It is
unreachable for in-memory input and blocked by the CSP; the audit lists it explicitly.

## What the browser itself may do

Your browser can keep downloaded copies in its downloads list, and may keep the page's static files in
its HTTP cache. Neither contains the file you inspected unless you download a copy. Browser extensions
can read page content; use a clean profile for sensitive files.

## Not a guarantee

Local processing protects the file from this tool's authors and from the network. It does not make a
copy anonymous, and it does not remove information the tool cannot read. See `docs/LIMITATIONS.md`.
