# Phase 0: Baseline Foundations

Status: implemented foundation, maintain as code changes.

Goal: preserve the completed measurement, hydration bounds/aggregation, event
replay history, and route manifest work that later phases depend on.

## Source Anchors

- [`../../../AUDIT.md`](../../../AUDIT.md)
- [`../../../SERVER-AND-CLIENT-PROTOCOL.md`](../../../SERVER-AND-CLIENT-PROTOCOL.md)
- `server/fastify/src/protocolMetrics.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `server/fastify/src/routeManifest.ts`

## Slices

- [`protocol-metrics.md`](slices/phase-0-baseline-foundations/protocol-metrics.md)
- [`bounded-hydration.md`](slices/phase-0-baseline-foundations/bounded-hydration.md)
- [`durable-command-event-history.md`](slices/phase-0-baseline-foundations/durable-command-event-history.md)
- [`route-manifest-coverage.md`](slices/phase-0-baseline-foundations/route-manifest-coverage.md)

## Exit Criteria

- Instrumentation remains opt-in and cheap when disabled.
- Hydration remains bounded, deduped, or aggregated by a bulk route.
- Command-event replay remains SQLite-backed and retained by revision.
- New routes fail tests or audit when auth/writer decisions are missing.

## Validation

- `pnpm api:test`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- `pnpm client-thinning:audit`
