# Character-Row Snapshot Paths

Status: implemented. Phase 2. Depends on the Phase 0 `CharacterRowSnapshot`.

Landed: `setCurrentCharacter` / `setCharacterByIndex` (`database.svelte.ts`) capture
`currentCharacterRowSnapshot(index)` instead of `currentCharacterStateSnapshot()`
and persist through the new `dispatchCompatibleCharacterUpdateScoped`, so a failed
character-field update restores only the target character row (plus the selection
scalars), never the whole characters array. Because the `v2Set*` lorebook/desc/note
trigger effects all route through `setCurrentCharacter(char)`, they inherit the
narrow rollback automatically (the global-lorebook slice additionally drops the
redundant re-clone). `characterCommands.ts` adds `*With(rollback)` cores plus the
scoped exports `dispatchUpdateCharacterScoped` / `dispatchCompatibleCharacterUpdateScoped`
(rolling back via `restoreCharacterRow`); the broad
`dispatchUpdateCharacter` / `dispatchCompatibleCharacterUpdate` stay for the
create/delete/reorder and image/emotion (Phase 7) call sites. Proof:
`characterCommands.test.ts` "Phase 2 character-row scoped dispatch" — a failed
`dispatchCompatibleCharacterUpdateScoped` restores only the target row (sibling
concurrent edit survives), and `setCharacterByIndex` under clone instrumentation
never serializes the large sibling transcript.

Deferred (mechanical reuse, out of this slice): the image/emotion handlers in
`characters.ts` (Phase 7) and the low-frequency `trashTime` / `realmId` field-edit
callers still hold the broad snapshot.

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
- First update `dispatchUpdateCharacter` /
  `dispatchCompatibleCharacterUpdate` to accept a narrow snapshot+rollback pair,
  or add narrow variants. The current compatible-update path still takes
  `CharacterStateSnapshot` and defaults to `restoreCharacterState()`.
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
