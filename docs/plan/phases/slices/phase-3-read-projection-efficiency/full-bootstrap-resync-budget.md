# Full Bootstrap Resync Budget

Status: implemented on 2026-06-02.

## Source Anchors

- `src/ts/bootstrap.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `server/fastify/src/routes/bootstrap.ts`

## Scope

Treat full bootstrap fallback frequency as a protocol health signal. Phase 0
diagnostics count reasons through `recordFullBootstrapResync()`; this slice
turns those counters into maintained expectations for the expected fallback
reasons.

## Current Behavior

- `recordFullBootstrapResync()` records every full-resync reason and separates
  unexpected reason strings into `unexpectedFullBootstrapResync`.
- The expected reason vocabulary is:
  `event-replay-unavailable`, `no-baseline`, `projection-error`,
  `projection-full-mode`, and `revision-gap`.
- Bootstrap regression tests assert that each expected fallback path increments
  the matching reason without increasing the unexpected counter.

## Protocol Behavior

- Existing full-bootstrap fallback remains in place for replay miss, revision gap,
  projection full mode, projection error, and no baseline.
- Reason classification is explicit in client diagnostics.
- The current budget is reason-shape coverage, not a strict runtime frequency
  threshold; future frequency budgets can build on the same counters.

## Done When

- Development diagnostics can distinguish expected from unexpected full resyncs.
- Tests cover each fallback reason without requiring network timing flakiness.
- Future frequency budgets can use the same counters; Phase 8 already covers
  payload, request-count, command-metric, and latest-verification gates.

## Validation

- 2026-06-02: `pnpm test -- src/ts/bootstrap.test.ts` passed. The configured
  client Vitest run reported 99 files, 940 passed tests, and 4 skipped tests.
