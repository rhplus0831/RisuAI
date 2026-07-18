# Hypa modal close is permanently blocked while a text save keeps failing

## Summary

Closing the Hypa V3 modal flushes dirty summary text and refuses to close
until every save persists. That is the right default (it was added to fix
"close does not await persistence"), but there is no bounded retry and no
"discard changes and close" escape hatch: while the server keeps rejecting the
PATCH, every Escape/X press re-runs the flush, fails, and keeps the modal
open indefinitely.

## Location

- `src/lib/Others/HypaV3Modal.svelte:605-626` — `flushDirtyServerSummaryText`
  loops over every dirty row and returns `false` on the first failed save.
- `src/lib/Others/HypaV3Modal.svelte:628-643` —
  `flushPendingServerSummaryChanges` propagates that failure.
- `src/lib/Others/HypaV3Modal.svelte:645-669` — `requestModalClose` closes
  only when the flush returns `true`; on failure the modal stays open and the
  next close attempt starts over.
- `src/lib/Others/HypaV3Modal/modal-header.svelte:83-98` — both the X button
  and the settings navigation route through `requestModalClose`.
- `src/lib/Others/HypaV3Modal.svelte:1228-1235` — while the failure persists,
  the error branch also replaces the list, so the user cannot meaningfully
  revert the textarea either.

## Trigger

Edit a summary's text while the server persistently rejects the PATCH (server
down or restarting, stale writer session that never recovers). Press Escape or
the X repeatedly.

## Expected behavior

After a failure the user can see the error and choose between retrying and
discarding the edit to leave the modal.

## Actual behavior

Every close attempt re-runs the flush, fails, and keeps the modal open. There
is no discard path, so the modal is stuck until the server recovers.

## Underlying cause

`requestModalClose` treats persistence failure as "cannot close" with no
terminal state; the close-time flush (the correct prior fix) shipped without
an explicit user decision point for the failing case.

## Affected data flow

1. Close request → `flushPendingServerSummaryChanges` →
   `flushDirtyServerSummaryText` → PATCH fails.
2. `persisted === false` → modal stays open.
3. Repeat on every close attempt.

## Severity and likely user impact

**Low.** Requires sustained server failure (medium confidence that users hit
it), but when hit it hard-traps the UI with no exit other than a full page
reload — which then silently drops the edit anyway.

## Recommended fix

On a second consecutive failed close attempt, offer a confirm dialog ("save
failed — discard changes and close?") that clears
`dirtyServerSummaryTextVersions` and closes; keep the current behavior for the
first attempt.

## Test gap

A component test with a persistently rejecting PATCH asserting the second
close attempt offers a discard path and that choosing it closes the modal.
