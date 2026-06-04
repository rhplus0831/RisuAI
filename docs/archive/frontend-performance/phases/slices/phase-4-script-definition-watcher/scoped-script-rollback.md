# Scoped Script-Definition Rollback

Status: implemented (`2ec1ea40`). Phase 4. Independent.

## Scope

Stop the script-definition watcher from cloning all characters and modules on
every fire. Keep per-key script/trigger strings for change detection and build
rollback only at dispatch.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../frontend-performance-audit.md) -
  the High script-definition watcher finding and the Low co-located stringify
  finding.
- `src/ts/server/scriptDefinitionBridge.svelte.ts` -
  `watchServerBackedScriptDefinitions`, `currentScriptDefinitionStateSnapshot`,
  `dispatchWatchedReplacement`, and `collectScriptDefinitionCollectionSnapshots`.

## Implemented Shape

- Dropped `currentScriptDefinitionStateSnapshot()` / `previousState` from the
  effect (and the watcher-setup baseline call).
- `collectScriptDefinitionCollectionSnapshots()` is now the effect's only
  change-detection input and its only per-fire serialization.
- Rollback is built inside `dispatchWatchedReplacement` as a single-row
  `ScopedScriptDefinitionRollback`, then routed through
  `restoreScopedScriptDefinition`.
- The dispatch functions take a `ScriptDefinitionRollback` union, so the discrete
  full-snapshot callers (`modules.ts`, MCP) keep working without change.
- `ensureAllClientScriptDefinitionIds()` stays in the effect: it is an
  O(scripts) read (`.some()` per row) with no JSON clone, and a guarded write only
  on the first fire that finds a missing id. The proof is the narrower "zero full
  characters+modules clones" form.
- Not done (deferred Low finding): caching per-key snapshot strings / moving the
  stringify into the debounce window. The per-key stringify is small and bounded;
  reopen only if profiling shows it.

## Behavior / Invariants

- Change detection fires the same dispatches; the per-key stringify content is
  unchanged.
- A failed script/trigger replacement restores only the changed character's
  `customscript`/`triggerscript` (or the changed module).
- Rapid same-key edits inside the debounce window coalesce into one command that
  sends the latest content; on failure it rolls back to the pre-first-edit
  baseline, not the intermediate edit (`c1349966`). The command is a factory fed
  `pending.previous` at fire time, so the preserved first baseline drives the
  rollback.
- Output (assembled scripts/triggers) is identical.

## Done When (met)

- The effect performs zero full characters+modules clones per fire, including on a
  streaming-token re-invalidation while the panel is open (clone-cost harness);
  the remaining ID-ensure scan is separately justified (O(scripts) read, no clone).
- The rollback restores only the changed row; change detection is unchanged.
- Coalesced same-key edits roll back to the pre-first-edit baseline, proven by two
  failed-command regressions (character scripts + module triggers).
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
