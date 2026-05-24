# Phase 8 Memory - 8-4c Closeout

Date: 2026-05-25

## Scope Landed

- Added `server/fastify/src/memorySummarizeJobHandler.ts` to execute
  planned `summarize` memory jobs from 8-3d.
- The handler validates the versioned summarize payload, loads the
  target chunk, verifies persisted chat data exists, builds the Hypa V3
  summary prompt, dispatches the API-backed `subModel` summary call, and
  persists successful output to `memory_summaries`.
- Added `server/fastify/src/memorySummaryModel.ts` to resolve the
  server-side summary `subModel` path into OpenAI-compatible provider
  requests for OpenAI, NanoGPT, and OpenRouter-style API providers,
  including reverse proxy, xcustom, DeepSeek, DeepInfra, and Ollama
  cloud OpenAI-compatible variants.
- Fastify startup now wires the real summarize handler into the memory
  worker while preserving test and caller handler overrides.
- Summary writes are idempotent by `{ chatId, chunkId, model }`: an
  existing summary converges the chunk to `summarized` without a
  duplicate provider call or duplicate row.
- Provider failures and invalid summary writes mark the chunk `failed`
  for observability and let the worker retry/fail the job through the
  existing queue primitives.

## Boundaries

- No embedding jobs or vector persistence landed.
- No similarity selection or prompt-assembly reads from memory summaries
  landed.
- No summary rate limiting, concurrent batching, or ordered batch write
  semantics landed; that remains 8-4d.
- No browser progress UI, browser listeners, or list/cancel controls
  landed.
- Local MLC / ONNX / WebLLM summary runtimes remain out of scope.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummarizeJobHandler.test.ts server/fastify/__tests__/memorySummaryAdapter.test.ts server/fastify/__tests__/memorySummaryPrompt.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused summarize-handler, adapter, and prompt verification passed with
21 tests. `pnpm check` was clean. `pnpm test` passed with 639 tests plus
4 skipped. `pnpm api:test` passed with 976 tests. `pnpm build` passed
with existing CSS `::highlight`, browser externalization,
plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-4d - Summary rate limiting and ordered writes. Apply
`summarizationRequestsPerMinute`, `summarizationMaxConcurrent`, and
legacy consecutive-success batch commit behavior across planned
summarize jobs. Keep embeddings, memory prompt selection, browser UI,
and local summary runtimes out of scope.
