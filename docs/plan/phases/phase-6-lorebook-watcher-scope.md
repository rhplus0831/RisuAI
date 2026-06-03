# Phase 6: Lorebook Watcher Scope

Status: planned. One slice. Independent.

Goal: scope the lorebook bridge watcher's change-detection snapshot to the
mounting panel's collection instead of rebuilding a DB-wide
`JSON.stringify` map of every character's `globalLore` + every chat's `localLore`
across all characters + every module lorebook on each reactive fire. The watcher
does not read `chat.message`, so it is bounded to lore bytes (kilobytes to low
MB), hence medium — but it re-fires per keystroke while a lorebook/module/preset
panel is open and the `delayMs` debounce wraps only the eventual dispatch, not
the snapshot rebuild.

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
  tie the watcher's tracked scope to the mounting panel: a
  `LoreBookSetting`/`lorepreset` session needs only global lorebooks + the
  selected character's `globalLore` + the open chat's `localLore`; a `ModuleMenu`
  session needs only the open module's lorebook. Lowest-risk minimal change: cut
  the unbounded all-chats-of-all-characters `localLore` loop down to the selected
  character's chats and the open module instead of all modules.

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
