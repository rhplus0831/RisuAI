# Input-translation rollback is not reconciled with delete failure

- **Severity:** Medium
- **Affected surface:** `CHAT-12` (translated composer and rollback action)
- **Primary locations:** `src/lib/ChatScreens/DefaultChatScreen.svelte:844-919,1627-1638`; `src/ts/chatCommands.ts:4113-4210,4726-4778`

## Trigger

1. Enable a character's input-translation hook and send a draft. The translated user message is appended and accepted by Fastify, and the rollback button appears.
2. Click the rollback button.
3. Make the ensuing message DELETE fail terminally, for example by deleting the row from another client first so Fastify returns `not-found`, or by rejecting the mutation because its writer/lineage is no longer valid.

## Expected behavior

Undoing the translated input is one user operation: remove the translated transcript row and restore its original source text/files to the composer. If deletion is terminally rejected, both halves should be compensated together, the rollback affordance should remain recoverable, and the user should see an error. Retryable retained work should be identified as queued rather than failed.

## Actual behavior

The translated row is removed optimistically and the original composer is restored immediately. The component then clears its only rollback descriptor without observing the delete result. If Fastify terminally rejects the DELETE, the chat command's rollback restores the translated transcript row, but nothing restores the pre-undo composer state or the rollback descriptor. The UI now shows the translated message and the original source draft at the same time.

For a `not-found` response, the restored translated row is additionally a client-only ghost: Fastify is authoritative that the row no longer exists. If the user sends the restored draft before the delete result arrives, the late transcript rollback can leave an apparently duplicated turn.

## Underlying cause

`rollbackLastInputTranslation` treats transcript deletion as fire-and-forget. It calls `dispatchDeleteMessageScoped`, then synchronously restores `messageInput`/attachments and sets `lastInputTranslationRollback = null` (`DefaultChatScreen.svelte:906-918`).

`dispatchDeleteMessageScoped` deliberately returns `void`, even though its internal durable dispatcher returns a command promise. It applies the attempted message list and registers a rollback that restores only the scoped transcript (`chatCommands.ts:4759-4778`). On a terminal outcome, `runServerCommand` invokes that rollback; the composer is owned by another component and is outside the attempt ledger. The caller therefore has no accepted/queued/failed outcome with which to reconcile the compound UI action.

## Affected data flow

1. The translation hook translates the source draft and calls `appendCurrentChatUserMessageForSend` (`DefaultChatScreen.svelte:844-867`).
2. The append helper optimistically adds the message, stages durable `POST /chats/:chatId/messages`, waits for its outcome, and reports `ok`, `queued`, or `error` (`chatCommands.ts:4113-4210`). Only an `ok` result creates `lastInputTranslationRollback` (`DefaultChatScreen.svelte:867-890`).
3. Clicking the rollback button snapshots the chat and calls `dispatchDeleteMessageScoped`, then restores the original text/files and discards the descriptor (`DefaultChatScreen.svelte:906-918,1627-1638`).
4. The delete helper removes the row locally and stages durable `DELETE /messages/:messageId` (`chatCommands.ts:4726-4778`).
5. `deleteMessageCommand` sends `DELETE /api/v1/commands/messages/:messageId` (`src/ts/server/commands.ts:4978-4995`).
6. Fastify resolves and deletes the active message, prunes bookmarks, and returns a revision/event on success; missing or ambiguous rows return a command error (`server/fastify/src/routes/commands.ts:6406-6458`).
7. A retryable failure is retained by the durable outbox, but a terminal rejection discards the intent and invokes the scoped transcript rollback. No completion reaches `DefaultChatScreen`, so its restored composer and cleared descriptor remain unchanged.

## User impact

The user can see two incompatible representations of the same input and cannot tell that undo failed. In cross-tab or writer-transition cases the transcript can also display a message that SQLite does not contain until a later authoritative refresh removes it again.

## Recommended fix

- Expose a structured result from the scoped delete path, such as `accepted | queued | failed`, while retaining its field-aware transcript rollback.
- Keep an undo attempt token containing the composer mutation version, transcript identity, and previous composer state until that result settles. On terminal failure, compensate the composer only if the same attempt still owns it, restore the rollback affordance, and show a localized error; do not overwrite a newer draft.
- Treat retained durable deletion as queued and keep enough state to reconcile a later accepted/discarded settlement. Consider making a delete of the exact already-missing message idempotent, or force an authoritative chat read instead of restoring a known-missing row.
- Extend the rollback component test with deferred accepted, retained, and terminal `not-found` outcomes, including a newer composer edit made while deletion is pending.
