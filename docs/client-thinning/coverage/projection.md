# Projection Coverage

Date: 2026-05-29

Proof pointers for bootstrap projection, the projection write guard, and event
refresh; see [`../status/server-projection.md`](../status/server-projection.md).

## Proof

Bootstrap and events:

- `server/fastify/__tests__/bootstrap.test.ts`
- `server/fastify/__tests__/events.test.ts`

Projection guard:

- `src/ts/process/__tests__/command.projectionGuard.test.ts`
- `src/ts/process/__tests__/lorebook.projectionGuard.test.ts`
- `src/ts/process/__tests__/triggers.projectionGuard.test.ts`

## Note

Command events are invalidation events; the browser refreshes the projection
rather than applying surgical patches. **Event patching is deferred** until the
SSE reconnect/replay gap is closed (today a stream error only logs — no
reconnect, no Last-Event-ID replay).
