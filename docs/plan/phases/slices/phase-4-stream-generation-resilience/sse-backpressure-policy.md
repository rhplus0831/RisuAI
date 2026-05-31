# SSE Backpressure Policy

Status: planned.

## Source Anchors

- `server/fastify/src/routes/events.ts`
- `server/fastify/src/streamJobs.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/streamJobs.ts`

## Scope

Define and implement bounded behavior for slow consumers on command/memory SSE,
durable generation streams, and proxy stream jobs.

## Protocol Behavior

- Check `write()` backpressure or queue size where raw replies are used.
- Add per-client caps or disconnect slow consumers after bounded buffering.
- Keep terminal errors visible to the affected stream without rolling back
  already committed domain mutations.

## Done When

- A slow event or generation consumer cannot create unbounded memory growth.
- Backpressure behavior is consistent across `/api/v1/events` and job streams.
- Tests or targeted harnesses prove cap/disconnect behavior.

## Validation

- Focused stream tests for the changed registry or route.
- `pnpm api:test`
