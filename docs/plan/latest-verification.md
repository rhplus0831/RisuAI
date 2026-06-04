# Latest Verification

Date: 2026-06-04

This is the maintained proof-command log for the workstream. Update it after
each phase or focused batch.

## Baseline (Phase 0 complete)

Re-run after both Phase 0 slices (fixture + server load-count harness +
fix-completeness gate scaffold; test-only, no runtime change):

- `pnpm test` — 1067 passed / 4 skipped (client suite; +5
  `largeCorpusFixture.test.ts`, +8 `fixCompletenessGate.test.ts`).
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

## Post-Fix Measurements

- Phase 1 H1 (`0dc7452e`): no-hypa chat hydration on the default fixture is now
  **0 corpus loads, ~1.6ms** (was 13 loads; ~13ms at the 9.6MB scale corpus).
  The zero-row not-yet-extracted fallback keeps its documented breadth
  (regression-tested in `serverLoadCostHarness.test.ts`).
- Phase 1 H3 (`e41dc6c6`): a synthetic 200-token stream performs **≤2
  editoutput parses / display writes** (`reloadKeys` ≤4 including setup +
  finally) instead of 200 each; final text byte-identical. Real-stream parse
  count is now bounded by frames-per-second × stream duration, not token
  count.
- Phase 1 H2 (`067ab82a`): chat select captures **zero clone-primitive calls**
  (`totalCloneCount` 0) instead of a whole-characters JSON clone per click;
  the `changeChatTo` end-to-end gate proves no clone at the size of the
  characters array on either the index or the id path.
- Phase 2 M1/L1/L2 (`c193c008`): a preview/send assembly performs **zero
  whole-corpus `messages`/`chat_hypa_v3` payload reads** (was: both tables
  parsed whole per send/continue/regenerate/preview) — only the target chat's
  rows plus the character/collection tables load, so `databaseLoadMs` no
  longer scales with transcript corpus size. The loader-equivalence test
  proves the target chat hydrates byte-identically and every sibling gets
  `message=[]`. L1: the ~8 per-assembly `getActiveModules` scans hit one memo
  entry. L2: marker-free message bodies skip the per-message parser pass as
  proven fixed points.
- Phase 2 M3/L5/L6 (`e0e86ab1`): a message/scriptstate/generation command
  mutation performs **zero whole-corpus payload reads of any table** (was: 13
  whole-corpus payload reads per mutation — characters, chats, all 9
  collection tables, plugin storage, assets — to locate one chat row). The
  scoped read parses exactly one chat row + one character row; the loader
  equivalence test proves identical records, and unknown-id / pre-extraction
  states keep the documented broad fallback.

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
| 2026-06-04 | Phase 0 fix-completeness-gate-scaffold slice (test-only) — PHASE 0 COMPLETE | `pnpm test` 1067/4 (+8 `fixCompletenessGate.test.ts`), audit green, both tsc checks zero errors. Server suite untouched (1639/1 carried). Drift behavior hand-verified: doc-DONE-only, new audit id, phase reroute each fail one self-check. |
| 2026-06-04 | Phase 1 H1 slice (`0dc7452e` fix + gate/doc flip) | `pnpm api:test` 1640/1 (+1 zero-row fallback regression; H1 control flipped to `assertScopedLoadOnHotPath`), `pnpm test` 1067/4 (gate flip, no count change), audit green, both tsc checks zero errors. No-hypa hydration: 0 corpus loads (was 13). |
| 2026-06-04 | Phase 1 H3 slice (`e41dc6c6` fix + gate/doc flip) | `pnpm test` 1077/4 (+7 `streamCoalescer.test.ts`, +3 `streamResponse.test.ts` H3 block), `pnpm api:test` 1640/1 (carried), audit green, both tsc checks zero errors. 200-token stream: ≤2 parses (was 200). |
| 2026-06-04 | Phase 1 H2 slice (`067ab82a` fix + gate/doc flip) — PHASE 1 COMPLETE | `pnpm test` 1084/4 (+4 `chatCommands.test.ts` H2 block, +3 `globalApi.changeChatTo.test.ts`), `pnpm api:test` 1640/1, audit green, both tsc checks zero errors. Chat select: 0 clone calls (was a whole-characters clone per click). |
| 2026-06-04 | Phase 2 scoped-assembly-load slice (`c193c008` fix + gate/doc flip) | `pnpm api:test` 1651/1 (+3 M1 `serverLoadCostHarness.test.ts`, +6 L1 `modulesMemo.test.ts`, +2 L2 `assemble.test.ts`), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. Assembly: 0 whole-corpus message/hypa reads (was 2 whole-table parses per send/preview). |
| 2026-06-04 | Phase 2 command-mutation-read-narrowing slice (`e0e86ab1` fix + gate/doc flip) | `pnpm api:test` 1657/1 (+6 `commandMutationReadNarrowing.test.ts`), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. Message/scriptstate/generation mutation: 0 whole-corpus payload reads (was 13 per mutation). |
