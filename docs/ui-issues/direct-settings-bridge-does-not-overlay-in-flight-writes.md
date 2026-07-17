# Direct settings writes are overwritten by authoritative refreshes

## Summary

Hand-written controls that call applyServerBackedSetting or applyServerBackedSettingsPatch optimistically update the shared settings projection, but the settings bridge does not reapply those pending values when a full or grouped settings resource is installed. An authoritative read that began before the edit can therefore replace a still-pending value with the older server value.

This is separate from the schema-driven SettingRenderer path: src/ts/setting/utils.ts registers its deferred attempts with the shared pending-settings overlay registry. The direct settings bridge keeps PendingSettingsAttempt records only for rollback ordering and never registers them as a read-side overlay.

## Location

- src/ts/server/settingsBridge.svelte.ts:65-104,133-135,554-594,887-1018,1090-1160
- src/ts/server/settingsPendingProjection.ts:1-18
- src/ts/setting/utils.ts:120-142
- src/ts/server/resourceState.svelte.ts:685-755,774-829
- src/ts/bootstrap.ts:965-990
- src/ts/server/commands.ts:2149-2220,5735-5783
- server/fastify/src/routes/commands.ts:2008-2074
- Representative controls: src/lib/Setting/Pages/Display/NotificationToggle.svelte:22-36, src/lib/Setting/Pages/HotkeySettings.svelte:1-17, and src/lib/ChatScreens/DefaultChatScreen.svelte:1974-1987,2013-2025

## Trigger

One concrete sequence is:

1. The persisted display.notification value is false.
2. The user enables NotificationToggle. The component calls applyServerBackedSetting('notification', true), which immediately projects true and queues the display-group command.
3. Before the command response is reconciled, an already-running full or display-group resource read returns the still-persisted false value.
4. applySettingsResource or applySettingsGroupResource installs that response.

The same race affects direct hotkey edits, custom background/color/theme controls, chat-menu auto-translate and auto-suggestion toggles, onboarding fields, and other callers listed by applyServerBackedSetting usage.

A retryable failure makes the lifetime mismatch longer: the durable outbox retains the request for recovery/replay, but dispatchTrackedServerBackedSettingsPatch still clears PendingSettingsAttempt. A later resource read can then display the old persisted value while the newer intent is still live. The specialized sparse-object queues for NAIImgConfig, wavespeedImage, and seperateParameters retain their queue state at lines 1151-1160, but they also register no pending-settings overlay, so a later resource apply can replace their claimed visible projection.

## Expected behavior

The user's in-flight attempted value should remain projected over an older authoritative read until the exact command is accepted, terminally rejected and rolled back, or superseded by a newer local edit. A successful command acknowledgement should then fence or canonicalize that projection without a visible regression.

## Actual behavior

The resource apply replaces true with false because the only registered overlay comes from the schema-driven setting utility. The direct bridge's pendingSettingsPatch, pendingSettingsAttempts, and sparseObjectSettingQueues are not consulted.

The accepted command cannot necessarily repair the value from its local effect: the intervening resource apply advances the settings-group projection epoch, and src/ts/bootstrap.ts:975-982 rejects an acknowledgement carrying the older epoch. The event-driven authoritative reload may eventually fetch the persisted true value, producing a true -> false -> true sequence; if that reload is unavailable, the shared UI can remain false even though Fastify persisted true.

The existing test at src/ts/server/settingsBridge.svelte.test.ts:1054-1085 confirms that the original intent is still sent after an authoritative apply, but it never asserts that the displayed projection remains at the attempted value.

## Underlying cause

dispatchTrackedServerBackedSettingsPatch registers a PendingSettingsAttempt, but that record is used only by rollbackSettingsAttempt and rebaseLaterSettingsAttempts. settingsBridge.svelte.ts has no call to registerPendingSettingsProjectionOverlay.

By contrast, resourceState deliberately invokes applyPendingSettingsProjectionOverlays after replacing settings, and setting/utils.ts registers both queued and dispatched schema-setting writes. The direct bridge bypasses that ownership contract. It also clears PendingSettingsAttempt on every command completion at lines 952-960, including a retryable result whose outbox row remains retained, rather than tying its lifetime to final durable settlement. Sparse-object queues keep desired/baseline data on retention but likewise have no read-side overlay registration.

## Affected data flow

1. **UI interaction:** NotificationToggle, HotkeySettings, a custom theme/background control, or a chat-menu toggle calls applyServerBackedSetting(s).
2. **Client projection:** prepareServerBackedSettingsPatch snapshots previous/attempted values and applyOptimisticServerBackedSettingsPatch writes the attempted value to the resource database facade.
3. **Durable request:** queueSettingsPatch stages a settings:bridge outbox intent. dispatchPendingSettingsPatch sends PATCH /api/v1/commands/settings/:group with the patch, base revision, writer lineage, and mutation receipt identifiers.
4. **Server mutation:** the Fastify settings route validates the group, applies the patch, calls writeSettingsOnly (and the Hypa collection co-write when applicable), emits settings.updated, and returns revision, acknowledgedKeys, and canonical overrides.
5. **Competing read:** a full or grouped settings request that still contains the pre-edit value is installed by resourceState. The pending-overlay registry has no direct-bridge or sparse-queue attempt to reapply.
6. **Response acknowledgement:** readSettingsPatchLocalEffect constructs a local effect, but bootstrap rejects it after the competing read changed the group epoch. Reconciliation must fall back to another resource read.
7. **Displayed state:** all direct consumers read the replaced resource projection and show the older value until a later successful synchronization.

## Severity and likely user impact

**High.** The defect is cross-cutting across settings and chat controls and directly matches the reported delayed-reversion pattern. It can make a successful setting look rejected, leave the UI stale relative to SQLite, and cause multiple controls or runtime effects to change twice during ordinary event-gap or recovery reads.

## Recommended fix

Register a direct-bridge projection overlay that reapplies pendingSettingsPatch.attempted values, every unsettled PendingSettingsAttempt, and the desired values of active sparseObjectSettingQueues, filtered by allowed group keys. Associate dispatched attempts with their outbox mutation IDs and keep them until final accepted/discarded settlement rather than transport-promise completion.

On acceptance, remove the overlay only after the canonical value/revision has been applied or an authoritative read at that revision has landed. On terminal discard, run the attempted-value-guarded rollback and remove it. On retention, keep it projected. Clear ownership only at explicit writer-session, database-lineage, or destructive-refresh boundaries.

Add a test that asserts the database facade and a representative control remain true after the authoritative false apply, then verifies accepted and terminal-rejection settlement separately.
