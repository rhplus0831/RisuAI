# Next Steps

Date: 2026-06-04

Phase 0 is complete (fixture + server load-count harness + fix-completeness
gate scaffold). Start Phase 1. Every fix needs a regression test, a Phase 8
gate flip (`fixCompletenessGate.test.ts` registry `PLANNED` -> `DONE` with the
test path), and the matching status flip in
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

1. H1 — `loadChatHydration` guard (`server/fastify/src/repository.ts:1061`).
   One-line change: early-return whenever `message.length > 0` so a non-HypaV3
   chat-open / generation completion stops falling into `loadPersisted`. The
   load-count test exists: flip the "CURRENT breadth (audit H1)" block in
   `server/fastify/__tests__/serverLoadCostHarness.test.ts` to
   `assertScopedLoadOnHotPath`.
2. H3 — streaming render coalescing. Buffer token frames, flush at most once per
   animation frame, and keep a full-fidelity flush on `done`.
3. H2 — `ChatSelectionSnapshot`. Add a scalar chat-selection snapshot/restore
   pair (mirror the landed `CharacterSelectionSnapshot`) and use it in
   `changeChatTo`.
4. Phase 2 — server load narrowing. Start with scoped assembly load (M1), then
   command-mutation read narrowing (M3, L5, L6).
5. After the highs and Phase 2, pick Phase 3-7 by current pain. Refresh
   [`latest-verification.md`](latest-verification.md) after each phase.

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
