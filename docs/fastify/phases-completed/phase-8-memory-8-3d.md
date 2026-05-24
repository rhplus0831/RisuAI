# Phase 8 Memory - 8-3d Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryChunkPlanner.ts` as the deterministic
  bridge from pure Hypa V3 planner windows to persisted work.
- Planned windows now create stable `memory_chunks` IDs from chat id,
  range, selected message indexes, memos, and chunk text.
- Planned chunks enqueue stable `summarize` jobs with a versioned 8-4
  payload:
  `schemaVersion`, `chunkId`, `model`, `rangeStartSeq`, `rangeEndSeq`,
  `messageIndexes`, and `chatMemos`.
- Replanning the same chat/range is idempotent: existing chunks and
  summarize jobs are reused, and summarized chunks are not reset.
- Chunk creation and job enqueueing stay ordered by planner window
  order.

## Boundaries

- No provider calls landed.
- No summary prompt construction landed.
- No summary rows, embedding rows, prompt selection, browser listeners,
  or browser list/cancel controls landed.
- The memory worker still uses no-op handlers for `summarize`; 8-4c is
  where planned jobs become executable summary work.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryChunkPlanner.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused bridge verification passed with 5 tests. `pnpm check` was
clean. `pnpm test` passed with 639 tests plus 4 skipped.
`pnpm api:test` passed with 955 tests. `pnpm build` passed with
existing CSS `::highlight`, browser externalization, plugin-timing, and
chunk-size warnings.

## Next Pickup

Continue with 8-4a - Summary prompt builder. Port the pure summary
prompt construction path around planned chunks: message sanitization,
default summarize / re-summarize prompts, `{{slot}}` replacement,
ChatML parsing fallback, provider-neutral options, and `<think>` /
`<Thoughts>` output scrubbing. Do not call providers, wire the worker,
write summaries, embed chunks, or alter browser UI in 8-4a.
