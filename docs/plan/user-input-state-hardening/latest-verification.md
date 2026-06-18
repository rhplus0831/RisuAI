# Latest Verification

Date: 2026-06-18

This file records the latest validation proof for the user input state hardening
workstream.

## Latest Run

- Runtime/code change under test: Phase 7 final workstream proof for stale-state
  hardening across shared helpers, rollback, dirty projection, upload/import
  callbacks, chat/message/generation freshness, collection domains,
  resync/memory/navigation fences, Fastify routes, browser smoke, and TypeScript.
- Browser-smoke note: the first `pnpm smoke:fastify-browser` attempt exposed
  stale smoke fixtures that still used legacy `generationSettings.presetId` and
  `botPresets`, plus a reroll smoke navigation assumption that character
  selection always opened the chat screen. The smoke specs were updated to seed
  `modelPresetId`/`promptPresetId` with split preset arrays and to open the
  fixture chat through the visible chat row when needed. The final smoke rerun
  passed.
- Commands:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/commands.test.ts src/ts/chatCommands.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/lib/Setting/Pages/PersonaSettings.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/ts/process/files/multisend.test.ts src/ts/characters.imageEmotion.test.ts src/ts/server/characterAdditionalAssetUpload.test.ts src/ts/server/moduleAssetUpload.test.ts src/ts/server/promptPresetIconUpload.test.ts src/ts/server/characterEmotionUpload.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/ts/server/nanoGPTDashboardFetch.test.ts src/lib/UI/NanoGPTDashboard.svelte.test.ts src/ts/server/settingsMediaAssetUpload.test.ts src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts src/ts/server/characterTtsAssetUpload.test.ts src/lib/SideBars/CharConfig.svelte.test.ts src/ts/server/colorSchemeImport.test.ts src/ts/gui/colorscheme.test.ts src/ts/server/pluginImport.test.ts src/ts/plugins/plugins.test.ts src/ts/server/personaIconUpload.test.ts src/ts/persona.iconUpload.test.ts src/ts/server/biasImport.test.ts src/ts/server/characterFolderImageUpload.test.ts src/ts/server/naiVibeImport.test.ts src/ts/server/seperateParametersImport.test.ts src/lib/Others/AllSeperateParameters.svelte.test.ts src/lib/Others/ProTools/EasyPanel.svelte.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/durableGeneration.test.ts src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.guard.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/lib/ChatScreens/partialEditFreshness.test.ts src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/ChatScreens/Chat.customHtml.test.ts src/lib/ChatScreens/chatButtonTriggerFreshness.test.ts src/ts/process/__tests__/command.projectionGuard.test.ts
pnpm exec vitest run src/ts/server/projectionResync.test.ts src/ts/server/backups.test.ts src/ts/bootstrap.test.ts src/ts/server/characterShellHydration.test.ts src/ts/characters.changeChar.test.ts src/ts/characters.importChat.test.ts src/ts/router.test.ts src/ts/server/memoryJobRefresh.test.ts src/ts/server/memoryJobEvents.test.ts src/lib/Others/WelcomeRisu.svelte.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveBundleImportRoute.test.ts server/fastify/__tests__/realmImport.test.ts server/fastify/__tests__/backups.test.ts
pnpm smoke:fastify-browser
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

- Result: passed on 2026-06-18. The Vitest matrix passed 1047 tests across 65
  files: 354/11, 179/27, 115/10, 96/10, and 303/7. Browser smoke passed 5
  Playwright tests. Both TypeScript checks passed.
- Residual gaps: none for Phase 7 or the user-input state hardening workstream.
  The known pre-existing `src/ts/compatibilityAdapters.test.ts` failure at line
  626 remains excluded from the gate because it reproduced at baseline commit
  `30d4ad7ab`.

## Remaining Proof

None. Phases 0 through 7 are complete and the workstream is closed.

## Validation Commands

Use the final Phase 7 matrix above for closeout proof. The known
`src/ts/compatibilityAdapters.test.ts` baseline failure is not part of this
matrix.
