# Slice: Summary Token Budget

Phase: [3](../../phase-3-memory-subsystem.md). Finding: M2. Runtime behavior
change.

## Scope

Make Hypa V3 prompt-memory selection enforce its token budget for both new and
already-persisted summaries whose `tokens` field is `0`.

This slice owns the intentional behavior correction where memory-enabled sends
stop injecting every accumulated summary. It does not own prefix-token
memoization, memory provider deadlines, or embedding decode laziness.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M2.
- `server/fastify/src/prompt/assemble.ts`: `buildPromptMemoryRowsForAssembly`
  and its `selectPromptMemory` call.
- `server/fastify/src/prompt/memoryAdapter.ts`:
  `PromptMemoryAdapterInput.getSummaryTokenCost` plumbing.
- `server/fastify/src/memoryBudgetAllocator.ts`: `defaultSummaryTokenCost`,
  category reservations, and allocation diagnostics.
- `server/fastify/src/memorySummaryAdapter.ts`,
  `server/fastify/src/memorySummarizeJobHandler.ts`, and
  `server/fastify/src/memoryLegacyImport.ts`: current `tokens: 0` persistence
  sources.
- `server/fastify/src/prompt/memory.ts` and
  `server/fastify/src/prompt/budgetFinalize.ts`: injected `hypaMemory` rows are
  non-removable, so overflow must be prevented during selection.
- Focused tests:
  `server/fastify/__tests__/memoryBudgetAllocator.test.ts`,
  `server/fastify/__tests__/memorySelectionService.test.ts`,
  `server/fastify/__tests__/promptMemoryAdapter.test.ts`, and
  `server/fastify/__tests__/generation.chat.test.ts`.

## Target Shape

- Supply `getSummaryTokenCost` from `buildPromptMemoryRowsForAssembly` when
  calling `selectPromptMemory`.
- Count `summary.text` with the same tiktoken encoding chosen for the current
  prompt assembly when `summary.tokens === 0`; keep positive persisted token
  counts as authoritative.
- Prefer a small per-assembly cache for fallback counts if a summary can be
  examined more than once during allocation. The required fix is the
  selection-time fallback, not a database rewrite.
- Optionally also measure and persist summary token counts in the summarize
  handler and legacy import path. That optional persist-time work must not
  replace the selection-time fallback because existing rows still need repair.
- Add or update tests that prove a memory-enabled send with many `tokens: 0`
  summaries selects by `memoryTokensRatio` and recent/similar category ratios
  instead of selecting every row.
- Cover the overflow prevention explicitly: a prompt with enough old summaries
  to displace all removable history before this fix should no longer reach the
  `finalizeRequestBudget` overflow path solely because zero-cost memory rows
  were over-injected.
- Register M2 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the M2 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- No database migration is required; copied legacy data may keep `tokens: 0`.
- Positive `summary.tokens` values remain the persisted cost source.
- Empty or whitespace-only summary text still assembles to no prompt row via
  the existing `assemblePromptMemoryRows` skip behavior.
- Important summaries remain selected before category-ratio allocation, subject
  to the total available memory budget.
- `hypaMemory` rows remain non-removable in final budget trimming; this slice
  fixes over-selection before finalization rather than making memory removable.

## Done Criteria

- Existing `tokens: 0` summaries are costed from text during live prompt-memory
  selection.
- Selection diagnostics show bounded `consumedTokens`, category
  `skippedForBudget` entries, and selected counts that change when
  `memoryTokensRatio`, `recentMemoryRatio`, or `similarMemoryRatio` changes.
- A regression test demonstrates the no-overflow property for memory bloat
  that previously crowded out history rows.
- M2 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryBudgetAllocator.test.ts \
  server/fastify/__tests__/memorySelectionService.test.ts \
  server/fastify/__tests__/promptMemoryAdapter.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
