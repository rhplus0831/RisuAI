# Retained chat mutations lose their visible projection after resource refresh

- **Severity:** High
- **Affected surfaces:** `SIDE-04` (chat and folder metadata), `CHAT-10` (message editing), and other ordinary chat-owned mutations
- **Primary locations:** `src/ts/server/chatBridge.svelte.ts:121-142,289-311,423-450`; `src/ts/chatCommands.ts:2484-2506,4405-4498`; `src/ts/server/resourceInvalidation.ts:182-238,483-500,1062-1091`; `src/ts/server/resourceState.svelte.ts:2005-2065,2113-2146,2665-2701`

## Trigger

One concrete path is a chat rename:

1. Enter chat-list edit mode and change a chat name.
2. Let the debounced `PATCH /chats/:chatId` fail before commit with a retryable outcome, such as a network failure or 503. The UI correctly keeps the new name and the encrypted outbox keeps the mutation.
3. Before the outbox replays, let another client successfully update any chat or folder belonging to the same character. Its contiguous `characterRow` command event causes this client to fetch that character again. A revision-gap or explicit full refresh triggers the same problem.
4. The refresh returns the still-persisted old chat name and applies it to the live character projection.

The equivalent transcript path is a retained message edit followed by another message event or a full chat hydration: the authoritative read predates the retained edit and replaces the optimistic message row.

## Expected behavior

Retryable durability and visible state should have the same lifetime. While an exact mutation remains eligible for replay, its optimistic fields should remain overlaid on older authoritative reads (or be shown explicitly as queued). The overlay should disappear only after replay is accepted, the intent is finally discarded and rolled back, or writer/database ownership changes invalidate it.

## Actual behavior

The failed request leaves the durable intent queued and initially leaves the optimistic name visible. However, request settlement unconditionally removes the in-memory attempt that can reapply that name. A later targeted or full resource refresh installs the server's old value, so the chat list visibly changes from the new name back to the old name even though the new-name mutation is still live and may execute later.

If replay later succeeds, the value can change from new to old to new. Until then the UI hides a pending operation. A user who edits the apparently current old value can create a successor whose execution is ordered behind an invisible retained predecessor.

## Underlying cause

The durable dispatcher correctly classifies retryable failures as `retained` and tells the command runner not to invoke its rollback (`src/ts/server/durableMutationDispatch.ts:95-149,389-420`). The chat projection owners nevertheless treat completion of that network attempt as final:

- The chat metadata bridge moves a debounced patch into `inFlightChatPatches`, but both fulfillment and rejection of the returned promise call `clearInFlightChatPatch` (`chatBridge.svelte.ts:289-311`). A resolved 503/error result therefore clears the overlay even though `dispatchDurableMutation` retained the outbox row.
- `reassertPendingChatMetadataPatches` runs after a resource-apply epoch, but it can only reapply entries still present in the pending or in-flight bridge maps (`chatBridge.svelte.ts:121-142,423-450`). It has no registry keyed by the retained mutation id.
- Direct chat metadata dispatches likewise remove `pendingChatMetadataAttempts` on any promise settlement (`chatCommands.ts:2484-2506`). Scoped transcript mutations do the same to `pendingScopedTranscriptAttempts` (`chatCommands.ts:4475-4498`). Those ledgers protect overlapping rollback, not retained projections across reads.
- The durable outbox derives only a generic request projection target for chat/message routes; resource invalidation has no generic merger that can reconstruct a chat-row or message-row overlay from it (`src/ts/server/pendingMutationOutbox.ts:1271-1478`).

The read path then replaces exactly the data that lost its overlay. `chat.updated` and `chatFolder.updated` events use the `characterRow` resource, so invalidation fetches and applies the complete parent character row (`server/fastify/src/commands/events.ts:494-525`; `resourceInvalidation.ts:483-493,827-834,1066-1072`). `preserveResidentCharacterChatBodies` preserves resident messages, Hypa data, and specially fenced generation settings, but it intentionally takes ordinary chat metadata from the incoming row (`resourceState.svelte.ts:2665-2701`). Full refresh replaces all character rows and rehydrates the active transcript (`resourceInvalidation.ts:182-238`; `src/ts/server/resourceRefresh.ts:162-175`). Neither path overlays retained ordinary chat/message intents.

## Affected data flow

1. **UI interaction:** `SideChatList.svelte` binds the edit-mode text input to `updateChatName`, which writes the new name into the resource-backed live chat (`src/lib/SideBars/SideChatList.svelte:505-513,1015-1020`).
2. **Client projection and durable intent:** the metadata watcher detects the field change, stages `{ method: "PATCH", path: "/chats/:id", body: { patch: { name }, select: false } }`, and paints/retains the live value while its debounce and request are pending (`chatBridge.svelte.ts:149-165,213-241`).
3. **Request:** `dispatchUpdateChatRow` sends `PATCH /api/v1/commands/chats/:chatId` via `updateChatCommand`, including the current `baseRevision` and mutation receipt headers (`src/ts/chatCommands.ts:2341-2386`; `src/ts/server/commands.ts:3485-3500`).
4. **Server persistence:** on success, Fastify validates the patch, rewrites the single SQLite chat row with `writeSingleChatRow`, and returns the new revision, `chat.updated` event, `chatId`, and selected chat id (`server/fastify/src/routes/commands.ts:5496-5559`). In this trigger, the retryable failure occurs before that commit, so the stored row still has the old name.
5. **Retryable acknowledgement:** the durable layer keeps the encrypted outbox row and suppresses rollback, but the settled command promise causes the bridge and rollback ledger to forget the optimistic attempt.
6. **Synchronization:** a foreign same-character event calls `fetchServerCharacter`; its message-free character payload contains the old persisted chat metadata (`src/ts/server/resourceReads.ts:169-187`). `applyCharacterResource` replaces the character row while preserving only selected resident bodies.
7. **Displayed state:** the chat list renders the newly installed old name. The bridge sees the resource-apply epoch but has no pending/in-flight entry left to reassert.
8. **Eventual replay:** bootstrap recovery or a later owner mutation can replay the queued exact patch. If accepted, the server finally stores the new name and another reconciliation makes it visible again.

For message edits, steps 2-5 use `dispatchUpdateMessageScoped` and durable `PATCH /messages/:messageId`; a later `message` invalidation reads the chat transcript and `applyServerChatMessagesResource` replaces it (`chatCommands.ts:4582-4673`; `resourceInvalidation.ts:498-500,848-872,1139-1155`; `src/ts/server/chatMessageHydration.svelte.ts:558-582`).

## User impact

**High.** This is the migration's characteristic delayed-reversion failure: the UI says an edit was kept, later says it was not, while the background queue still says it should be. It affects common chat renames, folder edits, message edits, and other chat-owned optimistic mutations whenever transient failures coincide with cross-tab activity or recovery refreshes. The hidden live intent also makes subsequent user edits difficult to reason about and can leave different mounted projections temporarily disagreeing.

## Recommended fix

- Keep a retained projection record keyed by the durable `mutationId`, semantic owner, row id, and exact attempted fields. Do not clear it when the first request merely settles as retained.
- Register `registerDurableMutationSettlementListener` when staging the chat/character-owned mutation. Remove the overlay only on final `accepted` or `discarded` settlement; transfer/rebase it when a same-owner successor supersedes it.
- Merge retained chat metadata into both targeted and full character reads, and reapply retained transcript operations after chat hydration. Use per-field/per-message fences so an older retained operation cannot overwrite a newer local successor.
- Preserve current value-aware terminal rollback behavior. On final discard, remove the retained overlay, roll back only fields still equal to the attempted values, and surface a localized failure; on retention, expose a queued/pending state instead.
- Add integration tests that retain a chat rename and a message edit on 503, apply a foreign targeted event and a full refresh returning the old server value, and assert the optimistic value remains visible until replay acceptance. Also cover terminal replay rejection and a newer same-row successor.
