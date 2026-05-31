# Finalization Retry Queue

Status: planned.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/generationJobs.ts`
- `server/fastify/src/db.ts`
- `server/fastify/src/messageStore.ts`

## Scope

Make final result persistence retryable after transient failures, without
claiming full server-restart survival for in-flight provider streams.

## Protocol Behavior

- Store generation id, chat id, mode, target message id when relevant, result
  text, derived metadata, and failure count.
- Key idempotence by `generationId`.
- Classify missing chat or target message as terminal failure, not endless
  retry.

## Done When

- A transient terminal persistence failure can be retried by a worker or startup
  sweep.
- Retry cannot duplicate assistant messages.
- Terminal non-retryable failures are visible in logs or job status.

## Validation

- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- Repository or worker tests if a new queue module is introduced.
