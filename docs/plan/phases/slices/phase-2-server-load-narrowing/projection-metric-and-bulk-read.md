# Projection Metric & Bulk Read

Status: not started. Phase 2. Covers M5, L10, U1 — cheap read-side wins.

## Scope

Three independent narrowings on the read path:
- M5: `jsonPayloadBytes(response)` runs a full `JSON.stringify` of every
  projection/bootstrap response even when `RISU_PROTOCOL_METRICS` is off, because
  the metric helper's argument is evaluated eagerly before the enabled-guard.
- L10: every SSE connection loads + maps the full command-event history even when
  no replay is requested.
- U1: bulk chat/lorebook hydration calls full `loadPersisted` just to compute
  `knownChatIds` even for a small id set.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M5**, **L10**, **U1**.
- `server/fastify/src/protocolMetrics.ts:18` (`jsonPayloadBytes`), `:26-38`
  (`emitProtocolMetric` enabled-guard), `server/fastify/src/routes/projection.ts:555`
  (`emitProjectionMetric`), `server/fastify/src/routes/bootstrap.ts:45`.
- `server/fastify/src/routes/events.ts:76`, `server/fastify/src/commands/events.ts:115`
  (`listPersistedCommandEventHistory`).
- `server/fastify/src/repository.ts:1086` (`loadChatHydrations`), `:1150`
  (`loadCharacterLorebookHydrations`).

## Planned Shape

- M5: have `emitProtocolMetric` accept a thunk for expensive fields and invoke it
  only after `protocolMetricsEnabled()`; or guard the
  `emitProjectionMetric`/bootstrap metric block with `protocolMetricsEnabled()`
  before calling `jsonPayloadBytes`.
- L10: load command-event history only when `sinceRevision`/`Last-Event-ID`
  requests replay.
- U1: resolve `knownChatIds`/`knownCharacterIds` via a targeted
  `SELECT id ... WHERE id IN (...)` and read row `data_json` only for ids with
  zero message rows (keep the defensive embedded fallback per-missing-id). Low
  payoff (callers already pass the whole corpus) — only if cheap.

## Behavior / Invariants

- Metric output is identical when metrics are on; responses are unchanged.
- SSE replay behavior is unchanged when replay *is* requested.
- Bulk hydration results (and the not-yet-extracted embedded fallback) are
  unchanged.

## Done Criteria

- M5: `jsonPayloadBytes` does not run when `RISU_PROTOCOL_METRICS` is off (spy/
  count test).
- L10: no command-event history load on a fresh (no-replay) SSE connect.
- U1 (if taken): bulk hydration resolves known ids without a full `loadPersisted`.
- Gates `M5`, `L10` (and `U1` if implemented) registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/events.test.ts`.
- `pnpm api:test`, both TypeScript checks.
