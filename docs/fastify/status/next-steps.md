# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-2d landed the memory progress event contract. `memoryEvents.ts`
defines the reusable `memory.job` event shape plus the
Phase-7-compatible `hypav3_progress` side-effect payload. `MemoryWorker`
now accepts `onEvent` and emits deterministic job events for claim,
completion, retry, terminal failure, and boot recovery transitions.
Cancelled running jobs do not emit a misleading completion when their
handler later settles. Enqueue/cancel route emissions remain for 8-2e,
where those transitions will be introduced at the route boundary.

## Immediate Pickup

Continue Phase 8 with **8-2e - Memory job routes**.

Expected scope:

- Wire the auth-gated backend job API:
  `POST /api/v1/memory/jobs`, `GET /api/v1/memory/jobs`, and
  `DELETE /api/v1/memory/jobs/:id`.
- Reuse the 8-2d `memory.job` event contract for enqueue and cancel
  transitions where the route owns those state changes.
- Route tests should cover enqueue, list, cancel, validation failures,
  and unauthorized access.
- Keep responses deterministic and scoped to the current repository job
  shape.

Out of scope for 8-2e:

- Provider calls, real memory mutation handlers, chunk/summary read
  routes, browser UI listeners, and browser list/cancel controls.

## Queue After 8-2e

1. 8-3a - Hypa V3 settings + planner contract.
2. 8-3b - Orphan cleanup.

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

Last recorded full baselines after 8-2d: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 931 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-2d verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
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
