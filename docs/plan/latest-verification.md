# Latest Verification

Date: 2026-06-04

This is the maintained proof-command log for the workstream. Update it after
each phase or focused batch.

## Baseline (Phase 0 measurement slice landed)

Re-run after the measurement-baseline-harness slice (fixture + server
load-count harness; test-only, no runtime change):

- `pnpm test` — 1059 passed / 4 skipped (client suite; +5
  `largeCorpusFixture.test.ts`).
- `pnpm api:test` — 1639 passed / 1 skipped (server suite; +7
  `serverLoadCostHarness.test.ts`).
- `pnpm client-thinning:audit` — green.
- `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` — zero errors.

Pre-slice numbers (through `6861494d`): 1054/4 client, 1632/1 server, audit
green, zero tsc errors, `pnpm check` at the pre-existing 10-error svelte-check
baseline (outside this workstream).

## Pre-Fix Fixture Measurements (Phase 0, 2026-06-04)

Recorded from the shared large-corpus fixture before any fix lands.

- Load counts (default fixture size;
  `RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config
  server/fastify/vitest.config.ts --reporter=verbose serverLoadCostHarness`):
  - Scoped hydration (hot chat, messages + hypaV3Data): **0 corpus loads**.
  - H1 fallback hydration (chat without a `chat_hypa_v3` row): **13
    whole-corpus payload loads** — characters, chats, all 9 collection tables,
    plugin_custom_storage, assets — for one chat's messages.
- Wall-clock at scale (one-off `tsx` run; 40 characters x 100KB cards, 4
  chats each, hot chat 1500 x 400B messages; 9.6MB corpus JSON; warmed, 5
  runs):
  - Hot chat hydration (scoped, 1500 messages): ~8ms — all payload.
  - No-hypa chat hydration (60 messages, H1 fallback): **~13ms** — a 25x
    smaller chat costs more than the hot chat because the fallback re-parses
    the whole corpus; scales with total character-card bulk, which is why real
    corpora saw multi-second stalls.
- The load *count* is the durable gate signal; the timings document why the
  counts matter.

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
| 2026-06-04 | Phase 0 measurement-baseline-harness slice (test-only) | `pnpm test` 1059/4, `pnpm api:test` 1639/1, audit green, both tsc checks zero errors. Pre-fix fixture measurements recorded above. |
