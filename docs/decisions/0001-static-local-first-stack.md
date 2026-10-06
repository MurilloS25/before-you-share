# Static, local-first stack: Vite, Preact, TypeScript

- Status: accepted
- Date: 2026-10-05

## Context
The product invariant forbids uploads, accounts and backends. A static build can be hosted anywhere and is easy to audit for network endpoints. The UI has many states (idle, reading, results, copy, verification, errors) that benefit from a small component model, and component tests are required.

## Decision
Vite builds a static site. Preact (about 4 KB) renders the UI. TypeScript strict mode types the findings model. No server, database, SSR or router. Vitest, Testing Library and Playwright test it.

## Consequences
Small dependency surface and an output that is plain files. Preact is less common than React but API compatible for what is used. Hosting must send a CSP header (see ADR 0006).

## Alternatives considered
Vanilla DOM (more code for stateful UI), React (larger, no benefit here), Next.js/SvelteKit (server-capable frameworks added by habit, rejected).
