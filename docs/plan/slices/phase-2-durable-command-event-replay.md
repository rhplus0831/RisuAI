# Phase 2: Durable Command Event Replay

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-2-durable-command-event-replay)

Status: planning slice.

Goal: avoid full bootstrap after server restart or long disconnect when the
revision gap is covered by stored command events.

## Implementation Slices

### 2.1 SQLite Event History

- Add a SQLite command-event history table.
- Use revision as the primary key.
- Store event JSON payload columns matching `CommandEvent`.
- Keep the schema aligned with the SQLite revision state.

Done when committed command events have a durable replay source independent of
process memory.

### 2.2 Command Path Persistence

- Write command events to SQLite in the same successful command path that bumps
  revision.
- Prefer writing in the same transaction before commit.
- If immediate-after-commit is chosen instead, document the recovery rule.
- Preserve one command event for every revision-tracked projected mutation.

Done when event persistence and revision commits cannot drift silently.

### 2.3 Replay Source And Live Fanout

- Keep `CommandEventSink` for live subscribers.
- Read replay selections from persisted history when a cursor is provided.
- Treat SQLite history as the replay source of truth.
- Keep memory events live-only and out of this persisted history.

Done when replay after restart no longer depends on the old in-memory sink.

### 2.4 Pruning And Cursor Edges

- Retain at least the current in-memory equivalent of 1000 revisions.
- Consider a time-based cap if large command bursts are realistic.
- Continue returning `409 event_replay_unavailable` for too-old cursors.
- Continue rejecting cursor-ahead cases.

Done when retained history is bounded and cursor failure modes remain explicit.

### 2.5 Restart Coverage

- Add tests covering replay after constructing a fresh app against the same
  data directory.
- Add tests for too-old and cursor-ahead replay failures.
- Confirm no startup rebuild is required because committed events live in
  SQLite.

Done when process restart is covered by an automated replay test.

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
