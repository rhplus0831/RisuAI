# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5e added a pure `memoryBudgetAllocator` helper. It selects supplied
`MemorySummary` rows across important, recent, similar, and random
buckets, accepts ranked similar rows from `memorySimilarityRanking`,
uses deterministic seed-based random ordering, suppresses duplicates, and
returns diagnostics for budget pressure, unknown ranked rows, and missing
allocation categories. It does not call providers, read or write SQLite,
enqueue jobs, or touch prompt assembly.

## Immediate Pickup

Continue Phase 8 with **8-5f - Memory selection service facade**.

Expected scope:

- Add a prompt-facing memory selection service/facade under
  `server/fastify/src/` that orchestrates repository reads,
  `memorySimilarityRanking`, and `memoryBudgetAllocator`.
- Read ready summaries for a chat/model plus their chunks and persisted
  embeddings from the repository layer; keep writes out of this slice.
- Accept supplied query vectors and memory budget inputs from the future
  prompt adapter rather than generating embeddings in the hot path.
- Return selected summaries plus ranking/allocation diagnostics that
  8-6 can surface as missing-summary / missing-embedding / budget
  pressure information.
- Preserve the no-hot-path-work boundary: no provider calls, no
  summarization, no embedding generation, no queue enqueueing, and no
  browser UI.
- Add focused tests for repository orchestration, missing chunks /
  embeddings diagnostics, empty inputs, budget pressure passthrough,
  model/chat filtering, and deterministic allocator wiring.

Out of scope for 8-5f:

- Embedding provider dispatch and query embedding generation.
- Summary generation, chunk planning, queue writes, and follow-up job
  enqueueing.
- Prompt-row assembly; that starts in 8-6.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Reuse `listMemorySummaries`, `listMemoryChunks`, and
  `listMemoryEmbeddings`; avoid adding repository writes.
- Reuse the `RankedMemorySummary` output from
  `memorySimilarityRanking` and the `allocateMemorySummaries` output from
  `memoryBudgetAllocator`; the facade should compose these modules rather
  than duplicating their rules.
- `memoryBudgetAllocator` reads importance from `metadata.isImportant`
  by default and accepts a pure override. Imported legacy Hypa V3 rows
  already populate that metadata field.
- The allocator defaults token cost to `MemorySummary.tokens`; pass a
  pure callback later if the prompt adapter needs separator/system-row
  overhead included.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5e

1. 8-6a - Prompt memory adapter contract.
2. 8-6b - Summary prompt-row assembly.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run the relevant focused tests while implementing, then before closing a
slice run:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 8-5e: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1023 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5e verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryBudgetAllocator.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5e.md`](../phases-completed/phase-8-memory-8-5e.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
