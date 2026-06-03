# Phase 4: Script-Definition Watcher

Status: planned. One slice. Independent; reuses the Phase 0 scoped-rollback
pattern.

Goal: stop the script-definition watcher from deep-reading characters and modules
on every reactive fire. While the panel is open, script/trigger edits and
streaming tokens should not trigger full clones.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the High script-definition watcher finding and the Low co-located stringify
  finding; recommended-remediation step 5.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:228` - the `$effect` calling
  `currentScriptDefinitionStateSnapshot()` before the early-return guards.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:41-47` -
  `currentScriptDefinitionStateSnapshot()` (full characters + modules clone).
- `src/ts/server/scriptDefinitionBridge.svelte.ts:257-298` -
  `dispatchWatchedReplacement` (already knows the changed `characterId`/`moduleId`).
- `src/ts/server/scriptDefinitionBridge.svelte.ts:300` -
  `collectScriptDefinitionCollectionSnapshots` (per-key script/trigger stringify,
  the cheap change-detection that stays).
- `src/lib/SideBars/CharConfig.svelte:157`, `src/lib/.../ModuleMenu.svelte:42` -
  the mounting panels.

## Slices

- [`scoped-script-rollback.md`](slices/phase-4-script-definition-watcher/scoped-script-rollback.md) -
  keep per-key string snapshots for change detection, and build scoped rollback
  inside `dispatchWatchedReplacement`.

## Exit Criteria

- [ ] The watcher effect no longer reads `DBState.db.characters` / `modules`
  deeply; a streaming token while the panel is open triggers no full
  characters+modules clone.
- [ ] Change detection still fires the same dispatches (per-key stringify
  unchanged); the rollback restores only the changed character's
  scripts/triggers (or the changed module).
- [ ] A clone-cost regression test proves the effect fire is O(scripts) not
  O(hydrated corpus); `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge` (or the bridge suite)
- `pnpm test`
- `pnpm client-thinning:audit`
