# SSE Backpressure Policy

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/events.ts`
- `server/fastify/src/streamJobs.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/streamJobs.ts`

## Scope

Define and implement bounded behavior for slow consumers on command/memory SSE,
durable generation streams, and proxy stream jobs.

Selected batch:

- Add a shared raw-stream write helper that checks buffered bytes before
  enqueueing another SSE frame.
- Apply the cap to `/api/v1/events` command/memory fanout, inline chat
  generation SSE, durable generation viewers, and proxy WebSocket job clients.
- Keep `JobRegistry` replay/pending caps intact while detaching clients that
  close during fanout.
- Source files:
  - `server/fastify/src/streamBackpressure.ts`
  - `server/fastify/src/routes/events.ts`
  - `server/fastify/src/routes/generationChat.ts`
  - `server/fastify/src/routes/streamJobs.ts`
  - `server/fastify/src/streamJobs.ts`
  - focused stream/event/durable generation tests

Implemented result:

- `streamBackpressure.ts` provides a shared 2 MiB per-client buffered-byte cap
  for raw SSE writes.
- `/api/v1/events` command/memory fanout uses bounded writes and unsubscribes
  slow consumers before closing their stream.
- Inline chat generation SSE and durable generation viewers use the same raw
  write cap; durable viewers also expose their current socket buffer to
  `JobRegistry`.
- Proxy WebSocket stream-job clients expose `bufferedAmount`, bound direct
  `job_accepted`/ping writes, and close when the cap would be exceeded.
- `JobRegistry` detaches clients that close during fanout and preserves pending
  proxy events when an attaching client is already over the cap.

## Protocol Behavior

- Check `write()` backpressure or queue size where raw replies are used.
- Add per-client caps or disconnect slow consumers after bounded buffering.
- Keep terminal errors visible to the affected stream without rolling back
  already committed domain mutations.
- Revision/event behavior: unchanged. The cap only affects live delivery to the
  slow consumer; committed command events remain replayable through persisted
  history, and durable generation frames remain available through the existing
  replay buffer.
- Rollback/resync behavior: no durable mutations are rolled back when one stream
  consumer is disconnected. `/api/v1/events` clients reconnect with
  `Last-Event-ID`/`sinceRevision`; durable generation clients reattach by job id.

## Done When

- A slow event or generation consumer cannot create unbounded memory growth.
- Backpressure behavior is consistent across `/api/v1/events` and job streams.
- Tests or targeted harnesses prove cap/disconnect behavior.

## Validation

- Passed:
  `pnpm api:test -- server/fastify/__tests__/streamBackpressure.test.ts server/fastify/__tests__/streamJobs.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- Passed: `pnpm api:test`
