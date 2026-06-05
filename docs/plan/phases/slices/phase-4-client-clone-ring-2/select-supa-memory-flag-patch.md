# Slice: Select Supa Memory Flag Patch

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: L34. Runtime
change.

## Scope

When character selection auto-enables Hypa V3 memory, patch only the selected
character's `supaMemory` flag instead of cloning and sending the full
character row through `setCharacterByIndex`.

This slice does not change Hypa V3 preset semantics, memory generation,
selection state, or manual character editing.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L34.
- `src/ts/stores.svelte.ts`: `selectedCharID.subscribe` and
  `alwaysToggleOn` branch.
- `src/ts/storage/database.svelte.ts`: `setCharacterByIndex`.
- `src/ts/characterCommands.ts`: field patch and scoped rollback helpers.
- Existing focused tests:
  `src/ts/characterCommands.test.ts`,
  `src/ts/stores.modulesEffect.svelte.test.ts`.

## Target Shape

- Replace the async `setCharacterByIndex(selId, { ...char, supaMemory: true })`
  path with a targeted `supaMemory: true` character patch.
- Capture only the stable character ID and previous `supaMemory` value for
  rollback, adding a tiny field restore helper if one does not already exist.
- Do nothing when Hypa V3 is disabled, the active preset does not have
  `alwaysToggleOn`, the selected character is missing, or `char.supaMemory` is
  already truthy.
- Add clone-cost coverage proving the selection subscriber does not clone the
  full character row or characters array for the one-flag patch.
- Add behavior and rollback tests proving the flag is applied once and a
  failed command restores only that flag/row while preserving sibling edits.
- Register L34 as `DONE` in the v2 gate with focused clone-cost and rollback
  tests, and flip the L34 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Selection still updates `selIdState.selId` synchronously.
- The auto-enable write must not fire repeatedly for a character that already
  has `supaMemory`.
- The targeted patch and rollback must preserve all other character fields,
  including chats, lore, modules, and images.
- Failure rollback must not change the selected character ID.

## Done Criteria

- Auto-enabling `supaMemory` issues a one-field character patch.
- The clone-cost test proves no whole-row or whole-array clone is required for
  the patch path.
- Forced-failure rollback restores only `supaMemory`, preserving sibling
  character edits, same-row unrelated edits, and selection.
- The v2 gate and active-risk row mark L34 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/characterCommands.test.ts src/ts/stores.modulesEffect.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
