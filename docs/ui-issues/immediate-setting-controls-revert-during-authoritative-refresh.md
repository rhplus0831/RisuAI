# Immediate setting controls revert during an authoritative refresh

## Summary

Schema-driven checks, selects, segmented controls, colors, and number inputs write their value optimistically and immediately dispatch a durable settings command. Unlike the continuous-input draft path, these controls do not retain a dirty value that can be rebased over an intervening authoritative settings read.

If a same-lineage replay gap or resource-recovery path performs a complete authoritative refresh before the local command is persisted, the read replaces the optimistic projection. The mounted wrapper copies that older value into the control and every other live consumer. Once the local command is accepted, a second reconciliation read restores the user's value. This produces a visible new-value -> old-value -> new-value sequence even though the durable command ultimately succeeds.

## Location

- `src/lib/Setting/Wrappers/SettingCheck.svelte:13-29`
- `src/lib/Setting/Wrappers/SettingSelect.svelte:15-46`
- `src/lib/Setting/Wrappers/SettingSegmented.svelte:14-29`
- `src/lib/Setting/Wrappers/SettingColor.svelte:13-29`
- `src/lib/Setting/Wrappers/SettingNumber.svelte:14-38`
- `src/ts/setting/utils.ts:158-181,280-474`
- `src/ts/server/resourceInvalidation.ts:168-238,253-325`
- `src/ts/server/resourceState.svelte.ts:684-765`
- `src/ts/bootstrap.ts:448-505,965-990`
- `src/ts/server/commands.ts:2043-2184,5231-5450`
- `server/fastify/src/routes/commands.ts:1844-1907`

One concrete live example is the `roundIcons` checkbox at `src/ts/setting/displaySettingsData.svelte.ts:331-336`; its value is also read by `src/lib/SideBars/Sidebar.svelte:250-254` and `src/lib/ChatScreens/Chat.svelte:2545-2550`.

## Trigger

Using **Round icons** as an example:

1. Start with `roundIcons = false` and keep Display Settings open.
2. Enable **Round icons**. The checkbox, sidebar icons, and chat sender icons immediately use `true` while the durable settings command is being staged or is in flight.
3. Before that command is persisted, let event replay become unavailable or let a revision gap trigger a complete same-lineage resource refresh. A queued command or delayed durable-outbox readiness can keep the setting request from reaching Fastify during this window.
4. Let the resulting full settings read return the still-authoritative `roundIcons = false` snapshot.
5. Allow the original local `roundIcons = true` command to finish.

A normal `settings.updated` echo from a duplicated tab carrying the same writer session is not sufficient by itself: an active local command batch defers own-session echoes. A client with a different writer session takes ownership, so the original command is rejected rather than completing this successful sequence.

The same ordering affects other immediate schema controls. It does not require two edits to the same input; an unrelated tab or command only has to trigger an authoritative read during the local persistence window.

## Expected behavior

An accepted local intent should remain displayed while it is pending. An authoritative projection that predates that intent should be merged with, or overlaid by, the pending field. If the command fails permanently, only then should the field-specific rollback restore the confirmed server value and tell the user that saving failed.

## Actual behavior

The authoritative read replaces `true` with `false` in the shared resource projection. The wrapper's database-to-local effect copies `false` into the checked state, and all other consumers of `roundIcons` render the same older value. The pending command is still valid and eventually persists `true`; because the refresh advanced the settings projection epoch, its optimistic acknowledgement cannot be applied directly and reconciliation reads the group again. The checkbox and dependent UI then return to `true`.

No failure is reported because persistence succeeded. During the interval, however, the UI says the user's edit was undone and different tabs may show different versions of the setting.

## Underlying cause

`setSettingValue` has field-aware rollback data, a durable outbox intent, and an intent-time settings-group projection epoch, but none of those is used to protect the displayed projection from reads:

- `writeLocalSettingValue` applies the new value to the resource facade and runs any runtime side effect.
- `queueDeferredSettingWrite` stages the durable absolute target. For immediate controls, `setSettingValue` calls `dispatchDeferredSettingWrite` at once, which removes the entry from `pendingDeferredSettingWrites` while retaining only a failure-attempt record.
- complete and targeted resource refreshes merge a few specialized pending projections (Agent Presets, plugin data, and split presets), but have no generic settings-intent merge hook;
- `applySettingsGroupResource` and `applySettingsResource` replace settings keys without consulting `pendingDeferredServerSettingAttempts` or the durable settings outbox.
- Each wrapper's first effect unconditionally assigns the resource value to `localValue`. There is no dirty/attempt identity to distinguish a stale read from a newer authoritative value.

The captured projection epoch correctly makes the later command acknowledgement fail closed after the refresh, but that only selects authoritative reconciliation. It does not keep the optimistic value visible while the command remains pending.

## Affected data flow

1. **UI interaction:** `SettingCheck.svelte` receives the checked `true` value for the `display.roundIcons` schema row.
2. **Client projection:** its write-back effect calls `setSettingValue`; `writeLocalSettingValue` writes `roundIcons = true` under `withTrustedResourceWrite`. The checkbox, sidebar, and chat all observe that projection.
3. **Durable request:** `queueDeferredSettingWrite` stages `/settings/display` in the pending-mutation outbox, and `dispatchDeferredSettingWrite` sends `PATCH /api/v1/commands/settings/display` with `{ patch: { roundIcons: true } }` plus the captured optimistic group epoch.
4. **Intervening synchronization:** event replay is unavailable or a revision gap is processed by the resource synchronization path. `forceServerResourceRefresh`/`refreshAllServerResources` fetches the complete same-lineage settings resource, and `applySettingsResource` writes the older `false` value while advancing every settings-group projection epoch.
5. **Displayed state:** the wrapper's database-to-local effect sets `localValue = false`; `Sidebar.svelte` and `Chat.svelte` also render `false` from the shared facade.
6. **Server persistence:** the Fastify route validates the group patch, applies it, writes the settings row with `writeSettingsOnly`, emits `settings.updated`, and acknowledges `roundIcons` at a new global revision.
7. **Response/reconciliation:** the client sees that the intent-time projection epoch changed, so the receipt cannot use its local effect. It follows the authoritative invalidation path, fetches the now-persisted `true` value, applies it, and the mounted UI changes back to `true`.

## Severity and user impact

**Medium.** The vulnerable wrappers back many boolean, enum, color, and numeric settings across display, accessibility, provider, generation, media, memory, sidebar, and advanced pages. The race requires an uncommon same-lineage full refresh during the persistence window, but it is user-visible in every mounted consumer and becomes more likely with slow storage, network latency, or a busy command queue. A user can interpret the reversion as a failed save and click again, accidentally submitting the opposite value while the first intent is still pending.

## Recommended fix

Keep immediate server-owned setting edits as owner-scoped pending projections until their mutation receipt is acknowledged or permanently fails. Same-lineage recovery reads should merge those pending absolute targets before applying them, just as specialized collection projections already do. Do not carry an overlay across a backup/import lineage change or another terminal ownership boundary.

A practical implementation is to expose a settings bridge hook that overlays every active `PendingDeferredServerSettingAttempt` and not-yet-dispatched deferred write onto full and group read payloads. Retain per-field attempt identity after dispatch instead of keeping only rollback baselines, and remove an overlay only when the matching mutation receipt is acknowledged. If the server canonicalizes a value, replace the overlay with the receipt's canonical field before clearing it.

The wrappers should also keep a dirty owner/attempt token so a resource effect cannot adopt an older projection merely because it arrived later in wall-clock time. On permanent failure, preserve the existing attempted-value guard, apply the confirmed rollback, replay any required runtime side effect, and surface `settingsSaveFailed`.

Add integration coverage for `false -> optimistic true -> authoritative false -> successful true receipt`. Assert throughout the race that the checkbox and a second live consumer remain `true`, then cover a permanent rejection and a server-canonicalized success.
