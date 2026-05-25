# Phase 8 Memory - 8-6a Closeout

Date: 2026-05-25

## Scope Landed

- Added `selectPromptMemory` under
  `server/fastify/src/prompt/memoryAdapter.ts`.
- Defined the prompt-facing adapter input around explicit enablement,
  chat/model context, supplied query vectors, available memory tokens,
  budget allocator settings, and optional selector injection for tests.
- Added enable/disable reasons for disabled feature state, missing
  chat/model context, and empty token budget.
- Delegated ready-memory reads to `selectMemorySummaries` and returned
  selected summaries, important/recent/similar/random buckets, ranked
  similar summaries, and selection diagnostics.
- Added adapter diagnostics for disabled state, whether selection was
  attempted, missing-memory hints, and no-hot-path-work guarantees.
- Added focused tests for disabled memory, empty memory, selected-summary
  passthrough, diagnostics passthrough, and injected-selector
  no-hot-path-work behavior.

## Boundaries

- No schema change was needed.
- No query embedding generation, provider calls, summary generation,
  queue writes, prompt-row assembly, root prompt assembler integration,
  browser listeners, or browser UI landed.
- Missing-memory diagnostics are passive hints for 8-6d; this slice does
  not enqueue follow-up work.
- The adapter reuses `selectMemorySummaries`; it does not duplicate
  repository, ranking, or allocation rules.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

Focused 8-6a verification passed with 5 tests. `pnpm check` was clean.
Full baseline verification after this slice passed: `pnpm test` with 639
tests plus 4 skipped, `pnpm api:test` with 1033 tests, and `pnpm build`
with the existing CSS `::highlight`, browser externalization,
plugin-timing, and chunk-size warnings.

## Next Pickup

Continue with 8-6b - Summary prompt-row assembly. Convert selected
`MemorySummary` rows from the prompt memory adapter into canonical
`memo: "hypaMemory"` prompt rows while keeping provider calls, query
embedding generation, summary generation, queue writes, root assembler
integration, and browser UI out of scope.
