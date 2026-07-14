# Stability And Performance Remediation Plan V3 (ARCHIVED 2026-06-08)

Date: 2026-06-06

> **ARCHIVED - workstream complete.** Moved from `docs/plan/` to
> `.archived-docs/performance-and-stability/stability-audits/v3/` on 2026-06-08 after
> Phases 0-9 closed. Final proof is recorded in
> [`latest-verification.md`](latest-verification.md): all three
> fix-completeness gates passed, `pnpm test` passed (1480 passed / 4 skipped),
> `pnpm api:test` passed (1950 passed / 1 skipped),
> `pnpm client-thinning:audit` passed, and both TypeScript project-reference
> checks passed. The v3 gate
> (`src/ts/__tests__/fixCompletenessGateV3.test.ts`) stays live against this
> archive at `.archived-docs/performance-and-stability/stability-audits/v3/`; the v1 and
> v2 gates remain live against their existing archives.

This archived directory records the v3 stability/performance audit remediation
plan. The audit found 89 confirmed issues: 1 high, 9 medium, 56 low, and 23
informational, plus 4 scheduled residuals/re-opens of prior-audit items
(K1-K4). The plan grouped them by cross-cutting theme and required a
regression test for each scheduled fix.

Start with [`status.md`](status.md). Use
[`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
only when you need the full evidence for a finding ID (`H*`, `M*`, `L*`, `I*`,
`K*`) — the verifier corrections embedded in each finding's prose are part of
the spec. The code remains the source of truth. The closed v1 and v2 plans
are archived at
[`../v1/`](../v1/)
and
[`../v2/`](../v2/).

## Read Order

1. [`status.md`](status.md) - final snapshot and phase router.
2. [`next-steps.md`](next-steps.md) - closeout summary and proof commands.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-finding routing
   to its phase, target fix, and the gated/non-goal exclusions.
4. [`v4-integration-brief.md`](v4-integration-brief.md) - post-Phase-4 v4
   routing layer; use it to amend remaining v3 phases without creating a v4
   mega-plan.
5. [`plan.md`](plan.md) - goal, sources, invariants, prerequisites, phase order.
6. [`phases/README.md`](phases/README.md) - phase index.
7. [`phases/slices/`](phases/slices/) - concrete task slices, authored when a
   phase opens.
8. [`latest-verification.md`](latest-verification.md) - the maintained
   verification baseline.

## Where Detail Lives

- Evidence and verifier corrections:
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md).
- Status and phase routing: [`status.md`](status.md).
- Finding -> phase map plus gated/dismissed exclusions:
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Post-Phase-4 v4 routing amendments:
  [`v4-integration-brief.md`](v4-integration-brief.md).
- Goal, invariants, prerequisites, and non-goals: [`plan.md`](plan.md).
- Phase scope and exit criteria: [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`,
  authored just-in-time when a phase opens.
- Verification baseline: [`latest-verification.md`](latest-verification.md).

## Source Anchors

The audit themes map to phases. These are the main files for each theme.

- Theme 1 — send-path O(transcript|corpus) costs (Phase 1; M1 in Phase 2;
  server amplifiers in Phase 7):
  `src/lib/ChatScreens/DefaultChatScreen.svelte` (send handler),
  `src/ts/chatCommands.ts` (`currentChatScopedSnapshot`,
  `dispatchReplaceMessagesWith`, `appendCurrentChatUserMessageForSend`),
  `src/ts/process/sendChatContext.ts`, `src/ts/characterCommands.ts`,
  `server/fastify/src/prompt/providerTransport.ts` (`emitProviderChunks`,
  H1).
- Theme 2 — command-surface scoped-read ring 3 (Phase 2):
  `server/fastify/src/commands/mutations.ts` (`applyTargetedCommandMutation`,
  `chatScopedRead`, `skipDatabaseLoad`), `routes/commands.ts`
  (settings/collection/plugin-storage/global-lorebook/script routes),
  `routes/generationChat.ts` (`persistAssemblyMutations`), `repository.ts`
  (`loadPersisted`, `COLLECTION_TABLE_MAP`,
  `loadCharacterLorebookHydration`), `commands/lorebooks.ts`,
  `commands/scriptDefinitions.ts`; K2: `routes/proxy.ts`, `routes/hub.ts`.
- Theme 3 — cancel/terminal-state + deadlines (Phase 1 H1 + Phase 4):
  `server/fastify/src/index.ts` + `app.ts` (onClose), `routes/generation.ts`
  (`pipeStream`), `routes/streamJobs.ts` + `streamJobs.ts`
  (`slidingDeadline`), `routes/realmImport.ts`, `generation/horde.ts`,
  `requestAbort.ts`; client `src/ts/globalApi.svelte.ts`
  (`fetchViaProxyJobWs`).
- Theme 4 — optimistic-write state machine (Phase 5):
  `src/ts/server/settingsBridge.svelte.ts`, `chatBridge.svelte.ts`,
  `lorebookBridge.svelte.ts`, `characterBridge.svelte.ts`,
  `src/lib/Setting/Pages/PromptSettings.svelte` +
  `src/lib/UI/PromptDataItem.svelte`, `src/ts/storage/database.svelte.ts`
  (`runPresetCommand`), `src/ts/server/commands.ts` (dispatch fetch).
- Theme 5 — projection-guard feature breakage (Phase 5):
  `src/ts/process/postGeneration/igp.ts`, `src/ts/process/sendChatErrors.ts`,
  `src/ts/process/files/multisend.ts` (`sendPofile`), `src/ts/bootstrap.ts`
  (error/rejection handlers), `src/ts/alert.ts`,
  `src/ts/server/projectionWriteGuard.svelte.ts`
  (`withTrustedServerProjectionWrite`).
- Theme 6 — reactive amplification & render (Phase 6):
  `src/ts/server/lorebookBridge.svelte.ts`
  (`collectCharacterLorebookSnapshots`), `chatBridge.svelte.ts` (watcher),
  `characterBridge.svelte.ts` (draft mirror),
  `src/lib/Mobile/MobileCharacters.svelte` + `src/lib/Others/GridCatalog.svelte`,
  `src/lib/ChatScreens/ChatBodyParseMemo.ts`, `src/lib/ChatScreens/Chat.svelte`
  (customHTML), `src/ts/process/scripts.ts` (`bestMatchCache`),
  `src/ts/observer.svelte.ts` (`bgmElement`).
- Theme 7 — memory subsystem (Phase 3):
  `server/fastify/src/memorySummaryAdapter.ts`,
  `memorySummarizeJobHandler.ts`, `memoryBudgetAllocator.ts`,
  `memoryPlanner.ts`, `memoryEmbedJobHandler.ts`, `memoryRepository.ts`
  (`decodeEmbeddingVector`), `memoryLegacyImport.ts`, `prompt/assemble.ts`
  (`selectPromptMemory` call), `prompt/memory.ts`, `generation/openai.ts`
  (`runOpenAI`, the summarize fetch site).
- Theme 8 — opt-in subsystem hygiene ring 3 (Phase 8; server residuals in
  Phase 7): `src/ts/process/triggers.ts`, `scriptings.ts`, `tokenizer.ts`,
  `src/ts/plugins/apiV3/factory.ts` + `v3.svelte.ts`, `plugins.svelte.ts`,
  `src/ts/process/mcp/` (`mcp.ts`, `mcplib.ts`, `filesystemclient.ts`),
  `src/ts/process/dynamicutils/pdf.ts`, `files/multisend.ts`,
  `files/inlays.ts`, `processzip.ts`, `stableDiff.ts`, `transformers.ts`,
  `tts.ts`, `src/lib/Playground/PlaygroundSubtitle.svelte`; server:
  `server/fastify/src/routes/generationChat.ts` (`readStoredAsset`),
  `prompt/chatDispatch.ts`, `prompt/history.ts`, `prompt/lorebook.ts`,
  `prompt/triggers.ts` + `triggerDataEffects.ts`.
- Theme 9 — transport/build defaults (Phase 4): `server/fastify/src/app.ts`
  (no compress; static registration), `vite.config.ts`, `package.json`
  (build scripts), `Dockerfile`.

For current repo navigation, read [`../../STRUCTURE.md`](../../../../STRUCTURE.md)
and [`../../structure/`](../../../../docs/structure/). Closed workstreams are indexed in
[`../README.md`](../../../README.md); deferred follow-ups are in
[`../leftover.md`](../../../deferred-work/leftover.md).

## Reference Templates

Reuse these already-landed patterns:

- Scoped mutation reads — `chatScopedRead` + `loadPersistedForChatMutation`
  (v1 Phase 2 / v2-K1, `e78047764`). M1 wires the same scoped read into
  `persistAssemblyMutations`; M3/L11 add the settings/collection analogs.
- Settings-only loader — `loadServerIntentCompletionSettings` (v2-L3,
  `3c8f91b4b`). M3 generalizes it to the command-mutation pipeline.
- Skip-load contract — `skipDatabaseLoad` in `commands/mutations.ts`, proven
  live at `routes/realmImport.ts:624`. L13 is a one-line adoption.
- Single-message append — `appendMessageCommand` /
  `appendCurrentChatUserMessageForSend` + the server append fast-path
  (`appendActiveChatMessageTail`, v2-L14). M4 routes the live send through
  them.
- Field-scoped snapshots — `CharacterSelectionSnapshot` /
  `restoreCharacterSelection` (`src/ts/characterCommands.ts`). M5 and L21
  follow this shape.
- Rollback suppression flag — `rollbackServerBackedLorebooks`
  (`suppressRollbackDispatch`, v2-M11/M12 wave). L23/L24/L26 wire the same
  flag into the missing paths; M8's flush must respect it.
- First-baseline retention — `existing?.previous ?? previous`
  (`scriptDefinitionBridge.svelte.ts`) and the settings
  `if (!(key in pendingSettingsPatch.previous))` guard. L25/L27 mirror them.
- $derived list helpers — `formatGridCatalogCharacterLists` /
  `sortModuleSettingsRows` (+ their gate tests, v2-L42/L43). M6 mirrors them
  for MobileCharacters.
- Execution budgets — `TriggerExecutionBudget` (server, v2-H1) and
  `LuaExecBudget` + the wasmoon count-hook deadline (`luaRuntime.ts`).
  L38/L39 port them to the client interpreters.
- Shared AudioContext — `getNetworkAudioContext` (`tts.ts`, v2-M18). L52/L55
  reuse or mirror it.
- Deadlines and caps — `requestAbort.ts` (sliding refresh), `createHubAbort`
  (`routes/hub.ts`), `slidingDeadline`/`refreshDeadline` (`streamJobs.ts`,
  v2-L1), `boundedInflate.ts`, the `processScriptCache`/`compiledRegexCache`
  LRU cap shape. L2/L4/L5/L16/L17/L18/L47/L48 and the cache caps
  (L32/L42/L47) follow these shapes.
- Trusted-write + scoped-command persistence — `withTrustedServerProjectionWrite`
  paired with a scoped command dispatch (e.g. `mutateCurrentChatMessages`).
  L34/L35/L36 (and the riding I20) follow this pair: wrapping alone restores
  behavior for the session; only the command makes it durable.

Each slice narrows the hot path, keeps the broad path for true full-corpus
consumers, and adds a regression test.

## V4 Integration

[`../v4/audit-stability-and-performance-v4.md`](../v4/audit-stability-and-performance-v4.md)
is now archived and was treated as a post-Phase-4 routing input for the
remaining v3 work, not as an unrelated plan. Start with
[`v4-integration-brief.md`](v4-integration-brief.md) before opening Phase 5
or rewriting any later phase slices.
