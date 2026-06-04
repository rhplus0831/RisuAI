# Stability And Performance Remediation Plan

Date: 2026-06-04

This directory turns the findings in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) into
an executable, phased remediation plan. The audit found 3 high, 14 medium, and
40 low confirmed stability/performance issues across the Fastify server and the
Svelte client, organized around five recurring root-cause patterns. This plan
schedules the fixes so each one lands with a regression test that proves the
problem stays fixed.

Use `status.md` for the current state. Use
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) as the
seed inventory (every finding ID `H*`/`M*`/`L*`/`U*` is defined there). The code
remains the source of truth.

## Read Order

1. [`status.md`](status.md) - current snapshot and phase router.
2. [`next-steps.md`](next-steps.md) - the next task batch and proof commands.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-finding routing to
   its phase, target fix, and the gated/non-goal exclusions.
4. [`plan.md`](plan.md) - goal, sources, invariants, prerequisites, phase order.
5. [`phases/README.md`](phases/README.md) - phase index.
6. [`phases/slices/`](phases/slices/) - concrete task slices under each phase.
7. [`latest-verification.md`](latest-verification.md) - the maintained
   verification baseline.

## Canonical Detail

- Per-finding evidence, impact, suggested fix, and the verifier's grounded notes
  live in [`audit-stability-and-performance.md`](audit-stability-and-performance.md).
- Current status and phase routing live in [`status.md`](status.md).
- The finding -> phase map and the gated/dismissed exclusions live in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Goal, invariants, prerequisites, and non-goals live in [`plan.md`](plan.md).
- Phase-level scope and exit criteria live in [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- The latest maintained verification result lives in
  [`latest-verification.md`](latest-verification.md).

## Source Anchors

The audit's five cross-cutting roots map to the phases; these are the files each
root concentrates in.

- **Root 1 — server rebuilds a broad in-memory `Database` on hot paths**
  (Phase 2): `server/fastify/src/repository.ts`
  (`loadPersisted`, `loadPersistedWithMessages`, `loadCharactersFromSqlite`,
  `loadCollectionsFromSqlite`, `loadChatHydration`, `loadSingleCharacterRow`),
  `server/fastify/src/messageStore.ts`
  (`getAllChatMessagesGrouped` vs `getChatMessagesGroupedByIds`),
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/routes/projection.ts`,
  `server/fastify/src/routes/generationChat.ts`.
- **Root 2 — client whole-corpus deep clones survive on hot/warm paths**
  (Phase 3): `src/ts/chatCommands.ts` (`currentChatStateSnapshot`,
  `cloneJsonValue`), `src/ts/characterCommands.ts`
  (`CharacterSelectionSnapshot` reference, `currentCharacterRowSnapshot`,
  `changedCharacterFields`), `src/ts/globalApi.svelte.ts` (`changeChatTo`),
  `src/ts/process/sendChatContext.ts`, `src/ts/process/command.ts`,
  `src/ts/moduleCommands.ts`, `src/ts/storage/database.svelte.ts`,
  the `src/ts/server/*Bridge.svelte.ts` watchers.
- **Root 3 — streaming re-does O(message) work per token** (Phase 1, H3):
  `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/ChatBody.svelte`,
  `src/ts/parser/parser.svelte.ts`,
  `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/request/serverChat.ts`,
  `server/fastify/src/routes/generation.ts`.
- **Root 4 — outbound fetches lack preventive timeouts / abort propagation**
  (Phase 4): `server/fastify/src/routes/proxy.ts`,
  `server/fastify/src/proxy.ts`, `server/fastify/src/routes/generation.ts`
  / `generationChat.ts` (`attachAbort`),
  `server/fastify/src/generation/*.ts`,
  `server/fastify/src/prompt/luaRuntime.ts`.
- **Root 5 — decompression / buffering without preventive caps** (Phase 5):
  `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`,
  `server/fastify/src/risuSave/blockCodec.ts`,
  `server/fastify/src/risuSave/bundleExport.ts`,
  `server/fastify/src/assetGc.ts`, `server/fastify/src/streamJobs.ts`,
  `server/fastify/src/routes/events.ts`, `server/fastify/src/app.ts`.

Present-tense navigation: [`../../STRUCTURE.md`](../../STRUCTURE.md) and
[`../structure/`](../structure/). The closed perf workstreams that this audit
followed are in [`../archive/frontend-performance`](../archive/frontend-performance),
[`../archive/server-client-protocol-stability-performance`](../archive/server-client-protocol-stability-performance),
and [`../archive/lazy-projection`](../archive/lazy-projection); deliberately
deferred follow-ups are in [`../archive/leftover.md`](../archive/leftover.md).

## Reference Templates

Two already-landed fixes are the templates this plan reuses:

- **Scalar/single-row snapshot** — `c9e728b1` narrowed character-select from a
  whole-`characters` clone to a scalar `CharacterSelectionSnapshot`
  (`src/ts/characterCommands.ts`; proof in
  `src/ts/compatibilityAdapters.test.ts`). H2 and the Phase 3 client clones
  follow this shape exactly: capture a scalar/single-row rollback on the hot
  path, keep the full clone only for create/delete/reorder/fork, and add a
  clone-cost regression test.
- **Scoped SQLite loader** — the lazy-projection workstream added
  `getChatMessagesGroupedByIds` / `getChatHypaV3GroupedByIds` (chunked,
  parameterized, per-id) alongside the whole-table `getAllChatMessagesGrouped`.
  M1 and the Phase 2 server narrowing reuse these: load only the rows a path
  reads, keep the broad loader for the genuine all-chat consumers
  (assetGc/export/save).

Every slice follows the same shape: narrow the work to what the path actually
needs on the hot path, keep the broad path for the rare full-corpus consumer,
and land a regression test that fails if the broad pattern returns.
