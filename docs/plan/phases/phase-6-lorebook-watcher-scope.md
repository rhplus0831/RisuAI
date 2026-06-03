# Phase 6: Lorebook Watcher Scope

Status: planned. One slice. Independent.

Goal: scope the lorebook watcher's snapshot to the mounted panel instead of
rebuilding a DB-wide lore stringify map on each reactive fire. The watcher does
not read `chat.message`, but it still re-fires per lorebook keystroke.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the Medium lorebook watcher finding; recommended-remediation step 7.
- `src/ts/server/lorebookBridge.svelte.ts:427` -
  `collectLorebookCollectionSnapshots` (the DB-wide `snapshotJson` loop).
- `src/ts/server/lorebookBridge.svelte.ts:355` - `watchServerBackedLorebooks` the
  mounting `$effect`.
- `src/lib/Setting/lorepreset.svelte:24`, `src/lib/.../ModuleMenu.svelte:41`,
  `src/lib/.../LoreBookSetting.svelte:41` - the mounting panels (each needs a
  different scope).

## Slices

- [`scope-lorebook-collector.md`](slices/phase-6-lorebook-watcher-scope/scope-lorebook-collector.md) -
  track only the mounted panel's collection: selected character/open chat lore for
  lorebook panels, or the open module's lorebook for module panels.

## Exit Criteria

- [ ] The collector no longer iterates every chat of every character / every
  module per fire; it covers only the mounting panel's collection.
- [ ] Change detection still fires the same dispatches for edits within the
  panel's scope (no missed lorebook change for the open collection).
- [ ] A clone-cost regression test proves the collector is O(panel scope) not
  O(all lore in the DB); `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge` (or the bridge suite)
- `pnpm test`
- `pnpm client-thinning:audit`
