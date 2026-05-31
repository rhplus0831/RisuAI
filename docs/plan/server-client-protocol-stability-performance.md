# Server/Client Protocol Stability And Performance Plan

Date: 2026-05-31

Status: verified planning document.

Source audit:

- Primary audit: `docs/SERVER-AND-CLIENT-PROTOCOL.md`.
- Structure map: `STRUCTURE.md`, `docs/structure/backend.md`,
  `docs/structure/frontend.md`, and `docs/structure/data-and-events.md`.
- Follow-up tracker: `docs/leftover.md`.
- Source verification was done against the current tree on 2026-05-31.

## Scope

This plan covers practical improvements to the Fastify server and Svelte client
protocol. It does not replace the current protocol: the server remains the
durable owner of state, the browser receives a projected database, commands use
`baseRevision`, and command events remain the projection invalidation layer.

The priority is to reduce full-bootstrap fallbacks, avoid bursty client/server
work, make manual protocol coverage harder to drift, and add enough measurement
to prove whether later changes help.

## Verification Matrix

| Recommendation                           | Current source check                                                                                                                                                                                                               | Result                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Add protocol observability first         | There is no dedicated protocol telemetry around command latency, projection fallback reason, hydration fanout, replay misses, or generation persistence failure. `rg` only finds scattered ad hoc performance logs and tests.      | Valid. Add lightweight logs/counters before deeper performance work.             |
| Bound bulk hydration concurrency         | `ensureAllCharacterLorebooksHydrated()` and `ensureAllChatsHydrated()` call unbounded `Promise.all(ids.map(...))` in `src/ts/server/chatMessageHydration.svelte.ts`.                                                               | Valid and low risk.                                                              |
| Persist command-event replay history     | Command replay uses `InMemoryCommandEventSink` with `COMMAND_EVENT_HISTORY_LIMIT = 1000` in `server/fastify/src/commands/events.ts`; `/api/v1/events` returns `409 event_replay_unavailable` when history cannot cover the cursor. | Valid. Useful for restart and long-disconnect recovery.                          |
| Reduce command mutation full-object cost | `applyJsonCommandMutation()` loads hydrated state, JSON-clones it, mutates, syncs chat rows, strips messages, writes `db.json`, and emits an event.                                                                                | Valid, but must be incremental because this path protects consistency.           |
| Make active-writer coverage less manual  | `isServerOwnedMutation()` in `server/fastify/src/activeWriter.ts` is hand-maintained and duplicated conceptually by `MUTATING_ROUTE_RULES` in `util/client-thinning-audit.ts`.                                                     | Valid. Drift is already recognized in docs and tests.                            |
| Narrow projection refreshes              | `RESOURCE_PROJECTION_FIELDS` maps `message` and `generation` to the full `characters` field, and the route loads a full stub projection before selecting fields.                                                                   | Valid. High impact for large character/chat sets.                                |
| Harden durable generation persistence    | `GenerationJobRegistry` is explicitly in-memory only; durable generation handles browser disconnects but not server restarts. `docs/leftover.md` already records restart survival as Milestone 2.                                  | Valid, but lower priority unless restart survival becomes a product requirement. |
| Reduce media/base64 memory pressure      | `resolveStoredAsset()` reads full asset bytes and base64-encodes them for chat generation; Realm staged assets are read fully before hashing/write.                                                                                | Valid, but secondary to replay/projection/hydration work.                        |
| Make rate limits explicit                | `@fastify/rate-limit` is registered with `global: false`, so the configured max is not a default global throttle.                                                                                                                  | Valid. Route-level limits should avoid SSE/WebSocket routes.                     |

## Invariants

- Preserve `baseRevision` conflict behavior and one revision bump per committed
  command.
- Preserve `BEGIN IMMEDIATE` serialization for revision-tracked commands.
- Emit one command event for every revision-tracked projected mutation.
- Keep `db.json` writes behind SQLite commits, not ahead of them.
- Keep Fastify route auth explicit with `requireAuth()` decisions.
- Keep server-owned mutating routes active-writer classified and covered by
  `pnpm client-thinning:audit`.
- Keep bootstrap and targeted projection message-free; hydrate chat messages via
  `GET /api/v1/projection/chatMessages?id=...`.
- Treat `docs/structure/*` and `docs/SERVER-AND-CLIENT-PROTOCOL.md` as
  present-tense references; archive docs are historical unless cited by present
  docs.

## Phase Slice Index

Each phase has a dedicated slice document with implementation slices,
acceptance checks, and validation commands.

| Phase   | Slice document                                                                                              | Goal                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Phase 0 | [`phase-0-protocol-measurement.md`](slices/phase-0-protocol-measurement.md)                                 | Make existing pressure points visible before changing behavior.                         |
| Phase 1 | [`phase-1-bound-bulk-hydration.md`](slices/phase-1-bound-bulk-hydration.md)                                 | Prevent unbounded projection requests during bulk hydration flows.                      |
| Phase 2 | [`phase-2-durable-command-event-replay.md`](slices/phase-2-durable-command-event-replay.md)                 | Avoid full bootstrap after restart or long disconnect when stored events cover the gap. |
| Phase 3 | [`phase-3-route-and-protocol-coverage-manifest.md`](slices/phase-3-route-and-protocol-coverage-manifest.md) | Reduce drift between route registration, writer classification, tests, and audit rules. |
| Phase 4 | [`phase-4-narrow-projection-refreshes.md`](slices/phase-4-narrow-projection-refreshes.md)                   | Reduce projected data shipped after message and generation events.                      |
| Phase 5 | [`phase-5-command-mutation-cost-reduction.md`](slices/phase-5-command-mutation-cost-reduction.md)           | Reduce command latency without weakening the command transaction contract.              |
| Phase 6 | [`phase-6-durable-generation-persistence-queue.md`](slices/phase-6-durable-generation-persistence-queue.md) | Retry final result persistence after transient failures.                                |
| Phase 7 | [`phase-7-media-and-import-memory-pressure.md`](slices/phase-7-media-and-import-memory-pressure.md)         | Reduce peak memory and repeated base64 work for large assets.                           |
| Phase 8 | [`phase-8-explicit-route-rate-limits.md`](slices/phase-8-explicit-route-rate-limits.md)                     | Add operational protection without breaking long-lived protocol streams.                |

## Phase 0: Protocol Measurement

Slice doc: [`slices/phase-0-protocol-measurement.md`](slices/phase-0-protocol-measurement.md)

Goal: make the existing pressure points visible before changing behavior.

Implementation slices:

- Server protocol timing and payload metrics.
- Client resync, hydration, and stale-response diagnostics.
- Manual readout and focused test validation.

## Phase 1: Bound Bulk Hydration

Slice doc: [`slices/phase-1-bound-bulk-hydration.md`](slices/phase-1-bound-bulk-hydration.md)

Goal: prevent export/tokenizer/cold-storage flows from opening an unbounded
number of projection requests.

Implementation slices:

- Bounded-concurrency helper and tuning constant.
- Chat hydration fanout conversion.
- Character lorebook hydration fanout conversion.
- Concurrency, dedupe, and stale-response tests.

## Phase 2: Durable Command Event Replay

Slice doc: [`slices/phase-2-durable-command-event-replay.md`](slices/phase-2-durable-command-event-replay.md)

Goal: avoid full bootstrap after server restart or long disconnect when the
revision gap is covered by stored command events.

Implementation slices:

- SQLite command-event history schema and repository.
- Transactional event persistence in the command path.
- Replay selection from persisted history with pruning.
- Restart, too-old cursor, and cursor-ahead tests.

## Phase 3: Route And Protocol Coverage Manifest

Slice doc: [`slices/phase-3-route-and-protocol-coverage-manifest.md`](slices/phase-3-route-and-protocol-coverage-manifest.md)

Goal: reduce drift between route registration, active-writer classification,
route-protection tests, and architecture audit rules.

Implementation slices:

- Table-driven route/protocol manifest that mirrors current behavior.
- Active-writer classification checks from the manifest.
- Route protection and architecture audit integration.
- Special-case coverage for streaming, reattach, cancel, and public asset
  routes.

## Phase 4: Narrow Projection Refreshes

Slice doc: [`slices/phase-4-narrow-projection-refreshes.md`](slices/phase-4-narrow-projection-refreshes.md)

Goal: reduce the amount of projected data shipped after message/generation
events.

Implementation slices:

- Event identity audit for message and generation paths.
- Narrow chat projection read model.
- Client refresh routing that targets one affected chat when possible.
- Broad-resource fallback and event-refresh smoke validation.

## Phase 5: Command Mutation Cost Reduction

Slice doc: [`slices/phase-5-command-mutation-cost-reduction.md`](slices/phase-5-command-mutation-cost-reduction.md)

Goal: reduce command latency for commands that do not need the full hydrated
database, without weakening the safe command transaction contract.

Implementation slices:

- Measurement-based command family selection.
- Scoped mutation helpers for message-free `db.json` plus targeted SQLite rows.
- First candidate migrations for low-cross-write command families.
- Revision, event, persistence, and secret-handling regression tests.

## Phase 6: Durable Generation Persistence Queue

Slice doc: [`slices/phase-6-durable-generation-persistence-queue.md`](slices/phase-6-durable-generation-persistence-queue.md)

Goal: make final result persistence retryable after transient failures, without
claiming full server-restart survival for running provider streams.

Implementation slices:

- SQLite-backed generation-finalization queue schema.
- Retryable failure capture from terminal persistence paths.
- Worker or startup sweep retry flow.
- Idempotence and terminal failure tests.

## Phase 7: Media And Import Memory Pressure

Slice doc: [`slices/phase-7-media-and-import-memory-pressure.md`](slices/phase-7-media-and-import-memory-pressure.md)

Goal: reduce peak memory and repeated base64 work for large assets.

Implementation slices:

- Size accounting around prompt asset resolution and Realm staging.
- Per-generation stored asset resolution cache.
- Realm `charx` streaming hash/write evaluation.
- Provider compatibility and asset id regression tests.

## Phase 8: Explicit Route Rate Limits

Slice doc: [`slices/phase-8-explicit-route-rate-limits.md`](slices/phase-8-explicit-route-rate-limits.md)

Goal: add operational protection without breaking long-lived protocol streams.

Implementation slices:

- Route risk inventory for abuse-prone endpoints.
- Explicit route-level limits for selected endpoints.
- Streaming and WebSocket exclusion coverage.
- Route-limit tests and manual smoke validation.

## Suggested Execution Order

1. [Phase 0: Protocol Measurement](slices/phase-0-protocol-measurement.md).
2. [Phase 1: Bound Bulk Hydration](slices/phase-1-bound-bulk-hydration.md).
3. [Phase 3: Route And Protocol Coverage Manifest](slices/phase-3-route-and-protocol-coverage-manifest.md).
4. [Phase 2: Durable Command Event Replay](slices/phase-2-durable-command-event-replay.md).
5. [Phase 4: Narrow Projection Refreshes](slices/phase-4-narrow-projection-refreshes.md).
6. [Phase 5: Command Mutation Cost Reduction](slices/phase-5-command-mutation-cost-reduction.md).
7. [Phase 6: Durable Generation Persistence Queue](slices/phase-6-durable-generation-persistence-queue.md).
8. [Phase 7: Media And Import Memory Pressure](slices/phase-7-media-and-import-memory-pressure.md).
9. [Phase 8: Explicit Route Rate Limits](slices/phase-8-explicit-route-rate-limits.md).

The order intentionally puts low-risk visibility and burst-control work before
schema or protocol-shape changes. Phase 2 and Phase 4 can swap if real
measurement shows projection payload size is a bigger problem than replay
misses.

## Not In This Plan

- Full durable generation restart survival for an in-progress provider stream.
  That remains the separate Milestone 2 decision in `docs/leftover.md`.
- Hosted or multi-tenant Lua isolation. The current security model is still
  single-user self-host.
- Replacing the command/event protocol with a new sync model.
- Re-enabling browser-local persistence paths in Fastify mode.
