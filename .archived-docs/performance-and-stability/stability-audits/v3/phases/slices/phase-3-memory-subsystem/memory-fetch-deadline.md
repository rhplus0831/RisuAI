# Slice: Memory Fetch Deadline

Phase: [3](../../phase-3-memory-subsystem.md). Finding: L16. Runtime
resilience change.

## Scope

Arm a bounded deadline on memory worker provider calls so a connected but
silent embedding or summarization endpoint fails the job and lets the
single-flight worker continue instead of parking until the undici default
timeout.

This slice covers memory embed and summarize provider fetches only. It does
not change chat-generation request deadlines, route-level abort behavior, or
provider adapter retry semantics.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L16.
- `server/fastify/src/memoryEmbedJobHandler.ts`: normal embedding controller
  and contextual embedding controller.
- `server/fastify/src/memorySummarizeJobHandler.ts`: summarize controller and
  `summarize` call.
- `server/fastify/src/memoryEmbeddingAdapter.ts`: signal forwarding and aborted
  fetch conversion.
- `server/fastify/src/generation/openai.ts`: `runOpenAI`, the summarize path's
  real fetch site.
- `server/fastify/src/memoryWorker.ts`: single-flight `inFlight`, failure,
  retry, and backoff handling.
- Focused tests:
  `server/fastify/__tests__/memoryEmbedJobHandler.test.ts`,
  `server/fastify/__tests__/memorySummarizeJobHandler.test.ts`, and
  `server/fastify/__tests__/memoryWorker.test.ts`.

## Target Shape

- Introduce one default memory-provider fetch deadline constant. Use a
  conservative production value in the 60-120 second range.
- Provide a narrow test seam, such as a handler option override, so tests can
  use a tiny deadline without sleeping.
- Start the deadline after rate limiting and immediately before the provider
  call that receives the controller signal. Clear the timer in `finally`.
- Apply the helper to:
  normal embedding jobs, contextual embedding jobs, and summarize jobs.
- Preserve existing adapter behavior: an aborted signal should become a
  retryable job failure through the current handler/worker failure path.
- Add fake-timer tests for hung embed and summarize calls that never resolve
  until the signal aborts.
- Add a slow-under-deadline test that resolves before the timer fires and
  proves the timer is cleared and the job succeeds normally.
- Register L16 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the L16 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Optional Adjacent Cleanup

The Phase 3 parent allows I6 to ride along if the summarize handler is already
being touched: verify the shared chatId once per summarize batch or use an
indexed existence probe instead of scanning every character's chat-id stubs per
job. Keep this cleanup separate in tests and do not treat it as required for
L16.

## Invariants

- The deadline bounds provider fetch time, not intentional rate-limit waiting.
- Deadline timers are always cleared on success, provider error, and abort.
- Legitimate provider calls that complete before the deadline keep their
  existing success/failure behavior.
- A timeout does not make the worker terminally stuck; the job follows the
  current retry/backoff path and later jobs can run.
- Existing request-abort helpers and chat-generation deadlines are unchanged.

## Done Criteria

- A hung normal embed request fails within the configured deadline and the
  worker proceeds.
- A hung contextual embed request fails within the configured deadline and the
  worker proceeds.
- A hung summarize request through `runOpenAI` fails within the configured
  deadline and the worker proceeds.
- Calls that resolve under the deadline are unaffected.
- L16 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
