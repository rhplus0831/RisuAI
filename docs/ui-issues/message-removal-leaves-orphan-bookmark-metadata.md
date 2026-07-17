# Message removal leaves orphan bookmark metadata

## Summary

Deleting a bookmarked message, or truncating a transcript across bookmarked messages, mutates only the message store. The chat's separate `bookmarks` array and `bookmarkNames` map are not updated in either the optimistic client projection or Fastify persistence. The bookmark dialog then silently filters the missing rows while repeatedly treating them as nonresident messages that might still be hydratable.

## Location

- `src/lib/ChatScreens/Chat.svelte:633-698`
- `src/ts/chatCommands.ts:4440-4462,4696-4715,4767-4793`
- `src/lib/Others/BookmarkList.svelte:91-127,133-164`
- `server/fastify/src/messageStore.ts:310-338`
- `server/fastify/src/commands/chats.ts:64-77,784-792`
- `server/fastify/src/routes/commands.ts:6023-6136`

## Trigger

1. Bookmark one or more messages and optionally assign bookmark names.
2. Delete one bookmarked row, or use the remove-to-here/truncate action so that a bookmarked row is in the removed tail.
3. Open the bookmark list, export/back up the chat, or reload and inspect its metadata.

## Expected behavior

Removing messages should atomically remove their IDs from `chat.bookmarks` and delete the corresponding `chat.bookmarkNames` keys. Optimistic display, persisted chat metadata, and the transcript should remain referentially consistent, with rollback restoring all three on failure.

## Actual behavior

The transcript row disappears and the server reports success, but the removed IDs and names remain in the chat row. The bookmark dialog does not show them because it filters IDs that have no message. On each new mount it detects those IDs as nonresident and requests a strict full-transcript hydration, which still cannot find them. The orphan metadata survives reload, export, and backup even though the bookmark is no longer actionable.

## Underlying cause

Bookmarks were split from the transcript during the Fastify migration: message rows live in the message store, while `bookmarks` and `bookmarkNames` remain allowed chat-row metadata. The delete and truncate commands operate only on the former.

On the client, `messagesAfterDelete()` and `messagesAfterTruncate()` calculate only a new `message` array. `dispatchDeleteMessageScoped()` and `dispatchTruncateMessagesScoped()` apply and roll back only transcript attempts. On the server, `deleteActiveMessageById()` and `truncateActiveChatMessages()` apply only a message-table diff. Neither route patches or writes the owning chat row.

No read-side repair closes the gap. Chat validation checks only that bookmarks are non-empty string IDs and bookmark names are strings; it does not require referenced message rows to exist. `BookmarkList` assumes a missing bookmarked ID may be outside the resident tail, hydrates the transcript, and then silently removes unresolved IDs from its display projection without repairing persistence.

## Affected data flow

1. **UI action:** `deleteMessageAtTarget()` dispatches a message DELETE; `truncateAtMessageTarget()` dispatches transcript truncation (`Chat.svelte:633-698`).
2. **Client projection:** The scoped attempt removes only rows from `chat.message`; `bookmarks` and `bookmarkNames` retain their prior values (`chatCommands.ts:4440-4462,4696-4715,4767-4793`).
3. **Request:** The client sends `DELETE /api/v1/commands/messages/:messageId` or `POST /api/v1/commands/chats/:chatId/messages/truncate`.
4. **Server persistence:** Fastify applies a diff only to the message table (`messageStore.ts:310-338`). The routes never write the owning chat metadata row (`routes/commands.ts:6023-6136`).
5. **Response:** The delete response acknowledges `chatId`/`messageId`; truncate acknowledges `chatId`, `afterMessageId`, and `removedCount`. Neither returns cleaned bookmark metadata.
6. **Client acknowledgement:** The accepted transcript local effect advances the chat body projection epoch; it has no chat-metadata patch to apply.
7. **Display:** `BookmarkList` sees an ID absent from resident messages, performs strict hydration, maps the still-orphaned ID to `null`, and filters it from the rendered list (`BookmarkList.svelte:91-127,133-164`).

## Severity and user impact

**Medium.** The transcript itself is removed intentionally, but a user-visible organizational feature becomes durably inconsistent. Bookmark names disappear from the UI without an explicit bookmark removal, repeated full hydrations waste bandwidth and time on large chats, and exported data accumulates references that can never resolve.

## Recommended fix

- Make message deletion, truncation, tail replacement, and full replacement compute the set of removed message IDs and clean `bookmarks`/`bookmarkNames` in the same server transaction.
- Return the canonical cleaned bookmark metadata, or a chat-row projection/local effect, along with the transcript acknowledgement.
- Mirror that cleanup in the optimistic client attempt and include metadata in its guarded rollback so the UI remains internally consistent before the response.
- Add a defensive read repair that prunes truly absent IDs after a complete transcript hydration. Do not prune before full hydration, because a valid bookmark can point outside the resident tail.

## Test coverage gap

Add route and client tests for deleting a named bookmark, truncating across several bookmarks, and replacing a transcript. Assert that retained-message bookmarks survive, removed-message IDs and names disappear in both SQLite and the resident projection, and a failed mutation restores both transcript and metadata. Add a bookmark-dialog test proving that reopening after successful cleanup does not request another full hydration.
