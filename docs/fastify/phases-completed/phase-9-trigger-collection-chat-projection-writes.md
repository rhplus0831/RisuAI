# Phase 9 - Trigger Collection/Chat Projection Writes Closeout

Date: 2026-05-27

## Finding

`runTrigger` in `src/ts/process/triggers.ts` had seven trigger data
effects that wrote the live `DBState.db` projection directly instead of
routing through a typed command. Under the server-backed projection
guard the writes threw `TypeError`.

## Fix

### globalLore effects (6 sites)

`v2ModifyLorebook`, `v2SetLorebookActivation`, `v2CreateLorebook`,
`v2ModifyLorebookByIndex`, `v2DeleteLorebookByIndex`, and
`v2SetLorebookAlwaysActive` all mutated `char.globalLore` (the
clone) and then wrote
`db.characters[selectedCharId].globalLore = char.globalLore` (the
guard violation).

Each site now:
1. Takes a `currentLorebookStateSnapshot()` before the projection
   write.
2. Calls `setCurrentCharacter(char)` which wraps the projection
   write in `withTrustedServerProjectionWrite`.
3. Dispatches `dispatchReplaceCharacterLorebooks` with the
   character's `chaId`, the updated entries, and the snapshot for
   rollback.

`globalLore` is in `CHARACTER_PATCH_EXCLUDED_KEYS`, so
`dispatchCompatibleCharacterUpdate` (inside `setCurrentCharacter`)
correctly skips it — the dedicated lorebook command handles
persistence.

### v2SetAuthorNote (1 site)

Previously wrote
`currentCharacter.chats[chatPage].note = value` and
`db.characters[selectedCharId].chats[chatPage].note = value` (the
guard violation).

Now:
1. Takes a `currentChatStateSnapshot()` before mutation.
2. Uses `withTrustedServerProjectionWrite` to get the live
   (un-proxied) character and write the note on the chat slot.
3. Dispatches `dispatchUpdateChat` with `{ note: value }` and the
   snapshot for rollback.

## Regression tests

Extended `src/ts/process/__tests__/triggers.projectionGuard.test.ts`
with five new cases (7 total):
- `v2ModifyLorebook` routes through character lorebook PUT
- `v2CreateLorebook` routes through character lorebook PUT
- `v2DeleteLorebookByIndex` routes through character lorebook PUT
- `v2SetLorebookAlwaysActive` routes through character lorebook PUT
- `v2SetAuthorNote` routes through chat PATCH

Each test enables the projection guard, fires the trigger via
`runTrigger`, asserts no throw, and verifies the correct command
endpoint was hit.

## Verification

- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 70 files, 754 passed, 4 skipped.
- `pnpm api:test`: 68 files, 1217 passed.
- `pnpm build`: passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser`: 1 browser smoke test passed.
