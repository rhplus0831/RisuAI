# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5f added `memorySelectionService`, a prompt-facing read-only facade
that loads ready summaries, chunks, and persisted embeddings for a
chat/model pair, ranks supplied query vectors with
`memorySimilarityRanking`, allocates summaries with
`memoryBudgetAllocator`, and returns repository/ranking/allocation
diagnostics. It accepts supplied query vectors and budget settings; it
does not call providers, generate embeddings, summarize, enqueue jobs, or
touch prompt assembly.

## Immediate Pickup

Continue Phase 8 with **8-6a - Prompt memory adapter contract**.

Expected scope:

- Define the server prompt-memory adapter contract that 8-6b/8-6c will
  use to request Hypa V3 memory rows during prompt assembly.
- Specify enable/disable rules, input context, selected-summary output,
  diagnostics, and how missing memory should be reported without doing
  hot-path provider work.
- Wire the contract to `selectMemorySummaries` only as far as needed to
  prove the boundary; canonical prompt rows start in 8-6b.
- Keep embedding generation, summary generation, queue writes, browser
  UI, and full prompt-row assembly out of this slice.
- Add focused tests for disabled memory, empty memory, selected-summary
  passthrough, diagnostics passthrough, and no-hot-path-work behavior.

Out of scope for 8-6a:

- Embedding provider dispatch and query embedding generation.
- Summary generation, chunk planning, queue writes, and follow-up job
  enqueueing.
- Summary prompt-row assembly; that starts in 8-6b.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Reuse `selectMemorySummaries`; do not duplicate repository, ranking, or
  allocation rules in the prompt adapter.
- `memorySelectionService` already reports repository diagnostics
  (`summaryIdsMissingEmbeddings`, `chunkIdsMissingSummaries`, counts),
  ranking diagnostics, and allocation diagnostics.
- Query vectors should still be supplied to the adapter. Generating those
  vectors remains deferred so prompt assembly stays free of provider
  calls.
- The adapter can define a stable shape for future 8-6d follow-up queue
  requests, but it should not enqueue them in 8-6a.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5f

1. 8-6b - Summary prompt-row assembly.
2. 8-6c - Assemble integration.

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

Last recorded full baselines after 8-5f: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1028 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5f verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySelectionService.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5f.md`](../phases-completed/phase-8-memory-8-5f.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
