# Finalization Retry Queue

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/generationJobs.ts`
- `server/fastify/src/db.ts`
- `server/fastify/src/generationFinalizationRetry.ts`
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

## Implemented Result

- Durable generation finalization enqueues the resolved assistant message,
  mode, target message id, and chat-var mutation payload before the first
  targeted persistence attempt.
- `generation_finalization_retries` stores retryable payloads in SQLite. The
  table is created by schema version 8 and has pending/terminal status, failure
  count, last error, and terminal error fields.
- App startup and a bounded interval sweep retry pending finalizations. Successful
  retries delete the queue row; transient failures remain pending; missing chat,
  missing target, and validation failures become terminal rows.
- Durable completion and streaming-cancel finalization share the queue path.
  Retries reuse the targeted generation write, so repeating a `generationId`
  does not append duplicate assistant rows.

## Done When

- A transient terminal persistence failure can be retried by a worker or startup
  sweep.
- Retry cannot duplicate assistant messages.
- Terminal non-retryable failures are visible in logs or job status.

## Validation

- Passed: `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- Passed: `pnpm api:test -- server/fastify/__tests__/db.test.ts`
