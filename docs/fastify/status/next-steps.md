# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-7b added a thin browser-side Fastify memory API adapter at
`src/ts/process/request/serverMemory.ts`. It is gated by
`isFastifyServer`, authenticates through `getNodeServerProxyAuth`, and
preserves the current Fastify JSON envelopes directly for `{ chunks }`,
`{ summaries }`, `{ jobs }`, and `{ job }` cancellation responses.

## Immediate Pickup

Continue Phase 8 with **8-7c - Browser progress listener**.

Expected scope:

- Wire server memory progress events into the existing
  `hypaV3ProgressStore` shape.
- Consume the `hypav3_progress` side effect shape produced by
  `server/fastify/src/memoryEvents.ts`.
- Keep the listener behind existing server-backed/Fastify gates.
- Preserve the existing browser progress store fields (`open`,
  `miniMsg`, `msg`, `subMsg`) so UI components do not need to learn the
  server event contract yet.

Out of scope for 8-7c:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in route handlers.
- Browser list/cancel controls.
- Browser-local embedding runtimes.
- Removing the legacy browser-local Hypa V3 runtime.

Implementation notes:

- The browser adapter from 8-7b lives in
  `src/ts/process/request/serverMemory.ts`.
- Server memory event types and side-effect payloads live in
  `server/fastify/src/memoryEvents.ts`.
- The target browser store is `hypaV3ProgressStore` in
  `src/ts/stores.svelte.ts`.
- There is not yet a dedicated browser memory event stream adapter; if
  8-7c needs one, keep it narrow and gate it on Fastify/server-backed
  mode.
- Preserve the no-compatibility-migrations policy: update current
  Fastify/browser adapter shapes directly if the contract needs a tighter
  shape.

## Queue After 8-7b

1. 8-7c - Browser progress listener.
2. 8-7d - Memory job list/cancel UI path.
3. 8-7e - `hypav3-memory` fixture parity.

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

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-7b.md`](../phases-completed/phase-8-memory-8-7b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
