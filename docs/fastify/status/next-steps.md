# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-1a-ii landed the Hypa V3 memory table foundation in `risu.db`:
`CURRENT_SCHEMA_VERSION` is now 2, fresh opens create
`memory_chunks`, `memory_summaries`, `memory_embeddings`, and
`memory_jobs`, and focused DB / bootstrap / smoke tests cover table
presence, reopen idempotence, memory check constraints, JSON payload
validation, and chunk cascade behavior.

## Immediate Pickup

Continue Phase 8 with **8-1b - Memory repositories + row mappers**.

Expected scope:

- Add typed repository methods and row mappers for chunks, summaries,
  embeddings, and jobs.
- Cover create / read / update primitives, vector encode/decode, status
  filtering, uniqueness conflicts, and validation errors.
- Preserve the schema shape from 8-1a-ii, including
  `memory_embeddings.group_id` and `group_index` for later contextual
  embedding support.
- Keep jobs as inert data rows; queue state-machine behavior starts in
  8-2a.

Out of scope for 8-1b:

- Legacy `hypaV3Data` import/backfill, workers, routes, provider calls,
  SSE progress, prompt memory selection, and browser UI.

## Queue After 8-1b

1. 8-1c - Legacy `hypaV3Data` import/backfill.
2. 8-2a - Memory job queue state machine.
3. 8-2b - Worker lifecycle + stub dispatch.

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

Last recorded full baselines after 8-1a-ii: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 902 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and bundle-size warnings.

Focused 8-1a-ii verification:

```bash
pnpm exec vitest run server/fastify/__tests__/db.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/smoke.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- 8-1a-i closeout:
  [`../phases-completed/phase-8-memory-8-1a-i.md`](../phases-completed/phase-8-memory-8-1a-i.md)
- 8-1a-ii closeout:
  [`../phases-completed/phase-8-memory-8-1a-ii.md`](../phases-completed/phase-8-memory-8-1a-ii.md)
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
