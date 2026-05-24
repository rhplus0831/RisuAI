# Phase 8 Memory - 8-5f Closeout

Date: 2026-05-25

## Scope Landed

- Added `memorySelectionService`, a read-only prompt-facing facade under
  `server/fastify/src/`.
- The facade loads summaries by `{ chatId, summaryModel }`, chunks by
  `chatId`, and embeddings by `{ chatId, embeddingModel }`, then composes
  `rankMemorySummariesBySimilarity` and `allocateMemorySummaries`.
- The facade accepts supplied query vectors and budget settings from the
  future prompt adapter; it does not generate query embeddings or call
  providers.
- Returned selected summaries split by important/recent/similar/random
  buckets, ranked similar summaries, and combined diagnostics for
  repository counts, missing embeddings, missing summaries, ranking
  skips, and allocator budget pressure.
- Added focused tests covering repository orchestration, chat/model
  filtering, empty inputs, missing summary/embedding diagnostics, budget
  pressure passthrough, and deterministic allocator seed wiring.

## Boundaries

- No schema change was needed.
- No provider calls, summarization, embedding generation, queue writes,
  prompt-row assembly, browser listeners, or browser UI landed.
- The service remains a composition layer over repository reads and the
  pure 8-5d/8-5e helpers; ranking and allocation rules were not
  duplicated.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySelectionService.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

Focused 8-5f verification passed with 5 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test` passed
with 1028 tests. `pnpm build` passed with the existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-6a - Prompt memory adapter contract. Define the prompt
adapter input/output and enable/disable boundary around
`selectMemorySummaries`, surface selected-summary and diagnostics shapes,
and keep query embedding generation, provider calls, queue writes,
prompt-row assembly, and browser UI out of scope.
