# Latest Verification

Date: 2026-06-04

This is the maintained proof-command log for the workstream. Update it after
each phase or focused batch.

## Baseline (pre-implementation)

Nothing in this plan is implemented yet. The starting point is the green
baseline left by prior workstreams, through `6861494d`:

- `pnpm test` — 1054 passed / 4 skipped (client suite).
- `pnpm api:test` — 1632 passed / 1 skipped (server suite).
- `pnpm client-thinning:audit` — green.
- `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` — zero server errors.
- `pnpm check` — unchanged 10-error svelte-check baseline (pre-existing, outside
  this workstream).

These numbers are carried forward. Re-run and record them before Phase 1 so new
regressions have a clear owner.

## How To Reproduce The Costs Being Fixed

- Server stage timings (H1, M1, M3, M4, M5, M10): run server tests with
  `RISU_PROTOCOL_METRICS=1` and `RISU_COMMAND_METRIC_SUMMARY=1` on the Phase 0
  fixture. Watch `databaseLoad*`, `projection_response`, and command metrics.
- Static corpus cost: `pnpm analyze:db <input>` (`util/analyze-database.ts`)
  reports export materialization, bootstrap payload size, and asset fanout.
- Client per-token cost (H3): browser profiler during a long streamed response;
  `ParseMarkdown` / `risuChatParser` self-time should grow with message length
  before the fix and stay bounded after.
  `localStorage.setItem('risu:protocol-debug','1')` adds client protocol logs.

## Run Log

| Date | Scope | Result |
| ---- | ----- | ------ |
| 2026-06-04 | Plan opened; no runtime change | Baseline carried from `6861494d` (above); not re-run as part of writing the plan. |
