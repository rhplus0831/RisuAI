# Character selection apply trusts the server index against a diverged local list

## Summary

`applyCharacterSelectionResource` receives both a `characterId` and a raw
`currentChar` index computed against the *server's* character list. It
validates that the target character exists and that the index is in bounds,
but never checks that the index actually points at that character in the
*local* list. When the local list has diverged (an optimistic, un-acked
structural change in flight), the stored index can point at a different
character, and the selection reconcile opens the wrong character.

## Location

- `src/ts/server/resourceState.svelte.ts:2187-2214` —
  `applyCharacterSelectionResource` verifies existence and bounds, then stores
  `payload.currentChar` verbatim; it never checks
  `characters[payload.currentChar].chaId === payload.characterId`.
- `src/ts/bootstrap.ts:1575-1587` —
  `reconcileSelectedCharacterAfterResourceRefresh` →
  `initialSelectedCharFromDatabase` sets `selectedCharID` from the stored
  index.
- `server/fastify/src/routes/resourceReads.ts:326+` — the selection read
  returns a raw `currentChar` index.

## Trigger

Tab A has an optimistic, un-acked structural change (character delete/create in
flight — its revision fences advance only on acknowledgement), and a
`characterSelection` invalidation for another character is processed (a
foreign select, or an own select whose local effect failed validation). The
read's index was computed against the server's list, whose length/positions
differ from the local optimistic list.

## Expected behavior

Selection application is keyed by `characterId`; the index is validated
against it, and the locally located index wins on divergence.

## Actual behavior

`db.currentChar` can point at a different character; the reconcile step opens
the wrong character's screen. The value self-corrects only on the next
characters/selection apply.

## Underlying cause

Index-based selection is transported across replicas whose list composition
can differ, with revision fences that cannot see un-acked local structural
edits.

## Affected data flow

1. **SSE:** `characterSelection` event → targeted read.
2. **Client:** `applyCharacterSelectionResource` writes the raw index.
3. **Reconcile:** `selectedCharID` set from the index.
4. **Displayed state:** wrong character/chat screen until the next apply.

## Severity and likely user impact

**Low-medium** (the missing check is certain; hitting it requires concurrent
structural divergence, so real-world frequency is modest). Briefly rendering
the wrong character is disorienting and can misdirect follow-up edits.

## Recommended fix

In `applyCharacterSelectionResource`, resolve the index locally: if
`characters[payload.currentChar]?.chaId !== payload.characterId`, use the
locally located `characterIndex` instead of the payload index (and skip the
apply if the character is not found).

## Test gap

Resource-state test: local list missing one row relative to the server's,
apply a selection payload whose index points at a neighbor, and assert the
stored index resolves to the payload's `characterId`.
