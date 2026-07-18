# Bookmark edits hide persistence outcomes

## Summary

The bookmark-list modal optimistically renames and removes bookmarks in the
active chat, then calls a void scoped chat updater. Fastify persistence can be
accepted, durably queued, or terminally rejected, but the modal receives no
outcome and exposes no pending/error state.

The chat metadata owner already performs attempted-field rollback, so a
terminal failure eventually makes a removed bookmark reappear or a renamed one
return to its old label. That reconciliation is silent. A retained change stays
visible with no indication that it has not reached the server.

## Location

- `src/lib/Others/BookmarkList.svelte:30-173` hydrates and derives bookmarked
  messages from the selected character/chat resource.
- `src/lib/Others/BookmarkList.svelte:201-216` applies optimistic bookmark
  metadata and synchronizes bridge baselines.
- `src/lib/Others/BookmarkList.svelte:218-285` renames and removes bookmarks.
- `src/ts/chatCommands.ts:2495-2545` implements the void scoped chat metadata
  dispatcher.
- `src/ts/chatCommands.ts:2385-2396,2550-2633` tracks guarded metadata attempts,
  rollback, and retained projection reapplication.
- `src/ts/chatCommands.test.ts:4702-4825` covers scoped failed metadata
  rollback.
- `src/ts/server/commands.ts:3485-3500` sends the PATCH and reads its local
  effect.
- `server/fastify/src/routes/commands.ts:5496-5559` persists chat metadata.

## Trigger

1. Open the bookmark-list modal for a hydrated chat.
2. Rename a bookmark, or remove one from the list.
3. Have `PATCH /chats/:chatId` fail terminally or be retained for durable
   replay.

## Expected behavior

The edited bookmark should have an operation-specific pending state. Accepted
work can settle normally; retained work should be labelled queued; a terminal
failure should restore the previous metadata and display an error. A second
edit should be sequenced or rebased without losing its own status.

## Actual behavior

Rename builds a new `bookmarkNames` object, writes it into the shared chat, and
calls `dispatchUpdateChatScoped(...)`. Remove builds new `bookmarks` and
`bookmarkNames` values, applies both optimistically, and calls the same void
function. Neither call can be awaited, and the modal has no pending, queued, or
failed state.

On terminal rejection, the chat metadata attempt tracker restores only keys
that still match the failed attempted values, preserving later edits. Because
the modal derives rows directly from the same resource, the old name or removed
row appears again with no explanation. For a retained failure, the durable
projection guards keep the optimistic values visible for replay, again without
status.

## Underlying cause

The bookmark UI migrated from mutating frontend-owned chat metadata to a
server-backed optimistic command, but the scoped helper retained a `void`
public contract. Internally it has the `Promise<ServerCommandResult>` returned
by `dispatchCharacterOwnedDurableMutation`; that Promise is discarded in both
the no-rollback and tracked-attempt branches.

## Affected data flow

1. **UI interaction:** an alert-driven rename or the remove button targets a
   stable bookmarked message ID.
2. **Client projection:** `applyOptimisticBookmarkMetadata` updates
   `characters[].chats[].bookmarks` and/or `bookmarkNames`, then refreshes the
   server-backed chat metadata baseline.
3. **Request:** the chat owner stages
   `PATCH /api/v1/commands/chats/:chatId` with `{ patch: { bookmarks,
   bookmarkNames }, select: false }` and a base revision.
4. **Server persistence:** Fastify validates the patch, locates the chat, writes
   the exact chat row with `writeSingleChatRow()`, and leaves sibling messages
   and rows untouched.
5. **Response/acknowledgement:** success returns the revision,
   `chat.updated`, `chatId`, and selected chat ID. The local effect clears the
   matching optimistic attempt. Retryable failure retains it; terminal failure
   calls `rollbackServerBackedChatRowMetadata` through the attempt tracker.
6. **Displayed state:** `bookmarkedMessages` is derived from the shared chat
   resource, so it reflects accepted, retained, or rolled-back metadata. The
   component cannot tell the user which transition occurred.

## Severity and likely user impact

**Medium.** Bookmark metadata does not delete chat messages, but it is the
user's navigation/indexing data. Silent rollback makes names or removals appear
unreliable, and a queued removal can replay later without the user knowing the
bookmark is provisional.

## Recommended fix

- Add an async scoped metadata API that returns an exact
  `accepted | queued | failed` outcome while preserving the existing attempt
  tracker and rollback callback.
- Await it in BookmarkList and track pending state by `(chatId, messageId,
  operation)` so unrelated bookmarks remain editable.
- Show a localized queued indicator for retained edits and an error after
  terminal rollback.
- If the modal closes while work is pending, keep settlement reporting in a
  shared notification owner rather than dropping it with component state.
- Add component tests with deferred results and a later edit to the same
  bookmark, verifying both guarded rollback and visible outcome state.
