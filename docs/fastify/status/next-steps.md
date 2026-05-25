# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

8-8 wired the live chunk-planning hook into server prompt assembly. The
assembler now runs the standard Hypa V3 planner before prompt-memory
selection, creates deterministic `memory_chunks`, and enqueues
idempotent `summarize` jobs when the active chat crosses the configured
Hypa V3 window. The hook is a best-effort prompt-assembly task, not a
concrete `chunk` worker handler; prompt rendering continues when planner
validation reports errors.

## Immediate Pickup

Continue Phase 8 with **8-9 - Phase 8 closeout**.

Expected scope:

- Run the full verification matrix and record the 8-8 baseline.
- Confirm the Phase 8 exit criteria in
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md).
- Update the live handoff to Phase 9 once the closeout is complete.
- Keep completed logs in [`../phases-completed/`](../phases-completed/).

Out of scope for 8-9:

- Query embedding generation.
- Summary or embedding provider work inside route handlers.
- Browser-local embedding runtimes.
- Removing the legacy browser-local Hypa V3 runtime.
- Bulk re-summary and per-summary metadata edits in server-backed mode.
- New browser UI.

Implementation notes:

- `server/fastify/src/memoryChunkPlanner.ts` already exposes
  `planHypaV3ChunkJobs`, which creates deterministic chunks and
  idempotent `summarize` jobs from a standard Hypa V3 plan.
- `server/fastify/src/prompt/assemble.ts` calls that planner as a
  prompt-assembly hook before `selectPromptMemory`; it records
  `promptMemoryChunkPlanningDiagnostics` and catches planner failures so
  prompt assembly remains non-blocking.
- `server/fastify/src/memoryWorker.ts` still defaults `chunk` to
  `noopMemoryJobHandler`; this is intentional after 8-8 because live
  chunk planning is driven from the prompt assembly context instead of a
  queued chunk snapshot. `embed` and `summarize` have real default
  handlers wired from `server/fastify/src/app.ts`.
- `server/fastify/src/prompt/memoryFollowups.ts` only enqueues
  `summarize`/`embed` follow-ups for chunks that already exist; it cannot
  recreate missing chunk windows safely.
- The browser memory adapter lives in
  `src/ts/process/request/serverMemory.ts` and preserves `{ chunks }`,
  `{ summaries }`, `{ jobs }`, and `{ job }` envelopes.
- The 8-7d memory job UI lives in
  `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte` and is mounted
  by `src/lib/Others/HypaV3Modal.svelte` only when Fastify plus
  `DBState.db.useServerPromptAssembly` are active.
- Local Hypa V3 editing remains available outside server-backed mode;
  server-backed mode treats the legacy modal summary list as read-only.
- Supported server summary path: `subModel` when it resolves to an
  API-backed OpenAI-compatible provider (`openai`, `nanogpt`, or
  `openrouter`).
- Supported server embedding paths: `custom`, `ada`, `openai3small`,
  `openai3large`, and `voyageContext3`. Browser-local models such as
  MiniLM, Nomic, BGE, transformers.js, WebGPU, MLC, ONNX, and WebLLM
  remain unsupported server-side.

## Queue After 8-8

1. 8-9 - Phase 8 closeout.
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
slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 8-8: `pnpm check` clean,
`pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1050 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Latest focused/full 8-8 verification:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/memoryChunkPlanner.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

8-8 focused verification passed with 50 tests. `pnpm check` was clean,
`pnpm test` passed with 652 tests plus 4 skipped, `pnpm api:test`
passed with 1050 tests, and `pnpm build` passed with the existing
warning set.

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-8.md`](../phases-completed/phase-8-memory-8-8.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
