# Phase 6: Durable Generation Persistence Queue

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-6-durable-generation-persistence-queue)

Status: planning slice.

Goal: make final result persistence retryable after transient failures, without
claiming full server-restart survival for running provider streams.

## Implementation Slices

### 6.1 Queue Schema And Repository

- Add a small SQLite-backed generation-finalization queue.
- Store generation id, chat id, mode, target message id when relevant, text,
  post-generation metadata that is already derived, and failure count.
- Key idempotence by `generationId`.

Done when terminal persistence work can be recorded for retry without losing the
result text.

### 6.2 Retryable Failure Capture

- Enqueue terminal result writes that fail after provider text is available.
- Classify transient SQLite/file errors as retryable.
- Classify chat deleted or target message gone as terminal failures surfaced to
  logs/events.

Done when retryable and non-retryable persistence failures are explicit.

### 6.3 Retry Worker Or Startup Sweep

- Add a worker or startup sweep that retries queued finalization work.
- Keep retries idempotent for the same `generationId`.
- Do not try to resume an interrupted upstream provider stream in this phase.

Done when transient persistence failures can be retried without claiming full
provider stream restart survival.

### 6.4 Terminal Failure Visibility

- Surface terminal non-retryable failures as job errors or logs.
- Ensure failed queue entries cannot duplicate assistant messages.
- Keep durable-generation Milestone 2 from `docs/leftover.md` out of scope.

Done when operators can see terminal failures and retries remain single-write.

## Acceptance

- A transient persistence failure can be retried by a worker or startup sweep.
- Terminal non-retryable failures remain visible as job errors/logs.
- The queue cannot duplicate assistant messages for the same `generationId`.

## Validation

- Extend `server/fastify/__tests__/durableGeneration.test.ts`.
- Add repository/worker tests if a new worker is introduced.
- `pnpm api:test`
