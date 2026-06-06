# Slice: Preset Rollback

Phase: [5](../../phase-5-client-write-path-correctness.md). Finding: L21.
Client optimistic-write rollback change.

## Scope

Add real rollback handling to preset mutations routed through
`runPresetCommand`. A failed preset command should restore preset collection
state and, for `setPreset`-driven operations, any scalar settings copied from
the selected preset.

This slice owns the `runPresetCommand` signature change and all preset-command
callers in `src/ts/storage/database.svelte.ts`. It does not change preset
normalization, import formats, or server command validation.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L21.
- `src/ts/storage/database.svelte.ts`:
  `runPresetCommand`, `normalizeBotPresetIds`, `selectedPresetClientId`,
  `setPreset`, preset save/create/import/update/delete/reorder/select callers,
  `botPresets`, and `botPresetsId`.
- `src/ts/storage/database.svelte.test.ts`: preset command behavior and
  optimistic state tests.
- `src/ts/storage/database.importPreset.test.ts`: imported preset coverage.
- `src/lib/Setting/botpreset.svelte` and bot settings callers for user-facing
  preset operations.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  `docs/plan/active-risk-analysis.md` for L21 proof registration.

## Target Shape

- Change `runPresetCommand` to accept a rollback callback or rollback snapshot
  parameter, and pass it into the existing optimistic command runner.
- Update every `runPresetCommand` caller in `database.svelte.ts`.
- Snapshot `botPresets` and `botPresetsId` before each optimistic preset
  mutation.
- For callers that invoke `setPreset`, also snapshot the affected scalar
  settings that `setPreset` copies from the preset into the live database.
- On command failure, restore:
  `botPresets`,
  `botPresetsId`,
  generated or preserved preset ids,
  and any affected `setPreset` scalar settings.
- Keep rollback narrowly scoped to preset state plus those scalar settings.
  Do not restore unrelated database fields.
- Add tests for failed save/create/update/delete/reorder/select paths, with at
  least one `setPreset` failure proving scalar settings are restored.
- Register L21 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the L21 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Successful preset commands preserve current behavior and response handling.
- Failed preset commands restore the exact pre-mutation preset collection and
  selected index.
- Failed `setPreset`-driven commands restore both preset selection and copied
  scalar settings.
- Rollback does not overwrite unrelated settings, characters, chats, modules,
  lorebooks, or plugin storage.
- Preset id normalization still runs where it did before.

## Done Criteria

- Every `runPresetCommand` caller supplies rollback coverage.
- A failed preset create/update/delete/reorder restores `botPresets` and
  `botPresetsId`.
- A failed preset select or delete that invokes `setPreset` restores the
  affected scalar settings.
- Successful preset flows remain unchanged.
- L21 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/storage/database.svelte.test.ts \
  src/ts/storage/database.importPreset.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
