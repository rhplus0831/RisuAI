# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-7e added `hypav3-memory` fixture parity coverage for the server-backed
path. The server-backed `/chat` fixture now pins the rendered
`hypaMemory` row, applies a Fastify `hypav3_progress` terminal side
effect into `hypaV3ProgressStore`, preserves memory job list/cancel
envelopes through the browser adapter, and explicitly asserts the
missing-memory diagnostics that drive best-effort summarize/embed
follow-up enqueueing.

## Immediate Pickup

Continue Phase 8 with **8-8 - Phase 8 closeout**.

Expected scope:

- Confirm the full verification matrix remains green.
- Document the supported Hypa V3 memory model/provider paths and the
  intentionally unsupported browser-local paths.
- Update the live handoff to Phase 9 client thinning once Phase 8 exit
  criteria are satisfied.
- Keep the closeout concise; historical detail belongs in
  `../phases-completed/`.

Out of scope for 8-8:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser-local embedding runtimes.
- Removing the legacy browser-local Hypa V3 runtime.
- Bulk re-summary and per-summary metadata edits in server-backed mode.
- New browser UI.

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
- The 8-7e fixture parity assertions live in
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`,
  `src/ts/process/request/tests/serverMemory.test.ts`, and
  `server/fastify/__tests__/assemble.test.ts`.
- Preserve the no-compatibility-migrations policy: update current
  Fastify/browser adapter shapes directly if the contract needs a tighter
  shape.

## Queue After 8-7e

1. 8-8 - Phase 8 closeout.
2. Phase 9 - Client thinning.

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

Last recorded full baselines after 8-7e: `pnpm check` clean,
`pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1048 tests, and
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

Focused/full 8-7e verification:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

8-7e passed the server-backed fixture file with 27 tests, the browser
memory adapter file with 12 tests, the focused Fastify assembler/adapter
files with 52 tests, `pnpm check` clean, `pnpm test` with 652 tests plus
4 skipped, `pnpm api:test` with 1048 tests, and `pnpm build` with the
existing warning set.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-7e.md`](../phases-completed/phase-8-memory-8-7e.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
