# Slice: Skip Dead Embedding Decode

Phase: [3](../../phase-3-memory-subsystem.md). Finding: K1, re-opened from
v2-R5 with corrected reasoning. Runtime performance change.

## Scope

Avoid decoding every memory embedding `vector_blob` on memory-enabled sends
when there are no valid query vectors, while preserving the metadata needed by
missing-memory diagnostics and follow-up job creation.

This slice does not add live query-vector generation. Similarity ranking with
real query vectors must continue to decode and score vectors exactly as before.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  Known-Item Overlaps, K1 row.
- `server/fastify/src/memorySelectionService.ts`: `selectMemorySummaries`,
  `listMemoryEmbeddings`, ranking, allocation, and repository diagnostics.
- `server/fastify/src/memoryRepository.ts`: `listMemoryEmbeddings`,
  `mapMemoryEmbeddingRow`, and `decodeEmbeddingVector`.
- `server/fastify/src/memorySimilarityRanking.ts`: valid-query handling and
  access to `embedding.vector`.
- `server/fastify/src/routes/generationChat.ts`:
  `loadPromptMemoryQueryVectors: () => []` on the live send path.
- Focused tests:
  `server/fastify/__tests__/memoryRepository.test.ts`,
  `server/fastify/__tests__/memorySelectionService.test.ts`, and
  `server/fastify/__tests__/memorySimilarityRanking.test.ts`.

## Target Shape

- Add a repository/selection path that can read embedding row metadata without
  eagerly decoding `vector_blob`, or make `MemoryEmbedding.vector` lazily decode
  only when read.
- Preserve all chunkId-only consumers. In particular,
  `buildRepositoryDiagnostics` still needs embedding counts and chunk ids so it
  does not enqueue duplicate follow-up embedding jobs for chunks that already
  have embeddings.
- Decide whether similarity can run before vector decode. If there are zero
  valid query vectors, return empty similarity ranking diagnostics without
  touching vector data.
- When valid query vectors are present, preserve existing behavior:
  malformed vectors still fail when the similarity path needs them, skipped
  zero vectors and dimension mismatches are reported as before, and ranking
  order is unchanged.
- Add a decode-count probe proving that the live empty-query route decodes zero
  vectors even when many embedding rows exist.
- Add or keep a real-query test proving vectors are decoded and ranked when a
  valid query vector is supplied.
- Register K1 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the K1 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Do not simply skip loading embeddings on empty queries if that would make
  diagnostics think embeddings are missing.
- `listMemoryChunks` and memory summary read routes remain unchanged.
- Embedding write/read APIs that explicitly request vectors keep returning
  vectors.
- Similarity results and diagnostics with valid query vectors are unchanged.
- Empty-query selection still allocates recent/important/random summaries via
  the budget allocator; only similarity scoring is inert.

## Done Criteria

- Memory-enabled sends with `loadPromptMemoryQueryVectors: () => []` perform
  zero embedding vector decodes.
- Missing-memory diagnostics still report existing embeddings by chunk id and
  do not enqueue duplicate embedding follow-up jobs for already-embedded
  chunks.
- Valid-query similarity tests still decode vectors, score matches, and keep
  ranking parity.
- K1 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memorySelectionService.test.ts \
  server/fastify/__tests__/memorySimilarityRanking.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
