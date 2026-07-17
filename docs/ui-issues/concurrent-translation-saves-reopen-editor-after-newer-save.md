# An older translation save reopens the editor after a newer save

- **Severity:** Medium
- **Affected surface:** `CHAT-09` (raw-message translation editor)
- **Primary locations:** `src/lib/ChatScreens/Chat.svelte:743-817,918-949,1068-1079,1540-1592`; `src/ts/chatCommands.ts:4582-4673`

## Trigger

1. Open a message that already has a server-owned raw translation.
2. Edit the translation to value A and save while delaying its message PATCH.
3. Before A's request settles, reopen the same row, edit it to value B, and save again.
4. Let the globally ordered A and B requests complete.

## Expected behavior

Value B is the newest intent. It should remain displayed and persisted, and completion of A must not alter the editor state owned by B. Once B is accepted, the translation editor should stay closed.

## Actual behavior

Both message mutations can persist correctly and the displayed translation remains B, but A's completion observes that the live translation no longer equals A and reopens the editor. B's later completion sees that the live value equals B and does nothing, so the editor remains open. With automatic popup editing enabled, the older completion can also reopen the popup after the user already finished the newer save.

## Underlying cause

`saveServerTranslationEdit` captures only a stable `{ chatId, messageId }` target. It optimistically installs the attempted translation, closes the editor, awaits `dispatchUpdateMessageScoped`, and then treats any live-value mismatch as evidence that this save failed (`Chat.svelte:918-949`).

That mismatch is also the normal result of a newer save. `isRenderingTranslationMessageTarget` verifies only row ownership (`Chat.svelte:753-755`); there is no save-attempt sequence or latest-operation token. The transcript dispatcher does have an ordered attempt ledger and field-aware rollback (`chatCommands.ts:4640-4673`), so it intentionally preserves B when A settles. The component then misinterprets that correct reconciliation as a reason to reopen A's editor.

## Affected data flow

1. The Edit Translation action captures the message target and populates `editTranslationText` (`Chat.svelte:1068-1075`).
2. Save A creates a new `MessageTranslation`, applies it directly to the live message projection, closes `editTranslationMode`, and calls `dispatchUpdateMessageScoped` (`Chat.svelte:918-942`).
3. The dispatcher marks the chat message-mutation intent, stages a durable `PATCH /messages/:messageId`, and registers a scoped transcript attempt (`chatCommands.ts:4582-4606,4640-4673`).
4. `updateMessageCommand` sends `PATCH /api/v1/commands/messages/:messageId` with the translation patch (`src/ts/server/commands.ts:4935-4956`).
5. Fastify resolves the message row, persists the patch in a targeted mutation, and returns the new revision, `message.updated` event, `chatId`, and `messageId` (`server/fastify/src/routes/commands.ts:6235-6303`).
6. Before A settles, Save B repeats the same flow and leaves B as the current optimistic projection.
7. A's promise resumes. The row still matches its stable owner, but its translation is B rather than A, so lines 943-947 reopen the editor. B's completion has no corresponding "close if latest" action.

## User impact

The saved data is usually correct, but the UI presents a false failure/pending state after a successful newer edit. The unexpected inline or popup editor can make users resave, cancel, or overwrite text because an older acknowledgement appears to take ownership of the current interaction.

## Recommended fix

- Add a monotonically increasing translation-save attempt id keyed by `chatId` and `messageId`. Only the latest attempt may change `editTranslationMode`, `editTranslationTarget`, or popup state after awaiting persistence.
- Use the returned command status to distinguish accepted/queued work from a terminal rollback. Do not infer failure solely from `live !== attempted`; that comparison must also account for a newer local attempt.
- On a terminal failure of the latest attempt, reopen only if the same row is still rendered and no newer edit/popup operation owns it. Preserve the current text and surface a localized save error.
- Add a deferred two-save component test: save A, save B, resolve A then B, and assert that B remains in the projection and the editor/popup stays closed.
