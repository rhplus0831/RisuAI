# Slice: Memory Embedding Chunk Bounds

Phase: [8](../../phase-8-server-bounds.md). Findings: L21 and L22. Runtime
change.
Status: done on 2026-06-06 KST.

## Scope

Add hard per-chunk embed request bounds and make contextual embedding window
splits an explicit, observable policy decision.

This slice does not own memory worker tick cadence, failure cascade scope,
summary fetch sharing, provider authentication, or selection ranking.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L21 and L22.
- `server/fastify/src/memoryChunkPlanner.ts`: chunk construction and size/token
  estimates.
- `server/fastify/src/memoryEmbedJobHandler.ts`: single-chunk,
  non-contextual, contextual `voyageContext3`, and sub-batch request paths.
- `server/fastify/src/memoryEmbeddingAdapter.ts`: provider request envelope and
  request body creation.
- `server/fastify/src/memoryEmbeddingModel.ts`: model capability/context
  metadata.
- Existing focused suites:
  `server/fastify/__tests__/memoryChunkPlanner.test.ts`,
  `server/fastify/__tests__/memoryEmbedJobHandler.test.ts`,
  `server/fastify/__tests__/memoryEmbeddingAdapter.test.ts`, and
  `server/fastify/__tests__/memoryEmbeddingModel.test.ts`.

## Target Shape

- Define a maximum allowed size for one memory chunk before it can be sent to
  any embed provider route. The ceiling may be token-based, byte-based, or both,
  but it must run before the request body is built.
- Apply the ceiling to single-chunk, non-contextual multi-chunk, and
  contextual `voyageContext3` paths.
- Fail oversized unsplittable chunks before provider dispatch with a clear
  memory job error that names the offending bound.
- Size contextual sub-batch budgets from provider/model context limits where
  available. If the limit is unavailable or unsafe for the input, fall back to
  non-contextual behavior or fail explicitly rather than silently fragmenting
  context.
- Emit a metric, diagnostic, or structured test-visible signal when a
  contextual batch is split and document the policy in code or docs.
- Add tests for an oversized single chunk, an oversized chunk inside a
  contextual batch, a valid contextual batch under the provider limit, and the
  observable split signal.
- Register L21 and L22 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid under-limit chunks produce the same embeddings and persisted rows.
- The contextual policy must not silently change the co-embedded context window
  without an observable signal.
- Provider requests must not be constructed for chunks already known to exceed
  the ceiling.
- Non-contextual models must not inherit contextual-only grouping semantics.

## Done Criteria

- Oversized chunks fail fast across single, non-contextual, and contextual
  routes.
- Contextual batch splitting is sized from provider limits or explicitly
  bypassed/fails when limits are unknown.
- Tests observe split diagnostics and clear oversized-chunk errors.
- L21 and L22 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Proof

- Runtime:
  `server/fastify/src/memoryEmbeddingModel.ts` attaches provider/fallback input
  limits to resolved embedding requests, `memoryEmbeddingAdapter.ts` rejects
  oversized inputs before request-body construction, and
  `memoryEmbedJobHandler.ts` validates chunks across single, non-contextual
  batch, and contextual `voyageContext3` paths before provider dispatch.
- Contextual policy:
  `memoryEmbedJobHandler.ts` now sizes contextual sub-batches from the resolved
  model's `contextualWindowTokens`, fails explicitly if that window metadata is
  absent, isolates known-oversized chunks into failed single-job sub-batches,
  and emits the opt-in `memory_contextual_embed_split` protocol metric when a
  contextual batch is split. For `voyage-context-3`, runtime limits keep the
  official 32,000 estimated-token ceiling for one contextual input chunk
  separate from the 120,000 estimated-token contextual group/request budget and
  the 16,000 chunk request cap.
- Regression proof:
  `server/fastify/__tests__/memoryEmbedJobHandler.test.ts` /
  `L21: fails an oversized single chunk before provider request construction`,
  `L21: fails an oversized non-contextual batch item before provider dispatch`,
  `L21: fails an oversized contextual chunk before provider request construction`,
  `L22: sends a valid contextual batch under the model window in one request`,
  and `L22: emits a protocol metric when provider limits split a contextual batch`.
  Adapter/model proof lives in
  `server/fastify/__tests__/memoryEmbeddingAdapter.test.ts` /
  `L21: rejects oversized inputs before constructing an embedding request body`
  and `L22: rejects grouped contextual inputs when the request has no context limit`,
  plus `server/fastify/__tests__/memoryEmbeddingModel.test.ts` /
  `L21: formats per-input size violations with the offending bound`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L21 and L22
  `DONE` with the focused proof paths;
  `.archived-docs/audit-stability-and-performance-v2/active-risk-analysis.md`
  marks both rows `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryChunkPlanner.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memoryEmbeddingAdapter.test.ts \
  server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
