# Phase 8 Missing-Summary Diagnostics - 2026-05-27

Slice 8C landed. Phase 8 follow-up is closed again.

## What Changed

- Changed memory repository diagnostics so `chunkIdsMissingSummaries`
  is computed from all chunks missing the requested summary model, not
  only chunks that already have the requested embedding model.
- Preserved embed follow-up behavior for summarized chunks missing
  embeddings.
- Added coverage for chunks that have neither summary nor embedding, and
  proved prompt assembly enqueues summarize follow-up jobs idempotently
  for those chunks.

## Notes

- No compatibility migration was added because there are no actual
  Fastify users yet.
- The similarity-ranking diagnostic `missingSummaries` still reports
  missing summaries discovered from embedding rows. The repository
  diagnostic is the broader follow-up source for chunks with no
  embedding yet.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
pnpm api:test -- server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts
```

## Historical Next Pickup

At this slice closeout, Phase 6 Slice 6A was the default pickup:
streaming error frame contract plus OpenAI-compatible failure handling.
