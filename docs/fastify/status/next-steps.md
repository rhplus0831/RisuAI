# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-6d converted prompt-memory missing-memory diagnostics into
best-effort follow-up queue writes. The assembler now records
`promptMemoryFollowUpDiagnostics` after row assembly, enqueues
idempotent `summarize` jobs for chunks missing summaries, and enqueues
idempotent `embed` jobs for chunks missing embeddings. Failures are
captured in diagnostics and do not abort prompt assembly. Provider-backed
query embedding generation, synchronous summary/embedding work, and
browser UI work remain out of scope.

Important caveat: `summaryIdsMissingChunks` is recorded as skipped follow
up because the current diagnostics identify orphan summaries but do not
contain enough source-window data to recreate missing chunks safely.
`chunk` remains a queue kind with no concrete production handler; do not
enqueue decorative no-op chunk jobs.

## Immediate Pickup

Continue Phase 8 with **8-7a - Chunk + summary read routes**.

Expected scope:

- Add auth-gated `GET /api/v1/memory/chunks/:chatId`.
- Add auth-gated `GET /api/v1/memory/summaries/:chatId?model=...`.
- Return current schema rows through a browser-friendly JSON shape without
  compatibility adapters for old intermediate Fastify shapes.
- Keep route tests focused on auth, chat filtering, model filtering,
  ordering, and empty-result behavior.

Out of scope for 8-7a:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Use existing repository readers (`listMemoryChunks`,
  `listMemorySummaries`) and route auth patterns from memory job routes.
- Preserve current schema/import paths directly; there are still no
  actual Fastify users requiring compatibility migrations.
- 8-6d added `prompt/memoryFollowups.ts` and exported
  `buildSummarizeJobId`; if read-route tests need seeded jobs/chunks,
  prefer repository helpers over raw SQL.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-6d

1. 8-7a - Chunk + summary read routes.
2. 8-7b - Browser memory API adapter.

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

Last recorded full baselines after 8-6c: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1039 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-6d verification:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

8-6d passed the focused assembler/adapter files with 52 tests, and
`pnpm check` was clean.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-6d.md`](../phases-completed/phase-8-memory-8-6d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
