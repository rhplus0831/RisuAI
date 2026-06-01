# Full Bootstrap Resync Budget

Status: budget gate planned; diagnostic counters already exist.

## Source Anchors

- `src/ts/bootstrap.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `server/fastify/src/routes/bootstrap.ts`

## Scope

Treat full bootstrap fallback frequency as a protocol health signal. Phase 0
diagnostics already count reasons through `recordFullBootstrapResync()`; this
slice is for turning those counters into maintained expectations.

## Protocol Behavior

- Keep existing full-bootstrap fallback for replay miss, revision gap,
  projection full mode, projection error, and no baseline.
- Keep reason classification in client diagnostics.
- Add assertions or budgets only after expected baseline behavior is known.

## Done When

- Development diagnostics can distinguish expected from unexpected full resyncs.
- Tests cover each fallback reason without requiring network timing flakiness.
- Future frequency budgets can use the same counters; Phase 8 already covers
  payload, request-count, command-metric, and latest-verification gates.

## Validation

- `pnpm test -- src/ts/bootstrap.test.ts`
