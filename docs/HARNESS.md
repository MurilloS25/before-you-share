# Development harness

## Active components

- `AGENTS.md`: canonical cross-agent contract. `CLAUDE.md`: minimal Claude Code entry point.
- `.claude/skills/frontend-design`: audited Anthropic skill pinned to the reviewed commit.
- `product-researcher`: bounded, read-only investigation. `change-reviewer`: focused, read-only review.
- `docs/plans/` and `docs/decisions/`: durable reasoning outside standing context.

## Commands

Every command below was run successfully on Node 22.19 / npm 10.9 on Windows. E2E uses the installed
Microsoft Edge (`channel: 'msedge'`); no browser is downloaded. Set `E2E_CHANNEL=` (empty) to use
Playwright's own Chromium if you have installed it.

| Command | What it does | What it proves |
| --- | --- | --- |
| `npm ci` | Install exact dependencies | Lockfile is consistent |
| `npm run typecheck` | `tsc --noEmit`, strict | Types, including tests and e2e |
| `npm test` | Vitest: parsers, transforms, PDF, worker client, UI components, source guard rails | Behaviour of every unit in Node/jsdom |
| `npm run test:fuzz` | fast-check property and mutation tests. `FC_SEED=n FC_RUNS=n` to explore | Parsers never throw, hang or point evidence outside the file |
| `npm run fixtures` / `npm run fixtures:check` | Regenerate / verify the synthetic fixtures byte for byte | Fixtures are reproducible |
| `npm run build` | Typecheck then `vite build` into `dist/` | The static app builds |
| `npm run audit:build` | Scan `dist/` for URLs, inline code, forbidden APIs, bundle budgets | No unexpected endpoint; PDF tooling is lazy and worker-only |
| `npm run preview` | Serve `dist/` on 127.0.0.1:4173 with the security headers | The artefact tested and shown in acceptance |
| `npm run test:e2e` | Playwright against the production build (builds first) | Flows, accessibility (axe), privacy (network and CSP), performance, and the results flow (simple result, one-click copy, options panel, closed technical report, page heights, Show more, 320/390/1440 px, 200% text, reduced motion) |
| `npm run check` | typecheck, `npm test`, `fixtures:check` | Fast pre-commit gate |

## Working loop

Inspect first, research only real uncertainty, plan by format and trust boundary, implement one
synthetic-fixture vertical slice, verify parsing and resource behaviour before transformations, review
the diff, and record only decisions with lasting impact.

Run before every push: `npm run check`, `npm run test:fuzz`, `npm run build`, `npm run audit:build`,
`npm run test:e2e`.

## Deliberately absent

- No upload, backend, database, authentication, analytics, advertising, or user tracking.
- No AI or external file-processing provider.
- No malware, password recovery, steganography-detection, or certified forensics claims.
- No blanket promise to inspect or sanitize every structure in a format.
- No in-place file modification or deletion.
- No hooks and no blanket permissions.
