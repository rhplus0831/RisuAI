# Grid catalog restore applies an unpersistable write for id-less characters

## Summary

Restoring a trashed character from the grid catalog performs the optimistic
`trashTime = null` projection write before checking that the character has a
`chaId`. For a row without an id, nothing is dispatched and the `null` return
is treated like success — the character appears restored until the next
hydration or refresh re-trashes it.

## Location

- `src/lib/Others/GridCatalog.svelte:171-193` — `restoreTrashedCharacter`: the
  `withTrustedResourceWrite` block (`:178-188`) sets `liveCharacter.trashTime
  = null` unconditionally (for a falsy `chaId` it writes at the raw index);
  the `characterId` guard (`:189`) only gates the dispatch, and the function
  returns `null`, which callers treat as a cleared/settled status.
- Contrast: the remove path returns before any write when `chaId` is missing.

## Trigger

Trash tab → Restore on a character whose `chaId` is empty (legacy rows; the
catalog itself anticipates them via its `legacy-${index}` keys).

## Expected behavior

Either no local change (like `removeChar`, which bails before any write when
`chaId` is missing) plus a "cannot restore this row" message, or a persisted
restore.

## Actual behavior

The optimistic write applies, no command is dispatched, the outcome reads as
success, and the next hydration/refresh reverts the character to trashed —
update appears, then reverts, with no message (symptom class 2).

## Underlying cause

The local projection write is ordered before the id guard, and the `null`
outcome is conflated with "accepted".

## Affected data flow

1. Restore click → trusted local `trashTime = null` write.
2. No command dispatched (falsy `characterId`).
3. Server still has `trashTime` set → next resync re-trashes the row.

## Severity and likely user impact

**Low.** Only reachable for legacy/id-less rows (medium confidence such rows
exist in real databases), but exactly the revert-after-apparent-success
symptom when hit.

## Recommended fix

Return before the `withTrustedResourceWrite` block when `characterId` is
falsy, and surface a distinct "cannot restore this row" error instead of
clearing the status.

## Test gap

A component-level test restoring a `chaId`-less trashed row, asserting no
projection write occurs and an error status is shown.
