# Protocol Metrics

Status: implemented foundation.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `server/fastify/src/commands/mutations.ts`
- `src/ts/bootstrap.ts`

## Scope

Keep server protocol metrics opt-in through `RISU_PROTOCOL_METRICS` and browser
diagnostics opt-in through `localStorage.risu:protocol-debug`. Existing coverage
should continue to distinguish command mutation timing, projection payload
sizes, event replay status, full-bootstrap reasons, hydration fanout, and stale
hydration drops.

## Done When

- Metrics stay disabled by default.
- Command mutation logs include `loadMs`, `cloneMutateMs`, `sqliteSyncMs`,
  `dbJsonWriteMs`, and `totalMs`.
- Client diagnostics identify normal replay versus each full-bootstrap fallback
  reason.

## Validation

- `pnpm api:test`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
