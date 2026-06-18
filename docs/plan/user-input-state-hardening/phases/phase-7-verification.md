# Phase 7: Verification

Status: complete.

Goal: prove the stale-state hardening workstream across shared helpers, domain
flows, browser interactions, and TypeScript checks.

## Scope

- Focused regression coverage for every Phase 1-6 behavior family is included
  in the final matrix.
- Browser smoke ran through `pnpm smoke:fastify-browser`.
- Final command output is recorded in `../latest-verification.md`.
- `../status.md` marks the workstream closed.

## Final Coverage

- Operation tokens reject stale async callback results for changed targets.
- Narrow rollback skips when live state no longer equals the attempted value.
- Dirty projection preserves newer local draft fields while refreshing clean
  fields.
- Composer send/continue/file/translate paths do not clear or append into newer
  input.
- Reroll, partial edit, trigger, suggestion, and generation finalization verify
  the target chat/message after async boundaries.
- Character, settings, module, prompt icon, plugin, and theme/background upload
  or import callbacks check entity/run freshness.
- Collection rollback for presets/personas/loadouts/lore/scripts/modules/
  plugins/sidebar lists does not restore whole stale snapshots.
- Full resync/restore/import, memory job updates, and route hydration are fenced
  or intentionally destructive with proof.

## Browser Smoke

Result: passed on 2026-06-18.

`pnpm smoke:fastify-browser` passed 5 Playwright tests. The first attempt
exposed stale smoke fixtures using legacy `generationSettings.presetId` and
`botPresets`, plus a reroll smoke helper that assumed character selection always
opened the chat screen. The smoke specs now seed the current
`modelPresetId`/`promptPresetId` split preset shape, pre-accept the TOS gate in
the reroll smoke, and open the fixture chat only when the browser is still on
the chat list. The final rerun passed.

## Final Commands

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

## Final Results

- Vitest set 1: 11 files, 354 tests passed.
- Vitest set 2: 27 files, 179 tests passed.
- Vitest set 3: 10 files, 115 tests passed.
- Vitest set 4: 10 files, 96 tests passed.
- Fastify Vitest set: 7 files, 303 tests passed.
- Browser smoke: 5 Playwright tests passed.
- TypeScript: `tsconfig.client-lib.json` and
  `server/fastify/tsconfig.json --noEmit` passed.

## Residual Gaps

None for Phase 7. The known pre-existing
`src/ts/compatibilityAdapters.test.ts` failure at line 626 remains excluded from
this closeout gate because it reproduced at baseline commit `30d4ad7ab`.

## Exit Criteria

- All required coverage has a passing focused test.
- Browser smoke passed.
- TypeScript workflow passed.
- `../status.md` records the workstream as complete.
