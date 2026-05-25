# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-7d added the minimal server-backed memory job UI path. The Hypa V3
modal now shows a Fastify/server-prompt-assembly gated pending/running job
panel using `listServerMemoryJobs`, supports per-job cancellation through
`cancelServerMemoryJob`, refreshes on open/chat changes and periodically,
and keeps local bulk/per-summary edit controls disabled while
server-backed memory mode is active.

## Immediate Pickup

Continue Phase 8 with **8-7e - `hypav3-memory` fixture parity**.

Expected scope:

- Pin canonical memory prompt rows for the server-backed
  `hypav3-memory` fixture path.
- Cover missing-memory diagnostics that drive the best-effort follow-up
  job enqueue path.
- Cover browser-visible memory side effects that are now wired through
  progress and list/cancel surfaces where the existing fixture harness can
  observe them.
- Keep any fixture updates narrowly tied to current Fastify/server-backed
  behavior; do not preserve old intermediate Fastify shapes.

Out of scope for 8-7e:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser-local embedding runtimes.
- Removing the legacy browser-local Hypa V3 runtime.
- Bulk re-summary and per-summary metadata edits in server-backed mode.
- New browser UI beyond fixture-observable parity.

Implementation notes:

- The browser adapter from 8-7b lives in
  `src/ts/process/request/serverMemory.ts`.
- It now contains both read/list/cancel helpers and the 8-7c
  `applyServerHypaV3Progress` mapper.
- The 8-7d UI lives in
  `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte` and is mounted
  by `src/lib/Others/HypaV3Modal.svelte` only when Fastify plus
  `DBState.db.useServerPromptAssembly` are active.
- Local Hypa V3 editing remains available outside server-backed mode;
  server-backed mode treats the legacy modal summary list as read-only.
- Fixture files live under `src/ts/process/__fixtures__/`; the current
  `hypav3-memory` expected output is the main target.
- Preserve the no-compatibility-migrations policy: update current
  Fastify/browser adapter shapes directly if the contract needs a tighter
  shape.

## Queue After 8-7d

1. 8-7e - `hypav3-memory` fixture parity.
2. 8-8 - Phase 8 closeout.

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

Last recorded full baselines after 8-7d: `pnpm check` clean,
`pnpm test` 650 tests plus 4 skipped, `pnpm api:test` 1048 tests, and
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

Focused 8-7b verification:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
```

8-7b passed the focused browser adapter file with 9 tests.

Focused 8-7c verification:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
pnpm check
```

8-7c passed the focused browser adapter file with 11 tests, and
`pnpm check` was clean.

Focused/full 8-7d verification:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

8-7d passed the focused browser adapter file with 11 tests, `pnpm check`
was clean, `pnpm test` passed with 650 tests plus 4 skipped,
`pnpm api:test` passed with 1048 tests, and `pnpm build` passed with the
existing warning set.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-7d.md`](../phases-completed/phase-8-memory-8-7d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
