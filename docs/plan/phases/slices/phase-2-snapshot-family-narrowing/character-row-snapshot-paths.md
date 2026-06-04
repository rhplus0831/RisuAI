# Character-Row Snapshot Paths

Status: implemented. Phase 2. Depends on the Phase 0 `CharacterRowSnapshot`.

Landed: `setCurrentCharacter` / `setCharacterByIndex` (`database.svelte.ts`) capture
`currentCharacterRowSnapshot(index)` instead of `currentCharacterStateSnapshot()`
and persist through the new `dispatchCompatibleCharacterUpdateScoped`, so a failed
character-field update restores only the target character row (plus the selection
scalars), never the whole characters array. Desc/note `v2Set*` trigger effects
that route through `setCurrentCharacter(char)` inherit the row rollback; lorebook
trigger effects now use the global-lorebook slice's scoped lorebook rollback and
skip the redundant character re-clone. `characterCommands.ts` adds
`*With(rollback)` cores plus the
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
