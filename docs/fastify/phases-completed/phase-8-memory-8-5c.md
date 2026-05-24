# Phase 8 Memory - 8-5c Closeout

Date: 2026-05-25

## Scope Landed

- Added server-side `voyageContext3` resolution to the memory embedding
  model contract using `voyageApiKey`, Voyage's contextualized
  embeddings endpoint, and wire model `voyage-context-3`.
- Added contextual document-group embedding support to
  `memoryEmbeddingAdapter` while preserving the existing standard
  OpenAI-compatible/custom embedding adapter behavior.
- Extended the embed job batch handler so same-chat `voyageContext3`
  jobs are sent as one ordered contextual document group.
- Persisted Voyage vectors through the existing flat
  `memory_embeddings` repository surface with deterministic `group_id`
  and ordered `group_index` values.
- Preserved standard embedding idempotence and retry/cancel behavior for
  non-contextual models.

## Boundaries

- No schema change was needed; `memory_embeddings.group_id` and
  `group_index` were already present.
- Similarity ranking, memory budget allocation, prompt memory selection,
  and prompt assembly reads from embeddings did not land.
- Browser progress UI, browser listeners, browser job list/cancel
  controls, and browser-local embedding runtimes remain out of scope.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbeddingAdapter.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused 8-5c verification passed with 30 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 1010 tests. `pnpm build` passed with the existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-5d - Pure similarity ranking. Build a pure ranking
helper over supplied summaries/chunks/vectors, support both standard and
contextual embedding rows from the flat repository shape, define stable
tie-breaking, and keep provider calls, DB writes, jobs, prompt assembly,
and browser UI out of scope.
