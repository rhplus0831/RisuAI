# Loadout favorite and delete failures have no UI outcome

## Summary

The loadout modal treats favorite and delete actions as synchronous even though their optimistic projections are persisted by asynchronous Fastify commands. It neither waits for nor exposes the command outcome. A favorite can visibly toggle and later revert, and a deleted row can disappear and later reappear after a terminal server rejection, with no pending, queued, or failure state explaining the change.

## Location

- `src/lib/Others/LoadoutModal.svelte:27-36,72-139,143-177,228-232`
- `src/ts/loadout.ts:504-589,1320-1429`
- `src/ts/server/commands.ts:3209-3250,5000-5043`
- `server/fastify/src/routes/commands.ts:4689-4763`
- `src/ts/loadout.test.ts:2231-2284,2610-2648`

## Trigger

1. Open the loadout modal.
2. Toggle a loadout's favorite star, or confirm deletion of a loadout.
3. Have Fastify reject the command terminally, for example because the row was concurrently removed, the request is invalid, or the writer/lineage is stale.
4. Wait for the asynchronous command and rollback to settle.

## Expected behavior

The affected row should remain visibly pending until the command is accepted or durably queued. A terminal rejection should restore the projection and show a clear failure message. A retained outbox operation should be labeled queued rather than presented as a completed mutation.

## Actual behavior

The star changes immediately with no busy marker. Delete removes the row immediately, and `deletingLoadoutId` is cleared as soon as the synchronous `deleteLoadout()` call returns, before any network result exists.

If the server terminally rejects the request, rollback later toggles the star back or reinserts the deleted row. `applyError` is never set for either action, so the modal offers no explanation. For a retryable failure, the optimistic state is retained by the durable outbox, also without a queued indicator. The controls can be used again while the first persistence attempt is still unsettled.

## Underlying cause

`toggleLoadoutFavorite()` and `deleteLoadout()` return only an immediate boolean indicating that a local row was found. They mutate the resource projection synchronously and call `dispatchFavoriteLoadout()` or `dispatchDeleteLoadout()`, both of which deliberately discard the durable command promise with `void`.

The command layer correctly distinguishes accepted, retained, and rollback outcomes and has field/keyed-list rollback logic. That settlement never reaches `LoadoutModal`. The component calls both functions without awaiting them; its `operationBusy` state does not include favorite persistence, and delete busy state covers only the confirmation plus synchronous dispatch. In contrast, loadout apply and save already await typed results and populate `applyError` or a queued notice.

## Affected data flow

1. **UI action:** The star handler calls `toggleLoadoutFavorite(loadout.id)` directly. The delete handler awaits confirmation, calls `deleteLoadout(loadout.id)`, then clears its local busy id (`LoadoutModal.svelte:115-139`).
2. **Optimistic projection:** The favorite field is changed in `getDatabase().loadouts`, or the row is spliced from that collection (`loadout.ts:1391-1429`). The modal's derived lists rerender immediately from the projection.
3. **Durable request:** The client stages an outbox intent and sends `POST /api/v1/commands/loadouts/:loadoutId/favorite` with `{ favorite }`, or `DELETE /api/v1/commands/loadouts/:loadoutId` (`loadout.ts:1320-1388`; `commands.ts:3209-3250`).
4. **Server persistence/response:** Fastify requires the row, updates or removes it, writes the loadout collection/settings transaction, and returns a new revision plus `loadout.favorited` or `loadout.deleted` event. Validation/not-found/writer errors return a failed command instead (`routes/commands.ts:4689-4763`).
5. **Client reconciliation:** Accepted responses reconcile the optimistic collection. Retryable failures retain and reapply the outbox projection. Terminal failures invoke `rollbackLoadoutFavorite()` or `rollbackDeletedLoadout()`, which carefully restore only the attempted field/row (`loadout.ts:504-589,1320-1388`).
6. **Display:** Because the component has no settlement subscription or returned promise, it simply rerenders the restored/retained resource state with no status or error. The existing `applyError` panel is never used for these paths.

## Severity and user impact

**Medium.** Delete is destructive and favorite state controls how loadouts are grouped. A silent disappearance/reappearance or delayed star reversion makes users repeat actions, distrust persistence, and potentially apply or recreate the wrong loadout. The behavior exactly resembles a successful update that later reverts without explanation.

## Recommended fix

- Make favorite and delete APIs return an awaited typed outcome such as `accepted`, `queued`, `superseded`, or `failed` instead of only an immediate boolean.
- Track pending mutation ids per loadout row and include them in `operationBusy`/disabled state until accepted or explicitly queued.
- On terminal failure, leave the rollback logic intact but set a localized modal error identifying the failed action and row.
- On retained durable work, show a queued state consistent with loadout apply.
- Serialize or coalesce repeated favorite operations for the same row while a prior attempt is unsettled.

## Test coverage gap

`src/ts/loadout.test.ts` proves that failed favorite/delete commands roll their projections back safely, while `LoadoutModal.svelte.test.ts` only verifies immediate dispatch and confirmation locking. Add mounted modal tests with deferred command outcomes that assert the row remains pending, an accepted result clears pending state, a retained result is labeled queued, and a terminal rollback displays an error.
