# Queued global lorebook delete reappears without status

## Summary

When a global lorebook delete fails retryably, the client intentionally restores the lorebook row even though the exact DELETE remains in the durable outbox. If replay is later accepted, a settlement listener removes that restored row again.

The global lorebook modal exposes none of this state. A user sees the lorebook disappear, reappear as an ordinary editable row, and later disappear again. The row's reappearance looks like a failed delete even though the delete is still live.

## Location

- src/lib/Setting/lorepreset.svelte:72-125
- src/ts/server/lorebookBridge.svelte.ts:976-1004,1094-1235
- src/ts/server/durableMutationDispatch.ts:32-55,297-325,383-420
- src/ts/server/commands.ts:3820-3840
- server/fastify/src/routes/commands.ts:6768-6812
- Replay/rollback coverage: src/ts/server/lorebookBridge.test.ts:769-930,1109-1155

## Trigger

1. Open the global lorebook picker with at least two lorebooks.
2. Confirm deletion of one lorebook.
3. Let DELETE /api/v1/commands/lorebooks/:id return a retryable 5xx/network failure while its outbox row was persisted.
4. Start a later durable mutation that drains this retained predecessor, or restart and allow bootstrap replay.

## Expected behavior

Because the delete remains executable, the UI should represent one coherent pending state. If the row is restored so its content is not stranded while the server still owns it, it must be visibly marked “deletion queued,” protected from misleading conflicting actions, and accompanied by cancel/retry semantics if supported. Terminal discard and final acceptance should have explicit outcomes.

## Actual behavior

deleteGlobalLorebook removes the row and resets loreBookPage immediately. dispatchStagedGlobalLorebookDelete deliberately overrides the durable transport's retain disposition with failureRollbackDisposition returning rollback, so the first retryable failure reinserts the latest row and restores selection.

The exact DELETE outbox row remains current. A durable settlement listener stays attached; when replay is accepted, applyAcceptedGlobalLorebookDeleteProjection removes the restored row again. lorepreset.svelte ignores even the helper's synchronous boolean and has no pending-delete map, status text, error, or disabled state, so the restored row looks fully normal and can be renamed or selected while an ordered delete predecessor is still live.

The test at src/ts/server/lorebookBridge.test.ts:769-865 proves the key contradiction: after a 500, the row and page are restored while the pending mutation list still contains DELETE. Reload/replay coverage confirms the request later runs.

## Underlying cause

The bridge makes a defensible data-availability tradeoff: retaining the optimistic removal would hide the entire lorebook while Fastify still contains it. It therefore decouples durable intent from visible projection and uses a final-settlement listener to reapply deletion later.

That special lifecycle is not surfaced through the UI API. dispatchStagedGlobalLorebookDelete returns void, deleteGlobalLorebook returns only whether the initial local splice happened, and lorepreset has no representation of PendingGlobalLorebookDeleteProjection. The restored resource row is indistinguishable from a normal authoritative row.

## Affected data flow

1. **UI interaction:** lorepreset confirms deletion and calls deleteGlobalLorebookById.
2. **Client projection:** deleteGlobalLorebook stages the durable intent first, then splices loreBook and resets loreBookPage.
3. **Request:** dispatchStagedGlobalLorebookDelete sends DELETE /lorebooks/:id with the base revision and mutation receipt identifiers.
4. **Server mutation:** on success, Fastify removes the lorebook, resets the selected page, writes the lorebook/settings tables, and returns lorebook.deleted. In the trigger sequence it does not commit and returns/causes a retryable failure.
5. **Initial client settlement:** the durable layer retains the outbox row, but the bridge forces its rollback callback, which reinserts the latest attempted-matching row and restores selection.
6. **Displayed state:** the modal renders the restored row with normal select/rename/delete controls and no queued-deletion indicator.
7. **Final replay:** bootstrap recovery, or a later durable successor draining retained predecessors, eventually receives acceptance. registerDurableMutationSettlementListener calls applyAcceptedGlobalLorebookDeleteProjection, and the row disappears again.

## Severity and likely user impact

**High.** This is an intentionally live future deletion presented as an ordinary record. Users can reasonably continue editing or relying on a lorebook that will later vanish, or retry deletion and create confusing successor operations. The behavior directly matches delayed reversion/synchronization symptoms and is most likely during unreliable connectivity.

## Recommended fix

Expose pending global-lorebook delete state from the bridge, keyed by durable lorebook ID and mutation ID, plus a typed accepted | queued | failed result. In lorepreset:

- keep a restored row visibly marked as deletion queued;
- disable or explicitly order rename/select/delete actions against that pending predecessor;
- show a queued acknowledgement after the retryable failure;
- clear the marker on accepted replay and remove the row once;
- on final discard, clear the marker, keep the restored row, and show a failure.

If product behavior instead chooses to keep the row removed while queued, provide a recoverable pending-deletions surface so its content is not stranded. Add a component test for remove -> retained restore with marker -> replay removal, plus terminal discard.
