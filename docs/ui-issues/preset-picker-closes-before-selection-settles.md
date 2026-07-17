# Global preset picker closes before selection persistence settles

## Summary

The global model/prompt preset picker closes immediately after starting an optimistic selection. selectModelPreset and selectPromptPreset expose no promise or persistence status, so the picker presents the action as complete before Fastify has accepted it.

If the server terminally rejects the command, the selection and all preset-derived settings roll back after the modal has disappeared. If the durable command is retained, the modal still closes without indicating that the selection is only queued.

## Location

- src/lib/Setting/botpreset.svelte:59-68,126-139,286-287
- src/lib/Setting/Pages/Model/ModelPresetList.svelte:20-25,102-109
- src/ts/storage/database.svelte.ts:2226-2330,5531-5581,6041-6100
- src/ts/server/commands.ts:2399-2411,2507-2519
- server/fastify/src/routes/commands.ts:3303-3342,3666-3707
- Rollback coverage: src/ts/storage/database.svelte.test.ts:3678-3727,4581-4640

## Trigger

1. Open the global model or prompt preset picker.
2. Select a different preset.
3. Let POST /model-presets/select or /prompt-presets/select fail terminally after the optimistic projection has been applied.

For model mode, botpreset embeds ModelPresetList with afterApply={close}; applyPreset invokes selectModelPreset and then afterApply. For prompt mode, selectPreset invokes selectPromptPreset/selectModelPreset and then close directly.

## Expected behavior

The picker should associate the click with the exact selection command. It should close only after acceptance, or close with a clear queued acknowledgement if the intent is durably retained. A terminal rejection should keep/reopen the picker, restore the prior selection, and show an actionable error.

## Actual behavior

The modal closes synchronously. The selection helper optimistically changes modelPresetsId/promptPresetsId and applies the selected preset's fields to the shared settings projection, then starts a fire-and-forget durable mutation.

The internal mutation owner correctly rolls back the selected ID and attempted-matching settings on terminal failure, but no result reaches the picker. The user can return to chat or start generation with what appears to be the newly selected configuration, only for it to revert to the previous preset later. Retained selection is also indistinguishable from accepted selection.

## Underlying cause

dispatchPreparedPresetMutation distinguishes accepted, retained, and rollback internally, and dispatchPresetRowMutation registers final durable-settlement listeners. That state is consumed only by projection repair. Both exported selection functions return void, and both UI call sites invoke close immediately after calling them.

The migration therefore preserved optimistic rollback correctness but lost an acknowledgement path from the server-owned mutation back to the interaction that claims completion.

## Affected data flow

1. **UI interaction:** a global picker row calls applyPreset/selectPreset.
2. **Client projection:** selectModelPreset/selectPromptPreset snapshots the previous selected ID and preset-derived settings, updates the selected index, and applies the new preset fields locally.
3. **Durable request:** the helper stages settings:bridge with POST /model-presets/select or /prompt-presets/select and dispatches the command using the current base revision.
4. **Server mutation:** Fastify resolves the preset by durable ID. Model selection writes selected settings and reapplies the selected prompt preset; prompt selection writes settings and prompt templates when applicable. It returns the new revision and selected event.
5. **Client acknowledgement:** dispatchPresetRowMutation settles on success, retains/reasserts a queued attempt, or restores the previous selection/settings on terminal failure.
6. **Displayed state:** the picker is already unmounted. The main UI initially renders the optimistic settings and later renders a rollback or replay result with no selection-specific explanation.

## Severity and likely user impact

**High.** Preset selection changes model, provider, credentials/references, parameters, prompts, and prompt templates used for generation. Treating an unacknowledged selection as complete can cause a request to run with a different configuration than the one the user believes they chose.

## Recommended fix

Make selectModelPreset and selectPromptPreset return a typed promise for accepted | queued | failed, while preserving their existing projection guards. The picker should track a per-selection busy state, suppress duplicate clicks, and:

- close normally on accepted;
- show a localized queued acknowledgement before closing (or keep a visible queued badge) on retained;
- remain open, display an error, and show the restored selection on failed.

Keep the no-op “already selected” case synchronous. Add component tests for accepted, retained, and terminally rejected selections in both embedded model and prompt picker paths.
