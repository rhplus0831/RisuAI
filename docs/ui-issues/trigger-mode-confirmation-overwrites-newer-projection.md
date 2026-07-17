# Trigger mode confirmation overwrites a newer trigger projection

## Summary

The V1, V2, and Lua mode buttons in the trigger editor await a destructive confirmation and then replace the component's *current* bound trigger array. They do not verify that the owner or trigger collection is still the one for which the confirmation was opened. If an authoritative refresh replaces the triggers while the dialog is pending, confirming erases that newer projection and persists the old mode-change intent over it. A programmatic owner change has the same failure mode.

## Location

- `src/lib/SideBars/Scripts/TriggerList.svelte:11-24,27-106`
- `src/lib/SideBars/CharConfig.svelte:262-353,1664-1668`
- `src/lib/Setting/Pages/Module/ModuleMenu.svelte:758-761`
- `src/ts/server/scriptDefinitionBridge.svelte.ts:201-263,397-426,1427-1467`
- `src/ts/server/resourceInvalidation.ts:450-475`
- `src/ts/server/commands.ts:4399-4422,4499-4525`
- `server/fastify/src/routes/commands.ts:7971-8005,8045-8086`

## Trigger

1. In client A, open a character whose trigger collection is nonempty.
2. Click a different trigger format, such as **V2**, so the destructive-change confirmation opens.
3. While that dialog remains pending, edit and save the same character's triggers in client B. Let client A receive the event and replace its editor draft with the newer authoritative collection.
4. In client A, confirm the original format change.

The same race exists for switching to V1 or Lua. It can also occur if a route/store-driven selection change retargets the still-mounted editor while the confirmation is pending.

## Expected behavior

The confirmation should be scoped to the owner and trigger snapshot that produced it. If either changed before the user responds, the operation should be cancelled and the newer authoritative triggers should remain untouched.

## Actual behavior

After the await, the handler assigns a V1, V2, or Lua replacement to the live `value` binding. Because that binding now contains client B's newer authoritative projection, the assignment destroys the newer collection. The parent treats the replacement as a fresh local edit and sends it to Fastify, overwriting the change that client A had already synchronized.

## Underlying cause

`TriggerList` accepts `ownerKey`, but the three mode-switch handlers never capture or compare it. They also do not capture a snapshot or revision of `value`. They read only the pre-dialog trigger type and then use the reactive `value` variable after `await alertConfirm(...)` (`TriggerList.svelte:33-42,49-77,83-105`). Svelte updates that variable when the parent binding changes during the await.

The nested V2 editor receives `ownerKey`, and neighboring async list operations use owner/snapshot guards, but the destructive top-level mode switch does not. `CharConfig` explicitly replaces `characterTriggersDraft` when a server resource projection changes and can also change `scriptDraftCharacterId` on selection (`CharConfig.svelte:262-333`), so the child binding can change without the pending continuation being invalidated.

## Affected data flow

1. **UI/client A:** A V1/V2/Lua button opens `alertConfirm` for the currently displayed trigger collection (`TriggerList.svelte:27-106`).
2. **Client B request and persistence:** Client B saves a newer trigger collection through the character trigger-definition command. Fastify replaces `character.triggerscript`, writes the character row, acknowledges the revision, and emits its resource event (`server/fastify/src/routes/commands.ts:7971-8005`).
3. **Client A authoritative refresh:** Resource invalidation receives the event, reads and applies the updated character row, and advances the resource-apply epoch (`resourceInvalidation.ts:450-475`). The bridge watcher observes that applied projection, and `CharConfig` reseeds `characterTriggersDraft` while the confirmation promise is still pending (`CharConfig.svelte:262-333`).
4. **Stale continuation:** The old handler resumes and replaces the now-current `value` array without checking the owner or collection snapshot captured at dialog creation (`TriggerList.svelte:41,57-76,92-104`).
5. **Client state:** `CharConfig` observes the replacement and calls `applyCharacterScriptDefinitionDraft` with the current character ID (`CharConfig.svelte:336-353`). That function writes the replacement into the live character row and queues a durable trigger-definition mutation (`scriptDefinitionBridge.svelte.ts:201-263,397-426`).
6. **Client A request:** For the concrete V2 mode replacement, the bridge selects the absolute replacement command and sends `PUT /api/v1/commands/characters/:characterId/triggers` with the replacement array (`commands.ts:4399-4422`).
7. **Server persistence:** Fastify validates the array, assigns it to `character.triggerscript`, and writes the character row, making the stale mode replacement authoritative. The equivalent module path can persist the same mistake to the module collection.
8. **Display/acknowledgement:** The optimistic draft already shows the destructive replacement. A successful acknowledgement confirms it; rollback logic only helps when the server rejects the command and cannot infer that the confirmation predates the synchronized collection.

## Severity and user impact

**High.** A single stale confirmation can silently replace an entire character or module trigger program after the UI already received the newer version. The replacement is durably saved, so recovery may require restoring a backup or reconstructing the lost triggers.

## Recommended fix

At the start of every mode-switch handler, capture:

- `ownerKey`;
- the bound array identity or a structural snapshot; and
- the requested source mode.

After confirmation, return unless `ownerKey` and the collection snapshot/revision still match. Prefer a shared `confirmTriggerModeReplacement(ownerKey, snapshot, replacement)` helper so all three buttons enforce the same rule. Invalidate outstanding mode-switch operations when either the owner or authoritative projection changes, and add a latest-operation token if multiple confirmations can overlap.

## Test coverage gap

Add a `TriggerList` test that opens a deferred V2 confirmation, replaces the same owner's binding with a newer authoritative collection, resolves the confirmation, and asserts that the newer value is unchanged. Add an owner-swap variant and cover V1, V2, and Lua replacements.
