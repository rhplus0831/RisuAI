# Queued direct setting writes are reported as failures

## Summary

The direct settings bridge treats every non-ok command result as a terminal save failure even when the durable mutation layer deliberately retained the exact request for replay. The optimistic value and encrypted outbox row remain live, but the user receives “Settings could not be saved,” and promise-based callers receive false.

The UI therefore cannot distinguish “saved on this device and queued for durable recovery/replay” from “discarded and rolled back.”

## Location

- src/ts/server/settingsBridge.svelte.ts:108-114,600-645,922-963,1111-1160
- src/ts/server/durableMutationDispatch.ts:90-149,383-420
- src/ts/server/commands.ts:2149-2181
- src/lib/Setting/Pages/OtherBotSettings.svelte:137-159
- src/ts/server/settingsBridge.svelte.test.ts:740-775
- server/fastify/src/routes/commands.ts:2008-2074

## Trigger

1. Make a direct settings change while the browser has an active writer session, so the bridge successfully stages an encrypted outbox row.
2. Let PATCH /api/v1/commands/settings/:group fail with a retryable network error, 5xx response, or non-terminal conflict.
3. The durable layer classifies the settlement as retained and supplies failureRollbackDisposition returning retain.

A visible example is importing a Hypa V3 preset in OtherBotSettings. The same classification affects void direct controls such as Notification, hotkeys, colors, backgrounds, and chat-menu toggles.

## Expected behavior

A retained mutation should produce a queued outcome. The optimistic value should remain visibly pending, the UI should explain that it is queued for durable recovery/replay, and callers should not receive or display a terminal save-failed result. A failure message and rollback should be reserved for a mutation that was not staged or was finally discarded.

## Actual behavior

patchServerBackedSettings correctly skips rollback when failureRollbackDisposition says retain. However, dispatchTrackedServerBackedSettingsPatch calls reportFailure for every non-ok result at lines 952-960. persistServerBackedSettingsPatch repeats that classification at lines 638-643 and returns false.

For Hypa import, OtherBotSettings only shows success when that boolean is true, while the bridge has already displayed the generic failure alert. The retained preset remains in the local projection and outbox and may later appear on the server. The current test at src/ts/server/settingsBridge.svelte.test.ts:758-775 explicitly expects this contradictory combination: false, retained optimistic data, and one error alert.

For void controls, the user sees a failure alert while the toggled value can remain changed and later be replayed, making a retry or reversal operate on an intent the UI just described as failed.

## Underlying cause

The durable layer exposes the distinction through settlement and failureRollbackDisposition: settleDurableMutation returns retained while the outbox row remains current, and rollback is suppressed. The settings bridge reduces the command result back to status === 'ok' and invokes a terminal failure reporter without consulting that disposition.

The boolean return type of persistServerBackedSettingsPatch cannot represent accepted versus queued versus failed. The void immediate API exposes even less state. The bridge also clears its PendingSettingsAttempt when the first transport result settles, despite a retained intent still having a future final settlement.

## Affected data flow

1. **UI interaction:** a custom setting control calls applyServerBackedSetting(s), or Hypa import awaits persistServerBackedSettingsPatch.
2. **Client projection:** the bridge applies the new value optimistically and stages settings:bridge in the pending-mutation outbox.
3. **Request:** the durable dispatcher sends PATCH /api/v1/commands/settings/:group through patchServerBackedSettings.
4. **Server/persistence uncertainty:** Fastify either rejects/does not receive the patch, or may have accepted it while the response was lost. Persistence and receipt status remain unconfirmed until durable recovery/replay settles; mutation-receipt deduplication prevents an accepted request from being applied twice.
5. **Durable acknowledgement:** settleDurableMutation keeps the exact encrypted row and makes failureRollbackDisposition return retain.
6. **Client outcome:** patchServerBackedSettings skips rollback, but settingsBridge reports settingsSaveFailed and persistServerBackedSettingsPatch returns false.
7. **Displayed state:** the optimistic value may remain visible while the user is told it failed. A later replay can persist it and emit the normal settings.updated synchronization event.

## Severity and likely user impact

**Medium to high.** This affects a broad set of settings during exactly the unreliable-network conditions the durable outbox is designed to handle. False failure feedback encourages duplicate edits and makes eventual replay surprising. For imports and compound settings, users may retry and create successor operations while an invisible predecessor is still live.

## Recommended fix

Replace the boolean/void settlement with a typed accepted | queued | failed outcome. Consult the durable settlement (or whether the exact outbox handle is still current) before reporting failure:

- accepted: reconcile canonical values and report success where appropriate;
- queued: keep the pending projection, register for final settlement, and show a localized queued message;
- failed/discarded: roll back and show settingsSaveFailed exactly once.

Keep the attempt registered through retained replay and remove it only on accepted/discarded final settlement. Update the retained-Hypa test to expect queued and no failure alert, and add equivalent coverage for an immediate direct control.
