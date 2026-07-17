# Chat fork rekeys messages without dependent references

## Summary

Copying or branching a chat assigns every copied message a new ID to satisfy Fastify's global active-message uniqueness rule, but it leaves metadata that refers to those messages keyed by the old IDs. Fastify accepts and persists the internally inconsistent fork. Bookmarks in the new chat disappear from its bookmark UI, bookmark names become unreachable, and message-linked generation or memory metadata can continue pointing into the source chat.

## Location

- `src/lib/SideBars/SideChatList.svelte:426-461,1050-1073,1166-1189`
- `src/lib/ChatScreens/Chat.svelte:485-569`
- `src/ts/characters.ts:716-760`
- `src/ts/chatCommands.ts:3528-3595`
- `src/ts/server/commands.ts:3524-3559`
- `server/fastify/src/routes/commands.ts:5388-5513`
- `src/lib/Others/BookmarkList.svelte:91-164`

## Trigger

- Choose Copy for a chat that contains bookmarks, bookmark names, linked `generationInfo.generationId` values, or Hypa V3 `chatMemos`; or
- Branch such a chat from a message, especially when bookmarks or memory links refer to rows at or after the branch point.

## Expected behavior

The fork should be a self-contained copy. Every reference to a copied message should be rewritten to that message's new ID. References to messages omitted by a branch should be removed or normalized. The source and fork should not share message identity or contain dangling cross-chat references.

## Actual behavior

Every copied `message.chatId` changes, but `bookmarks`, the keys of `bookmarkNames`, `generationInfo.generationId`, and Hypa V3 summary `chatMemos` are copied unchanged. In a branch, metadata for source-tail messages is also retained even though those rows were sliced out. The new chat is persisted successfully with orphan or source-owned IDs.

The bookmark list detects all copied bookmarks as nonresident, hydrates the complete fork, then filters them out because no forked row has the old ID. Other consumers can resolve the reference to no row or, if they search more broadly, to a row in the source chat rather than the fork.

## Underlying cause

The two fork builders perform an incomplete rekey. `SideChatList.forkChat()` snapshots the source, assigns a new chat ID, and replaces only each `message.chatId`. `Chat.branch()` slices the message array and performs the same one-field loop. Neither records an old-to-new map or transforms dependent metadata.

This omission is especially visible after migration because active message IDs must now be unique in the normalized Fastify message table. The import path already contains the needed pattern: `rekeyImportedChat()` constructs a map and rewrites bookmarks, bookmark-name keys, generation IDs, and memory chat memos. Forking does not reuse it.

The server treats the supplied fork as canonical. It validates that the new message IDs do not already exist, inserts the supplied chat row, writes the supplied message rows, and separately stores supplied Hypa data. It validates bookmark shape but not that IDs belong to the fork. The success response contains no repaired metadata, and the client acknowledges its optimistic fork as complete.

## Affected data flow

1. **UI action:** The sidebar Copy option invokes `forkChat()`; the message Branch action builds a fork at the selected row (`SideChatList.svelte:426-461`; `Chat.svelte:485-569`).
2. **Client projection:** A deep snapshot retains all metadata. The code changes the chat ID and each message ID but does not rewrite anything that points at a message. The branch path additionally slices messages without pruning tail references.
3. **Request:** `dispatchForkChat()` optimistically inserts that exact snapshot and sends it through `POST /api/v1/commands/chats/:sourceChatId/fork` (`chatCommands.ts:3528-3595`; `commands.ts:3524-3559`).
4. **Server persistence:** Fastify verifies only new-row ID uniqueness and structural validity, then inserts the chat row, replaces its message rows, and stores `hypaV3Data` (`routes/commands.ts:5388-5502`).
5. **Response:** The response returns revision/event identifiers, selected chat ID, and generation settings. It does not return a canonical fork or a reference-remapping result (`routes/commands.ts:5506-5510`).
6. **Client acknowledgement:** Because the supplied transcript was already painted, the optimistic fork effect marks it hydrated and leaves all copied metadata unchanged.
7. **Display:** The bookmark dialog maps old bookmark IDs against new message IDs, finds no rows, and filters them (`BookmarkList.svelte:91-164`). Message-linked memory and generation consumers receive similarly stale identifiers.

## Severity and user impact

**High.** Copy and Branch appear successful while silently corrupting durable relationships inside the new chat. Users lose access to copied bookmarks, named organizational state, and potentially message-linked memory context. Because the inconsistent snapshot is accepted by Fastify and survives reload, there is no later authoritative reconciliation that repairs it.

## Recommended fix

- Extract a single fork rekey routine that builds an old-to-new message-ID map and use it for sidebar copies, message branches, imports, and any future transcript clone path.
- Rewrite `bookmarks`, `bookmarkNames`, `generationInfo.generationId`, and every schema-defined message-ID reference. For branches, first restrict references to retained rows, then rekey them; normalize summary ranges and connected-message metadata that cross the cut.
- Prefer moving this transformation into a dedicated Fastify fork command that receives a source ID and branch boundary, performs the clone transactionally, and returns the canonical fork. The browser can still optimistically derive the same map if client-supplied IDs are required.
- Validate on the server that bookmark and memory message IDs belong to the target chat before accepting create/fork/import payloads.

## Test coverage gap

Current fork tests cover transcript persistence and ID uniqueness but not dependent references. Add a fixture with named bookmarks, a generation link, and memory chat memos. Copy it and branch before the final referenced row. Assert that retained references resolve only inside the fork, removed-tail references are absent, the source remains unchanged, and the bookmark dialog renders the copied bookmarks after reload.
