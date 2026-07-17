# Preset picker rename drafts mask rollback and authoritative names

## Summary

The global prompt-preset picker and the active-chat model/prompt picker keep each inline rename in a component-local renameDrafts map. Once a key is present, the input always renders that draft instead of the resource-backed preset name. The draft is cleared only when edit mode is toggled, not when the debounced server command settles or an authoritative collection update is applied. Global model mode uses ModelPresetList instead and does not take this path.

A rejected rename can therefore be correctly rolled back in shared state while the open picker continues to show the rejected name. Other components show the persisted name at the same time.

## Location

- src/lib/Setting/botpreset.svelte:46-50,88-124,289-376
- src/ts/storage/database.svelte.ts:752-823,900-934,1064-1170,5409-5428,5898-5917
- src/ts/server/commands.ts:2355-2375,2463-2483
- server/fastify/src/routes/commands.ts:3128-3210,3488-3571

## Trigger

1. Open the global prompt-preset picker, or an active-chat model/prompt picker, enter edit mode, and change a preset name.
2. updatePresetNameDraft stores the text in renameDrafts and calls updatePromptPreset or updateModelPreset. The model variant is active-chat-only because global model mode renders ModelPresetList.
3. Let the debounced PATCH be terminally rejected, for example because the preset was deleted on the server or the request is invalid.
4. The split-preset mutation owner rolls the resource row back to its prior name while the picker remains in edit mode.

An authoritative preset collection update that changes the row name while the editor remains open produces the same display split.

## Expected behavior

The input should represent the current owned draft only while that edit is pending. On terminal rollback it should show the restored persisted name and an error; on accepted canonical reconciliation it should adopt the canonical name; on an unrelated authoritative update it should either merge/rebase or explicitly show a conflict.

## Actual behavior

presetNameDraft returns renameDrafts[key] whenever the property exists. No command-result, resource-apply, or rollback path removes or rebases that entry. The terminal rollback updates getDatabase().modelPresets/promptPresets, but the TextInput binding continues to return the rejected text.

The non-editing ModelPresetList and other preset consumers read the shared resource row and can show the restored name concurrently. Toggling edit mode finally clears the map and makes the input snap to the authoritative value without explaining why.

## Underlying cause

updateModelPreset and updatePromptPreset have a robust resource-side mutation owner: they queue per-preset field patches, persist them through the durable outbox, reconcile local effects, and perform attempted-value-guarded rollback. botpreset.svelte adds a second projection owner for the same field but never connects it to that lifecycle.

renameDrafts is keyed stably by preset kind and ID, which protects against reorder identity bugs, but stable identity alone does not establish settlement. The map has no pending/accepted/failed metadata and observes neither collection projection epochs nor command outcomes.

## Affected data flow

1. **UI interaction:** TextInput in the picker calls updatePresetNameDraft on each edit.
2. **Local projections:** renameDrafts stores the visible string; updateModelPreset/updatePromptPreset also patches the shared preset row.
3. **Durable request:** queueSplitPresetPatch stages a per-owner outbox row and dispatches PATCH /api/v1/commands/model-presets/:id or /prompt-presets/:id after the debounce.
4. **Server mutation:** Fastify validates the preset ID/patch, updates the collection row, co-writes selected settings or prompt-template data when needed, and returns an event plus acknowledgement metadata.
5. **Client acknowledgement:** accepted local effects settle the split-preset attempt; terminal failures invoke rollbackSplitPresetPatchAttempt and restore matching resource fields.
6. **Displayed state:** the picker ignores the reconciled resource name because renameDrafts still wins in presetNameDraft. Other consumers render the resource row directly.

## Severity and likely user impact

**Medium.** The underlying rollback is safe, but the editor lies about what is saved and can disagree with every other preset surface. A user may leave the picker believing a rejected rename exists, then see it disappear later or issue more edits against an incorrect visible baseline.

## Recommended fix

Give each inline rename draft an explicit owner and settlement state. Prefer an updateModelPreset/updatePromptPreset API that returns the exact mutation's accepted | queued | failed outcome. Reconcile the map as follows:

- accepted: clear the draft after the resource/local effect contains the accepted or canonical name;
- queued: retain it and mark it pending while reapplying it over same-lineage reads;
- failed/discarded: clear it, expose the rolled-back resource name, and show an error;
- authoritative replacement while dirty: preserve/rebase the draft with an explicit conflict baseline rather than silently masking the resource forever.

Add a component test that rejects a rename while edit mode stays open and asserts the input, shared row, and another preset consumer all converge to the same restored name.
