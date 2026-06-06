# Slice: Memory Job Failure Cascade Scope

Phase: [8](../../phase-8-server-bounds.md). Finding: L19. Runtime change.
Status: done on 2026-06-06 KST.

## Scope

Constrain memory job fail-cascade behavior so transient failures only poison
the jobs that actually depend on the failed contextual batch. Independent
concurrent jobs should remain retryable or continue committing normally.

This slice does not own worker tick cadence, terminal-job retention, chunk size
ceilings, or contextual window policy.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L19.
- `server/fastify/src/memoryEmbedJobHandler.ts`: batch commit path and
  contextual `voyageContext3` grouping.
- `server/fastify/src/memorySummarizeJobHandler.ts`: summarize batch commit
  path and current "stop after failure" behavior.
- `server/fastify/src/memoryRepository.ts`: job status transitions and retry
  metadata.
- Existing focused suites:
  `server/fastify/__tests__/memoryEmbedJobHandler.test.ts`,
  `server/fastify/__tests__/memorySummarizeJobHandler.test.ts`, and
  `server/fastify/__tests__/memoryWorker.test.ts`.

## Target Shape

- Identify which jobs are all-or-nothing because they share one contextual
  provider request or one ordered persistence unit.
- For independent concurrent embed/summarize jobs, mark only the failed job or
  failed dependency group according to the existing retry policy.
- Keep later independent jobs eligible for retry or commit rather than marking
  every later batch row failed after the first transient error.
- Preserve all-or-nothing semantics for a contextual group whose embeddings
  were produced from shared context and cannot be partially persisted safely.
- Make the failure result shape explicit enough that the worker can decide
  whether it made progress and whether to fast-path reschedule.
- Add tests for one transient failure among independent jobs, one contextual
  group failure, and an ordered persistence failure that should still stop at
  the unsafe boundary.
- Register L19 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Contextual embedding groups remain internally consistent.
- Successful jobs must not be persisted twice after a sibling failure.
- Retry counts, error messages, and terminal states stay compatible with the
  existing memory job routes.
- The change must not introduce parallel writes outside the repository's
  existing transaction boundaries.

## Done Criteria

- A transient failure in an independent job leaves unaffected jobs live or
  committed according to their actual result.
- Contextual group failure still marks the dependent group together.
- Focused tests cover embed and summarize handlers.
- The L19 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Proof

- Runtime:
  `server/fastify/src/memoryEmbedJobHandler.ts` isolates provider/result
  failures on the non-contextual path, keeps ordered commit failures as the
  stopping boundary, and persists new Voyage contextual group vectors in one
  transaction before completing the group. `server/fastify/src/memorySummarizeJobHandler.ts`
  applies the same independent-result versus ordered-commit split for summary
  batches.
- Regression proof:
  `server/fastify/__tests__/memoryEmbedJobHandler.test.ts` /
  `L19: commits independent embed jobs after a sibling provider failure`,
  `L19: retries an ordered Voyage contextual batch after provider failure`, and
  `L19: rolls back a Voyage contextual group when one staged vector cannot persist`;
  `server/fastify/__tests__/memorySummarizeJobHandler.test.ts` /
  `L19: commits independent summarize jobs after a sibling provider failure`
  and `L19: commits batch summaries in planned order only until the first failed write`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L19 `DONE` with
  the focused proof paths above; `docs/plan/active-risk-analysis.md` marks L19
  `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
