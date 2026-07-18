# Preset row mutations drop persistence outcomes

## Summary

Creating, deleting, duplicating, renaming, and reordering model/prompt presets
runs through helpers that produce a rich accepted/queued/failed outcome — but
the two management surfaces discard it. On server rejection, the internal
rollback silently resurrects a deleted preset, removes a created one, snaps the
order back, or reverts a rename, with no alert or status. Queued (offline)
outcomes and replay discards are equally invisible. The select and
prompt-preset rename flows in the same modal do surface saving/queued/failed
states, which makes the silent paths read as confirmed successes.

## Location

- `src/lib/Setting/botpreset.svelte:221-230` (`createNewPreset`), `:232-249`
  (`removeModernPreset`), `:193-219` (drag reorder) — fire-and-forget calls.
- `src/lib/Setting/botpreset.svelte:101-149` — the contrast: rename
  (`updatePresetName`/`settlePresetRename`, `showPresetRenameFailure` at
  145-149) surfaces saving/queued/failed with alerts — the prior
  "reconcile preset rename drafts" fix.
- `src/lib/Setting/botpreset.svelte:329-330` — the global model-preset picker
  renders `ModelPresetList` instead of that fixed rename path.
- `src/lib/Setting/Pages/Model/ModelPresetList.svelte:82-88` — `renamePreset`
  discards `updateModelPreset`'s returned `Promise<PresetMutationOutcome>`;
  `:59-70,90-104` — create/duplicate/delete are fire-and-forget void calls.
- `src/ts/storage/database.svelte.ts:5522-5546` — `updateModelPreset` returns
  accepted/queued/failed with a settlement; `:5548-5646`
  (`deleteModelPreset`), `:5480-5520` (`createModelPreset`), `:5702-5761`
  (`reorderModelPresets`) return void even though the internal
  `dispatchPresetRowMutation` produces an outcome.
- `src/ts/storage/database.svelte.ts:2318-2402` — `dispatchPreparedPresetMutation`'s
  `rollbackOnce` has no user-facing output; `:2026-2044` — rollback reinserts
  the deleted row.

## Trigger

In the preset picker modal (prompt presets, or model presets via the global
picker / Model settings), delete a preset (confirming both prompts), create,
duplicate, rename (model presets), or drag-reorder — while the server rejects
the command (revision conflict, validation) or while offline (queued, later
replay-discarded).

## Expected behavior

Failures surface an error and/or per-row status — the pattern already used by
preset rename in `botpreset`, global-lorebook delete, chat delete, and
character removal. Queued outcomes show the queued notice; replay discards are
reported.

## Actual behavior

The optimistic change appears (row removed/added/renamed/reordered), the server
rejects, the rollback restores the previous state — the deleted preset
reappears, the new one vanishes, the order snaps back, the old name returns —
with no message. Offline-queued outcomes show nothing; a later replay discard
silently drops the change.

## Underlying cause

The row-mutation helpers expose no outcome for delete/create/reorder (void
wrappers around an outcome-producing dispatcher), and `ModelPresetList` ignores
the outcome that rename does return. No `presetDeleteFailed`-style language
keys exist.

## Affected data flow

1. Row action → confirm dialog(s) → optimistic collection splice/reorder +
   selection re-point.
2. Durable intent staged → `DELETE/POST/PATCH /model-presets/...` (or prompt
   preset equivalents).
3. Server rejects → `rollbackOnce` restores the row/order/selection.
4. UI shows the restored state with zero explanation; outcome/settlement never
   consumed.

## Severity and likely user impact

**Medium.** Confidence: high. Classic "UI shows success though the server
rejected": deleted presets resurrect, new presets evaporate, renames revert —
on the primary preset-management surfaces.

## Recommended fix

Make `deleteModelPreset`/`deletePromptPreset`/`createModelPreset`/
`reorder*Presets` return `Promise<PresetMutationOutcome>` (the internal
dispatcher already produces it), and consume outcomes in both `botpreset` and
`ModelPresetList` with per-row saving/queued/error state plus alerts, mirroring
the existing rename settlement handling. Add the missing language keys.

## Test gap

Component tests that reject a delete/create/reorder/rename at the transport and
assert a visible error state; a queued case asserting the queued notice and a
replay-discard alert.
