# Character removal actions finish before persistence

## Summary

Character trash, restore, and permanent-delete actions optimistically update
the shared character catalog but do not await or report the Fastify mutation.
`removeChar()` is declared async, yet its Promise covers only confirmation and
local dispatch; it clears the per-character pending guard before the server
request settles. Restore is fully fire-and-forget.

The command owners already retain retryable writes and narrowly roll back
terminal failures. The initiating controls cannot distinguish either case from
accepted persistence, so a character can silently move back between the active
and trash lists or reappear after an apparent permanent deletion.

## Location

- `src/lib/Others/GridCatalog.svelte:115-136` implements restore.
- `src/lib/Others/GridCatalog.svelte:257-299,309-353` renders active trash,
  restore, and permanent-delete controls.
- `src/lib/SideBars/CharConfig.svelte:1770-1782` invokes the same soft-delete
  helper from the character editor.
- `src/ts/characters.ts:1275-1317` implements `removeChar` and its pending set.
- `src/ts/characterCommands.ts:1105-1149,1346-1378` dispatches character PATCH
  and DELETE mutations.
- `src/ts/characterCommands.test.ts:3240-3293` demonstrates retained soft
  delete, and `src/ts/characterCommands.test.ts:634-700` covers failed permanent
  delete rollback.
- `src/ts/server/commands.ts:3358-3372,3405-3424` sends the client commands.
- `server/fastify/src/routes/commands.ts:5076-5131,5270-5331` persists trash
  state and permanent deletion.

## Trigger

- Delete an active character from the catalog or character editor (soft delete
  to trash).
- Restore a character from the trash list.
- Confirm permanent deletion from the trash list.

Then let the command be retained after a retryable failure or rejected
terminally.

## Expected behavior

The exact character action should remain pending until its durable result is
classified. Accepted, queued, and failed must be distinguishable. A terminal
failure should show an error alongside the restored row; a queued destructive
action should be visibly provisional and protected from conflicting actions.

## Actual behavior

Soft delete writes `trashTime = Date.now()` and calls
`dispatchUpdateCharacterTrashTime(...)` without awaiting its returned Promise.
Permanent delete removes the row and calls the void
`dispatchDeleteCharacter(...)`. `removeChar` then repairs the visible order,
clears selection, reaches `finally`, and removes the character ID from
`pendingCharacterRemovalIds` even while the command is unresolved.

Restore writes `trashTime = null` and ignores the Promise returned by
`dispatchUpdateCharacterScoped(...)`.

The catalog immediately derives its active/trash rows from the optimistic
resource. A terminal failure later restores the attempted field or missing row
with guarded rollback, but no UI error explains the move. A retryable failure
retains the optimistic catalog state and outbox row without a queued indicator.
Callers that `await removeChar()` also receive a false completion boundary.

## Underlying cause

`removeChar` retained its old meaning of “confirmation and local `Database`
mutation completed” after the authoritative write moved to Fastify. The soft
delete and restore command functions already return a server result, but the UI
path discards it. Permanent delete erases the result one layer lower by
launching its durable dispatch with `void`. The pending guard consequently
protects only the confirmation window, not persistence.

## Affected data flow

1. **UI interaction:** GridCatalog or CharConfig invokes `removeChar`; the trash
   restore button invokes `restoreTrashedCharacter`.
2. **Client projection:** soft delete/restore changes the target row's
   `trashTime`; permanent delete splices `characters`; order normalization and
   selection stores update immediately. GridCatalog derives its displayed rows
   from this projection.
3. **Request:** soft delete/restore stages
   `PATCH /api/v1/commands/characters/:characterId` with a `trashTime` patch;
   permanent delete stages `DELETE /api/v1/commands/characters/:characterId`.
4. **Server persistence:** the PATCH writes the exact character row and also
   updates the settings-owned character order when trash state changes. DELETE
   removes the character row, cascades chat rows, deletes message/memory rows,
   and writes repaired selection/order settings.
5. **Response/acknowledgement:** success returns a revisioned character event,
   character ID, and for delete the selected-character ID. Local effects settle
   the optimistic projection. Retryable failures retain the durable row;
   terminal failures restore only the attempted trash field or missing
   character/order placement.
6. **Displayed state:** the catalog and sidebar react to the resource rollback
   or retained projection, but neither action handler receives its status and
   the removal guard has already cleared.

## Severity and likely user impact

**High.** Permanent delete is explicitly destructive, and all three actions
change whether a character appears usable. Silent reappearance/reversion is
likely to be read as data loss or an unreliable trash system. Clearing the
pending guard early also permits conflicting character actions while a
destructive mutation is still live.

## Recommended fix

- Return `Promise<CharacterMutationOutcome>` from soft delete, restore, and
  permanent delete, including `accepted`, `queued`, and `failed`.
- Keep `pendingCharacterRemovalIds` (and an equivalent restore state) active
  through classification of the exact outbox generation, not merely local
  dispatch.
- Bind pending state to stable `chaId`, disable conflicting row actions, and
  expose a queued label for retained mutations.
- On terminal failure, keep the existing narrow rollback and show a localized
  error after the row is restored. Do not broadly restore the character array.
- Make the caller-visible `removeChar()` Promise settle at the persistence
  classification boundary.
- Add component tests proving that buttons remain pending and queued/failed
  results are visible for all three actions.
