# Before You Share agent guide

## Mission

Build an experimental, local-first tool that helps people understand what a
file may reveal before they share it. Prefer verifiable evidence, plain
explanations, and preservation of the original over broad format claims or a
false promise of perfect sanitization.

## Canonical sources

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/HARNESS.md`, the active plan,
and the closest executable schemas and tests before non-trivial work. If
documentation and behavior disagree, identify the conflict and update the
stale source when appropriate.

## Product invariants

- File contents remain on the device unless a later, explicit product decision
  introduces a clearly disclosed boundary. The initial product has no such
  boundary.
- Never modify, move, rename, or delete the original file.
- A sanitized artifact is always a separately downloaded experimental copy.
- Do not promise that inspection or sanitization is complete. State format,
  parser, browser, and round-trip limitations in context.
- Every finding identifies its evidence source and whether it is verified,
  inferred, suspicious, unsupported, or unavailable.
- Do not collapse findings into a fear-based privacy score.
- Treat names, paths, metadata, previews, embedded content, compressed data,
  parser output, and generated copies as untrusted.
- Identify file type from content where practical; never trust an extension or
  declared MIME type alone.
- Bound file size, memory, time, recursion, decompression, entry counts, page
  counts, dimensions, and generated output.
- No analytics, telemetry, accounts, database, remote persistence, ads, or
  automatic sharing.
- Do not introduce a paid service or a path to automatic charges.
- The tool is not antivirus, digital forensics certification, legal advice, or
  a guarantee of anonymity.

## Intended repository shape

Start with the smallest architecture justified by the approved plan. A likely
first slice is a static-capable web application using browser file APIs,
isolated workers, and pure format-specific analysis modules. Do not create a
backend, database, authentication system, AI boundary, or empty package merely
to match a template.

Potential areas, only when earned by implementation:

- `apps/web`: intake, local inspection, evidence, explanation, preview, and
  copy-verification experience.
- `packages/formats`: bounded parsers or adapters when isolation and testing
  justify a package.
- `fixtures`: synthetic, generated, or explicitly redistributable files with
  known metadata and corruption cases.
- `docs`: format support, architecture, threat model, decisions, and plans.

## Engineering rules

- Separate intake, type detection, parsing, normalized findings, explanation,
  transformation, output verification, and presentation.
- Prefer browser-native capabilities and small audited libraries. Use WASM
  only when it provides a measured correctness, format, or performance benefit.
- Move expensive or failure-prone processing off the main thread and make it
  cancellable.
- Use streaming or bounded slices when whole-file buffering is unnecessary.
- Never render active file content directly into the application origin.
  Previews require inert representations or an appropriately isolated sandbox.
- Reject archive bombs, oversized dimensions, excessive object counts,
  recursive containers, malformed offsets, integer overflows, and unexpected
  parser output.
- Hashes establish file identity, not safety. Label them accordingly.
- A transformation must have deterministic fixtures, an explicit mutation
  report, and round-trip checks before it is exposed to users.
- Preserve unsupported structures by default or refuse the transformation;
  do not silently discard content.
- Do not log filenames, metadata values, extracted text, hashes, paths, or file
  contents.
- Keep UI language factual and calm. Explain uncertainty and give a concrete
  next action.

## Workflow

1. Inspect documentation, format boundaries, trust boundaries, and fixtures.
2. Research real uncertainty using primary format specifications, browser
   documentation, and maintained library sources.
3. For multi-boundary work, create a plan under `docs/plans/` with explicit
   format and safety gates.
4. Implement the smallest end-to-end format slice with synthetic fixtures.
5. Test parsing separately from explanation and transformation.
6. Measure memory, time, cancellation, responsiveness, and output integrity.
7. Review the diff for parser safety, privacy leakage, active content,
   unsupported claims, accessibility, resource exhaustion, and silent loss.
8. Record durable format, sandbox, storage, and transformation decisions under
   `docs/decisions/`.

Until scaffolding provides real commands, do not invent them. Update
`docs/HARNESS.md` only after commands are selected and run successfully.

## Definition of done

A change is complete when the original remains untouched, evidence is
traceable, unsupported content is disclosed, resource limits and cancellation
are tested, generated copies have integrity evidence, no file data leaves the
device, accessibility is verified proportionately, documentation is current,
and the final report lists only checks actually run.
