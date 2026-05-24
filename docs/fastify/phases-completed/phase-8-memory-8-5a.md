# Phase 8 Memory - 8-5a Closeout

Date: 2026-05-25

## Scope Landed

- Added `server/fastify/src/memoryEmbeddingModel.ts` to resolve Hypa V3
  embedding settings into a server-side provider request shape.
- Supported API-backed OpenAI embedding aliases:
  `ada`, `openai3small`, and `openai3large`.
- Supported custom embedding endpoints from `hypaCustomSettings`,
  including URL normalization to `/embeddings`, optional bearer
  credentials, and optional provider model ids.
- Added `server/fastify/src/memoryEmbeddingAdapter.ts` to call
  OpenAI-compatible `/embeddings` endpoints.
- The adapter normalizes OpenAI-style `data[].embedding` responses,
  preserves response order when `index` is supplied, validates vector
  dimensions, rejects non-finite vector values, and returns typed
  provider errors.

## Boundaries

- No embed job handler, worker wiring, or vector persistence landed.
- No writes to `memory_embeddings` landed.
- No Voyage contextual embedding grouping landed.
- No similarity ranking, memory budget allocation, or prompt memory
  selection landed.
- No browser memory routes, progress listener, job list/cancel UI, or
  fixture parity changes landed.
- Browser-local transformers, WebGPU, WebLLM, MLC, and ONNX embedding
  runtimes remain out of server scope.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbeddingAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused embedding resolver and adapter verification passed with 14
tests. `pnpm check` was clean. `pnpm test` passed with 639 tests plus 4
skipped. `pnpm api:test` passed with 994 tests. `pnpm build` passed with
the existing CSS `::highlight`, browser externalization,
plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-5b - Embed job handler + vector persistence. Fetch
planned embed jobs through `resolveMemoryEmbeddingModel` and
`embedTexts`, persist vectors through `createMemoryEmbedding`, preserve
queue retry/cancel behavior, and apply `embeddingRequestsPerMinute` /
`embeddingMaxConcurrent` limits. Leave Voyage grouping, similarity
ranking, prompt assembly reads, and browser UI out of scope.
