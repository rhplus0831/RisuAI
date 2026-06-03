# Scope Lorebook Collector

Status: planned. Phase 6. Independent.

## Scope

Scope the lorebook watcher's change-detection snapshot to the mounted panel
instead of rebuilding a DB-wide lore stringify map on each fire.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Medium lorebook watcher finding.
- `src/ts/server/lorebookBridge.svelte.ts` -
  `collectLorebookCollectionSnapshots` (the all-chats-of-all-characters
  `snapshotJson` loop; the `delayMs` debounce wraps only the dispatch) and
  `watchServerBackedLorebooks` (the mounting `$effect`).
- `src/lib/Setting/lorepreset.svelte`,
  `src/lib/Setting/Pages/Module/ModuleMenu.svelte`, and
  `src/lib/SideBars/LoreBook/LoreBookSetting.svelte` - the mounting panels.
- `src/lib/SideBars/LoreBook/LoreBookData.svelte` - the draft `$effect` that
  writes `cloneJsonValue(draft)` per keystroke (the dependency the collector
  reacts to).

## Target Implementation

- Add an explicit scope option/API to `watchServerBackedLorebooks` (it currently
  only accepts `delayMs`) and pass the scope from each mounting panel.
- Scope by panel: `lorepreset` needs the global `DBState.db.loreBook` list;
  `LoreBookSetting` needs the selected character/open chat lore it is editing;
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

- The collector covers only the mounting panel's collection (global list,
  selected character/open chat, or open module); it no longer iterates every chat
  of every character / every module per fire (clone-cost harness measuring
  entries/bytes per fire).
- An edit within the panel's scope still dispatches; nothing within scope is
  missed.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
