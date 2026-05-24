# Phase 8 Memory - 8-5d Closeout

Date: 2026-05-25

## Scope Landed

- Added `memorySimilarityRanking`, a pure server-side helper for ranking
  supplied `MemorySummary` rows through their `MemoryChunk` and persisted
  `MemoryEmbedding` rows.
- Added defensive cosine similarity that does not assume normalized
  vectors and skips dimension mismatches, non-finite vectors, and
  zero-magnitude vectors.
- Supported standard embedding rows and Voyage contextual rows from the
  same flat `memory_embeddings` shape. Context metadata remains ranking
  metadata; no special provider path is needed.
- Added deterministic ordering for equal scores using chunk range,
  contextual group metadata, summary id, chunk id, and embedding id.
- Returned allocator-facing diagnostics for skipped query vectors,
  skipped embeddings, missing chunks, and missing summaries.

## Boundaries

- No schema change was needed.
- No provider calls, repository reads/writes, queue operations, prompt
  assembly reads, browser listeners, or browser UI landed.
- Memory budget allocation remains in 8-5e.
- Prompt-facing repository orchestration remains in 8-5f.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySimilarityRanking.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused 8-5d verification passed with 7 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 1017 tests. `pnpm build` passed with the existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-5e - Pure memory budget allocator. Port the
important/recent/similar/random summary selection over supplied records,
consume `RankedMemorySummary` inputs for the similar bucket, use
deterministic randomness for tests, and keep provider calls, DB writes,
jobs, prompt assembly, and browser UI out of scope.
