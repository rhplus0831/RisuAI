# Slice: Remove Character Trash Single Row

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: L33. Runtime
change.

## Scope

Narrow the normal trash branch of `removeChar` so setting `trashTime` captures
only the targeted character row or field and rolls back only that `trashTime`
edit. Permanent deletion still removes from the collection and may keep the
broader deletion snapshot unless it can be proven safe to narrow separately.

This slice does not change confirmation prompts, permanent delete semantics,
character order repair, or encoder reload signaling.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L33.
- `src/ts/characters.ts`: `removeChar`.
- `src/ts/characterCommands.ts`: `currentCharacterRowSnapshot`,
  `restoreCharacterRow`, `dispatchUpdateCharacter`.
- Existing focused tests:
  `src/ts/characterCommands.test.ts`,
  `src/ts/characters.importChat.test.ts`.

## Target Shape

- In the `type === 'normal'` branch, capture rollback with a stable
  character-id snapshot of the prior `trashTime` value, or the narrowest
  existing row helper if a field helper needs to be added in the same slice.
- Dispatch the `trashTime` patch with that scoped snapshot so a failed server
  command restores only the trashed character's `trashTime`.
- Keep stable-ID restore behavior so rollback survives character reordering or
  index shifts.
- Leave permanent and forced deletion behavior untouched unless tests prove a
  similarly narrow delete snapshot can preserve all semantics.
- Add clone-cost coverage proving the trash branch never clones the whole
  characters array.
- Add forced-failure rollback coverage proving concurrent sibling edits and
  unrelated same-row edits survive a failed trash update.
- Register L33 as `DONE` in the v2 gate with focused clone-cost and rollback
  tests, and flip the L33 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Confirmation prompts run in the same order and still cancel the mutation.
- `trashTime` uses a single timestamp for both the optimistic write and server
  patch.
- Rollback restores the pre-mutation `trashTime` value without replacing other
  fields on the same character.
- `checkCharOrder()` and `requiresFullEncoderReload.state = true` still run
  after a completed mutation.
- Permanent delete rollback is not accidentally weakened by the trash-only
  change.

## Done Criteria

- Normal trash removal captures only one character row.
- A failed trash update restores only `trashTime` and preserves unrelated
  character edits.
- Existing create/update/delete character command tests remain green.
- The v2 gate and active-risk row mark L33 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/characterCommands.test.ts src/ts/characters.importChat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
