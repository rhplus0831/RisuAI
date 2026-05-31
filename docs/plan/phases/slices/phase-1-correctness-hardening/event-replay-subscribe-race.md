# Event Replay Subscribe Race

Status: active priority.

## Source Anchors

- `server/fastify/src/routes/events.ts`
- `server/fastify/src/commands/events.ts`
- `src/ts/bootstrap.ts`

## Scope

Fix the race where `/api/v1/events` can select replay history, write replay, and
only then subscribe the live listener. A command committed between replay
selection and live subscription can be missed until a later event creates a
revision gap.

## Protocol Behavior

- Subscribe before selecting replay, or subscribe, re-read current
  revision/history, replay through the latest covered revision, then start live
  delivery.
- Preserve `409 event_replay_unavailable` for too-old or cursor-ahead cases.
- Memory events remain live-only and do not need replay persistence.

## Done When

- A command committed during event stream setup is delivered or included in
  replay.
- The client no longer needs a later event to discover this missed revision.
- A regression test covers the setup interleaving.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
