# Prompt And Bot Settings Audit

## Scope

Audited global prompt, preset, settings UI, and command persistence paths for BotSettings, PromptSettings, split model/prompt presets, loadouts, model parameters, system/main/jailbreak/global note, stop strings, bias/additional params, and regex lists. The audit focused on draft values not reaching persisted objects and optimistic UI updates that can appear saved without durable command persistence.

## Inspected Files

- `src/lib/Setting/Pages/BotSettings.svelte`
- `src/lib/Setting/Pages/PromptSettings.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Others/LoadoutModal.svelte`
- `src/ts/storage/database.svelte.ts`
- `src/ts/presetSplit.ts`
- `src/ts/presetFieldMirror.ts`
- `src/ts/promptPresetModelOverrides.svelte.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/promptTemplateBridge.svelte.ts`
- `src/ts/server/bridgeFlush.ts`
- `src/ts/setting/utils.ts`
- `src/ts/loadout.ts`
- `src/ts/activeChatGenerationSettings.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `server/fastify/src/commands/loadouts.ts`
- `server/fastify/src/routes/commands.ts`

## Findings

### Bad: loadouts still persist/apply only legacy bot presets

Fastify now initializes and uses split `modelPresets` and `promptPresets` even when legacy `botPresets` is empty: `setDatabase` normalizes `botPresets` to `[]` and `botPresetsId` to `-1`, then creates default split model and prompt presets at `src/ts/storage/database.svelte.ts:560` and `src/ts/storage/database.svelte.ts:567`.

The loadout model still stores only a single legacy `presetName`. `makeLoadout` reads `DBState.db.botPresets[DBState.db.botPresetsId]` and then dereferences `preset.name` at `src/ts/loadout.ts:48` and `src/ts/loadout.ts:57`. In a normal split-preset database with no legacy presets, this can throw before a loadout is saved. Even when legacy presets exist, the saved loadout does not record `modelPresetsId`, `promptPresetsId`, selected model/prompt preset IDs, or active chat generation settings.

Applying a loadout has the same legacy-only behavior. It finds `DBState.db.botPresets` by name at `src/ts/loadout.ts:517`, calls `setPreset` on that legacy preset at `src/ts/loadout.ts:547`, and dispatches `selectPresetCommand` at `src/ts/loadout.ts:592`. It never dispatches `selectModelPresetCommand`, `selectPromptPresetCommand`, or a chat generation settings command. The server shape reinforces this gap: `LoadoutRecord` has `presetName` but no split preset IDs at `server/fastify/src/commands/loadouts.ts:14`, and `createLoadoutRecord` only persists that name at `server/fastify/src/commands/loadouts.ts:67`.

Impact: loadouts can fail to save in the current split-preset default state, and successful loadouts do not restore the model/prompt preset selections that the current UI and generation path actually use.

Suggested fix:

- Extend the loadout shape to persist split preset IDs, e.g. `modelPresetId`, `promptPresetId`, and, if loadouts are meant to restore chat-specific generation configuration, the relevant `generationSettings` fields.
- Make `makeLoadout` tolerate absent legacy presets and prefer split preset IDs/names from `DBState.db.modelPresets[modelPresetsId]` and `DBState.db.promptPresets[promptPresetsId]`.
- Update `applyLoadout` to dispatch split preset commands or active-chat generation settings commands instead of only `selectPresetCommand`.
- Keep legacy `presetName` as an import/backward-compat fallback only.

Suggested tests:

- Unit test `saveCurrentLoadout` with `botPresets: []`, `botPresetsId: -1`, and valid split presets; assert it does not throw and persists split preset IDs.
- Unit test `applyLoadout` dispatches split model/prompt selection for a split-preset loadout.
- Server route test for `/api/v1/commands/loadouts` preserving the new split preset fields through create/update/projection.

## Notes

Prompt and settings draft persistence generally routes through the expected command paths. `BotSettings` prompt fields mirror into the selected prompt preset via `updatePromptPreset` at `src/lib/Setting/Pages/BotSettings.svelte:508`, prompt template edits flush pending debounced commands on component teardown at `src/lib/Setting/Pages/PromptSettings.svelte:435`, and lifecycle flushing covers prompt/settings bridges at `src/ts/server/bridgeFlush.ts:9`. I did not find another likely draft-only persistence gap in the inspected prompt, stop-string, bias/additional-param, or regex-list paths.
