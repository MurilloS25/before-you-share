# One analysis worker, ended by termination

- Status: accepted
- Date: 2026-10-05

## Context
Parsers can hang or allocate heavily. Cooperative cancellation inside synchronous parsing is unreliable.

## Decision
All parsing and transformation run in one dedicated worker that keeps the current file in memory. Cancel, timeout, supersede and reset terminate it. Every message carries a job id and worker generation and stale messages are dropped.

## Consequences
Cancellation is certain and memory is released. A transform after a cancel needs the file chosen again. Concurrency is exactly one.

## Alternatives considered
Cooperative abort flags (can be ignored by a stuck parser), a worker pool (no benefit at one file at a time).
