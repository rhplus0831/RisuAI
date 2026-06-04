# Next Steps

Date: 2026-06-04

Phases 1, 2, and 3 are COMPLETE. Phase 1: H1 `0dc7452e`, H3 `e41dc6c6`, H2
`067ab82a`. Phase 2: scoped assembly load (M1, L1, L2, `c193c008`),
command-mutation read narrowing (M3, L5, L6, `e0e86ab1`), single-character
projection (M4, `254b3112`), and the metric/bulk-read slice (M5, L10, U1,
`b2765994`). Phase 3: client clone narrowing (M12-M14, L31-L36, U4) plus the
L32 watcher/global-modal ID-assignment follow-up. Next: pick Phase 4-7 by
current pain — Phase 4 outbound request lifecycle is the next root in audit
order.
Every fix needs a regression test, a Phase 8 gate flip
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

1. Phase 4 — outbound request lifecycle (M6, M8, L20, L22-L25): the next root
   in audit order. Generous preventive timeouts + abort propagation; the
   durable path's 600s deadline is the reference. Do not set aggressive
   provider/proxy timeouts.
2. Phases 5-7 by current pain. Refresh
   [`latest-verification.md`](latest-verification.md) after each phase.

Done so far (Phases 0-3 complete):

- M12-M14, L31-L36, U4 — client clone narrowing, DONE (`0efa7ba6` plus L32
  follow-up): `/setvar`/`/addvar` drop the redundant `setDatabase` normalizer
  (M12); `changedCharacterFields` diffs per kept key, excluded keys skipped
  before any clone (M13); `setupSendChatContext` rolls back via one
  `currentCharacterRowSnapshot` (M14); the script-definition watcher gains
  character/module scopes wired from CharConfig/ModuleMenu (L31); lorebook
  editor actions use scoped snapshots and scoped ID assignment, scoped
  `watchServerBackedLorebooks()` mounts initialize IDs only for their watched
  scope, and `lorepreset.svelte` uses the global-list-only ensure (L32); the
  `stores.svelte` modules `$effect` reads `readModuleUpdateSignals` instead
  of `$state.snapshot` (L33); `toggleSelectedChatModule` and MCP
  `setCharacterInfo` use scoped snapshots (L34, L35); `runServerCommand` and
  `runOptimisticCommandSequence` roll back surfaced factory rejections
  (L36); `setCurrentChat` uses the chat-scoped snapshot (U4). Regressions:
  `command.projectionGuard.test.ts`, `characterCommands.test.ts`,
  `sendChatContext.test.ts`, `scriptDefinitionBridge.svelte.test.ts`,
  `lorebookBridge.test.ts`, `lorebookBridge.svelte.test.ts`,
  `stores.modulesEffect.svelte.test.ts`, `moduleCommands.test.ts`,
  `characters.setCharacterInfo.test.ts`, `commands.test.ts`, `chatCommands.test.ts`.

- M5/L10/U1 — projection metric & bulk read, DONE (`b2765994`):
  `emitProtocolMetric` takes a fields thunk evaluated after the enabled
  guard (no `jsonPayloadBytes` double-serialization when metrics are off);
  the SSE route loads command-event history only for replay or with
  metrics on; bulk chat/lorebook hydration resolves known ids + the
  embedded fallback from requested rows (`WHERE id IN`), broad fallback
  kept for pre-extraction databases. Regressions:
  `serverLoadCostHarness.test.ts` M5/L10/U1 tests.

- M4 — single-character projection, DONE (`254b3112`):
  `loadSingleCharacterStubRow` reads one character row + its chat rows
  (broad fallback for embedded/uninitialized states keeps 404s identical)
  and the route/bootstrap mask owned objects in place via
  `maskProviderSecretsInPlace` (copying contract unchanged). Regressions:
  `serverLoadCostHarness.test.ts` M4 block (route load-count +
  per-character byte-identity + lorebook-stub parity + embedded fallback +
  bootstrap byte-identity), `providerSecrets.test.ts` mask parity.

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

- For any future server-load narrowing, do not edit `loadPersistedWithMessages`
  itself as the hot-path shortcut — it is shared with full-corpus consumers that
  genuinely need all chats' messages. Add a path-specific scoped loader instead.
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
