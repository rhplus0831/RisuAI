# Full Bootstrap Resync Budget

Status: planned.

## Source Anchors

- `src/ts/bootstrap.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `server/fastify/src/routes/bootstrap.ts`

## Scope

Treat full bootstrap fallback frequency as a protocol health signal. Full
resync remains a necessary recovery path, but unexpected use should be visible
and eventually budgeted.

## Protocol Behavior

- Keep existing full-bootstrap fallback for replay miss, revision gap,
  projection full mode, projection error, and no baseline.
- Count and classify reasons in client diagnostics.
- Add assertions only after expected baseline behavior is known.

## Done When

- Development diagnostics can distinguish expected from unexpected full resyncs.
- Tests cover each fallback reason without requiring network timing flakiness.
- Later Phase 8 budgets can use the same counters.

## Validation

- `pnpm test -- src/ts/bootstrap.test.ts`
