# Translator preset structural actions drop persistence outcomes

## Summary

TranslatorPresetSettings implements accepted, queued, and failed handling internally for optimistic preset creation, but the normal Add control discards that typed result. Selection and deletion have equivalent internal settlement logic yet expose only fire-and-forget functions.

As a result, a terminally rejected add can disappear, a deleted preset can reappear, or the selected preset can switch back with no error. A retained mutation looks fully accepted even though it remains queued. The import path in the same component correctly reports queued and failed outcomes, demonstrating the missing connection in the ordinary controls.

## Location

- src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:772-843,845-955,957-1169,1454-1579,1607-1641
- src/ts/server/commands.ts:3142-3207
- server/fastify/src/routes/commands.ts:4543-4584,4658-4726,4729-4764
- src/lang/en.ts:1543-1545

## Trigger

Use any of these controls while Fastify returns a terminal error or a retryable failure:

- click Add to create and select a new translator preset;
- choose another preset in the select element;
- confirm deletion of the selected preset.

The Add case is especially direct: createTranslatorPresetOptimistically returns TranslatorPresetCreateStatus, but line 1498 calls it with void.

## Expected behavior

The component should display the same accepted/queued/failed outcome for normal structural actions that it already displays for imported presets. Terminal rejection should be accompanied by the guarded rollback and an error. Retention should leave the projection pending and tell the user it will retry.

## Actual behavior

Add applies the new row and selection, starts persistence, and ignores the returned status. A terminal failure rolls the row/selection back inside createTranslatorPresetOptimistically, with no message. A retained result reasserts the pending structural projection, but the user sees no queued state.

dispatchOptimisticTranslatorPresetSelection and deleteTranslatorPresetOptimistically are void wrappers. Their promise continuations correctly distinguish retained from terminal settlement and repair the resource projection, then return without updating any UI outcome. Consequently, the visible select can revert or a removed row can reappear without explanation.

By contrast, the Import button awaits createTranslatorPresetOptimistically at lines 1629-1637 and shows language.translatorPresetImportQueued or translatorPresetImportFailed. The underlying status is available; the normal controls simply drop it.

## Underlying cause

The Fastify migration added durable structural mutation owners and rollback/reassertion logic inside this component but did not centralize their status contract. Creation returns TranslatorPresetCreateStatus; selection and deletion translate settlement only into projection operations. The event handlers neither await nor store per-operation state.

The UI therefore conflates an optimistic local transition with server acceptance even though the data layer explicitly knows otherwise.

## Affected data flow

1. **UI interaction:** Add, preset select, or Delete starts a structural action.
2. **Client projection:** applyOptimisticTranslatorPresetCreate/Selection/Delete changes translatorPresets, translatorPresetId, and the selected preset's legacy translatorPrompt/translatorMaxResponse fields.
3. **Durable request:** the component stages an owner/selection outbox mutation and sends POST /translator-presets, POST /translator-presets/select, or DELETE /translator-presets/:id.
4. **Server mutation:** Fastify validates durable IDs, writes the translator preset collection and selected legacy fields, emits the corresponding event, and returns the new revision/IDs.
5. **Client acknowledgement:** accepted settlement confirms the structure; retryable settlement keeps and reasserts the pending operation; terminal failure invokes the operation-specific rollback.
6. **Displayed state:** all controls render getDatabase(), but no ordinary-action status is displayed. Only import consumes the typed result.

## Severity and likely user impact

**Medium to high.** The actions change both the selected translator configuration and the legacy fields used by translation. Silent reversion can make subsequent translations use a different prompt/response size than the user selected, while silent retention makes later replay surprising.

## Recommended fix

Use one TranslatorPresetPersistenceStatus contract for create, select, and delete. Return a promise from the selection/delete wrappers and have all three handlers await it. Add per-operation busy/error/queued state and reuse localized queued/failed messages (generalize the import-only strings where needed).

For accepted, settle and clear pending state. For queued, keep the structural projection/replay listener and show an explicit queued acknowledgement. For failed, show an error after rollback. Add component tests proving each normal control handles all three outcomes; keep import as the reference behavior.
