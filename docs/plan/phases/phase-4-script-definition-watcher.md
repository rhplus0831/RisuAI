# Phase 4: Script-Definition Watcher

Status: planned. One slice. Independent; reuses the Phase 0 scoped-rollback
pattern.

Goal: stop the script-definition watcher from taking a full characters+modules
rollback snapshot on every reactive fire. While the panel is open, script/trigger
edits and streaming tokens should not trigger full clones.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the High script-definition watcher finding and the Low co-located stringify
  finding; recommended-remediation step 5.
- `src/ts/server/scriptDefinitionBridge.svelte.ts` -
  `watchServerBackedScriptDefinitions`, `currentScriptDefinitionStateSnapshot`,
  `dispatchWatchedReplacement`, and `collectScriptDefinitionCollectionSnapshots`.
- `src/lib/SideBars/CharConfig.svelte` and
  `src/lib/Setting/Pages/Module/ModuleMenu.svelte` - the mounting panels.

## Slices

- [`scoped-script-rollback.md`](slices/phase-4-script-definition-watcher/scoped-script-rollback.md) -
  keep per-key string snapshots for change detection, and build scoped rollback
  inside `dispatchWatchedReplacement`.

## Exit Criteria

- [ ] The watcher effect no longer clones `DBState.db.characters` / `modules`; a
      streaming token while the panel is open triggers no full characters+modules
      clone. If the ID-ensure scan remains in the effect, account for it
      separately or scope/move it.
- [ ] Change detection still fires the same dispatches (per-key stringify
      unchanged); the rollback restores only the changed character's
      scripts/triggers (or the changed module).
- [ ] A clone-cost regression test proves the effect fire is O(scripts) not
      O(hydrated corpus); `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
