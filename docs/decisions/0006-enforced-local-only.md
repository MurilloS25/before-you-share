# Local-only is enforced by CSP and tested

- Status: accepted
- Date: 2026-10-05

## Context
A claim of local processing needs technical evidence, not copy.

## Decision
The page ships a CSP with default-src none, script-src self, connect-src none, worker-src self, img-src self blob data. Playwright records every request after load and fails on any other than the app's own static assets. A build audit script scans dist for URLs. Dependencies are listed with their network behaviour.

## Consequences
Any future feature that needs the network must change a test and this ADR. connect-src none also blocks the app from fetching its own assets after load, which is intended.

## Alternatives considered
Trusting code review alone (rejected).
