# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-7c wired server Hypa V3 progress side effects into the existing browser
progress store. `src/ts/process/request/serverMemory.ts` now exposes a
Fastify-gated `applyServerHypaV3Progress` mapper that accepts the
`hypav3_progress` payload shape, validates the legacy progress fields, and
sets `hypaV3ProgressStore` with only `open`, `miniMsg`, `msg`, and
`subMsg`. Server-backed chat terminal side-effect handling now applies
those progress payloads alongside the existing TTS side effect path.

## Immediate Pickup

Continue Phase 8 with **8-7d - Memory job list/cancel UI path**.

Expected scope:

- Add a minimal browser-visible pending / running job list for server
  memory jobs using the 8-7b adapter.
- Wire cancellation controls through `cancelServerMemoryJob`.
- Keep the UI behind existing server-backed/Fastify gates.
- Preserve existing local Hypa V3 controls where still needed outside
  server-backed mode.

Out of scope for 8-7d:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser-local embedding runtimes.
- Removing the legacy browser-local Hypa V3 runtime.
- Bulk re-summary and per-summary metadata edits in server-backed mode.

Implementation notes:

- The browser adapter from 8-7b lives in
  `src/ts/process/request/serverMemory.ts`.
- It now contains both read/list/cancel helpers and the 8-7c
  `applyServerHypaV3Progress` mapper.
- The target browser UI for existing Hypa V3 state is likely under
  `src/lib/Others/HypaV3Modal.svelte` and related utilities.
- Prefer narrow list/cancel wiring over broad modal cleanup; fixture
  parity is queued separately as 8-7e.
- Preserve the no-compatibility-migrations policy: update current
  Fastify/browser adapter shapes directly if the contract needs a tighter
  shape.

## Queue After 8-7c

1. 8-7d - Memory job list/cancel UI path.
2. 8-7e - `hypav3-memory` fixture parity.
3. 8-8 - Phase 8 closeout.

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

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-7c.md`](../phases-completed/phase-8-memory-8-7c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
