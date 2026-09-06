# Connected Reader Boundary Inventory

Planning source: `696aecef2dd22dc50ebeca47144cad2b8f5c68b0`.

This is a seed map from source inspection, not an exhaustive audit or completed
mutation-guard inventory. Phase 0 expands it by actual caller and runtime.
Execution and verification results belong in [status](status.md).

## Boundary Map

| ID  | Current source owners                                                                                                                                                                                                           | Observed behavior / required disposition                                                                                                                                         | Phase   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| B01 | `src/ts/startupReadiness.ts`, `src/ts/observerShellLifecycle.svelte.ts`, `packages/protocol/src/startupTelemetry.ts`                                                                                                            | Route/write readiness is coupled. Define live role/connectivity independently from startup milestone history; keep telemetry contracts coherent.                                 | 1       |
| B02 | `src/ts/bootstrap.ts`, `src/ts/server/bootstrap.ts`, `src/ts/observerShellFlag.ts`                                                                                                                                              | Optional read-only shell is followed by writer acquisition. Add stable observer startup and role-specific service composition.                                                   | 1–3     |
| B03 | `src/ts/server/activeWriterSession.ts`, `src/styles.css`                                                                                                                                                                        | Writer loss stops reading services and applies global interaction freeze. Replace with demotion and targeted mutation controls after prerequisites pass.                         | 1, 3    |
| B04 | `src/ts/server/events.ts`, `src/ts/server/resourceInvalidation.ts`, `src/ts/server/resourceRefresh.ts`, `src/ts/server/resourceCache.ts`                                                                                        | Event subscription is writer-loss gated; reconciliation and reconnect also involve replay. Keep read updates and recovery independent from write/replay admission.               | 2–3     |
| B05 | `src/App.svelte`, `src/lib/ObserverShell.svelte`, `src/ts/router.ts`, `src/ts/routeHandlers/character.ts`, `src/ts/routeHandlers/settings.ts`, `src/ts/server/routeResourceLoader.ts`                                           | Observer UI is separate; ordinary route effects require writer readiness, and settings routes can persist persona selection. Support read routes without authoring side effects. | 1–2     |
| B06 | `src/ts/characters.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/chatCommands.ts`, `src/lib/SideBars/SideChatList.svelte`                                                                                                          | Character/chat selection dispatches shared mutations; some command-unavailable branches still mutate local owners. Introduce local reader selection and gate structural actions. | 1–2     |
| B07 | `src/ts/server/commands.ts`, `src/ts/server/ownerMutationLifecycle.ts`, `src/ts/server/pendingOwnerMutationRegistry.ts`                                                                                                         | Command access and owner flush lifecycle exist. Cover queue admission/execution, debounce, pagehide, and callbacks finishing after demotion.                                     | 1, 3    |
| B08 | `src/ts/server/pendingMutationOutbox.ts`, `src/ts/server/pendingMutationReplay.ts`, `src/ts/server/draftRecoveryScope.ts`, `src/ts/server/moduleEditorDraftStore.ts`, `src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts` | Intent and drafts carry scope but have different recovery semantics. Preserve local edits, settle accepted receipts, and keep inactive intent out of reader projection/replay.   | 0–3     |
| B09 | `src/ts/plugins/plugins.svelte.ts`, `src/ts/plugins/apiV3/v3.svelte.ts`, `src/ts/process/recoveredGenerationEffects.ts`                                                                                                         | Some plugin mutation fallbacks change resource owners without commands. Classify runtime hooks, display needs, storage, and effect execution before enabling them in readers.    | 1, 4    |
| B10 | `src/ts/process/reattach.ts`, `src/ts/server/generationOperations.ts`, `src/ts/process/generationPersistenceState.ts`, `src/ts/server/messageTranslationJobs.ts`, `src/ts/server/greetingTranslations.svelte.ts`                | Observation and writer recovery are composed together. Isolate status/stream viewing from finalization retry, effect claims, and mutation actions.                               | 2–4     |
| B11 | `server/fastify/src/activeWriter.ts`, `server/fastify/src/routes/bootstrap.ts`, `server/fastify/src/routes/events.ts`, `server/fastify/src/routeManifest.ts`                                                                    | Server supports one writer and authenticated readers. Preserve takeover, initial writer snapshot, guard, and replay policies; audit minimal protocol needs.                      | 0, 3    |
| B12 | `server/fastify/src/routes/generationChat.ts`, `server/fastify/src/routes/generationOperations.ts`, `server/fastify/src/routes/generationEffects.ts`                                                                            | Detached jobs support viewers; submit/control/recovery effects require explicit policy. Preserve durable execution and writer fencing.                                           | 4       |
| B13 | `src/ts/observerProjectionLifecycle.ts`, `src/ts/server/replacementDatabaseOwnership.ts`, `src/ts/server/lifecycleRecovery.ts`                                                                                                  | Auth loss, lineage replacement, and browser resume have existing reset/recovery owners. Reader mode must retain these stronger boundaries.                                       | 2–5     |
| B14 | `src/lang/en.ts`, `src/docs/client-runtime.md`, `src/docs/svelte-chat-ui.md`, `src/docs/svelte-navigation-ui.md`                                                                                                                | Localized statuses and supported reader affordances require UI and final guide updates. Current guides describe shipped behavior until cutover.                                  | 2–5     |
| B15 | `src/ts/server/displaySources.ts`, `server/fastify/src/routes/displaySources.ts`, `packages/protocol/src/displaySource.ts`                                                                                                      | Display reads have their own protocol and freshness fences. Rendering with observer authority must preserve these fences without acquiring write access.                         | 0, 2, 4 |
| B16 | `src/ts/server/events.ts`, `src/ts/server/memoryJobRefresh.ts`, `src/ts/server/bardWikiJobEvents.ts`, `server/fastify/src/memoryEvents.ts`                                                                                      | Memory/BardWiki snapshots and live events need observer-safe consumers, lifecycle teardown, and ordering independent from the domain revision cursor.                            | 0, 2, 5 |

## Phase 0 Expansion Rules

For each relevant entry point record its trigger, projection or durable effect,
owner, reader disposition, demotion handling, and exact behavioral test. Expand
rows or add a small companion table where one file has materially different
paths. Allowed dispositions are read-only use, writer-only guard, or unavailable
with an explicit product affordance. A necessary in-scope path cannot be silently
deferred. Record any server-owned operational exception and why it is safe.
Bound the review to entry points reachable from supported reader surfaces and
callbacks that can survive writer demotion. Record that concrete set and its
reviewed/unclassified totals at the end of Phase 0; unclassified in-scope entries
must be zero before their surfaces are enabled. New reachable paths discovered
later join this set. This is not a repository-wide plugin or editor redesign.

Include at least:

- Normal, sidebar, direct-link, history, notification, and hotkey navigation;
  selection/last-interaction writes, empty-chat creation, and cold-storage reads.
- Composer/message actions, structural chat actions, editor watches, imports,
  uploads, settings controls, and lifecycle flushes reachable from reader UI.
- Plugin V2/V3 mutation APIs, local projection fallbacks, plugin storage and
  display callbacks, scripts, provider/media operations, and completion effects.
- Staged versus sent versus accepted-unacknowledged commands; newer draft edits;
  owner teardown; same-origin tab storage sharing; auth and lineage replacement.
- Resource reads and refreshes that apply shared selection or start other
  runtimes, not just direct write HTTP methods.

## Existing Verification Owners

Confirm current discovery before extending these files. Their existence is not
evidence that they cover the proposed behavior.

| Contract                           | Starting test owners                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, role, and event admission | `src/ts/startupReadiness.test.ts`, `src/ts/bootstrap.test.ts`, `src/ts/server/activeWriterSession.test.ts`, `src/ts/server/events.test.ts`, `src/ts/server/bootstrap.svelte-node.test.ts`                                                                                                                                                                         |
| Visible observer and routing       | `src/lib/ObserverShell.svelte.test.ts`, `src/App.routeEffect.dom.test.ts`, `src/ts/router.test.ts`, `src/ts/routeHandlers/character.test.ts`, `src/ts/server/routeResourceLoader.test.ts`                                                                                                                                                                         |
| Mutation and draft recovery        | `src/ts/server/commands.test.ts`, `src/ts/server/pendingMutationOutbox.test.ts`, `src/ts/server/pendingMutationOutbox.crossTab.test.ts`, `src/ts/server/pendingMutationReplay.test.ts`, `src/ts/server/moduleEditorDraftStore.test.ts`                                                                                                                            |
| Plugin boundaries                  | `src/ts/plugins/plugins.test.ts`, `src/ts/plugins/apiV3/v3.svelte.test.ts`                                                                                                                                                                                                                                                                                        |
| Generation observation/effects     | `src/ts/process/__tests__/reattach.test.ts`, `src/ts/server/generationOperations.test.ts`, `src/ts/process/recoveredGenerationEffects.svelte-node.test.ts`, `src/ts/process/generationPersistenceState.test.ts`                                                                                                                                                   |
| Server ownership and streams       | `server/fastify/__tests__/activeWriter.test.ts`, `server/fastify/__tests__/routeProtection.test.ts`, `server/fastify/__tests__/bootstrap.test.ts`, `server/fastify/__tests__/events.test.ts`, `server/fastify/__tests__/generationOperations.test.ts`, `server/fastify/__tests__/generationEffects.test.ts`, `server/fastify/__tests__/durableGeneration.test.ts` |
| Real browser transitions           | `server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts`, `server/fastify/browser-smoke/startupDirectLinks.spec.ts`                                                                                                                                                                                                                                |

Use the [browser recovery](../../tests/browser-state-sync-and-recovery.md),
[navigation/chat](../../tests/app-navigation-and-chat.md), and
[generation](../../tests/prompting-generation-and-streaming.md) test guides for
additional owners. Add a focused connected-reader browser spec if extending the
existing startup matrix would mix unrelated contracts. Record its real path
when created; no hypothetical test file counts as verification.
