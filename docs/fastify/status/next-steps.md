# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-7a added auth-gated memory read routes:
`GET /api/v1/memory/chunks/:chatId` and
`GET /api/v1/memory/summaries/:chatId?model=...`. The routes use the
current repository readers directly, return `{ chunks }` and
`{ summaries }` JSON envelopes, validate empty model filters, preserve
repository ordering, and keep old intermediate Fastify/browser memory
shapes out of the contract.

## Immediate Pickup

Continue Phase 8 with **8-7b - Browser memory API adapter**.

Expected scope:

- Add a thin browser-side server-backed memory client for the 8-7a read
  routes.
- Include server-backed calls for memory job listing and cancellation so
  the later UI path does not need to know route details.
- Keep the adapter behind existing server-backed/Fastify gates; do not
  remove the legacy browser-local Hypa V3 runtime until the browser
  progress/list UI slices have landed.
- Preserve the current Fastify JSON contract directly:
  `{ chunks }`, `{ summaries }`, and `{ jobs }`.

Out of scope for 8-7b:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Read-route tests live in
  `server/fastify/__tests__/memoryReadRoutes.test.ts`.
- The route module is `server/fastify/src/routes/memoryReads.ts` and is
  registered next to `registerMemoryJobRoutes` in `app.ts`.
- Route auth behavior follows `memoryJobs.ts`; browser calls should pass
  the same `risu-auth` assertion plumbing used by other server-backed
  APIs.
- Preserve the no-compatibility-migrations policy: update current
  Fastify/browser adapter shapes directly if the contract needs a tighter
  shape.

## Queue After 8-7a

1. 8-7b - Browser memory API adapter.
2. 8-7c - Browser progress listener.
3. 8-7d - Memory job list/cancel UI path.
4. 8-7e - `hypav3-memory` fixture parity.

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

Focused 8-7a verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryReadRoutes.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts --config server/fastify/vitest.config.ts
```

8-7a passed the focused route files with 12 tests.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-7a.md`](../phases-completed/phase-8-memory-8-7a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
