# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

8-7e added server-backed `hypav3-memory` fixture parity. The `/chat`
fixture pins the rendered `hypaMemory` row, applies a Fastify
`hypav3_progress` terminal side effect into `hypaV3ProgressStore`,
preserves memory job list/cancel envelopes through the browser adapter,
and asserts missing-memory diagnostics for best-effort summarize/embed
follow-up enqueueing.

## Immediate Pickup

Continue Phase 8 with **8-8 - live chunk-planning hook**.

Expected scope:

- Wire the existing server chunk planner into a production path so a
  server-backed chat with no memory rows can create `memory_chunks` and
  enqueue `summarize` jobs after crossing the Hypa V3 window.
- Decide whether the hook is a concrete `chunk` job handler or a
  post-chat/post-assembly server task, then document the chosen boundary.
- Keep prompt assembly non-blocking; missing summaries and embeddings
  should continue to enqueue follow-up work best-effort.
- Preserve the current memory API envelopes and browser adapter shapes.

Out of scope for 8-8:

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
- `server/fastify/src/memoryWorker.ts` still defaults `chunk` to
  `noopMemoryJobHandler`; `embed` and `summarize` have real default
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

## Queue After 8-7e

1. 8-8 - live chunk-planning hook.
2. 8-9 - Phase 8 closeout.
3. Phase 9 - Client thinning.

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

Last recorded full baselines after 8-7e: `pnpm check` clean,
`pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1048 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Latest focused/full 8-7e verification:

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
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
