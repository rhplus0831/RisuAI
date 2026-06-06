# Phase 3: Memory Subsystem (Theme 7)

Status: pending — NEXT.

Goal: make the Hypa V3 memory budget actually work, and remove the per-send
memory waste around it. M2 is one of the plan's two scheduled behavior
corrections: once the budget is enforced, assembled prompts for
memory-enabled chats with accumulated summaries change intentionally.

Findings: M2, L15, L16, K1.

## Planned Slices

Author under `slices/phase-3-memory-subsystem/` when starting.

- [summary-token-budget](slices/phase-3-memory-subsystem/summary-token-budget.md)
  (M2) — supply `getSummaryTokenCost` in the
  `assemble.ts` `selectPromptMemory` call that tiktoken-counts
  `summary.text` when `summary.tokens === 0` (repairs new AND
  already-persisted rows; the plumbing exists end-to-end). Optionally also
  measure tokens at persist time (summarize handler + legacy import) so new
  rows carry real counts.
- [prefix-token-memo](slices/phase-3-memory-subsystem/prefix-token-memo.md)
  (L15) — per-row token memo (WeakMap or content-hash,
  the `PreparedScript` memo shape) so the immutable summarized prefix
  tokenizes once instead of every send.
- [memory-fetch-deadline](slices/phase-3-memory-subsystem/memory-fetch-deadline.md)
  (L16) — arm a default deadline (constant; no model
  field exists) on the already-threaded AbortControllers in the embed and
  summarize handlers, cleared in `finally`; adapters already convert an
  aborted signal into a retryable failure. Covers the summarize path's real
  fetch site (`runOpenAI`).
- [skip-dead-embedding-decode](slices/phase-3-memory-subsystem/skip-dead-embedding-decode.md)
  (K1) — skip or lazify the
  `decodeEmbeddingVector` per-row decode when no valid query vectors exist
  (the live wiring passes `() => []`), preserving the chunkId-only
  consumers. This is the v2-R5 re-open with corrected reasoning.
- [phase-3-verification-refresh](slices/phase-3-memory-subsystem/phase-3-verification-refresh.md)
  — gates, focused proofs, full validation,
  latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M2, L15, L16; K1 under Known-Item Overlaps (first row).
- M2: `server/fastify/src/memorySummaryAdapter.ts` (`summarizeOnce`
  `tokens: 0`), `memorySummarizeJobHandler.ts` (persist),
  `memoryLegacyImport.ts` (also persists 0), `memoryBudgetAllocator.ts`
  (`defaultSummaryTokenCost`), `prompt/assemble.ts` (`selectPromptMemory`
  call), `prompt/memoryAdapter.ts` (`getSummaryTokenCost` plumbing),
  `prompt/memory.ts` (`hypaMemory` rows are non-removable),
  `prompt/budgetFinalize.ts` (overflow abort path).
- L15: `memoryPlanner.ts` (`planStandardHypaV3Memory` prefix
  `sumChatTokens`; the per-window encode fires only in summarization mode),
  `prompt/tokens.ts` (encoder cache exists; per-text encode is uncached).
- L16: `memoryEmbedJobHandler.ts` (both controllers),
  `memorySummarizeJobHandler.ts`, `memoryEmbeddingAdapter.ts` (signal
  forwarding), `generation/openai.ts` (`runOpenAI`), `memoryWorker.ts`
  (single-flight `inFlight`).
- K1: `memorySelectionService.ts` (`listMemoryEmbeddings` call),
  `memoryRepository.ts` (`mapMemoryEmbeddingRow`, `decodeEmbeddingVector`),
  `memorySimilarityRanking.ts` (`validQueries` loop),
  `routes/generationChat.ts` (`loadPromptMemoryQueryVectors: () => []`).

## Planned Shape

- M2 must document and test the behavior change: with the budget enforced,
  the `recent`/`important`/`similar` category caps engage and
  `memoryTokensRatio` matters again. Test both the selection counts and the
  no-overflow property (`hypaMemory` rows are non-removable in
  `finalizeRequestBudget`, so over-injection previously displaced history
  rows and could abort the send).
- Prefer fix shape (b) from the audit (selection-time fallback count); a
  persist-time measure alone would NOT repair existing rows.
- L16's deadline must comfortably exceed legitimate provider latency
  (60-120 s starting point) and is a bound, not a behavior change: the job
  fails-and-retries with backoff instead of wedging the single-flight
  worker.
- K1 must keep `listMemoryChunks`/diagnostics consumers working; only the
  vector decode is skipped/lazified when queries are empty.
- I6 (summarize-handler existence scan) may ride this phase for free
  (hoist the shared chatId check per batch or use an indexed probe).

## Exit Criteria

- [ ] M2: summaries are budget-capped on a memory-enabled send (selection
      respects `memoryTokensRatio` and category ratios); existing
      `tokens: 0` rows are costed via the fallback; behavior change
      documented in the slice and tests.
- [ ] L15: repeated sends on an unchanged summarized prefix perform zero
      re-encodes of prefix rows (count probe).
- [ ] L16: a hung embed/summarize endpoint fails the job within the deadline
      and the worker proceeds; legitimate slow calls under the deadline
      unaffected.
- [ ] K1: memory-enabled sends decode zero embedding vectors when query
      vectors are empty; similarity path (tests with real vectors)
      unchanged.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
