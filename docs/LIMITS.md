# Limits

All limits live in `src/core/limits.ts`. Changing one is a product decision: update this table and the tests.

| Limit | Value | Behaviour when exceeded |
| --- | --- | --- |
| Any file | 64 MiB | Refused on the page before any read |
| JPEG, PNG | 48 MiB | Refused in the worker after reading only the first bytes |
| PDF | 64 MiB | Same |
| Empty file | 0 bytes | Refused with an explanation |
| Decode ceiling | 36 Mpx and 16,384 px per edge | No preview, no decode, no copy (declared size is read from the header) |
| Exact pixel comparison | 16 Mpx | Comparison reported as skipped (never as passed) |
| JPEG segments | 4,096 | Walk stops, finding added, copy refused |
| PNG chunks | 20,000 | Same |
| EXIF | 512 entries per IFD, 12 IFDs, 1 MiB per value, IFD cycles detected | Remaining parts reported as malformed |
| IPTC datasets | 256 | Stops |
| XMP packet | 1 MiB | Truncated read |
| ICC profile | 4 MiB assembled | Stops collecting |
| Inflate (PNG text, ICC) | 256 KiB per chunk, 2 MiB per file | Output cut; finding marked suspicious with a bomb warning |
| Displayed value | 400 characters | Truncated with a note; control and bidi characters replaced |
| Findings | 600 (+100 reserved for structural findings) | Notice that the list stops. A copy is verified against the capped lists, so a file with more findings can fail verification (fail-safe: download is disabled) |
| PDF pages inspected | 200 | `pdf.limit` finding; counts stay correct |
| PDF image size | 16 Mpx | pdf.js `maxImageSize` |
| DOCX file | 32 MiB (a larger ZIP is not examined and stays an unsupported container) | Refused or treated as unsupported |
| ZIP entries | 2,000 | Listing stops; finding added |
| ZIP part read | 512 KiB per part, 6 MiB in total after decompression | Output cut; the rest is not read |
| ZIP declared size | Flagged above 512 MiB declared or a 1000:1 ratio | Finding only; nothing is expanded beyond the part cap |
| Job time | 30 s | Worker terminated, structured timeout error |
| Concurrency | 1 job (structural, in `worker/client.ts`) | A new file supersedes the old job |

Measured in desktop Edge on the development machine (one run of `e2e/performance.spec.ts`; numbers vary by machine and are
printed as a `PERF` line by that test):

| Measurement | Result |
| --- | --- |
| Cancel clicked during a slow inspection, until the start screen is back | 52 ms |
| Longest main-thread stall while a 50 MiB slow PDF was being inspected in the worker | 4 ms |
| 40 MiB PNG (one unknown chunk of random data) inspected, from choosing the file to the result | 1,119 ms |
| 40 MiB JPEG made of 620 comment segments inspected (finding cap reached) | 913 ms |
| Longest main-thread stall while drawing 600 findings after that JPEG | 531 ms |
| Typical fixtures (kitchen-sink JPEG, kitchen-sink PNG, XMP PDF) | 210 ms, 63 ms, 217 ms |
| Copy of a 30 MiB PNG built and verified | 994 ms |
| Main-thread JS heap growth after three copy and reset cycles (worker and buffer memory are not measured) | 1 MiB |
