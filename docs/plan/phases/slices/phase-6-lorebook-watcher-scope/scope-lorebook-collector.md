# Scope Lorebook Collector

Status: planned. Phase 6. Independent.

## Scope

Scope the lorebook watcher's change-detection snapshot to the mounted panel
instead of rebuilding a DB-wide lore stringify map on each fire.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Medium lorebook watcher finding.
- `src/ts/server/lorebookBridge.svelte.ts:427` -
  `collectLorebookCollectionSnapshots` (the all-chats-of-all-characters
  `snapshotJson` loop; the `delayMs` debounce wraps only the dispatch).
- `src/ts/server/lorebookBridge.svelte.ts:355` - `watchServerBackedLorebooks` the
  mounting `$effect`.
- `src/lib/Setting/lorepreset.svelte:24`, `src/lib/.../ModuleMenu.svelte:41`,
  `src/lib/.../LoreBookSetting.svelte:41` - the mounting panels.
- `src/lib/Setting/LoreBookData.svelte` - the draft `$effect` that writes
  `cloneJsonValue(draft)` per keystroke (the dependency the collector reacts to).

## Target Implementation

- Tie the watcher's tracked scope to the mounted panel. `LoreBookSetting` /
  `lorepreset` need global lorebooks plus the selected character/open chat lore.
  `ModuleMenu` needs only the open module's lorebook.
- Lowest-risk minimal change: cut the unbounded all-chats-of-all-characters
  `localLore` loop down to the chats of the selected character, and the open
  module instead of all modules, in `collectLorebookCollectionSnapshots`.
- Keep `snapshotJson`; this slice reduces entries per fire, not per-entry cost.

## Behavior / Invariants

- Change detection still fires the same dispatches for edits within the panel's
  scope (no missed change for the open collection).
- The debounced dispatch is unchanged.
- Lorebook persistence and projection are unaffected (this is a change-detection
  cost only).

## Done When

- The collector covers only the mounting panel's collection (selected character's
  chats + open module, or the panel's narrower scope); it no longer iterates every
  chat of every character / every module per fire (clone-cost harness measuring
  entries/bytes per fire).
- An edit within the panel's scope still dispatches; nothing within scope is
  missed.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge` (or the bridge suite)
- `pnpm test`
- `pnpm client-thinning:audit`
