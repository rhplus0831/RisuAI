# Retained setting mutation loses its visible projection

## Summary

Immediate schema-driven setting controls keep an optimistic value visible while their durable command is in flight, but they stop protecting that value as soon as a retryable request settles. The encrypted mutation remains in the outbox for replay, while the in-memory attempt used to overlay authoritative settings reads is removed unconditionally.

Any later same-lineage settings refresh can therefore replace the pending value with the older server value. The setting may change back again only after a successor drains the retained mutation or the app restarts and bootstrap replays it. This creates a visible new-value -> old-value -> new-value sequence even though the original user intent was deliberately retained.

## Location

- `src/lib/Setting/Wrappers/SettingCheck.svelte:15-29`
- `src/lib/Setting/Wrappers/SettingSelect.svelte:17-45`
- `src/lib/Setting/Wrappers/SettingSegmented.svelte:14-29`
- `src/lib/Setting/Wrappers/SettingColor.svelte:13-29`
- `src/lib/Setting/Wrappers/SettingNumber.svelte:14-38`
- `src/ts/setting/utils.ts:120-142,181-212,341-450,468-573`
- `src/ts/server/durableMutationDispatch.ts:28-55,90-149,297-325,328-369,389-420`
- `src/ts/server/resourceState.svelte.ts:685-755`
- `src/ts/server/commands.ts:2080-2098,2149-2220,5391-5469`
- `src/ts/server/resourceInvalidation.ts:997-1029`
- `server/fastify/src/routes/commands.ts:2008-2075,8803-8823`

One concrete affected control is **Round icons**, declared at `src/ts/setting/displaySettingsData.svelte.ts:328-334`. The same projected value is consumed outside the settings page by `src/lib/SideBars/Sidebar.svelte:249-253` and `src/lib/ChatScreens/Chat.svelte:2587-2592`.

## Trigger

Using **Round icons** as an example:

1. Start with the server-persisted value `roundIcons = false`.
2. Enable **Round icons**. The setting wrapper calls `setSettingValue`, which writes `true` to the shared client projection, stages a durable `/settings/display` intent, and sends it immediately.
3. Let the request fail in a retryable way, such as a network/5xx failure or an ordinary revision conflict. The durable outbox row remains queued for replay, so rollback is intentionally suppressed and the UI initially remains `true`.
4. Before another mutation drains that retained row, trigger a same-lineage settings read. This can happen during command-event gap recovery, unavailable event replay, or another full resource-recovery path.
5. The read returns the still-persisted `roundIcons = false` value and applies it to the client projection.

The same sequence applies to other immediate `SettingRenderer` checks, selects, segmented controls, colors, and number inputs backed by a server settings group. Continuous text/slider drafts have an additional component-local dirty guard while mounted, but they can still lose the retained value after that owner is unmounted and later reconstructed from the shared projection.

## Expected behavior

A retryable durable failure should keep both halves of the pending operation aligned: the encrypted intent must remain queued, and the attempted value must remain projected over older authoritative reads. The overlay should be removed only when replay is accepted, when the exact intent is terminally discarded and rolled back, or when a destructive ownership/lineage transition makes the projection invalid.

## Actual behavior

The first failed request correctly leaves the optimistic `true` value in place and retains the outbox row. However, its promise continuation immediately removes the only generic settings overlay for that attempt. A later authoritative settings read installs `false`, and immediate setting wrappers copy it into their local control state. Other consumers such as the sidebar and chat also display `false`.

The client does not report a save failure because the durable transport classified the mutation as retained rather than rejected. The queued intent may later persist `true`, at which point reconciliation changes the UI back again; until that happens, the UI hides an operation that still exists and may still execute.

## Underlying cause

`dispatchDurableMutation` deliberately distinguishes retryable retention from terminal rollback. Once its outbox row is persisted, an ordinary conflict, transient server error, or network failure produces settlement `retained`, and the transport's `failureRollbackDisposition` returns `retain`.

`dispatchDeferredSettingWrite` does not preserve that settlement distinction in its projection lifecycle:

- it registers a `PendingDeferredServerSettingAttempt`, which `registerPendingSettingsProjectionOverlay` reapplies over full and group settings reads;
- it sends the durable mutation through `patchServerBackedSettings`;
- when the command promise resolves, lines 520-529 call `clearDeferredServerSettingAttempt(attempt)` before checking whether the failure disposition is `retain`;
- the retained branch correctly avoids rollback and avoids the failure alert, but it has already deleted the overlay;
- the rejection continuation at lines 530-533 also clears the overlay without checking whether the durable row survived.

The durable layer already exposes `registerDurableMutationSettlementListener` for exactly this lifetime mismatch. Replay and predecessor draining publish the final `accepted` or `discarded` settlement, and other projection owners use that notification to keep retained state latched. The generic setting-renderer path neither registers such a listener nor associates its overlay with the outbox mutation id.

`applySettingsResource` and `applySettingsGroupResource` do call `applyPendingSettingsProjectionOverlays`, so the read-side merge is present. It becomes ineffective only because the write-side code removes the retained attempt too early.

## Affected data flow

1. **UI interaction:** `SettingCheck.svelte` receives the checked value for the `display.roundIcons` row. Its write-back effect calls `setSettingValue(item, true, ctx)`.
2. **Client projection:** `writeLocalSettingValue` updates the resource-backed database facade. The settings control, sidebar icons, and chat sender icons all render `true`.
3. **Durable intent and request:** `queueDeferredSettingWrite` stages an encrypted `PATCH /settings/display` intent in the browser outbox. `dispatchDeferredSettingWrite` registers the projection attempt, and `patchServerBackedSettings` sends `PATCH /api/v1/commands/settings/display` with `{ patch: { roundIcons: true }, baseRevision }` plus mutation receipt headers.
4. **Server mutation:** the Fastify route validates the group and value, applies the patch, writes settings through `writeSettingsOnly`, emits `settings.updated`, and returns the accepted keys and revision on success. In the failing sequence, the request never reaches that commit or loses the revision race, so the server remains at `false`.
5. **Retryable acknowledgement:** `requestCommandJson` returns an error/conflict result. `settleDurableMutation` keeps the persisted outbox row and makes the command transport choose `retain`, so the ordinary rollback is correctly skipped.
6. **Premature projection settlement:** the `result.then` callback removes the `PendingDeferredServerSettingAttempt` regardless of that retained disposition.
7. **Later synchronization:** a full or display-group resource read returns authoritative `false`. `applySettingsResource` or `applySettingsGroupResource` invokes the pending-overlay registry, but there is no longer an attempt to merge, so it writes `false` into the shared facade.
8. **Displayed state:** each immediate wrapper's database-to-local effect adopts `false`; other live consumers also rerender from the same stale-with-respect-to-intent projection.
9. **Eventual replay:** bootstrap replay or a same-key successor can resend the durable intent. If it is accepted, Fastify persists `true` and reconciliation eventually makes the UI show `true` again.

## Severity and likely user impact

**High.** The defect is cross-cutting across many display, accessibility, provider, generation, media, memory, sidebar, and advanced settings. It requires a retryable failure followed by a resource read, so it is most visible on unreliable networks, under server load, or when revision conflicts and event recovery are more frequent.

The misleading state is especially risky because the hidden mutation remains live. A user who sees the old value can reasonably repeat or reverse the edit, creating a successor whose result depends on an invisible retained predecessor. Different mounted components can also disagree temporarily when a continuous input preserves its component-local draft but immediate/shared consumers render the replaced resource value.

## Recommended fix

Tie `PendingDeferredServerSettingAttempt` to its outbox mutation id and keep the attempt registered when `failureRollbackDisposition` is `retain`. Register a `registerDurableMutationSettlementListener` before dispatch:

- on direct or replay acceptance, remove the overlay only after the response/local-effect reconciliation has fenced or projected the accepted value;
- on final discard, remove it, run the attempted-value-guarded rollback and runtime side effect, and surface `settingsSaveFailed`;
- on a retained transport result, leave it queued and visibly marked pending;
- on supersession, rebase or transfer the overlay to the exact successor rather than dropping it;
- clear all such overlays at destructive writer-session or database-lineage boundaries.

The normal promise continuation should clean up only terminal settlements, not transport completion itself. If an accepted replay notification can arrive before its authoritative resource read, retain an `accepted-replay` phase until the matching value/revision is observed, as the model-profile mutation owner already does.

Add focused coverage for:

1. optimistic `false -> true`;
2. a retryable 500/network/conflict result with the outbox row retained;
3. a subsequent full and grouped resource read returning `false`, which must still leave every shared consumer at `true`;
4. later replay acceptance, after which the overlay can settle cleanly; and
5. terminal replay rejection, which must remove the overlay, restore `false`, and report failure exactly once.
