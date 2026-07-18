# Chat-list structural actions hide persistence outcomes

## Summary

The sidebar chat organizer and the chat-list modal optimistically create,
fork, delete, rename, reorder, and organize chats and folders, but most of their
command helpers return `void`. The lists immediately render the new structure;
create also navigates to the optimistic chat and the modal closes. The durable
owners safely retain retryable work or roll back terminal failures, but the
initiating UI never learns which occurred.

As a result, a rejected create can make the new chat and route disappear, a
rejected delete can make a chat reappear, and an order/folder edit can silently
snap back. A retained mutation looks identical to a persisted mutation.

## Location

- `src/lib/SideBars/SideChatList.svelte:100-127` selects chats and folds
  folders.
- `src/lib/SideBars/SideChatList.svelte:233-252,350-401` moves chats and
  folders or changes folder metadata.
- `src/lib/SideBars/SideChatList.svelte:404-455` creates and forks chats.
- `src/lib/SideBars/SideChatList.svelte:590-613` deletes chats.
- `src/lib/SideBars/SideChatList.svelte:761-830,955-986,1303-1326` handles
  drag reorder plus folder delete/create.
- `src/lib/Others/ChatList.svelte:115-142,158-235` renames, deletes, and
  creates from the modal; create navigates and closes immediately.
- `src/ts/chatCommands.ts:2047-2083,2399-2439,3628-3795,3886-3952,4105-4185`
  implements the fire-and-forget command owners.
- Rollback behavior is exercised in `src/ts/chatCommands.test.ts:1335-1705`.
- `src/ts/server/commands.ts:3452-3500,3583-3631` sends the corresponding chat
  commands.
- `server/fastify/src/routes/commands.ts:5403-5559,5690-5937,5940-6135`
  persists chats, ordering, and folder metadata.

## Trigger

Use either chat list to perform any of these actions while Fastify later
returns a terminal error or the durable transport retains the request:

- create, fork, rename, or delete a chat;
- drag/reorder a chat or move it into/out of a folder;
- create, delete, reorder, fold, recolor, or rename a chat folder.

## Expected behavior

Each structural action should stay associated with its exact durable mutation.
The affected row should expose an in-flight state, accepted work should finish
normally, retained work should be labelled queued, and terminal failure should
show an error after rollback. Navigation or modal closure should not imply an
unclassified server success.

## Actual behavior

The UI changes `characters[].chats`, `chatFolders`, `chatPage`, and sometimes
the route immediately. It then calls command functions such as
`dispatchCreateChat`, `dispatchDeleteChat`, `dispatchForkChat`,
`dispatchReorderChatsByIds`, or `dispatchCreateChatFolder`. Those functions
stage and execute durable mutations with `void`, erasing the
`ServerCommandResult` and retention decision.

The modal's rename path similarly calls the void `dispatchUpdateChat`; an
async variant already exists and is used by the sidebar persona-binding action,
which explicitly distinguishes queued from failed. The structural actions do
not use that pattern.

On a terminal failure, attempted-value and projection-epoch guards reconcile
the shared resource rather than leaving permanent divergence. The visible
symptom is therefore an unexplained reappearance, disappearance, or reorder
reversion. On a retained failure, the optimistic structure remains visible for
replay without any queued marker.

## Underlying cause

The chat command layer was upgraded with durable outbox ownership, narrow
rollback, local-effect certificates, and stale-response fences, but its public
structural APIs kept the old frontend-owned `Database` void contract. The UI
cannot await or classify a mutation that the helper does not return. Rollback
has become the only failure signal.

## Affected data flow

1. **UI interaction:** a sidebar/list button, alert action, or Sortable callback
   initiates the mutation.
2. **Client projection:** helpers optimistically update the selected
   character's `chats`, `chatFolders`, folder assignments/order, and `chatPage`.
   Create/delete may also call `navigate()` using the optimistic chat ID.
3. **Durable request:** the owner stages one or more requests, including
   `POST /characters/:characterId/chats`,
   `PATCH|DELETE /chats/:chatId`, `POST /chats/:chatId/fork`,
   `POST /characters/:characterId/chats/reorder`, and chat-folder
   create/update/delete/reorder endpoints.
4. **Server persistence:** Fastify validates complete ID sets and folder
   references, writes exact chat rows with `writeSingleChatRow()` or
   `writeCharacterChatRows()`, and writes the parent character row when
   `chatPage` or `chatFolders` changes. Delete also removes message and memory
   rows.
5. **Response/acknowledgement:** success returns a revisioned chat/folder event
   and stable IDs. Local-effect certificates acknowledge matching optimistic
   structure; retryable failures retain the outbox; terminal failures invoke
   scoped rollback.
6. **Displayed state:** both components render the same resource projection,
   so reconciliation eventually appears. Neither component holds the returned
   settlement, pending state, or error, and route/modal state may already have
   moved on.

## Severity and likely user impact

**High.** These are frequent and sometimes destructive catalog actions. A user
can believe a chat was created, forked, organized, or deleted, continue in a
new route, and later see the action reverse without explanation. Silent queued
deletes and forks are especially confusing because they can replay on a later
session.

## Recommended fix

- Add outcome-bearing async variants for every chat/folder structural helper,
  settled from the exact durable outbox handle, using
  `accepted | queued | failed` consistently.
- Await them in both list components. Track pending state per chat/folder ID and
  disable only conflicting actions.
- For create, navigate/close after accepted; if queued navigation is retained,
  explicitly show that the chat is provisional. On failed create, remain in or
  restore a valid route and show an error.
- For delete/reorder/folder edits, render a localized queued indicator and a
  localized terminal-failure message after the existing narrow rollback.
- Preserve current owner IDs, projection epochs, and attempted-value rollback
  so an older failed action cannot overwrite newer organization work.
- Add component tests with deferred accepted, retained, and terminal outcomes,
  including route behavior for create/delete.
