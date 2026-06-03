# Character-Row Snapshot Paths

Status: planned. Phase 2. Depends on the Phase 0 `CharacterRowSnapshot`.

## Scope

Replace full-characters rollback on character field edits with a single-row
snapshot. Character edits and lorebook-mutating triggers should clone only the
target character row.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High `currentCharacterStateSnapshot` finding and the Low image/emotion
  finding (image/emotion lands in Phase 7).
- `src/ts/characterCommands.ts:57` - `currentCharacterStateSnapshot` and
  `restoreCharacterState`; `dispatchCompatibleCharacterUpdate`.
- `src/ts/storage/database.svelte.ts:968/995` - `setCurrentCharacter` /
  `setCharacterByIndex` (both guarded by `canUseServerCommands()` === true, so the
  clone always fires).
- `src/ts/process/triggers.ts:2409/2445/2212/2262/2932/2989/3012/3043` - the
  `v2SetCharacterDesc`/`v2SetReplaceGlobalNote`/`v2SetLorebook*` callers of
  `setCurrentCharacter` (per-send when the character's trigger uses these
  effects).
- Lower-frequency callers: `setCharacterSupaMemory`,
  `characterCards.ts:136/369/648/1752`, plugins/MCP, `characters.ts:904`
  (trashTime).

## Target Implementation

- Add rollback through `currentCharacterRowSnapshot(index/characterId)` /
  `restoreCharacterRow()` from Phase 0.
- Route `setCurrentCharacter` / `setCharacterByIndex` /
  `dispatchCompatibleCharacterUpdate` (character-FIELD updates) through it.
- Keep `currentCharacterStateSnapshot` only for
  `dispatchCreateCharacter` / `dispatchDeleteCharacter` /
  `dispatchReorderCharacters`.
- The lower-frequency callers share the same fix (mechanical reuse); the
  image/emotion handlers (`characters.ts:138...`) are narrowed in Phase 7 reusing
  this same `CharacterRowSnapshot`.

## Behavior / Invariants

- `dispatchCompatibleCharacterUpdate` keeps its `prepareCompatibleCharacterUpdate`
  diff over the single character (`CHARACTER_PATCH_EXCLUDED_KEYS` already excludes
  `chats`); only the rollback baseline narrows.
- A failed character-field command restores only that character row and scalars.

## Done When

- `setCurrentCharacter`/`setCharacterByIndex` and the `v2Set*` trigger callers
  capture a single-character-row snapshot; none clones every character (clone-cost
  harness).
- The full-array snapshot remains only on create/delete/reorder.
- Rollback-correctness test proves a failed field edit restores only the target
  character.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/process/triggers`
- `pnpm test`
- `pnpm client-thinning:audit`
