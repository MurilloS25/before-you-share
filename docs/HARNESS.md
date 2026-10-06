# Development harness

## Active components

- `AGENTS.md`: canonical cross-agent contract.
- `CLAUDE.md`: minimal Claude Code entry point.
- `.claude/skills/frontend-design`: audited Anthropic skill pinned to the
  reviewed commit.
- `product-researcher`: bounded, read-only investigation of file formats,
  metadata, browser APIs, parser libraries, privacy, security, and licensing.
- `change-reviewer`: focused, read-only review of completed work.
- `docs/plans/` and `docs/decisions/`: durable reasoning outside standing
  context.

## Working loop

Inspect first, research only real uncertainty, plan by format and trust
boundary, implement one synthetic-fixture vertical slice, verify parsing and
resource behavior before transformations, review the diff, and record only
decisions with lasting impact.

After updating Claude Code, prefer bundled `/run`, `/verify`, `/code-review`,
`/debug`, and `/security-review`. Once the application launches reliably, run
`/run-skill-generator` to capture the real startup recipe.

## Deliberately absent

- No upload, backend, database, authentication, analytics, advertising, or
  user tracking.
- No AI or external file-processing provider without a demonstrated product
  need and an explicit privacy decision.
- No malware, password recovery, steganography-detection, or certified
  forensics claims.
- No blanket promise to inspect or sanitize every structure in a format.
- No in-place file modification or deletion.
- No hooks until stable checks exist.
- No blanket permissions or write-capable research tools.
- No agent team at the current repository size.

Real install, run, test, lint, browser, parser, fixture, benchmark, and
verification commands do not exist yet. Do not invent them. Update this file
only after commands have been selected and executed successfully.
