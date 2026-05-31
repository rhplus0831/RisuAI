# Phase 2: Durable Command Event Replay

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-2-durable-command-event-replay)

Status: completed on 2026-05-31.

Goal: avoid full bootstrap after server restart or long disconnect when the
revision gap is covered by stored command events.

## Implementation Slices

### 2.1 SQLite Event History

- Add a SQLite command-event history table.
- Use revision as the primary key.
- Store event JSON payload columns matching `CommandEvent`.
- Keep the schema aligned with the SQLite revision state.

Completed with schema v7 `command_events`, keyed by revision and retaining
`type`, `resource`, `id`, and `parentId`.

### 2.2 Command Path Persistence

- Write command events to SQLite in the same successful command path that bumps
  revision.
- Prefer writing in the same transaction before commit.
- If immediate-after-commit is chosen instead, document the recovery rule.
- Preserve one command event for every revision-tracked projected mutation.

Completed for normal JSON commands inside `applyJsonCommandMutation()` before
`COMMIT`. Server-owned import/initialize/restore/asset paths persist immediately
after their existing repository commit and before live fanout; a persistence
failure is visible to the caller instead of silently emitting an unreplayable
event.

### 2.3 Replay Source And Live Fanout

- Keep `CommandEventSink` for live subscribers.
- Read replay selections from persisted history when a cursor is provided.
- Treat SQLite history as the replay source of truth.
- Keep memory events live-only and out of this persisted history.

Completed: `/api/v1/events` selects replay from SQLite history, then resumes
live fanout through the existing `CommandEventSink` and memory event bus.

### 2.4 Pruning And Cursor Edges

- Retain at least the current in-memory equivalent of 1000 revisions.
- Consider a time-based cap if large command bursts are realistic.
- Continue returning `409 event_replay_unavailable` for too-old cursors.
- Continue rejecting cursor-ahead cases.

Completed with the existing 1000-revision retention limit enforced during event
persistence.

### 2.5 Restart Coverage

- Add tests covering replay after constructing a fresh app against the same
  data directory.
- Add tests for too-old and cursor-ahead replay failures.
- Confirm no startup rebuild is required because committed events live in
  SQLite.

Completed in `server/fastify/__tests__/events.test.ts`.

## Acceptance

- Reconnect after process restart can replay stored command events if the cursor
  is within retained history.
- Replay still returns `409 event_replay_unavailable` for too-old cursors or
  cursor-ahead cases.
- Memory events remain live-only and are not persisted by this phase.
- Every persisted event is one-revision contiguous with SQLite revision state.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- Add tests covering replay after constructing a fresh app against the same data
  directory.
- `pnpm test -- src/ts/bootstrap.test.ts`
