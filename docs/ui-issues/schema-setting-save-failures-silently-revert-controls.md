# Schema setting save failures silently revert controls

## Summary

The shared persistence path used by schema-rendered settings has no user-facing failure reporting. It optimistically updates the resource projection, stages a durable request, and correctly rolls an attempted field back after a terminal Fastify rejection. The returned error result is then ignored.

As a result, checks, selects, segmented controls, colors, numbers, sliders, text fields, and textareas can change successfully in the UI and later revert with no explanation. Hand-written settings drafts use a `settingsSaveFailed` reporter for the same server route, so two controls on the same settings page expose different failure semantics.

## Location

- `src/lib/Setting/SettingRenderer.svelte:20-40`
- `src/ts/setting/settingRegistry.ts:1-25`
- `src/lib/Setting/Wrappers/SettingCheck.svelte:13-29`
- `src/lib/Setting/Wrappers/SettingSelect.svelte:15-46`
- `src/lib/Setting/Wrappers/SettingSegmented.svelte:14-29`
- `src/lib/Setting/Wrappers/SettingColor.svelte:13-29`
- `src/lib/Setting/Wrappers/SettingNumber.svelte:14-38`
- `src/ts/setting/inputDraft.svelte.ts:30-138`
- `src/ts/setting/utils.ts:158-225,280-522`
- `src/ts/server/commands.ts:2043-2184,5231-5418`
- `src/ts/server/durableMutationDispatch.ts:91-153`
- `src/ts/server/settingsBridge.svelte.ts:522-612`
- `server/fastify/src/routes/commands.ts:1844-1907`

## Trigger

1. Open any schema-rendered settings page and edit a server-owned field. For example, toggle **Round icons**, choose a display enum, or change a text/slider value.
2. Have `PATCH /api/v1/commands/settings/:group` fail terminally. Reproducible cases include a Fastify validation rejection, a non-retryable HTTP error, an invalid command response, or inability to obtain a command base revision.
3. Observe the control and any dependent live UI after rollback.

Continuous inputs add a 250 ms debounce, but the result is the same once their command is dispatched. Retryable failures whose durable intent is retained are a related ambiguity: the optimistic value remains visible without any pending/queued indication even though it has not yet reached SQLite.

## Expected behavior

The optimistic value may remain visible while persistence is pending, but a terminal failure must restore only the attempted fields and display a clear save error. A retained durable mutation should remain visually distinguishable as queued until replay is acknowledged. All settings controls should follow the same pending/success/failure contract.

## Actual behavior

Terminal failures invoke the field-aware rollback and the control eventually displays its previous value. Nothing tells the user why it changed back or even that the server rejected the edit. There is no per-control pending/error state, and `setSettingValue`/`setDeferredSettingValue` return only synchronous queue metadata rather than a settlement the wrapper can observe.

The behavior differs from hand-written settings drafts. `dispatchTrackedServerBackedSettingsPatch` observes the same `ServerCommandResult` and calls `alertError(language.errors.settingsSaveFailed)` once on non-OK settlement or rejection; `dispatchDeferredSettingWrite` only clears its rollback bookkeeping.

## Underlying cause

The schema persistence stack separates rollback from reporting but implements only the former:

- A wrapper calls `setSettingValue` or a continuous-input draft calls `setDeferredSettingValue`.
- `writeLocalSettingValue` immediately changes the resource facade, so the initiating control and all other readers show the attempted value.
- `queueDeferredSettingWrite` stages an encrypted absolute-target intent. `dispatchDeferredSettingWrite` calls `patchServerBackedSettings` with a rollback callback.
- `executeServerCommand` invokes that rollback for every non-OK result. `rollbackDeferredServerSetting` is appropriately field-aware and replays an `onChange` runtime effect when necessary.
- The only result handlers in `dispatchDeferredSettingWrite` call `clearDeferredServerSettingAttempt` for both fulfillment and rejection. They never inspect `result.status`, surface `result.error`, set UI state, or call the existing localized `settingsSaveFailed` alert.

`dispatchDurableMutation` owns retention and receipt settlement; it does not report application-specific UI errors. The calling path therefore cannot rely on it to fill this gap.

## Affected data flow

1. **UI interaction:** a `SettingRenderer` wrapper receives a user value. Immediate wrappers use `setSettingValue`; text, textarea, input, and slider drafts use `setDeferredSettingValue` through `createSettingInputDraft`.
2. **Client projection:** `writeLocalSettingValue` writes the attempted value under `withTrustedResourceWrite` and invokes `item.onChange`, if present. The mounted control and runtime consumers immediately render it.
3. **Durable request:** the utility stages a `/settings/:group` outbox intent and sends `PATCH /api/v1/commands/settings/:group` with the absolute root value and intent-time projection epoch.
4. **Server persistence:** Fastify validates the group's allowlist, asset references, and value shapes before applying the patch and calling `writeSettingsOnly`. In the failure case, it returns an error without committing or emitting a successful `settings.updated` event.
5. **Response/rollback:** `requestCommandJson` converts the response into a non-OK `ServerCommandResult`; `executeServerCommand` runs `rollbackDeferredServerSetting`, which restores attempted-matching paths in the resource facade.
6. **Displayed state:** the wrapper's resource-to-local synchronization copies the restored value into the control, and dependent components also revert.
7. **Missing acknowledgement UI:** the promise handler discards the non-OK status after clearing its attempt record. No alert or persistent error state is produced.

## Severity and user impact

**High.** This is the default persistence layer for schema-driven settings across the application. A silent reversion makes a valid rollback look like random data loss and gives no actionable distinction between validation, authorization, conflict, storage, and network failures. Users may repeatedly submit the same invalid value, assume another component overwrote it, or leave the page believing a retained-but-not-yet-persisted value is durable.

## Recommended fix

Give the schema settings dispatcher the same settlement reporting contract as `settingsBridge`:

- Add a once-per-attempt failure reporter to `dispatchDeferredSettingWrite` and invoke it when the fulfilled result is non-OK or the promise rejects.
- Distinguish `retained` from terminal failure. Keep the optimistic projection for a retained durable intent, expose a queued state, and clear it only through the mutation settlement listener or replay receipt.
- Return an observable attempt handle from `setSettingValue`/`setDeferredSettingValue`, or maintain owner-keyed pending/error state that wrappers can render accessibly. Avoid a separate alert for every field when one batched root fails.
- Preserve the existing attempted-path rollback guard and runtime-effect replay so a failed older write cannot replace a newer edit.

Add mounted tests for an immediate check and a debounced text input. For each, cover HTTP 400, network/retained, and accepted responses; assert the optimistic display, field-specific rollback, exactly one localized failure indication for terminal errors, a queued indication for retained work, and no rollback of a newer same-field edit.
