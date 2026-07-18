# Hypa failure errors are cleared by their own reconcile refresh

## Summary

Two flows in the Hypa V3 modal set a failure message and then immediately run
a list refresh whose success path nulls that same message: deleting a summary,
and cancelling a memory job. In both cases the user's confirmed action fails
with zero feedback. The summary PATCH path solves exactly this by restoring
the mutation error after its reconcile refresh; the delete and cancel paths
lack that logic.

## Location

Summary delete:

- `src/lib/Others/HypaV3Modal.svelte:312-338` — `deleteServerSummaryAt`: a
  non-ok DELETE sets `serverMemoryError` (`:320`), then `if (!deleted) await
  refreshServerSummaries(currentChatId)` (`:336`).
- `src/lib/Others/HypaV3Modal.svelte:149-150` — `refreshServerSummaries`
  starts with `serverMemoryError = null` and leaves it null on success.
- Contrast: `src/lib/Others/HypaV3Modal.svelte:226-241` — the queued-mutation
  drain (used by the PATCH-failure path via
  `pendingServerSummaryRefreshChatId`, set at `:299`) captures the mutation
  error before refreshing and restores it afterwards (`:236-238`).

Memory job cancel:

- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:74-96` — `cancelJob`
  sets `error` on a non-ok result (`:89-94`), then `await refreshJobs()`
  (`:95`).
- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:106-110` — the refresh
  controller's `onJobs` callback sets `error = null` on any successful list.

## Trigger

- Click the trash icon on a summary (or "delete after") while the server
  rejects the DELETE (transient 5xx, stale-writer 409, restarting server) but
  the follow-up list GET succeeds; or
- click "Cancel" on a pending/running memory job while the DELETE
  `/api/v1/memory/jobs/:id` fails but the subsequent jobs list GET succeeds.

## Expected behavior

The row/job correctly remains, and the error area explains that the delete or
cancel failed — that is exactly what `serverMemoryError` and the jobs `error`
banner exist for.

## Actual behavior

The error is set and then nulled within the same interaction by the reconcile
refresh. The modal just re-renders the unchanged list; the confirmed
destructive action silently does nothing.

## Underlying cause

Failure message and refresh share one error slot, and the refresh
unconditionally clears it on success. The PATCH path's preserve-and-restore
logic was not applied to the delete and cancel paths.

## Affected data flow

1. UI delete/cancel → server command → non-ok → error slot set.
2. Reconcile refresh (`refreshServerSummaries` / `refreshJobs`) → success →
   error slot nulled.
3. UI shows the unchanged list with no failure indication.

## Severity and likely user impact

**Low.** Data converges correctly (the row/job stays), but the user gets zero
feedback for a confirmed destructive action (symptom class 4) and may retry
repeatedly or assume the item is gone.

## Recommended fix

Mirror the PATCH path: capture the just-set error before the reconcile
refresh and restore it afterwards if the refresh itself succeeded (for the
delete, route through `pendingServerSummaryRefreshChatId`; for the jobs panel,
skip the `error = null` in `onJobs` when a cancel error was set in the same
interaction).

## Test gap

Component tests that reject the DELETE/cancel while resolving the follow-up
list, asserting the error banner remains visible.
