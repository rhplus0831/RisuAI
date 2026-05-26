# Phase 8 Custom Embedding Routing - 2026-05-27

Slice 8A landed.

## What Changed

- Kept custom Hypa V3 embeddings keyed as `custom` in prompt selection,
  follow-up job payloads, job IDs, and persisted embedding rows.
- Kept the configured custom provider model as the separate adapter
  `wireModel`, so deferred embed jobs still call the intended upstream
  model.
- Added prompt-time and deferred-job regression coverage for custom
  embedding routing.

## Notes

- No compatibility migration was added; current Fastify schema and job
  payloads now use the stable custom key directly.
- At this slice closeout, Phase 8 still needed production memory
  progress event delivery and no-embedding/no-summary diagnostics.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts
```

## Historical Next Pickup

At this slice closeout, Phase 8 Slice 8B was the default pickup:
production memory progress event delivery.
