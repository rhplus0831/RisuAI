# Slice: Watcher Short-Circuits

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Findings:
L28 and L29. Client bridge watcher performance change.

## Scope

Stop broad server-projection writes from forcing collection-sized snapshot
work inside the character-scope lorebook watcher and the chat-metadata
watcher.

This slice owns reference-keyed lazy `localLore` snapshots in
`lorebookBridge.svelte.ts` and a no-change short-circuit in
`chatBridge.svelte.ts`. It does not change command debounce semantics,
rollback suppression, watcher ref-counting, selected-character behavior, or
the read-only projection guard.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L28, L29, and I19 context.
- `src/ts/server/projectionWriteGuard.svelte.ts`: fresh proxy tree per
  guarded write is intentional.
- `src/ts/server/lorebookBridge.svelte.ts`:
  `collectLorebookCollectionSnapshots`,
  `collectCharacterLorebookSnapshots`, `snapshotJson`,
  `queueReplacement`, and rollback helpers.
- `src/ts/server/chatBridge.svelte.ts`:
  `watchServerBackedChatMetadata`, `scalarChatMetadata`,
  `scalarChatFolderMetadata`, `changedFields`, and the existing single
  ref-counted effect.
- `src/ts/process/streamResponse.ts`: hot guarded-write driver during
  streaming render frames.
- Focused tests:
  `src/ts/server/lorebookBridge.svelte.test.ts` and
  `src/ts/server/chatBridge.svelte.test.ts`.

## Target Shape

- Keep lorebook watcher coverage full: a character-scope watcher must still
  visit every chat for the selected character, including non-open chats, so
  external rollback/replacement of any `localLore` remains visible.
- Replace unconditional `snapshotJson(chat.localLore ?? [])` with a lazy cache
  keyed by chat id plus the current `localLore` array reference. If the array
  reference is unchanged, reuse the previous JSON snapshot; if it changes,
  stringify once and update the cache.
- Prune lazy lore snapshots for chat ids that disappear so deleted chats do
  not leave stale comparison state.
- Preserve the existing hydrated-character globalLore guard: stubbed
  character lorebooks must still not be diffed into deletions.
- For chat metadata, keep the one shared ref-counted watcher. Add a cheap
  no-change path before allocating and replacing full `Map` snapshots for all
  chat/folder rows.
- Acceptable chat-metadata shapes include comparing current row scalar fields
  directly against the previous snapshot and only materializing a new scalar
  clone for rows that changed, or using an explicit metadata invalidation
  token. A generic proxy identity check is not enough because I19 remints
  proxies on unrelated writes.
- A guarded streaming-frame write with no chat/folder metadata change should
  leave previous chat/folder maps untouched and queue no commands.
- Register L28 and L29 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Do not narrow the lorebook watcher to open chats only.
- Guarded writes still make broad dependencies re-run; this slice removes
  wasted per-consumer work after the re-run.
- Rollback and external replacement tests must still catch localLore changes
  in any chat for the watched character.
- Chat metadata/folder metadata patches must remain field-scoped and must not
  overwrite sibling rows.
- Existing rollback suppression and pending-patch coalescing behavior stays
  unchanged.

## Done Criteria

- A lorebook entry keystroke re-stringifies only the changed `localLore`
  collection; unchanged chat arrays reuse their cached snapshot.
- A test proves a non-open chat's externally replaced `localLore` is still
  detected and dispatched.
- A guarded streaming render frame with no metadata changes does not rebuild
  the full per-chat/per-folder scalar maps and queues no patch.
- Real chat/folder metadata edits still dispatch the same patches and
  rollbacks as before.
- L28 and L29 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
