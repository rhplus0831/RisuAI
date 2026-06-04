# Phase 4: Script-Definition Watcher

Status: implemented. The clone-cost slice landed (`2ec1ea40`) and the debounced
rollback baseline gap the Phase 1-5 completion audit found is now closed
(`c1349966`). One slice. Independent; reuses the Phase 2 chat-metadata watcher's
lazy per-row rollback pattern.

Audit note (resolved):
[`../phase-1-5-completion-audit.md`](../phase-1-5-completion-audit.md) found that
rapid same-key edits inside the debounce window could roll back to the
intermediate baseline, because `queueReplacement()` preserved `existing?.previous`
but the queued command rollback closed over the latest dispatch's `previous`. The
fix makes the pending command a factory that receives the rollback baseline at
fire time, and the debounce timer passes `pending.previous`, so a failed
coalesced command restores the pre-first-edit slice. Covered by two failed-command
regressions (character scripts + module triggers).

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
- [x] Debounced same-key edits coalesce into one command that sends the latest
      content, and a failed coalesced command rolls the changed row back to the
      pre-first-edit baseline (not the intermediate edit). Proven by two
      failed-command regressions (character scripts + module triggers).

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
`scriptDefinitionBridge.svelte.test.ts` (3 clone-cost + 2 scoped-rollback +
2 debounced-baseline tests added; existing baseline tests unchanged).

The debounce coalescing follow-up (`c1349966`) makes
`PendingCollectionReplacement.command` a factory that receives the rollback
baseline at fire time; `queueReplacement` still keeps the first dispatch's
baseline (`existing?.previous ?? previous`) and the debounce timer now calls
`pending.command(pending.previous)`, so the coalesced final command rolls back to
the pre-first-edit value rather than the intermediate edit it superseded.

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
