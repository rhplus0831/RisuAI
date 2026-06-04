# Next Steps

Date: 2026-06-04

Phase 1 is COMPLETE (H1 `0dc7452e`, H3 `e41dc6c6`, H2 `067ab82a`). Phase 2 is
in progress: scoped assembly load (M1, L1, L2, `c193c008`) and
command-mutation read narrowing (M3, L5, L6, `e0e86ab1`) are DONE. Next is
the single-character projection (M4), then the metric/bulk-read slice (M5,
L10, U1). Every fix needs a regression test, a Phase 8 gate flip
(`fixCompletenessGate.test.ts` registry `PLANNED` -> `DONE` with the test
path), and the matching status flip in
[`active-risk-analysis.md`](active-risk-analysis.md) — the gate fails unless
both move together.

## Start Point

- Start with the per-finding routing in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the per-finding
  evidence/impact/fix detail in
  [`audit-stability-and-performance.md`](audit-stability-and-performance.md).
- Before editing runtime code, open the active slice and re-check the cited
  symbol. Line numbers drift.
- Reuse the existing client clone-cost harness
  (`src/ts/__tests__/cloneCostHarness.ts`) for Root-2 clones; use the Phase 0
  server load-count harness
  (`server/fastify/__tests__/helpers/loadCostHarness.ts`,
  `assertScopedLoadOnHotPath`) for Root-1 loads, and seed cost tests from the
  shared fixture (`src/ts/__tests__/largeCorpusFixture.ts`).

## Current Best Targets

In leverage order. Each is independent unless noted.

1. Phase 2 — server load narrowing, remaining slices: the single-character
   projection (M4), and the metric/bulk-read slice (M5, L10, U1).
2. After Phase 2, pick Phase 3-7 by current pain. Refresh
   [`latest-verification.md`](latest-verification.md) after each phase.

Done so far (Phase 1 complete; Phase 2 in progress):

- M3/L5/L6 — command-mutation read narrowing, DONE (`e0e86ab1`):
  `loadPersistedForChatMutation` + opt-in `chatScopedRead` on
  `applyTargetedCommandMutation` (hard-guarded against `writeDatabase`);
  the 7 hot routes (scriptstate, message append/PATCH/DELETE/truncate/PUT,
  generation-result) read one chat row + parent character; broad fallback
  for unknown ids / embedded state keeps 404s and dedup identical.
  Regressions: `commandMutationReadNarrowing.test.ts`.

- M1/L1/L2 — scoped assembly load, DONE (`c193c008`):
  `loadPersistedForAssembly` hydrates only the target chat's messages/hypaV3
  (siblings get `message=[]`; broad loader untouched for
  assetGc/export/save/boot), `getActiveModules` memoized per loaded
  `Database`, and `applyCurrentChatRunVars` skips marker-free parser
  fixed points. Regressions: `serverLoadCostHarness.test.ts` (M1 route
  load-count + loader equivalence + embedded fallback),
  `modulesMemo.test.ts` (L1), `assemble.test.ts` L2 describe.

- H1 — `loadChatHydration` guard, DONE (`0dc7452e`): early-return on
  `message.length > 0`; scoped + zero-row-fallback regression tests in
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.
- H3 — streaming render coalescing, DONE (`e41dc6c6`):
  `src/ts/process/postGeneration/streamCoalescer.ts` applies the newest chunk
  at most once per animation frame with a final full-fidelity `settle()`;
  bounded-parse + display-progress + failure-propagation regressions in
  `src/ts/process/__tests__/streamResponse.test.ts` (+ coalescer unit suite).
- H2 — chat-selection scalar snapshot, DONE (`067ab82a`):
  `ChatSelectionSnapshot`/`restoreChatSelection` + `dispatchSelectChat` in
  `chatCommands.ts`; used by `changeChatTo` and `SideChatList.selectChat`.
  Clone-cost gate `src/ts/globalApi.changeChatTo.test.ts` + rollback proofs in
  `src/ts/chatCommands.test.ts`, registered in the clone-cost budget map.

## Not First

- Do not start a Phase 2 server narrowing by editing `loadPersistedWithMessages`
  itself — it is shared with assetGc/export/save/import that genuinely need all
  chats' messages. Add an assembly-specific scoped loader instead.
- Do not delete the full-collection client snapshot
  (`currentChatStateSnapshot`) or the broad SQLite loaders; create/delete/
  reorder/fork and the full-corpus consumers still need them. Only stop the hot
  path from reaching them.
- Do not change a narrowed rollback's restore set; it must restore exactly what
  the command mutates or it can clobber unrelated edits.
- Do not set an aggressive provider/proxy timeout; use a generous default (the
  durable path's 600s is the reference).
- Do not change `.risu` envelope bytes or projection/bootstrap payloads;
  narrowing changes what the server loads, not what it returns. Round-trip tests
  gate any codec/export change.
- Do not schedule the gated items (L4, L7, L26, U2) — they need real-corpus
  evidence or an owner decision.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
load/projection/guard behavior. Add the regression test under the matching suite
and register it in Phase 8.

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts` (H1, M4, M5,
  U1, L10 — hydration/projection responses).
- `pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts` (M1, L1,
  L2 — assembly load + assembly-internal memo; run with
  `RISU_PROTOCOL_METRICS=1` to see stage timings).
- `pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts` (M3, L5,
  L6 — command-mutation read cost; `RISU_COMMAND_METRIC_SUMMARY=1`).
- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts`
  (H2, M13, M14, L34, L35, U4 — client snapshot/rollback narrowing).
- `pnpm test -- src/lib/ChatScreens` and the parser suite (H3 — streaming
  coalescing; assert render parse count is bounded for an N-token stream).
- `pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/generation.test.ts`
  (M6, M8, L20, L22 — abort/timeout).
- `pnpm api:test -- server/fastify/__tests__/risuSave*.test.ts server/fastify/__tests__/backups.test.ts`
  (M9, M11, L27, L28 — bounded inflate, export cleanup, restore robustness;
  round-trip identity).
- `pnpm api:test -- server/fastify/__tests__/memory*.test.ts` (M7, L16, L17,
  L18 — memory batch/fairness/orphan).
- `pnpm test` (full client suite); `pnpm api:test` (full server suite).
- `pnpm client-thinning:audit` (optimistic-write / projection invariants).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
