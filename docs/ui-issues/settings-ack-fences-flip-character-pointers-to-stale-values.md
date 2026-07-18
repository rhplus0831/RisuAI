# Settings acknowledgement fences flip the character pointer facade to stale values

## Summary

The database facade serves `characterOrder` and `currentChar` from the
characters resource when its revision is at least the settings resource's
`fullRevision`, otherwise from the settings resource's value. Local-effect
acknowledgements advance `fullRevision` as a "reject older settings reads"
fence *without refreshing the settings value*. When the characters-side
pointers are newer than the settings copy (imports, foreign reorders/selects
via SSE), any unrelated acknowledged command flips the facade to the stale
settings snapshot: sidebar order reverts, an imported character disappears from
the order, and `currentChar` points at the wrong character.

## Location

- `src/ts/server/resourceState.svelte.ts:2720-2726` —
  `shouldUseCharacterPointerResource` compares pointer revisions against
  `settingsResourceState.fullRevision`.
- `src/ts/server/resourceState.svelte.ts:2545-2573` — the facade reads
  `characterOrder`/`currentChar` through that arbiter.
- `src/ts/server/resourceState.svelte.ts:1185,1267,1565,1644` — local-effect
  acknowledgements set `settingsResourceState.fullRevision = payload.revision`
  without updating `settingsResourceState.value`.
- `src/ts/server/resourceState.svelte.ts:2035-2056,2161-2170,2187-2214` —
  authoritative pointer applies update only `charactersResourceState`.
- `src/ts/bootstrap.ts:168-175,1575-1587` — consumers of `db.currentChar`
  (foreign-selection reconcile).
- `server/fastify/src/routes/commands.ts:604-610` — the server appends
  created/imported characters to the settings-row `characterOrder`.

## Trigger

1. The client observes an authoritative pointer apply that its own optimistic
   writes never mirrored into `settingsResourceState.value` — e.g. a Realm
   import (characters read adds the imported character to
   `charactersResourceState.characterOrder` at revision N while the settings
   copy still holds the bootstrap-era order), or any foreign-writer
   reorder/select/trash observed via SSE.
2. The user performs any command whose acknowledgement fences `fullRevision` —
   editing a field of the selected model/prompt preset, a persona
   patch/select, or a preset reorder with `settingsWritten` — at revision
   R > N.

## Expected behavior

`db.characterOrder`/`db.currentChar` keep returning the fresher
characters-resource values.

## Actual behavior

`pointerRevision (N) >= fullRevision (R)` is false, so the facade flips to the
stale settings snapshot. Sidebar order reverts / the imported character
disappears from the order / `db.currentChar` points at the old character;
`initialSelectedCharFromDatabase` can then select the wrong character when
reconciling a foreign selection event; `composeResourceDatabaseSnapshot`
embeds the stale pointers into exports/backups; a drag-reorder captured from
the stale order is dispatched and rejected server-side ("characterOrder must
include every untrashed character id"). The window persists until the next
characters/order/selection read or full settings read.

## Underlying cause

`fullRevision` is overloaded: acknowledgements advance it as a staleness fence
for future settings *reads*, but the pointer arbiter interprets it as settings
*value* freshness.

## Affected data flow

1. **SSE/import:** `applyCharacterOrderResource`/`applyCharactersResource`
   update the characters slice only.
2. **UI:** user edits the selected preset → PATCH → acknowledgement.
3. **Client state:** `applySplitPresetPatchLocalEffect` sets
   `fullRevision = R`.
4. **Facade read:** `db.characterOrder` flips to the stale settings snapshot.
5. **Displayed state:** sidebar order/selection revert; follow-on writes and
   exports use stale pointers.

## Severity and likely user impact

**Medium** (medium-high confidence — mechanics verified line-by-line; the
trigger needs pointer-copy divergence, which several real flows produce).
Visible order/selection reversion, wrong-character selection on foreign select
events, stale pointers in exports, rejected reorder writes.

## Recommended fix

Track a separate `settingsPointerValueRevision` that is set only where the
settings *value* of `characterOrder`/`currentChar` is actually written
(`applySettingsResource`, `replaceResourceDatabase`, the facade set/mirror
paths), and use it in `shouldUseCharacterPointerResource`. Alternatively give
the acknowledgement-only advances a dedicated `settingsAckRevision` consulted
by the settings-read entry fence, leaving `fullRevision` as pure value
freshness.

## Test gap

Resource-state test: apply a characters-order resource at revision N, then a
settings local-effect acknowledgement at R > N without a settings value write,
and assert the facade still serves the characters-side order.
