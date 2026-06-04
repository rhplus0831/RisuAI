# Phase 4: Script-Definition Watcher

Status: partial audit gap. The clone-cost slice landed (`2ec1ea40`), but the
Phase 1-5 completion audit found a debounced rollback baseline correctness gap.
One slice. Independent; reuses the Phase 2 chat-metadata watcher's lazy per-row
rollback pattern.

Audit note: [`../phase-1-5-completion-audit.md`](../phase-1-5-completion-audit.md)
found that rapid same-key edits inside the debounce window can roll back to the
intermediate baseline, because `queueReplacement()` preserves
`existing?.previous` but the queued command rollback closes over the latest
dispatch's `previous`. Close that gap and add a failed-command regression before
marking Phase 4 complete again.

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

- [x] The watcher effect no longer clones `DBState.db.characters` / `modules`; a
      streaming token while the panel is open triggers no full characters+modules
      clone. The `currentScriptDefinitionStateSnapshot()` call (and the
      `previousState` baseline) is gone from the effect; the per-key stringify map
      is the only per-fire serialization. The `ensureAllClientScriptDefinitionIds`
      scan stays in the effect: it is an O(scripts) read with no JSON clone and a
      guarded write only on the first fire that finds a missing id, so it is
      separately accounted for (not a whole-collection clone).
- [x] Change detection still fires the same dispatches (per-key stringify
      unchanged); the rollback restores only the changed character's
      `customscript`/`triggerscript` (or the changed module's `regex`/`trigger`)
      via the scoped `ScopedScriptDefinitionRollback`.
- [x] A clone-cost regression test proves the effect fire is O(scripts) not
      O(hydrated corpus) (baseline, script edit, and streaming-token append all
      stay below the ~250 KB hydrated history); `pnpm test` is green.

## Outcome

`watchServerBackedScriptDefinitions` dropped the per-fire (and setup-time)
`currentScriptDefinitionStateSnapshot()` whole-`characters`+`modules` clone. The
effect now reads only `collectScriptDefinitionCollectionSnapshots()` (the
existing per-key scripts/triggers stringify) for change detection and builds the
rollback lazily inside `dispatchWatchedReplacement`, parsing the prior per-key
snapshot string into a single-row `ScopedScriptDefinitionRollback`. A failed
replacement restores only the changed row.

The dispatch functions now accept a `ScriptDefinitionRollback` union
(`ScriptDefinitionStateSnapshot | ScopedScriptDefinitionRollback`), so the rarer
discrete callers (`modules.ts` module-apply and the MCP character/module edits)
keep passing the full snapshot unchanged; `rollbackServerBackedScriptDefinitions`
discriminates on the `'kind'` field and routes scoped rollbacks through the new
`restoreScopedScriptDefinition`. Proven by
`scriptDefinitionBridge.svelte.test.ts` (3 clone-cost + 2 scoped-rollback tests
added; existing baseline tests unchanged).

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
