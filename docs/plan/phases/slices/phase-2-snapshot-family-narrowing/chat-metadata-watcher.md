# Chat-Metadata Watcher

Status: planned. Phase 2. Always-on watcher. Depends on the Phase 0 kit.

## Scope

Stop the chat-metadata watcher from materializing a full `ChatStateSnapshot` on
each fire. Also make `scalarChatMetadata` copy only scalar patch keys instead of
cloning full chats.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical chat-metadata-watcher finding and the High `scalarChatMetadata`
  finding.
- `src/ts/server/chatBridge.svelte.ts:68` - the tracked `$effect` calling
  `currentChatStateSnapshot()` (full-array) before the early-return guard at
  `:80-91`; `previousState`/`currentState` at `:61/68/89/113`.
- `src/ts/server/chatBridge.svelte.ts:190` - `scalarChatMetadata` =
  `sanitizeChatPatch(cloneJsonValue(chat))`.
- `src/ts/server/chatBridge.svelte.ts` - `dispatchUpdateChat` /
  `dispatchUpdateChatFolder`, `queueChatPatch`/`queueFolderPatch`,
  `CHAT_PATCH_ALLOWED_KEYS`, `sanitizeChatPatch`.
- `src/lib/SideBars/SideChatList.svelte:75`, `ChatList.svelte:34`,
  `CharConfig.svelte:156` - the mounting sites.

## Target Implementation

- Remove the effect's full-array `previousState` / `currentState` snapshots.
- Capture rollback lazily in `queueChatPatch` / `queueFolderPatch`, only when
  `changedFields()` finds a real change.
- Do not only gate the old snapshot behind `Object.keys(patch).length > 0`.
  `previousState` is reassigned every run, so the diff baseline itself must be
  per-row.
- Rewrite `scalarChatMetadata` to build the scalar snapshot without serializing
  `chat.message`/`chat.localLore`: iterate `CHAT_PATCH_ALLOWED_KEYS` and
  `cloneJsonValue` only the small allowed values
  (`bookmarks`/`bookmarkNames`/`modules` are bounded).

```ts
function scalarChatMetadata(chat) {
  const out = {}
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    const v = chat[key]
    if (v !== undefined) out[key] = cloneJsonValue(v)
  }
  return out
}
```

## Behavior / Invariants

- Metadata diffs produce the same scalar patches and dispatch decisions.
- The 300 ms debounced dispatch is unchanged.
- Per-chat/per-folder rollback restores only that row's scalar metadata.
- A failed metadata patch rolls back only the affected chat/folder row.

## Done When

- The effect performs zero full-characters clones on a no-change re-trigger and on
  a streaming-chunk re-trigger (clone-cost harness).
- `scalarChatMetadata` never serializes `chat.message`/`chat.localLore`; the
  per-chat `.map` over `character.chats` is O(scalar keys) not O(messages).
- A failed `dispatchUpdateChat`/`dispatchUpdateChatFolder` restores only the one
  row; unrelated chats keep their values.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/chatBridge` (or the bridge suite)
- `pnpm test`
- `pnpm client-thinning:audit`
