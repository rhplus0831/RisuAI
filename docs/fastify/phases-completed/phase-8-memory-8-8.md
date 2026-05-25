# Phase 8 Memory - 8-8 Closeout

Date: 2026-05-25

## Scope Landed

- Wired the live chunk-planning hook into
  `server/fastify/src/prompt/assemble.ts` before prompt-memory
  selection.
- Reused the standard Hypa V3 planner plus `planHypaV3ChunkJobs` so a
  server-backed chat with no memory rows can create deterministic
  `memory_chunks` and idempotent `summarize` jobs after crossing the
  configured Hypa V3 window.
- Reused current server tokenizer settings and existing summary
  `chatMemos` metadata when computing the planner start index.
- Ran orphan cleanup for current chat memos before planning when
  `preserveOrphanedMemory` is disabled.
- Added `promptMemoryChunkPlanningDiagnostics` with attempted state,
  cleanup counts, planned-window count, created chunk/job counts,
  planner warnings/errors, and caught runtime errors.
- Kept prompt assembly non-blocking for planner validation failures; no
  summary or embedding provider calls run in the prompt request.

## Boundary

8-8 chose a prompt-assembly hook rather than a concrete `chunk` job
handler. The planner needs the already-built history rows, running token
estimate, active Hypa V3 settings, current summaries, and tokenizer
configuration, all of which are present in assembly. A queued `chunk` job
would need a larger snapshot payload to reconstruct that context.

The `chunk` queue kind remains reserved/no-op. `summarize` and `embed`
continue to be the executable worker jobs.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/memoryChunkPlanner.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused 8-8 verification passed with 50 tests, and `pnpm check` was
clean. Full verification passed: `pnpm test` with 652 tests plus
4 skipped, `pnpm api:test` with 1050 tests, and `pnpm build` with the
existing CSS `::highlight`, browser externalization, plugin-timing, and
chunk-size warnings.

## Next Pickup

Continue with 8-9 - Phase 8 closeout. Run the full verification matrix,
confirm the Phase 8 exit criteria, and flip the live handoff to Phase 9
client thinning when complete.
