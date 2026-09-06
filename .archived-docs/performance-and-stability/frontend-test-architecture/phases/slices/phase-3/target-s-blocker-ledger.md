# Phase 3 Proof Slice: Target-S Blocker Ledger

Status: Complete without promotion

## Scope

Account for all 93 Phase 0 target-S candidates that failed the exact
Svelte+Node probe. The other 34 target-S candidates passed and have already
moved to their smallest verified runtime.

No production module, test body, assertion, mock, setup file, or permanent
runtime inventory changes in this proof slice.

## Probe Result

The temporary Svelte+Node inventory contained all 127 outstanding target-S
candidates. Of those, 34 passed unchanged and 93 failed. Ninety-one failed
because their unchanged collection or execution graph reads `window` (or a
hoisted mock reaches the same `window` edge); two collected but exercised the
real `DOMParser` API.

After all temporary entries were removed, the exact 92-file ordinary retained
Happy-DOM scope passed 1,502 tests in 22.26s wall with 2,920,532 KiB peak RSS.
The separately gated send-clone probe passed its one test in 3.73s wall with
723,292 KiB peak RSS. This proves all 93 files / 1,503 tests remain healthy
under their current owner while the Svelte+Node failures establish that S is
not a valid unchanged runtime.

## Window And Browser-Graph Blockers

The following 91 candidates reach an eager browser global. The common verified
anchors are `stores.svelte.ts:23`, where store initialization reads
`window.innerWidth`, and `plugins/pluginSafeClass.ts:33`, where plugin-safe
location initialization reads `window.location`. Some subjects, such as
`globalApi.svelte.ts:82`, also execute real document-owned behavior.

- `src/ts/activeChatGenerationSettings.test.ts`
- `src/ts/agentPresets.test.ts`
- `src/ts/characters.changeChar.test.ts`
- `src/ts/characters.imageEmotion.test.ts`
- `src/ts/characters.importChat.test.ts`
- `src/ts/chatFork.test.ts`
- `src/ts/globalApi.changeChatTo.test.ts`
- `src/ts/globalApi.downloadFile.test.ts`
- `src/ts/globalApi.getFileSrc.test.ts`
- `src/ts/globalApi.proxy.test.ts`
- `src/ts/globalApi.saveAssets.test.ts`
- `src/ts/loadout.test.ts`
- `src/ts/moduleCommands.test.ts`
- `src/ts/observerProjectionLifecycle.test.ts`
- `src/ts/persona.iconUpload.test.ts`
- `src/ts/persona.test.ts`
- `src/ts/stores.importSafety.svelte.test.ts`
- `src/ts/stores.modulesEffect.svelte.test.ts`
- `src/ts/util.persona.test.ts`
- `src/ts/__tests__/sendCloneCountProbe.test.ts`
- `src/ts/process/index.svelte.stop.test.ts`
- `src/ts/process/regexDisplayReload.test.ts`
- `src/ts/process/rerollNavigation.guard.test.ts`
- `src/ts/process/rerollNavigation.rollback.test.ts`
- `src/ts/process/scriptings.test.ts`
- `src/ts/process/scripts.editdisplay.test.ts`
- `src/ts/process/scripts.importRegex.test.ts`
- `src/ts/process/scripts.regexCache.test.ts`
- `src/ts/process/serverBackedSendChat.findMessage.test.ts`
- `src/ts/process/serverGeneratedMessageTranslation.test.ts`
- `src/ts/process/triggers.clientBudget.test.ts`
- `src/ts/process/triggers.regexMemo.test.ts`
- `src/ts/server/characterBridge.svelte.test.ts`
- `src/ts/server/characterShellHydration.test.ts`
- `src/ts/server/chatMessageHydration.reactivity.svelte.test.ts`
- `src/ts/server/lorebookBridge.svelte.test.ts`
- `src/ts/server/lorebookBridge.test.ts`
- `src/ts/server/promptTemplateHydration.test.ts`
- `src/ts/server/resourceRefresh.test.ts`
- `src/ts/server/resourceState.svelte.test.ts`
- `src/ts/server/settingsBridge.durable.test.ts`
- `src/ts/server/settingsBridge.svelte.test.ts`
- `src/ts/setting/displaySettingsData.svelte.test.ts`
- `src/ts/storage/database.downloadPreset.test.ts`
- `src/ts/storage/database.importPreset.test.ts`
- `src/ts/storage/database.resourceState.test.ts`
- `src/ts/storage/database.svelte.test.ts`
- `src/ts/parser/tests/additionalAssetCache.test.ts`
- `src/ts/process/__tests__/buildDescription.test.ts`
- `src/ts/process/__tests__/buildLorebookContext.test.ts`
- `src/ts/process/__tests__/buildPlainPromptSections.test.ts`
- `src/ts/process/__tests__/buildStaticPromptSections.test.ts`
- `src/ts/process/__tests__/charEmotionStore.test.ts`
- `src/ts/process/__tests__/dispatchRequest.test.ts`
- `src/ts/process/__tests__/emotionFallbackEmbedding.test.ts`
- `src/ts/process/__tests__/emotionFallbackLlm.test.ts`
- `src/ts/process/__tests__/emotionFromResponse.test.ts`
- `src/ts/process/__tests__/igp.test.ts`
- `src/ts/process/__tests__/imggenStableDiff.test.ts`
- `src/ts/process/__tests__/lorebook.resourceGuard.test.ts`
- `src/ts/process/__tests__/nonStreamResponse.test.ts`
- `src/ts/process/__tests__/normalizeTemplate.test.ts`
- `src/ts/process/__tests__/orchestrateResponse.test.ts`
- `src/ts/process/__tests__/outputTrigger.test.ts`
- `src/ts/process/__tests__/preflightTemplateTokens.test.ts`
- `src/ts/process/__tests__/renderFinalPrompt.test.ts`
- `src/ts/process/__tests__/runStage4.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChatContext.test.ts`
- `src/ts/process/__tests__/sendChatErrors.test.ts`
- `src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts`
- `src/ts/process/__tests__/stage4Finalize.test.ts`
- `src/ts/process/__tests__/triggers.resourceGuard.test.ts`
- `src/ts/process/mcp/mcp.test.ts`
- `src/lib/Setting/Pages/Module/ModuleMenu.svelte.test.ts`
- `src/ts/parser/tests/cbs/conditionals.test.ts`
- `src/ts/parser/tests/cbs/eachReinjection.test.ts`
- `src/ts/parser/tests/cbs/escapes.test.ts`
- `src/ts/parser/tests/cbs/loop.test.ts`
- `src/ts/parser/tests/cbs/strings.test.ts`
- `src/ts/process/request/tests/anthropicProfileOptions.test.ts`
- `src/ts/process/request/tests/durableGeneration.test.ts`
- `src/ts/process/request/tests/koboldProfileOptions.test.ts`
- `src/ts/process/request/tests/modelRoleRouting.test.ts`
- `src/ts/process/request/tests/openaiProfileOptions.test.ts`
- `src/ts/process/request/tests/openaiResponsesLegacyProfileOptions.test.ts`
- `src/ts/process/request/tests/pluginProviderModelId.test.ts`
- `src/ts/process/request/tests/serverPromptAssembly.test.ts`
- `src/ts/process/mcp/risuaccess/tests/characters.setCharacterInfo.test.ts`
- `src/ts/process/mcp/risuaccess/tests/modules.optimisticProjection.test.ts`
- `src/ts/process/mcp/risuaccess/tests/modules.test.ts`

Owner: Phase 4 stopping-gate triage. Reason: the unchanged import graph reads a
browser global during collection or execution, so adding a project-wide
`window` fake would violate the Phase 3 no-browser-global rule and could mask a
real browser contract. Revisit after the Phase 3 formal profile only when a
measured Phase 4 pure-logic seam removes the eager browser edge without mocking
away the tested dependency. Candidates not selected by current profiler
evidence remain D-owned and are reclassified as durable DOM/browser contracts
during Phase 5.

## DOMParser Blockers

- `src/ts/process/files/multisend.test.ts` executes XML parsing through
  `process/files/multisend.ts:221`.
- `src/ts/translator/translator.html.test.ts` executes and spies on HTML
  parsing through `translator/translator.ts:888`.

Owner: Phase 5 DOM contract consolidation. Reason: `DOMParser`, parsed document
traversal, and element/text extraction are behavior under test rather than
ambient setup conveniences. Revisit only if a separately tested pure planning
seam is extracted; retain the parser contract in Happy-DOM.

## Validation And Done Criteria

- The exhaustive temporary target-S probe evaluated all 127 candidates.
- Every one of the 93 retained files has an exact Svelte+Node failure category,
  owner, reason, and revisit condition in this ledger.
- The exact retained Happy-DOM scopes passed 93 files / 1,503 tests with no real
  network request.
- Inventory ownership remains unchanged by this proof record and continues to
  be exhaustive and disjoint.
- Formatting and `git diff --check` passed.

Exact commands, source-state details, and resource observations are in
[latest-verification.md](../../../latest-verification.md).

## Rollback

No runtime rollback is required. Replace a ledger entry only when a relevant
production/test boundary changes and a fresh target-project probe passes.
