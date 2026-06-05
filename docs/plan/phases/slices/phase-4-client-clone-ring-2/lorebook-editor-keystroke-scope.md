# Slice: Lorebook Editor Keystroke Scope

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: K4. Runtime
change.

## Scope

Stop lorebook entry typing from cloning and dispatching the whole collection
on every keystroke. The v1 residual narrowed the watcher and rollback helpers,
but the editor still clones the collection for each field edit flowing from
`LoreBookData` into `LoreBookList`.

This slice does not change drag/drop reorder behavior, folder moves,
collection-level replace commands, token counting, or lorebook activation
semantics.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  K4 under Known-Item Overlaps.
- `src/lib/SideBars/LoreBook/LoreBookList.svelte`: `cloneLoreBooks`,
  `update*LoreValue`, `update*LoreCollection`.
- `src/lib/SideBars/LoreBook/LoreBookData.svelte`: `draft` propagation,
  `updateCollection`, `onCollectionChange`.
- `src/ts/server/lorebookBridge.ts` and
  `src/ts/server/lorebookBridge.svelte.ts`: scoped lorebook snapshots and
  server dispatch.
- Existing focused tests:
  `src/ts/server/lorebookBridge.test.ts`,
  `src/ts/server/lorebookBridge.svelte.test.ts`.

## Target Shape

- Route per-entry field edits through an entry-scoped update path or a
  debounced collection replacement that clones only the edited entry while the
  user is typing.
- Keep collection-level operations, such as reorder, folder moves, create, and
  delete, on the existing collection replacement path when they genuinely need
  collection context.
- Preserve local draft responsiveness: keystrokes should update the visible
  editor immediately even if server writes are debounced.
- On debounce settle or blur, dispatch the same final server write that the
  old path would have produced for the collection.
- Add clone-cost coverage proving typing into one entry no longer clones the
  whole collection per keystroke.
- Add behavior coverage proving the settled server write contains the final
  edited entry and reorder/delete operations still behave as collection-level
  writes.
- Register K4 as `DONE` in the v2 gate with focused clone-cost and behavior
  tests, and flip the K4 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- A failed server write must roll back only the scoped collection or entry
  represented by the command, preserving unrelated character/chat/global
  lorebook edits.
- Entry IDs, folder membership, activation flags, and mode-specific fields
  must remain unchanged unless edited by the user.
- Token counting debounce and expensive detail work should not be made more
  eager by the write debounce.
- Drag/drop Sortable DOM reconciliation remains stable.

## Done Criteria

- Typing a field in one lorebook entry does not clone the whole collection per
  keystroke.
- The final settled server write is equivalent to the old collection update
  for the edited entry.
- Reorder, folder move, create, and delete tests still cover the collection
  path.
- The v2 gate and active-risk row mark K4 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
