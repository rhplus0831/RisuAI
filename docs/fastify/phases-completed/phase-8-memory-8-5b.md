# Phase 8 Memory - 8-5b Closeout

Date: 2026-05-25

## Scope Landed

- Added `server/fastify/src/memoryEmbedJobHandler.ts` for standard
  server-side Hypa V3 embed jobs.
- Embed jobs now parse schema-versioned payloads, load planned chunks,
  resolve provider credentials through `resolveMemoryEmbeddingModel`,
  call `embedTexts`, and persist successful vectors through
  `createMemoryEmbedding`.
- Standard embedding reruns are idempotent by `{ chatId, chunkId,
  model }` and use deterministic `hypav3-embedding-*` ids.
- The worker batch handler surface now supports any memory job kind;
  embed batches claim same-chat pending jobs, preserve retry/cancel
  transitions, and complete only still-running jobs.
- Embed batches apply `embeddingMaxConcurrent` and
  `embeddingRequestsPerMinute` from normalized Hypa V3 settings.
- Fastify app startup wires the default embed handler and embed batch
  handler into the in-process memory worker.

## Boundaries

- Voyage contextual embedding grouping did not land; `group_id` and
  `group_index` stay empty for standard embeddings.
- Similarity ranking, memory budget allocation, and prompt memory
  selection did not land.
- Prompt assembly still does not read memory embeddings.
- Browser memory routes, progress listener, job list/cancel UI, and
  fixture parity remain future work.
- Browser-local transformers, WebGPU, WebLLM, MLC, and ONNX embedding
  runtimes remain out of server scope.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbedJobHandler.test.ts server/fastify/__tests__/memoryWorker.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused embed handler and worker verification passed with 24 tests.
`pnpm check` was clean. `pnpm test` passed with 639 tests plus 4
skipped. `pnpm api:test` passed with 1004 tests. `pnpm build` passed
with the existing CSS `::highlight`, browser externalization,
plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-5c - Voyage contextual embeddings. Start from
`server/fastify/src/memoryEmbedJobHandler.ts` and
`server/fastify/src/memoryEmbeddingModel.ts`, add explicit
`voyageContext3` provider resolution and contextual grouping, and keep
writes going through the flat `memory_embeddings` repository surface
with `group_id` / `group_index` populated. Leave similarity ranking,
prompt assembly reads, and browser UI out of scope.
