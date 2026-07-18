# Character editor draft retains profile edits rejected by the server

## Summary

The character editor renders a component-local server-backed draft while a
separate watcher persists an optimistic copy of that draft. When a character
profile `PATCH` fails terminally, the watcher rolls the shared character
resource back, but the editor draft is neither rolled back nor told that the
attempt failed. The inputs therefore continue to show the rejected values even
though the resource projection and SQLite row contain the previous values.

## Location

- `src/lib/SideBars/CharConfig.svelte:159-210` creates the profile draft and
  `src/lib/SideBars/CharConfig.svelte:258-270` mounts the persistence watcher.
- `src/lib/SideBars/CharConfig.svelte:1272-1308` shows representative fields
  bound directly to `characterDraft.value`.
- `src/ts/server/characterBridge.svelte.ts:65-198` owns draft seeding, dirty
  fields, optimistic projection writes, and success acknowledgement.
- `src/ts/server/characterBridge.svelte.ts:263-403` observes that projection,
  queues the durable mutation, and installs the rollback callback.
- `src/ts/server/characterBridge.svelte.ts:433-436,659-692` rolls a failed
  attempt back only in the shared character resource.
- `src/ts/characterCommands.ts:852-873,1060-1068` dispatches the character
  command and invokes the supplied rollback on a terminal failure.
- `src/ts/server/commands.ts:3358-3372` sends the client request and decodes its
  local success effect.
- `server/fastify/src/routes/commands.ts:5076-5131` validates and applies the
  character patch.
- `server/fastify/src/repository.ts:551-557` persists the character row in
  SQLite.

## Trigger

1. Open a character's configuration panel and edit a profile field such as
   Name, Display Name, Description, First Message, a TTS option, or another
   field in the draft key list.
2. Let the 300 ms profile watcher dispatch the update.
3. Make the request fail terminally, for example because validation rejects
   the patch (`400`) or the character no longer exists (`404`). The same gap
   applies to another failure that the command runner classifies for immediate
   rollback rather than durable retry.
4. Keep the character editor mounted.

## Expected behavior

After the mutation is definitively rejected, every field belonging only to the
failed attempt should return to its last persisted value. A newer edit made
after that attempt started must remain visible and be rebased/retried instead
of being rolled back with the older attempt. The editor and all other consumers
of the character resource should show the same value.

## Actual behavior

The shared character resource is restored to the pre-attempt value, but the
mounted editor input keeps displaying the rejected value from
`characterDraft.value`. Other components reading `getDatabase().characters`
can simultaneously show the restored value. An ordinary authoritative refresh
does not reliably correct the editor: while the field remains dirty, the merge
path preserves the rejected draft and can reassert it into the refreshed client
projection. Changing character identity or remounting the editor clears the
dirty set, so navigating away and back can make the apparent saved value
disappear.

## Underlying cause

`createServerBackedCharacterDraft()` has its own `dirtyFields` set. Draft edits
mark those fields dirty and copy their values into the shared projection. A
matching successful `characterPatch` local effect clears them, but no failure
or rollback event reaches this draft.

The rollback path calls `rollbackServerBackedCharacterProfile()`, which safely
restores attempted fields in `getDatabase().characters` while suppressing a
second dispatch. It does not update `characterDraft.value` or reconcile that
draft's `dirtyFields`.

Although the trusted rollback write can make the draft's seed effect reactive,
that effect returns at `characterBridge.svelte.ts:98` unless character
identity, the server-resource-apply epoch, or the explicit local-character
projection epoch changed. This rollback advances none of those accepted seed
signals. Even simply advancing an epoch would be insufficient while the failed
fields remain dirty, because the merge path intentionally reasserts dirty draft
values over incoming projections.

## Affected data flow

1. **UI interaction:** Inputs in `CharConfig.svelte` mutate
   `characterDraft.value.<field>`.
2. **Client draft/projection:** The draft effect records the changed top-level
   fields in `dirtyFields`, sanitizes a patch, and optimistically assigns it to
   the selected character resource.
3. **Persistence watcher:** `watchServerBackedCharacterProfile()` notices the
   projection change, captures the previous profile, and stages a debounced
   durable mutation.
4. **Request:** `updateCharacterCommand()` sends
   `PATCH /api/v1/commands/characters/:characterId` with `baseRevision` and
   `{ patch }`.
5. **Server mutation:** Fastify authenticates and validates the command, builds
   the patched row, writes it with `writeSingleCharacterRow()`, and on success
   returns the new revision, event, and character ID. A rejected command returns
   a command error without persisting the attempted value.
6. **Acknowledgement/rollback:** A successful response produces a
   `characterPatch` local effect, allowing matching dirty fields to clear. A
   terminal failure instead invokes `rollbackCharacterAttempt()`, which restores
   only the shared resource projection.
7. **Displayed state:** The editor remains bound to the independent draft. Its
   dirty state is not settled on failure, so it continues to render the failed
   value while SQLite and resource-backed consumers hold the old value.

## Severity and likely user impact

**High.** This affects most autosaved fields across the character editor and
creates a false-success state with no explicit Save action to expose the
failure. Users can continue working under the assumption that identity,
prompting, media, or TTS changes were saved, observe conflicting values in
other UI, and only discover the loss after navigation or reload.

## Recommended fix

Make draft settlement part of the same per-attempt protocol as projection
rollback:

1. Register each dispatched profile attempt with its per-field previous and
   attempted values plus a monotonically increasing attempt token.
2. On success, clear a field only when the draft still equals that attempt's
   value, as the current local-effect path already approximates.
3. On terminal failure, restore the corresponding draft field and clear its
   dirty marker only when it still equals the failed attempted value. Preserve
   any later local value and rebase/requeue it using the existing later-attempt
   logic.
4. Update the shared projection, watcher baseline, and draft settlement in one
   coordinated operation so the rollback cannot schedule another stale patch.

Do not fix this only by forcing a resource reseed: without first settling the
failed dirty fields, the draft merge logic will intentionally write them back.

## Test gap

`src/ts/server/characterBridge.svelte.test.ts` separately covers dirty-draft
protection across authoritative applies and shared-resource rollback after a
watcher failure. Add an integration-style bridge test that mounts both
`createServerBackedCharacterDraft()` and
`watchServerBackedCharacterProfile()`, rejects the dispatched command, and
asserts both the resource and bound draft return to the baseline. Add a second
case where a newer edit occurs before the older attempt fails and verify that
only the older attempted value is rolled back.
