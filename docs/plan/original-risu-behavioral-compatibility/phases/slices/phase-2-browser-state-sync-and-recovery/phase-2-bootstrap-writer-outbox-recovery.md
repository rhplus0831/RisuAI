# Phase 2 Slice — Bootstrap, Writer, Outbox, And Recovery

Status: Complete
Phase: [Phase 2](../../phase-2-browser-state-sync-and-recovery.md)
Opened from Fastify: `546ea5aaee78144176043971fdd2c13c9e7c6079`
Completed at Fastify: `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`

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

## Handoff

Phase 2 closed at `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`.
Bootstrap projections now preserve baseline-compatible defaults and legacy
shapes without replacing valid partial objects; durable lineage survives both
command-response and SSE parsing; and writer, observer, outbox, receipt, replay,
gap recovery, response-loss, takeover, and reload owners converge through
focused and built-browser evidence. Phase 3 consumes the same durable event and
bridge contract.

## Completion Evidence

| State surface | Canonical inventory | Implementation evidence |
| --- | --- | --- |
| Bootstrap projection and selected-character repair | `ORC-SURFACE-086` | `3ce85c1f034b3afc493e291f8a8f5e9227064463`, `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |
| Durable recovery lineage | `ORC-SURFACE-087` | `3ce85c1f034b3afc493e291f8a8f5e9227064463` |
| Writer, observer, outbox, receipt, and replay lifecycle | `ORC-SURFACE-088` | verified at `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |
| Signed replay-gap behavior | `ORC-SURFACE-023` | `ORC-DECISION-019`, re-verified at `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |
| Resolved replay-loss finding | `ORC-SURFACE-072` | `ORC-B-009`, re-verified at `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |

The post-correction pinned differential passed with 16 baseline tests, 18
current/cluster tests, 16 compared cells, 15 governed divergences, and healthy
cluster 10. Exact focused and compatibility commands are recorded in
[`latest-verification.md`](../../../latest-verification.md).
