# Phase 8 Memory - 8-6b Closeout

Date: 2026-05-25

## Scope Landed

- Added `assemblePromptMemoryRows` under
  `server/fastify/src/prompt/memoryAdapter.ts`.
- Converted selected `MemorySummary` rows from `selectPromptMemory` into
  canonical `OpenAIChat` memory rows with `role: "system"` and
  `memo: "hypaMemory"`.
- Preserved selected-summary order from the selection facade as the
  deterministic prompt-row order.
- Trimmed summary text and skipped whitespace-only summaries instead of
  emitting empty prompt rows.
- Added separate row-assembly diagnostics for input summary count,
  emitted row count, skipped empty summary ids, and prompt-row assembly
  work, while preserving the original selection diagnostics object.
- Added focused tests for empty selections, single summary rows,
  multiple-row ordering, memo/role/content shape, empty-row behavior, and
  diagnostics preservation.

## Boundaries

- No schema change was needed.
- No root prompt assembler integration landed; that remains 8-6c.
- No query embedding generation, provider calls, summary generation,
  queue writes, follow-up enqueueing, browser listeners, or browser UI
  landed.
- The row assembly helper consumes `selectPromptMemory` output; it does
  not call repositories, ranking, or allocation helpers directly.
- Missing-memory diagnostics remain passive hints for 8-6d.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

Focused 8-6b verification passed with 9 tests. `pnpm check` was clean.
The last recorded full baseline remains the post-8-6a run:
`pnpm test` with 639 tests plus 4 skipped, `pnpm api:test` with 1033
tests, and `pnpm build` with the existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-6c - Assemble integration. Wire the root server prompt
assembler to call `selectPromptMemory`, pass the result through
`assemblePromptMemoryRows`, and feed the resulting `memo: "hypaMemory"`
rows into the existing memory-card split. Keep provider-backed query
embedding generation, summary generation, queue writes, and
missing-memory follow-up enqueueing out of this slice.
