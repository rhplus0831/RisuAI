# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-6b added summary prompt-row assembly under
`server/fastify/src/prompt/memoryAdapter.ts`. The new
`assemblePromptMemoryRows` helper consumes the existing
`selectPromptMemory` result, preserves selected-summary order, trims
summary text, skips whitespace-only summaries, and emits canonical
`OpenAIChat` rows with `role: "system"` and `memo: "hypaMemory"`.
It returns separate row-assembly diagnostics while preserving the
selection diagnostics object from 8-6a. Provider calls, query embedding
generation, summary generation, queue writes, and root assembler
integration remain out of scope.

## Immediate Pickup

Continue Phase 8 with **8-6c - Assemble integration**.

Expected scope:

- Wire the root server prompt assembler to select prompt memory and pass
  assembled `memo: "hypaMemory"` rows into the existing memory-card split.
- Keep query vectors supplied by the integration boundary; do not add
  provider-backed query embedding generation in this slice.
- Preserve 8-6a/8-6b read-only behavior: integration may read selected
  summaries and assemble rows, but it must not summarize, embed, or
  enqueue follow-up jobs.
- Respect the existing `prompt/memory.ts` contract: memory template cards
  consume Hypa memory rows via `memories`; non-template/no-memory-card
  paths wrap them inline as previous conversation.
- Add focused tests that prove canonical rows reach the prompt assembly
  memory path without changing unrelated prompt sections.

Out of scope for 8-6c:

- Embedding provider dispatch and query embedding generation.
- Summary generation, chunk planning, queue writes, and follow-up job
  enqueueing.
- Missing-memory follow-up enqueueing; that starts in 8-6d.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Build on `selectPromptMemory` and `assemblePromptMemoryRows`; do not
  call repositories, ranking, allocation, or row-shaping helpers directly
  from the root assembler.
- `prompt/memory.ts` already recognizes `memo: "supaMemory"` and
  `memo: "hypaMemory"` rows. Newly assembled rows use `hypaMemory`.
- 8-6b row assembly diagnostics set
  `hotPathWork.assembledPromptRows: true`; the selection diagnostics
  still preserve the 8-6a no-assembly signal.
- Missing-memory follow-up hints are present but should remain passive
  until 8-6d.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-6b

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

Focused 8-6b verification:

```bash
pnpm exec vitest run server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

8-6b passed the focused adapter file with 9 tests, and `pnpm check` was
clean.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-6b.md`](../phases-completed/phase-8-memory-8-6b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
