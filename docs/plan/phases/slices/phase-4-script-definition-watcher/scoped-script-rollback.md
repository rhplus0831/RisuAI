# Scoped Script-Definition Rollback

Status: planned. Phase 4. Independent.

## Scope

Stop the script-definition bridge watcher reading the whole characters array +
modules deeply on every fire. Keep only the small per-key script/trigger stringify
for change detection; build the rollback baseline lazily and scoped at dispatch,
where the changed `characterId`/`moduleId` is already known.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High script-definition watcher finding and the Low co-located stringify
  finding.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:228` - the `$effect` calling
  `currentScriptDefinitionStateSnapshot()` before the early-return guards;
  `previousState`.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:41-47` -
  `currentScriptDefinitionStateSnapshot()` =
  `cloneJsonValue(DBState.db.characters ?? [])` + `cloneJsonValue(DBState.db.modules ?? [])`.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:257-298` -
  `dispatchWatchedReplacement` (knows `characterId`/`moduleId`).
- `src/ts/server/scriptDefinitionBridge.svelte.ts:300` -
  `collectScriptDefinitionCollectionSnapshots` (per-key stringify — keep).

## Target Implementation

- Drop `currentScriptDefinitionStateSnapshot()` / `previousState` from the effect
  body. The effect's only change-detection input becomes
  `collectScriptDefinitionCollectionSnapshots()` (small per-key script/trigger
  JSON strings), which does not read `chat.message`.
- Build the rollback baseline lazily and scoped inside
  `dispatchWatchedReplacement`: snapshot only
  `{ characterId, scripts: clone(character.customscript), triggers:
  clone(character.triggerscript) }` (or `{ moduleId, … }` for the module
  equivalent) at dispatch time, restoring only that one row's scripts/triggers on
  failure.
- The effect must stop *deeply reading* `DBState.db.characters` so a streaming
  token write does not re-invalidate it into another full clone. Tracking the
  per-key snapshot map (strings) instead of the deep array is what removes that
  dependency.
- Optional (the Low finding): cache the per-key snapshot strings and only
  re-stringify the key whose source changed, or move the snapshot into the 250 ms
  debounce window.

## Behavior / Invariants

- Change detection fires the same dispatches; the per-key stringify content is
  unchanged.
- A failed script/trigger replacement restores only the changed character's
  `customscript`/`triggerscript` (or the changed module).
- Output (assembled scripts/triggers) is identical.

## Done When

- The effect performs zero full characters+modules clones per fire, including on a
  streaming-token re-invalidation while the panel is open (clone-cost harness).
- The rollback restores only the changed row; change detection is unchanged.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/scriptDefinitionBridge` (or the bridge suite)
- `pnpm test`
- `pnpm client-thinning:audit`
