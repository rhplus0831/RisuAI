# Phase 6: Lorebook Watcher Scope

Status: implemented (`c6dd103c`). One slice. Independent.

Goal: scope the lorebook watcher's snapshot to the mounted panel instead of
rebuilding a DB-wide lore stringify map on each reactive fire. The watcher does
not read `chat.message`, but it still re-fires per lorebook keystroke.

## Source Anchors

- [`../../../frontend-performance-audit.md`](../../../frontend-performance-audit.md) -
  the Medium lorebook watcher finding; recommended-remediation step 7.
- `src/ts/server/lorebookBridge.svelte.ts` -
  `collectLorebookCollectionSnapshots` (the DB-wide `snapshotJson` loop) and
  `watchServerBackedLorebooks` (the mounting `$effect`).
- `src/lib/Setting/lorepreset.svelte`,
  `src/lib/Setting/Pages/Module/ModuleMenu.svelte`, and
  `src/lib/SideBars/LoreBook/LoreBookSetting.svelte` - the mounting panels (each
  needs a different scope).

## Slices

- [`scope-lorebook-collector.md`](slices/phase-6-lorebook-watcher-scope/scope-lorebook-collector.md) -
  add a scope option/API to `watchServerBackedLorebooks` and track only the
  mounted panel's collection: global lorebooks for `lorepreset`, selected
  character/open chat lore for `LoreBookSetting`, or the open module's lorebook
  for `ModuleMenu`.

## Exit Criteria

- [x] The collector no longer iterates every chat of every character / every
      module per fire; it covers only the mounting panel's collection
      (`LorebookWatchScope` + scoped `collectLorebookCollectionSnapshots`).
- [x] Change detection still fires the same dispatches for edits within the
      panel's scope (no missed lorebook change for the open collection); the
      `character` scope re-subscribes on a switch via `selectedCharMirror`.
- [x] A clone-cost regression test proves the collector is O(panel scope) not
      O(all lore in the DB); `pnpm test` is green (1022/4).

## Validation

- `pnpm test -- src/ts/server/lorebookBridge.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
