# Architecture boundary

## Product boundary

Before You Share inspects a user-selected file locally and explains information
that may not be obvious from its ordinary visible content. A later, explicitly
gated capability may create a separate sanitized copy for selected supported
formats and verify what changed.

It is an educational and experimental privacy tool. It is not malware
scanning, legal or compliance advice, certified digital forensics, evidence
preservation, password recovery, or a guarantee that a file is anonymous or
safe.

## Core interaction contract

1. Explain local processing before selection.
2. Let the user choose a file without uploading it.
3. Identify the format from bounded file evidence, not extension alone.
4. Display visible identity separately from hidden or structural findings.
5. Explain each finding, its evidence, its confidence, and why it may matter.
6. Clearly disclose unsupported regions or incomplete analysis.
7. If sanitization is supported, describe the exact transformation before it
   runs and generate a distinct copy.
8. Reinspect the generated copy and compare it with the original.
9. Remind the user to open and verify the copy before sharing it.
10. Provide an obvious reset that releases references and clears local state.

## Trust boundaries

- The selected file, its name, declared type, structure, metadata, embedded
  content, previews, and parser results are untrusted.
- Complex parsers can fail, hang, allocate excessively, or interpret active
  content. They require isolation, limits, cancellation, and adversarial
  fixtures.
- Browser memory and local storage remain privacy boundaries. Persistence must
  be opt-in, minimal, documented, and erasable if introduced at all.
- Downloads cross back to the user's filesystem. A generated copy may be
  incomplete or incompatible and must never replace the original.
- Third-party code runs in the application's trust boundary. Dependencies need
  maintenance, licensing, bundle, and security review.
- A network request containing file-derived data would violate the initial
  product boundary.

## Provisional component boundaries

These boundaries are candidates for the first plan, not approved stack choices:

1. **Intake and fingerprinting** - bounded reads, format signatures, size, and
   optional local cryptographic hashes described only as identifiers.
2. **Worker coordinator** - jobs, progress, cancellation, timeouts, memory and
   concurrency budgets, and structured errors.
3. **Format adapters** - narrow parsers that return normalized findings and
   explicit coverage instead of UI markup.
4. **Finding model** - category, value presentation, source location, evidence
   status, privacy explanation, and remediation availability.
5. **Safe preview** - inert, generated representations or isolated rendering;
   never active file content in the application origin.
6. **Transformation engine** - allowlisted operations for explicitly supported
   formats, separate-copy output, and a mutation manifest.
7. **Verifier** - reparse output, compare declared removals, check basic
   usability signals, and surface remaining or unsupported structures.
8. **Presentation** - calm explanations, accessible evidence, limitations,
   local-processing status, and reset/download controls.

## Architecture constraints

- Essential analysis operates without a backend, account, provider, or
  network connection after application assets load.
- Avoid retaining file bytes longer than the active session requires.
- Do not persist original files or generated copies in browser storage by
  default.
- Prefer synthetic fixtures containing deliberate metadata over personal or
  real-world documents.
- Parsing and transformation modules expose explicit format/version coverage.
- Sanitization does not enter the MVP for a format until round-trip integrity,
  unsupported-content behavior, and failure recovery are defined and tested.
- A static deployment should be possible unless evidence establishes a need
  for a server boundary.

## Decisions requiring evidence

- Initial supported formats and whether the first release inspects only or
  also sanitizes them.
- Exact metadata categories and evidence representation.
- Browser-native parsing versus audited JavaScript or WASM libraries.
- Worker, streaming, memory, timeout, and cancellation budgets.
- Safe preview strategy for each supported format.
- Definition and limits of round-trip integrity.
- Whether OPFS or any persistence adds user value without increasing risk.
- Browser support, mobile behavior, and large-file degradation.
- Deployment and CSP requirements for a fully local-processing application.

No library, file format, transformation, or browser API is approved merely by
appearing in this document. The first reviewed plan must resolve or explicitly
defer it.
