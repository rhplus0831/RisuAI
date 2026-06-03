# Chat-Metadata Watcher

Status: planned. Phase 2. The always-on, per-render Critical. Depends on the Phase
0 kit.

## Scope

Stop the chat-metadata bridge watcher materializing a full-array
`ChatStateSnapshot` on every reactive fire, and stop `scalarChatMetadata` cloning
each full chat (incl. `message[]`) before stripping to scalar keys. The watcher is
mounted by the default chat sidebar, so it re-fires per streaming chunk and per
message edit.

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

- Remove the `previousState`/`currentState` full-array
  `currentChatStateSnapshot()` from the effect. Capture the rollback baseline
  lazily and per-row **only when `changedFields()` detects an actual change**,
  inside `queueChatPatch`/`queueFolderPatch`, materializing just the affected
  chat/folder row (a scalar/single-row snapshot from the Phase 0 kit). Nothing is
  cloned on the common no-change re-trigger.
  - Note: a minimal "gate `currentChatStateSnapshot` behind
    `Object.keys(patch).length>0`" is **not** sufficient — `previousState` is
    reassigned every run as the diff baseline, so the baseline itself must be made
    cheap (per-row), not merely deferred.
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

- The metadata-diff maps (`scalarChatMetadata`/`sanitizeChatPatch`) produce the
  same scalar patches and the same dispatch decisions; only their cost changes.
- The 300 ms-debounced dispatch is unchanged; the rollback for a per-chat/per-folder
  metadata patch restores only that row's scalar metadata.
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
