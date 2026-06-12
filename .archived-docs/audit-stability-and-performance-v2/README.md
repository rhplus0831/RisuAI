# Stability And Performance Remediation Plan V2 (ARCHIVED 2026-06-06)

Date: 2026-06-05

> **ARCHIVED - workstream complete.** Moved from `docs/plan/` to
> `.archived-docs/audit-stability-and-performance-v2/` on 2026-06-06 after
> Phases 0-9 closed. Final proof is recorded in
> [`latest-verification.md`](latest-verification.md): both fix-completeness
> gates passed, `pnpm test` passed (1312 passed / 4 skipped),
> `pnpm api:test` passed (1846 passed / 1 skipped),
> `pnpm client-thinning:audit` passed, and both TypeScript project-reference
> checks passed. The v2 gate
> (`src/ts/__tests__/fixCompletenessGateV2.test.ts`) stays live against this
> archive at `.archived-docs/audit-stability-and-performance-v2/`; the v1 gate
> remains live against `.archived-docs/audit-stability-and-performance/`.

This directory turns the v2 stability/performance audit into a phased repair
plan. The audit found 102 confirmed issues: 3 high, 22 medium, 59 low, and 18
informational, plus 4 scheduled residuals of landed v1 fixes (K1-K4). The plan
groups them by root cause and requires a regression test for each scheduled
fix.

Start with [`status.md`](status.md). Use
[`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md)
only when you need the full evidence for a finding ID (`H*`, `M*`, `L*`, `I*`,
`K*`). The code remains the source of truth. The closed v1 plan is archived at
[`../audit-stability-and-performance/`](../audit-stability-and-performance/).

## Read Order

1. [`status.md`](status.md) - current snapshot and phase router.
2. [`next-steps.md`](next-steps.md) - the next task batch and proof commands.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-finding routing
   to its phase, target fix, and the gated/non-goal exclusions.
4. [`plan.md`](plan.md) - goal, sources, invariants, prerequisites, phase order.
5. [`phases/README.md`](phases/README.md) - phase index.
6. [`phases/slices/`](phases/slices/) - concrete task slices under each phase.
7. [`latest-verification.md`](latest-verification.md) - the maintained
   verification baseline.

## Where Detail Lives

- Evidence and verifier notes:
  [`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md).
- Status and phase routing: [`status.md`](status.md).
- Finding -> phase map plus gated/dismissed exclusions:
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Goal, invariants, prerequisites, and non-goals: [`plan.md`](plan.md).
- Phase scope and exit criteria: [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- Verification baseline: [`latest-verification.md`](latest-verification.md).

## Source Anchors

The audit roots map to phases. These are the main files for each root.

- Root 1 — second ring of server whole-corpus mutation/read paths (Phase 2;
  H2 in Phase 1): `server/fastify/src/commands/mutations.ts`
  (`applyJsonCommandMutation` vs `applyTargetedCommandMutation` +
  `chatScopedRead`), `server/fastify/src/routes/commands.ts` (chat-create,
  character/chat PATCH), `server/fastify/src/routes/generationChat.ts`
  (`persistServerGenerationResult`), `server/fastify/src/routes/projection.ts`
  (field branch), `server/fastify/src/routes/realmImport.ts`,
  `server/fastify/src/repository.ts`, `server/fastify/src/assetGc.ts`,
  `server/fastify/src/messageStore.ts`.
- Root 2 — CBS/`risuChatParser` per-send interpreter costs (Phase 3):
  `server/fastify/src/prompt/assemble.ts` (`captureMessageReplacement`),
  `server/fastify/src/prompt/history.ts` (`formatHistoryMessage`,
  depth prompts), `server/fastify/src/prompt/templates.ts`
  (`renderContentCard`), `server/fastify/src/prompt/lorebook.ts`
  (`searchMatch`), `server/fastify/src/prompt/triggers.ts` +
  `triggerDataEffects.ts`, `src/ts/cbs.ts`, `src/ts/parser/risuChatParser.ts`.
- Root 3 — client whole-corpus clones ring 2 (Phase 4):
  `src/ts/process/request/serverMessagePatch.ts`,
  `src/ts/plugins/plugins.svelte.ts` (`pluginStorage.getItem`),
  `src/ts/chatCommands.ts` (`changedChatMetadata`),
  `src/ts/moduleCommands.ts` (`currentModuleStateSnapshot`),
  `src/ts/process/command.ts`, `src/ts/characters.ts`, `src/lang/index.ts`.
- Root 4 — GUI-reload remount amplifier and render/editor costs (Phase 1 H3 +
  Phase 5): `src/ts/stores.svelte.ts` (`ReloadGUIPointer.subscribe`),
  `src/lib/ChatScreens/Chat.svelte` (`{#key chatReloadPointer}`),
  `src/lib/ChatScreens/ChatBody.svelte`, `src/ts/process/scripts.ts`
  (`resetScriptCache`), `src/ts/parser/parser.svelte.ts`,
  `src/lib/Setting/Pages/PromptSettings.svelte`.
- Root 5 — opt-in subsystems (Phase 7): `src/ts/translator/translator.ts`,
  `src/ts/translator/bergamotTranslator.ts`, `src/ts/process/tts.ts`,
  `src/ts/process/mcp/` (`mcplib.ts`, `mcp.ts`, `filesystemclient.ts`),
  `src/ts/process/processzip.ts`, `src/ts/process/files/`
  (`multisend.ts`, `inlays.ts`), `src/ts/characterCards.ts`,
  `src/ts/pngChunk.ts`.
- Root 6 — bridge echo guards and lifecycle hygiene (Phase 6):
  `src/ts/server/lorebookBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`, `src/ts/bootstrap.ts`
  (reconnect), `src/ts/observer.svelte.ts`, `src/ts/process/prereroll.ts`,
  `src/ts/storage/database.svelte.ts`
  (`mergeServerProjectionCharacterRow`).
- Server bounds (Phase 8): `server/fastify/src/streamJobs.ts`,
  `generationFinalizationRetry.ts`, `db.ts` (pragmas), `memory*.ts`,
  `routes/hub.ts`, `routes/legacyStorage.ts`, `routes/realmImport.ts`,
  `risuSave/bundleExport.ts`, `generation/vertexAuth.ts`, `routes/proxy.ts`.

For current repo navigation, read [`../../STRUCTURE.md`](../../STRUCTURE.md)
and [`../../structure/`](../../docs/structure/). Closed workstreams are indexed in
[`../README.md`](../README.md); deferred follow-ups are in
[`../leftover.md`](../leftover.md).

## Reference Templates

Reuse these already-landed patterns:

- Targeted chat writes — the fork route
  (`server/fastify/src/routes/commands.ts`) composes
  `writeCharacterChatRows` + `insertCharacterChatRow` +
  `replaceActiveChatMessages` + `writeSingleCharacterRow` instead of the
  hydrated whole-corpus mutation. H2 and L13 follow this shape.
- Scoped mutation reads — `loadPersistedForChatMutation` + `chatScopedRead`
  (v1 Phase 2, `e0e86ab1`). M5 and K1 wire the same scoped read into the
  PATCH routes and the finalization persist (M5's chat PATCH needs a
  modules-aware variant).
- Marker fixed-point guard — `isRunVarParserFixedPoint`
  (`server/fastify/src/prompt/assemble.ts`, v1 L2). M2 applies it to
  `formatHistoryMessage`.
- Scalar/single-row snapshots — `CharacterSelectionSnapshot` /
  `currentCharacterRowSnapshot` (v1 H2/M14). M10, L33, K4 follow this shape.
- Allowed-keys diff without a prior full clone — `changedCharacterFields`
  (v1 M13, `src/ts/characterCommands.ts`). M9 mirrors it for chat metadata.
- Apply-epoch echo gate — the chat/script/settings watchers
  (`src/ts/server/*Bridge.svelte.ts`). M11/M12 add the same gate to the two
  missing watchers.
- Compiled-regex memo — `getCompiledRegex` + the `PreparedScript` WeakMap
  memo (v1 M2/L40). L6 extends it to trigger conditions/effects.
- Deadlines and caps — `requestAbort.ts` (600 s non-durable deadline),
  `generation/body.ts` (32 MB), `risuSave/boundedInflate.ts`. M20, L27, L31,
  M21 follow these shapes.

Each slice narrows the hot path, keeps the broad path for true full-corpus
consumers, and adds a regression test.
