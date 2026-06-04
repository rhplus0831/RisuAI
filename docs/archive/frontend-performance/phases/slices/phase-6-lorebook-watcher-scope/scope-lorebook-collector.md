# Scope Lorebook Collector

Status: implemented (`c6dd103c`). Phase 6. Independent.

## Scope

Scope the lorebook watcher's change-detection snapshot to the mounted panel
instead of rebuilding a DB-wide lore stringify map on each fire.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../../../frontend-performance-audit.md) -
  the Medium lorebook watcher finding.
- `src/ts/server/lorebookBridge.svelte.ts` -
  `collectLorebookCollectionSnapshots` (the all-chats-of-all-characters
  `snapshotJson` loop; the `delayMs` debounce wraps only the dispatch) and
  `watchServerBackedLorebooks` (the mounting `$effect`).
- `src/ts/server/lorebookBridge.svelte.ts` -
  `hydratedCharacterLorebooks` / `isCharacterLorebookHydrated`; the current
  no-data-loss guard only snapshots hydrated character `globalLore`.
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
- Preserve the hydrated-character lorebook registry: never persist re-stubbed or
  never-hydrated character `globalLore`.

## Behavior / Invariants

- Change detection still fires the same dispatches for edits within the panel's
  scope (no missed change for the open collection).
- The debounced dispatch is unchanged.
- Lorebook persistence and projection are unaffected (this is a change-detection
  cost only).
- The existing no-data-loss invariant for character `globalLore` stubs remains
  intact.

## Done When

- The collector covers only the mounting panel's collection (global list,
  selected character/open chat, or open module); it no longer iterates every chat
  of every character / every module per fire (clone-cost harness measuring
  entries/bytes per fire).
- An edit within the panel's scope still dispatches; nothing within scope is
  missed.
- Existing character-lorebook hydration / no-data-loss tests stay green.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Implementation (`c6dd103c`)

- Added `LorebookWatchScope` (`all | global | character | module`) to
  `watchServerBackedLorebooks`; `collectLorebookCollectionSnapshots(scope)`
  branches on it. The `all` branch is byte-for-byte the original whole-DB scan
  and remains the default, so callers without a narrower scope (and the
  no-data-loss tests) are unchanged.
- Panels pass their scope: `lorepreset` and global-mode `LoreBookSetting` →
  `global`; character-mode `LoreBookSetting` → `character`; `ModuleMenu` →
  `module` (its effect reads `currentModule.id`, restarting the watcher with a
  fresh baseline when a different module opens).
- The `character` scope reads a `selectedCharMirror` `$state` (fed by a
  `selectedCharID.subscribe`) rather than a bare `get()`, so the effect re-runs
  and re-subscribes to the newly selected character on a switch — the first edit
  to the new character is never dropped. `LoreBook` is mounted unkeyed in
  `CharConfig`, so the watcher does not remount on a switch; the mirror is what
  keeps it correct.
- The hydrated-character no-data-loss invariant is preserved (the per-character
  helper still snapshots `globalLore` only when hydrated).

Regression coverage in `lorebookBridge.svelte.test.ts`: each scope collects only
its panel's keys, `all` still scans the whole DB, a scoped fire performs far
fewer snapshot clones (`withCloneInstrumentation`), and a character-scoped
watcher ignores sibling/cross-scope edits while re-subscribing after a switch.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
  (15 tests: 4 no-data-loss + 4 Phase 0 + 7 Phase 6).
- `pnpm test` (1022 passed / 4 skipped).
- `pnpm client-thinning:audit` (green).
