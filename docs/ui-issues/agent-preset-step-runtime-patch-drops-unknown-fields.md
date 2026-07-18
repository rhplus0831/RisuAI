# Agent preset step runtime patch drops unknown runtime fields

## Summary

The step editor drawer rebuilds a step's `runtime` object from exactly the
four fields it renders. When any runtime value changes, the sparse step patch
carries that whole rebuilt object, and the server replaces `runtime`
wholesale. Runtime fields the drawer does not know about — today
`structuredOutputStrict`, which the schema accepts and normalization
preserves — are silently deleted by any runtime edit.

## Location

- `src/lib/Setting/Pages/AgentPresetEditorDrawer.svelte:305-311` — drawer
  rebuilds `runtime` from its four rendered fields.
- `src/lib/Setting/Pages/agentPresetStepPatch.ts` — object-level diff puts the
  whole `runtime` object into the patch when any field differs.
- `server/fastify/src/commands/agentPresets.ts:738,759-781` — `applyStepPatch`
  replaces `runtime` wholesale; the schema accepts `structuredOutputStrict`.
- `src/ts/agentPresetRecords.ts:473-474` — normalization preserves the field,
  so imported/API-written values survive until a drawer edit.

## Trigger

1. A step has `runtime.structuredOutputStrict` set via API or import.
2. The user edits any runtime number in the drawer and saves.

## Expected behavior

Untouched runtime fields survive a sparse patch.

## Actual behavior

The patch carries the drawer's four-field runtime object; the server replaces
the whole object, deleting `structuredOutputStrict`. (Materializing drawer
defaults for absent numeric fields is behavior-neutral — execution defaults in
`agentPresetExecution.ts:22-25,1002-1006` are identical.)

## Underlying cause

Whole-object patch granularity for a record that can legally contain fields
outside the editor's projection.

## Affected data flow

1. **UI:** runtime edit → `stepSnapshotForSave` builds a four-field runtime.
2. **Client state:** step patch diff includes the rebuilt object.
3. **Request:** step PATCH → server replaces `runtime` wholesale.
4. **Persistence:** unknown field gone; next read propagates the loss to all
   clients.

## Severity and likely user impact

**Low.** `structuredOutputStrict` is currently consumed nowhere in execution,
so today this is schema-level data loss only; it becomes user-visible the day
that flag (or any newly added runtime field) is consumed. Mechanics medium
confidence, impact low.

## Recommended fix

Preserve unknown/unedited runtime keys when building `stepSnapshotForSave`
(spread `activeStep.runtime` before overlaying the four edited fields), or
diff `runtime` per-key on the server.

## Test gap

A step-patch test seeding `runtime.structuredOutputStrict`, editing one
runtime number through the drawer's save path, and asserting the flag
survives the round-trip.
