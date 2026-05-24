# Phase 8 Memory - 8-5e Closeout

Date: 2026-05-25

## Scope Landed

- Added `memoryBudgetAllocator`, a pure server-side helper for selecting
  supplied `MemorySummary` rows across important, recent, similar, and
  random buckets.
- Preserved Hypa V3 allocation semantics: important summaries consume the
  global budget first, remaining budget is split by recent/similar/random
  ratios, recent walks newest-to-oldest, similar consumes supplied
  `RankedMemorySummary` rows, and random can reuse unspent recent/similar
  budget.
- Made random selection deterministic with a seed-based stable ordering
  for focused tests and future facade wiring.
- Suppressed duplicate summary ids across inputs and categories, then
  returned final selected summaries in canonical input order for prompt
  assembly.
- Added allocator diagnostics for consumed/remaining tokens, per-category
  budget pressure, duplicate ids, unknown ranked-similar rows, and missing
  allocation categories.
- Defaulted important-memory detection to `metadata.isImportant === true`
  and token cost to `MemorySummary.tokens`, with pure callbacks available
  for future prompt-adapter overhead adjustments.

## Boundaries

- No schema change was needed.
- No provider calls, repository reads/writes, queue operations, prompt
  assembly reads, browser listeners, or browser UI landed.
- Similarity scoring remains in 8-5d; this slice only consumes ranked
  similar summaries.
- Prompt-facing repository orchestration remains in 8-5f.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryBudgetAllocator.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

Focused 8-5e verification passed with 6 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 1023 tests. `pnpm build` passed with the existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-5f - Memory selection service facade. Compose repository
reads, `memorySimilarityRanking`, and `memoryBudgetAllocator`; return
selected summaries plus diagnostics for missing chunks, missing
summaries, missing embeddings, and allocator budget pressure. Keep
provider calls, embedding generation, summarization, jobs, prompt-row
assembly, and browser UI out of scope.
