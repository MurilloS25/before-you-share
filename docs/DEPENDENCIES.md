# Dependencies

Runtime (shipped in the build):

| Package | Version | Licence | Why | Network behaviour |
| --- | --- | --- | --- | --- |
| `preact` | 10.29.8 | MIT | Small UI runtime (about 4 KB). Version 10 because the component-testing library targets it (effects did not clean up under 11 in tests) | None |
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | Parsing PDFs correctly is far beyond this project. Legacy build because the modern build needs `Promise.try` | Contains URL-loading code that is unreachable for in-memory data and blocked by the CSP; loaded only when a PDF is opened, inside the worker |
| `@fontsource/source-serif-4`, `@fontsource/barlow-semi-condensed` | 5.3.0 | OFL-1.1 | Typefaces, bundled as woff2 (latin subset) so no font CDN is used | None (files copied into the build) |

Development only: `vite`, `typescript`, `vitest`, `jsdom`, `@testing-library/preact`, `@testing-library/dom`,
`fast-check`, `tsx`, `jpeg-js` (BSD-3-Clause, used only to generate fixtures), `@types/node`,
`@playwright/test` (Apache-2.0), `@axe-core/playwright` (MPL-2.0, test-only, never shipped).

Maintenance and vulnerabilities: `npm audit` reported 0 vulnerabilities for production and development
dependencies when this was written. CVE-2024-4367 (pdf.js, arbitrary JavaScript via font handling) is
fixed in 4.2.67 and later; the app also sets `isEvalSupported:false`.

Rejected: EXIF/metadata libraries (ADR 0002), WebAssembly tools (ADR 0007), fonts from a CDN, any
analytics or error-reporting package, any UI kit.

No package here introduces a paid service or a path to automatic charges.
