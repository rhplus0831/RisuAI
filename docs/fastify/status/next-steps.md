# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-6a added the server prompt-memory adapter contract under
`server/fastify/src/prompt/memoryAdapter.ts`. The adapter accepts an
explicit enabled flag, chat/model context, supplied query vectors, memory
budget settings, and an optional injected selector. It delegates to
`selectMemorySummaries`, returns selected summaries plus category buckets,
passes selection diagnostics through, reports missing-memory hints for
future follow-up enqueueing, and records the no-hot-path-work guarantee.
It does not generate query embeddings, call providers, summarize,
enqueue jobs, or assemble prompt rows.

## Immediate Pickup

Continue Phase 8 with **8-6b - Summary prompt-row assembly**.

Expected scope:

- Convert selected `MemorySummary` rows from `selectPromptMemory` into
  canonical memory prompt rows.
- Preserve the existing prompt memory card contract by emitting rows that
  `prompt/memory.ts` can split as Hypa memory (`memo: "hypaMemory"`).
- Define deterministic row ordering, content wrapping, and empty-row
  behavior for selected summaries.
- Keep the adapter read-only: prompt-row assembly should consume
  selected summaries and diagnostics, not generate embeddings,
  summarize, or enqueue follow-up jobs.
- Add focused tests for empty summaries, single/multiple summary rows,
  ordering, memo/role/content shape, and diagnostics preservation.

Out of scope for 8-6b:

- Embedding provider dispatch and query embedding generation.
- Summary generation, chunk planning, queue writes, and follow-up job
  enqueueing.
- Root prompt assembler integration; that starts in 8-6c.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Build on `selectPromptMemory`; do not call repositories, ranking, or
  allocation helpers directly from the row assembly layer.
- `prompt/memory.ts` currently recognizes `memo: "supaMemory"` and
  `memo: "hypaMemory"` rows. New rows should use `hypaMemory`.
- 8-6a diagnostics include `hotPathWork.assembledPromptRows: false`;
  8-6b may introduce a separate row-assembly result while keeping
  provider/queue fields false.
- Missing-memory follow-up hints are present but should remain passive
  until 8-6d.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-6a

1. 8-6c - Assemble integration.
2. 8-6d - Missing-memory follow-up enqueue.

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

Last recorded full baselines after 8-6a: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1033 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-6a verification:

```bash
pnpm exec vitest run server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-6a.md`](../phases-completed/phase-8-memory-8-6a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
