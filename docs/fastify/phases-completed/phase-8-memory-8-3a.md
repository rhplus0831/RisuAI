# Phase 8 Memory - 8-3a Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryPlanner.ts` as a pure server-side
  Hypa V3 settings and standard-planner contract module.
- Ported the browser Hypa V3 preset defaults from
  `src/ts/process/memory/hypav3.ts` into `DEFAULT_HYPA_V3_SETTINGS`.
- Added settings normalization for partial settings with same-typed
  override behavior matching the browser preset helper.
- Locked the server planner choice to the standard path. Settings that
  carry `useExperimentalImpl: true` are normalized back to `false` and
  return structured `experimental_planner_fallback` warning metadata for
  a later one-time migration warning surface.
- Added deterministic settings validation for memory/summary ratios,
  recent+similar ratio sum, rate limits, concurrency values, query chat
  count, max chats per summary, and empty chunk separators.
- Defined the pure standard planner input/output contract with planner
  mode, normalized settings, warnings, errors, token deltas,
  reservation fields, planned windows, and skipped-message reasons.
- Added initial deterministic standard-planner behavior for start-index
  calculation from existing summary memos, max-response token correction,
  summarized-history token deltas, memory reservation deltas,
  cannot-summarize-further errors, and window skip reasons.
- Added `server/fastify/__tests__/memoryPlanner.test.ts` covering
  defaults, normalization, experimental fallback, validation, token
  deltas, planned windows, planner errors, and skipped-message reasons.

## Boundaries

- No memory rows are mutated.
- No jobs are enqueued from planner output.
- No orphan cleanup, provider calls, summary prompt construction,
  embedding, prompt-facing summary selection, browser listeners, or
  browser controls landed here.
- The planner contract intentionally returns plain deterministic data;
  later slices should bridge it to repositories/jobs instead of adding DB
  behavior to this module.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryPlanner.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused planner verification passed with 6 tests. `pnpm check` was
clean. `pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 943 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-3b - Orphan cleanup. Implement the server-side cleanup
pass for summaries/chunks whose source chat memos no longer exist,
respect `preserveOrphanedMemory`, keep cleanup idempotent, and use the
locked cascade behavior: delete orphaned `memory_summaries`, then parent
`memory_chunks`, and let `memory_embeddings` cascade through `chunk_id`.
Do not perform summary-window planning, job enqueueing, provider calls,
or browser wiring in 8-3b.
