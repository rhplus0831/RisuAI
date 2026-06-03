# Chat-Metadata Watcher

Status: implemented. Phase 2. Always-on watcher. Depends on the Phase 0 kit.

Landed: the watcher no longer captures a `currentChatStateSnapshot()` per fire.
`scalarChatMetadata` iterates `CHAT_PATCH_ALLOWED_KEYS` and clones only the small
allowed scalars (never `chat.message`/`chat.localLore`), so the effect also stops
tracking the message array and no longer wakes on streaming chunks. Each changed
row queues a narrow `ChatRowMetadataSnapshot` / `ChatFolderRowMetadataSnapshot`
rollback (the per-row scalar baseline the watcher already diffs), dispatched via
new `dispatchUpdateChatRow` / `dispatchUpdateChatFolderRow` variants that restore
through `restoreChatRowMetadata` / `restoreChatFolderRowMetadata` instead of
`restoreChatState`. Proofs: clone-cost + streaming-no-wake + epoch-rebuild tests
in `chatBridge.svelte.test.ts`, and row-restore correctness (incl. added-key
delete + sibling-row isolation) in `chatCommands.test.ts`.

## Scope

Stop the chat-metadata watcher from materializing a full `ChatStateSnapshot` on
each fire. Also make `scalarChatMetadata` copy only scalar patch keys instead of
cloning full chats.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical chat-metadata-watcher finding and the High `scalarChatMetadata`
  finding.
- `src/ts/server/chatBridge.svelte.ts` - `watchServerBackedChatMetadata`,
  `collectChatCollectionSnapshots`, `scalarChatMetadata`, `queueChatPatch`,
  `queueFolderPatch`, and the narrow chat/folder row dispatch variants.
- `src/lib/SideBars/SideChatList.svelte:75`, `ChatList.svelte:34`,
  `CharConfig.svelte:156` - the mounting sites.

## Implemented Shape

- The effect keeps per-row scalar baselines instead of full-chat snapshots.
- `queueChatPatch` / `queueFolderPatch` capture rollback only after a real diff
  and dispatch through narrow chat/folder row variants.
- `scalarChatMetadata` iterates `CHAT_PATCH_ALLOWED_KEYS`, never serializing
  `chat.message` or `chat.localLore`; bounded scalar arrays such as bookmarks are
  still cloned.

## Behavior / Invariants

- Metadata diffs produce the same scalar patches and dispatch decisions.
- The 300 ms debounced dispatch is unchanged.
- Per-chat/per-folder rollback restores only that row's scalar metadata.
- A failed metadata patch rolls back only the affected chat/folder row.

## Proven

- Clone-cost tests cover no-change and streaming-chunk re-triggers.
- `scalarChatMetadata` is O(scalar keys), not O(messages).
- Failed chat/folder metadata dispatch restores only the affected row.

## Validation

- `pnpm test -- src/ts/server/chatBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
