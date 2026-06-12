# Stability And Performance Remediation Plan (ARCHIVED 2026-06-05)

Date: 2026-06-04

> **ARCHIVED - workstream complete.** Moved from `docs/plan/` to
> `.archived-docs/audit-stability-and-performance/` on 2026-06-05 after all
> phases (0-8) closed with the recorded closing verification run. The
> fix-completeness gate (`src/ts/__tests__/fixCompletenessGate.test.ts`)
> stays live against this archive and keeps every landed fix's regression
> test registered. The follow-up v2 audit and its remediation plan are now
> closed in [`../audit-stability-and-performance-v2/`](../audit-stability-and-performance-v2/);
> the still-gated items here (L4, L7, L26, U2) remain
> owner-decision/evidence-gated and are referenced by the v2 archive.

This directory turns the stability/performance audit into a phased repair plan.
The audit found 57 confirmed issues: 3 high, 14 medium, and 40 low. The plan
groups them by root cause and requires a regression test for each scheduled fix.

Start with [`status.md`](status.md). Use
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) only
when you need the full evidence for a finding ID (`H*`, `M*`, `L*`, `U*`). The
code remains the source of truth.

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

## Where Detail Lives

- Evidence and verifier notes: [`audit-stability-and-performance.md`](audit-stability-and-performance.md).
- Status and phase routing: [`status.md`](status.md).
- Finding -> phase map plus gated/dismissed exclusions:
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Goal, invariants, prerequisites, and non-goals: [`plan.md`](plan.md).
- Phase scope and exit criteria: [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- Verification baseline: [`latest-verification.md`](latest-verification.md).

## Source Anchors

The five audit roots map to phases. These are the main files for each root.

- Root 1 — server rebuilds a broad in-memory `Database` on hot paths
  (Phase 2): `server/fastify/src/repository.ts`
  (`loadPersisted`, `loadPersistedWithMessages`, `loadCharactersFromSqlite`,
  `loadCollectionsFromSqlite`, `loadChatHydration`, `loadSingleCharacterRow`),
  `server/fastify/src/messageStore.ts`
  (`getAllChatMessagesGrouped` vs `getChatMessagesGroupedByIds`),
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/routes/projection.ts`,
  `server/fastify/src/routes/generationChat.ts`.
- Root 2 — client whole-corpus deep clones survive on hot/warm paths
  (Phase 3): `src/ts/chatCommands.ts` (`currentChatStateSnapshot`,
  `cloneJsonValue`), `src/ts/characterCommands.ts`
  (`CharacterSelectionSnapshot` reference, `currentCharacterRowSnapshot`,
  `changedCharacterFields`), `src/ts/globalApi.svelte.ts` (`changeChatTo`),
  `src/ts/process/sendChatContext.ts`, `src/ts/process/command.ts`,
  `src/ts/moduleCommands.ts`, `src/ts/storage/database.svelte.ts`,
  the `src/ts/server/*Bridge.svelte.ts` watchers.
- Root 3 — streaming re-does O(message) work per token (Phase 1, H3):
  `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/ChatBody.svelte`,
  `src/ts/parser/parser.svelte.ts`,
  `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/request/serverChat.ts`,
  `server/fastify/src/routes/generation.ts`.
- Root 4 — outbound fetches lack preventive timeouts / abort propagation
  (Phase 4): `server/fastify/src/routes/proxy.ts`,
  `server/fastify/src/proxy.ts`, `server/fastify/src/routes/generation.ts`
  / `generationChat.ts` (`attachAbort`),
  `server/fastify/src/generation/*.ts`,
  `server/fastify/src/prompt/luaRuntime.ts`.
- Root 5 — decompression / buffering without preventive caps (Phase 5):
  `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`,
  `server/fastify/src/risuSave/blockCodec.ts`,
  `server/fastify/src/risuSave/bundleExport.ts`,
  `server/fastify/src/assetGc.ts`, `server/fastify/src/streamJobs.ts`,
  `server/fastify/src/routes/events.ts`, `server/fastify/src/app.ts`.

For current repo navigation, read [`../../STRUCTURE.md`](../../STRUCTURE.md) and
[`../structure/`](../../docs/structure/). Closed perf workstreams are in
[`../frontend-performance`](../frontend-performance),
[`../server-client-protocol-stability-performance`](../server-client-protocol-stability-performance),
and [`../lazy-projection`](../lazy-projection). Deferred follow-ups are in
[`../leftover.md`](../leftover.md).

## Reference Templates

Reuse these already-landed patterns:

- Scalar/single-row snapshot — `c9e728b1` narrowed character-select from a
  whole-`characters` clone to a scalar `CharacterSelectionSnapshot`
  (`src/ts/characterCommands.ts`; proof in
  `src/ts/compatibilityAdapters.test.ts`). H2 and the Phase 3 client clones
  follow this shape: capture a scalar/single-row rollback on the hot path, keep
  the full clone for create/delete/reorder/fork, and add a clone-cost test.
- Scoped SQLite loader — the lazy-projection workstream added
  `getChatMessagesGroupedByIds` / `getChatHypaV3GroupedByIds` (chunked,
  parameterized, per-id) alongside the whole-table `getAllChatMessagesGrouped`.
  M1 and the Phase 2 server narrowing reuse these: load only the rows a path
  reads, keep the broad loader for the genuine all-chat consumers
  (assetGc/export/save).

Each slice narrows the hot path, keeps the broad path for true full-corpus
consumers, and adds a regression test.
