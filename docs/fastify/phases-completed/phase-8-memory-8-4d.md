# Phase 8 Memory - 8-4d Closeout

Date: 2026-05-25

## Scope Landed

- Added a narrow summarize batch hook to `MemoryWorker` so planned
  summarize jobs can be claimed and settled as an ordered batch without
  changing the generic queue model.
- Added `createSummarizeMemoryJobBatchHandler` in
  `server/fastify/src/memorySummarizeJobHandler.ts`.
- The batch handler loads Hypa V3 settings, applies
  `summarizationMaxConcurrent`, spaces provider dispatch with
  `summarizationRequestsPerMinute`, stages successful provider results,
  and commits only the consecutive planned successes.
- If an earlier job fails, is cancelled, or produces an invalid/empty
  write, later staged successes stay uncommitted and are returned to the
  existing retry/fail queue handoff with useful error text.
- Existing single-job summarize behavior remains available and
  idempotent by `{ chatId, chunkId, model }`.
- Fastify startup wires the batch handler by default while preserving
  explicit summarize handler overrides.

## Boundaries

- No embedding provider contract, embed job handler, or vector
  persistence landed.
- No Voyage contextual embedding grouping landed.
- No similarity ranking, memory budget allocation, or prompt memory
  selection landed.
- No browser memory routes, progress listener, job list/cancel UI, or
  fixture parity changes landed.
- Local MLC / ONNX / WebLLM summary and embedding runtimes remain out of
  scope.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummarizeJobHandler.test.ts server/fastify/__tests__/memoryWorker.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused summarize handler and worker verification passed with 25 tests.
`pnpm check` was clean. `pnpm test` passed with 639 tests plus 4
skipped. `pnpm api:test` passed with 980 tests. `pnpm build` passed with
the existing CSS `::highlight`, browser externalization,
plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-5a - Embedding provider contract. Define the
server-side embedding request/result shape, model and credential
resolution, provider response normalization, dimension validation, and
typed errors. Keep embed job persistence, Voyage grouping, similarity
ranking, prompt assembly reads, browser UI, and browser-local embedding
runtimes out of scope.
