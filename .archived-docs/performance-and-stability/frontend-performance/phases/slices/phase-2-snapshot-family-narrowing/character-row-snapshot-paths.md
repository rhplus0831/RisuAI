# Character-Row Snapshot Paths

Status: implemented. Phase 2. Depends on the Phase 0 `CharacterRowSnapshot`.

Implemented: `setCurrentCharacter` / `setCharacterByIndex` capture
`currentCharacterRowSnapshot(index)` and persist through scoped character
dispatchers that roll back via `restoreCharacterRow`. Trigger desc/note edits
inherit that row rollback; lorebook triggers use the Phase 2 scoped lorebook path.
Proofs in `characterCommands.test.ts` cover sibling-isolation rollback and clone
cost. Image/emotion, trash/Realm/import/card, plugins/MCP, and other
lower-frequency callers remain broad until a focused slice narrows them.

## Scope

Replace full-characters rollback on character field edits with a single-row
snapshot. Character edits and lorebook-mutating triggers should clone only the
target character row.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../frontend-performance-audit.md) -
  the High `currentCharacterStateSnapshot` finding and the Low image/emotion
  finding (image/emotion lands in Phase 7).
- `src/ts/characterCommands.ts` - `currentCharacterStateSnapshot` and
  `restoreCharacterState`; `dispatchCompatibleCharacterUpdate`.
- `src/ts/storage/database.svelte.ts` - `setCurrentCharacter` /
  `setCharacterByIndex` (both guarded by `canUseServerCommands()` === true, so the
  clone always fires).
- `src/ts/process/triggers.ts` - `v2SetCharacterDesc` and
  `v2SetReplaceGlobalNote` callers of `setCurrentCharacter`; lorebook triggers
  are covered by the global-lorebook slice.
- Lower-frequency callers: `setCharacterSupaMemory`, `characterCards.ts`,
  plugins/MCP, and `characters.ts` trash/Realm/import/card paths.

## Implemented Shape

- `setCurrentCharacter` and `setCharacterByIndex` capture
  `currentCharacterRowSnapshot(index)` and dispatch via
  `dispatchCompatibleCharacterUpdateScoped`.
- `dispatchUpdateCharacterScoped` / `dispatchCompatibleCharacterUpdateScoped`
  roll back through `restoreCharacterRow`; broad dispatch remains for
  create/delete/reorder and deferred lower-frequency callers.
- Trigger `v2Set*` callers inherit the row snapshot through
  `setCurrentCharacter(char)`.

## Behavior / Invariants

- `dispatchCompatibleCharacterUpdate` keeps its `prepareCompatibleCharacterUpdate`
  diff over the single character (`CHARACTER_PATCH_EXCLUDED_KEYS` already excludes
  `chats`); only the rollback baseline narrows.
- A failed character-field command restores only that character row and scalars.

## Proven

- Clone-cost coverage proves `setCharacterByIndex` does not serialize a large
  sibling transcript.
- Rollback-correctness coverage proves a failed scoped character update restores
  only the target row.

## Validation

- `pnpm test -- src/ts/characterCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
