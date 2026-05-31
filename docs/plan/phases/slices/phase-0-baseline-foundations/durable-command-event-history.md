# Durable Command Event History

Status: implemented foundation, with Phase 1 hardening still required.

## Source Anchors

- `server/fastify/src/commands/events.ts`
- `server/fastify/src/routes/events.ts`
- `server/fastify/src/db.ts`
- `src/ts/server/events.ts`

## Scope

Preserve SQLite-backed command-event replay history and revision-cursor replay.
This slice is the implemented foundation; the replay/live subscription race is
tracked separately in Phase 1.

## Done When

- Reconnect after process restart can replay retained command events.
- Too-old and cursor-ahead cases return `409 event_replay_unavailable`.
- Memory events remain live-only progress signals.
- Event retention remains explicit and tested.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
