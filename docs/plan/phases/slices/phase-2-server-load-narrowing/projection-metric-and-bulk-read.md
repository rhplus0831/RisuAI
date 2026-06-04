# Projection Metric & Bulk Read

Status: DONE (`b2765994`). Phase 2. Covers M5, L10, U1.

## Landed Shape

- M5: `emitProtocolMetric` accepts `fields` as a thunk evaluated only after
  the `protocolMetricsEnabled()` guard; the projection (`emitProjectionMetric`)
  and bootstrap call sites pass thunks, so `jsonPayloadBytes` no longer
  re-serializes every response in the default metrics-off config. The five
  test mocks of `emitProtocolMetric` evaluate function fields the same way.
- L10: the SSE route calls `listPersistedCommandEventHistory` only when a
  replay cursor was sent — or when metrics are on, keeping the replay metric's
  `oldestRevision`/`latestRevision` fidelity. A fresh default-config connect
  performs zero corpus reads.
- U1: `loadChatHydrations` / `loadCharacterLorebookHydrations` resolve known
  ids and the legacy embedded-message fallback from the REQUESTED rows
  (`WHERE id IN`, chunked, via `getChatRowsByIds` / `getCharacterRowsByIds`).
  `sqliteIsCharacterAuthority` gates the scoped path to exactly the states the
  broad walk would have served from the tables (settings present, characters
  extracted; chats are FK-tied to characters) — a pre-extraction
  embedded-characters database keeps the broad `loadPersisted` fallback, so
  `missing`/payload semantics are identical. A genuinely unknown id resolves
  to `missing` without the broad walk. `command_events` joined the load-count
  harness corpus tables (prune's revision-only walk stays unflagged).
- Regressions: `server/fastify/__tests__/serverLoadCostHarness.test.ts` M5
  (thunk laziness unit + exact +1-serialization on/off accounting for
  projection and bootstrap), L10 (scoped fresh connect; replay and metrics-on
  controls still read history), U1 (scoped bulk routes incl. missing ids,
  per-row payload equivalence vs the single hydration routes, legacy
  embedded-row fallback now scoped, pre-extraction broad fallback kept).

## Scope

Three independent read-side narrowings:
- M5: `jsonPayloadBytes(response)` eagerly stringifies projection/bootstrap
  responses even when `RISU_PROTOCOL_METRICS` is off.
- L10: every SSE connection loads + maps the full command-event history even when
  no replay is requested.
- U1: bulk hydration calls full `loadPersisted` just to compute known ids.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M5, L10, U1.
- `server/fastify/src/protocolMetrics.ts:18` (`jsonPayloadBytes`), `:26-38`
  (`emitProtocolMetric` enabled-guard), `server/fastify/src/routes/projection.ts:555`
  (`emitProjectionMetric`), `server/fastify/src/routes/bootstrap.ts:45`.
- `server/fastify/src/routes/events.ts:76`, `server/fastify/src/commands/events.ts:115`
  (`listPersistedCommandEventHistory`).
- `server/fastify/src/repository.ts:1086` (`loadChatHydrations`), `:1150`
  (`loadCharacterLorebookHydrations`).

## Planned Shape

- M5: pass expensive metric fields as thunks, or guard before calling
  `jsonPayloadBytes`.
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

- [x] M5: `jsonPayloadBytes` does not run when `RISU_PROTOCOL_METRICS` is off
      (`M5: projection and bootstrap responses are serialized once when
      metrics are off` — exact on/off accounting).
- [x] L10: no command-event history load on a fresh (no-replay) SSE connect
      (`L10: a fresh (no-replay) SSE connect performs zero command-event
      history reads`).
- [x] U1 (taken): bulk hydration resolves known ids without a full
      `loadPersisted` (`U1: bulk chat hydration performs zero whole-corpus
      payload reads, missing ids included`).
- [x] Gates `M5`, `L10`, `U1` registered in Phase 8
      (`fixCompletenessGate.test.ts`).

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/events.test.ts`.
- `pnpm api:test`, both TypeScript checks.
