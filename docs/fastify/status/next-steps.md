# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-3b landed `cleanupOrphanedMemory()` in
`server/fastify/src/memoryRepository.ts`. The cleanup pass reads
summary `metadata.chatMemos`, respects `preserveOrphanedMemory`, deletes
orphaned `memory_summaries` rows and their parent `memory_chunks` rows
inside one transaction, and relies on the existing `chunk_id` cascade for
matching `memory_embeddings`. The pass is idempotent and preserves
summaries whose metadata does not expose a `chatMemos` array.

## Immediate Pickup

Continue Phase 8 with **8-3c - Pure summarization window planner**.

Expected scope:

- Port the pure summarization window planner behavior from the standard
  Hypa V3 path.
- Cover start-index selection, memory-token reservation,
  summary-window selection, skip rules for examples/new/empty/user
  messages, target-token stopping, and "cannot summarize further"
  guards.
- Return planned windows and token deltas only.
- Keep the output deterministic for the 8-3d chunk/job bridge.

Out of scope for 8-3c:

- DB writes, job enqueueing, provider calls, summary prompt construction,
  embedding, memory prompt selection, browser listeners, and browser
  list/cancel controls.

## Queue After 8-3c

1. 8-3d - Chunk/job planning bridge.
2. 8-4a - Summary prompt builder.

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

Last recorded full baselines after 8-3b: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 946 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-3b verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- 8-1a-i closeout:
  [`../phases-completed/phase-8-memory-8-1a-i.md`](../phases-completed/phase-8-memory-8-1a-i.md)
- 8-1a-ii closeout:
  [`../phases-completed/phase-8-memory-8-1a-ii.md`](../phases-completed/phase-8-memory-8-1a-ii.md)
- 8-1b closeout:
  [`../phases-completed/phase-8-memory-8-1b.md`](../phases-completed/phase-8-memory-8-1b.md)
- 8-1c closeout:
  [`../phases-completed/phase-8-memory-8-1c.md`](../phases-completed/phase-8-memory-8-1c.md)
- 8-2a closeout:
  [`../phases-completed/phase-8-memory-8-2a.md`](../phases-completed/phase-8-memory-8-2a.md)
- 8-2b closeout:
  [`../phases-completed/phase-8-memory-8-2b.md`](../phases-completed/phase-8-memory-8-2b.md)
- 8-2c closeout:
  [`../phases-completed/phase-8-memory-8-2c.md`](../phases-completed/phase-8-memory-8-2c.md)
- 8-2d closeout:
  [`../phases-completed/phase-8-memory-8-2d.md`](../phases-completed/phase-8-memory-8-2d.md)
- 8-2e closeout:
  [`../phases-completed/phase-8-memory-8-2e.md`](../phases-completed/phase-8-memory-8-2e.md)
- 8-3a closeout:
  [`../phases-completed/phase-8-memory-8-3a.md`](../phases-completed/phase-8-memory-8-3a.md)
- 8-3b closeout:
  [`../phases-completed/phase-8-memory-8-3b.md`](../phases-completed/phase-8-memory-8-3b.md)
- Phase 7 closeout:
  [`../phases-completed/phase-7-prompt-assembly-closeout.md`](../phases-completed/phase-7-prompt-assembly-closeout.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- 7-12d-i closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md)
- 7-12d-ii closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-ii.md`](../phases-completed/phase-7-prompt-assembly-7-12d-ii.md)
- 7-12d-iii-a closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md)
- 7-12d-iii-b closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md)
- 7-12d-iv closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iv.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iv.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
