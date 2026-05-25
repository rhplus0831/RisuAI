# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-6c wired the root server prompt assembler to the prompt-memory adapter.
`AssembleDeps` can now supply the SQLite memory database and already
computed query vectors. The route passes the live SQLite handle and an
empty vector list; tests inject seeded vectors. The assembler resolves the
active Hypa V3 preset, calls `selectPromptMemory`, converts the selection
through `assemblePromptMemoryRows`, prepends canonical
`memo: "hypaMemory"` rows into the existing `buildMemoryWindow` split,
and preserves the current memory-card contract. This remains read-only:
no provider-backed query embedding generation, summary generation, embed
work, or queue writes landed.

## Immediate Pickup

Continue Phase 8 with **8-6d - Missing-memory follow-up enqueue**.

Expected scope:

- Consume the passive missing-memory diagnostics now surfaced by the
  prompt-memory adapter integration.
- Enqueue idempotent `chunk`, `summarize`, and `embed` follow-up jobs
  best-effort after prompt assembly detects missing memory.
- Keep prompt assembly non-blocking: enqueue failures should not abort
  chat unless an existing route-level invariant requires it.
- Preserve the hot-path boundary: do not generate summaries, embeddings,
  or query vectors synchronously during prompt assembly.
- Add focused tests for idempotent enqueue behavior, no-op behavior when
  diagnostics show no missing memory, and failure isolation.

Out of scope for 8-6d:

- Embedding provider dispatch and query embedding generation.
- Summary generation and embedding provider work in the prompt request
  hot path.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- 8-6c stores selection diagnostics on `AssemblyState` as
  `promptMemorySelectionDiagnostics` and row diagnostics as
  `promptMemoryRowAssemblyDiagnostics`.
- Missing-memory hints are still passive after 8-6c. 8-6d should convert
  them into best-effort queue writes without making selection call lower
  repository/ranking/allocation helpers directly.
- The route-bound assembler dependency now passes the live SQLite handle
  through `loadMemoryDatabase`; tests can inject seeded memory databases.
- Query vectors remain supplied by `loadPromptMemoryQueryVectors`. Do not
  add provider-backed query embedding generation in 8-6d.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-6c

1. 8-6d - Missing-memory follow-up enqueue.
2. 8-7a - Chunk + summary read routes.

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

Focused 8-6c verification:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

8-6c passed the focused assembler/adapter files with 49 tests, and
`pnpm check` was clean.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-6c.md`](../phases-completed/phase-8-memory-8-6c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
