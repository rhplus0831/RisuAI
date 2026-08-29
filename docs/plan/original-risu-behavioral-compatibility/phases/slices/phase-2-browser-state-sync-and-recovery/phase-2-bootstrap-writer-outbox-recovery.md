# Phase 2 Slice — Bootstrap, Writer, Outbox, And Recovery

Status: Ready after Phase 1
Phase: [Phase 2](../../phase-2-browser-state-sync-and-recovery.md)

## Outcome

Verify the browser/server state boundary from initial bootstrap through writer
mutation, observer invalidation, queued replay, reload, and terminal recovery,
including races that could lose, duplicate, resurrect, or mis-target state.

## Exact Entry Owners

- Browser bootstrap and durable state: `src/ts/storage/database.svelte.ts` and
  its focused tests.
- Server projection and persistence: `server/fastify/src/bootstrap.ts`,
  `server/fastify/src/repository.ts`, and owning integration tests.
- Writer/outbox/observer lifecycle: the browser server-sync modules under
  `src/ts/server/`, their protocol schemas, and Fastify event/receipt routes.
- Built-browser outcomes: `server/fastify/browser-smoke/`.

## Required Matrix

- Defaults, missing/null/empty/legacy shapes, identity, order, and selection at
  bootstrap and replacement.
- Accepted, rejected, queued, replayed, response-lost, and duplicate-receipt
  mutations across reload/restart.
- Rapid repeat, stale completion, target deletion, cross-chat navigation,
  observer tab, and writer takeover.
- Terminal streamed, cancelled, failed, and reattached state without silent
  loss or duplication.

## Required Evidence

- Closed-world resource/command/event ownership.
- Deterministic integration and fault fixtures through production boundaries.
- Built-browser reload/multi-tab journeys for visible outcomes.
- Inventory, finding/decision, verification, affected-lane, compatibility, and
  residual-owner updates.
