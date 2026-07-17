# Failed memory jobs and their errors are hidden from the UI

## Summary

The server persists the error for a failed memory job, but both the job-list API and SSE event projection omit that error. The client then removes every terminal job from its local list, causing a failed job to disappear and the panel to report that there are no pending or running jobs.

## Location

- `server/fastify/src/memoryRepository.ts:90-111,989-1028,1129-1149`
- `server/fastify/src/routes/memoryJobs.ts:132-160`
- `server/fastify/src/memoryEvents.ts:60-74`
- `src/ts/process/request/serverMemory.ts:50-63,290-310`
- `src/ts/server/memoryJobRefresh.ts:30-32,72-82,97-112,141-154`
- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:19-28,102-128,163-203`

## Trigger

Allow any server memory job to exhaust its attempts, for example by using an invalid summary provider/model or encountering a persistent provider error, while the Hypa V3 modal is open.

## Expected behavior

The panel should retain a bounded history of terminal jobs, distinguish completed, cancelled, and failed states, and show the server's failure message so the user can correct the underlying configuration or request problem.

## Actual behavior

When the job becomes failed, its row disappears. The panel displays “No pending or running memory jobs,” even though a failed row and error remain in server storage. Neither refresh nor SSE gives the component the persisted error text.

## Underlying cause

The database `MemoryJob` includes `error`, but `MemoryJobListItem` and its SQL projection omit it. The default GET route additionally filters to only `pending` and `running`. SSE events use the same reduced list shape. On the client, refresh normalization discards all terminal statuses and terminal event updates remove the matching active row instead of retaining it for display.

## Affected data flow

1. **Server job logic/persistence:** `memoryRepository.ts:1129-1149` stores the error and changes the last attempt to `failed`.
2. **Response/API:** `routes/memoryJobs.ts:148-153` defaults to pending/running only; `memoryRepository.ts:989-1028` selects no error column. `memoryEvents.ts:60-74` emits status and attempts but no error.
3. **Client state:** `serverMemory.ts:50-63` has no error field. `memoryJobRefresh.ts:72-82` removes terminal jobs received from refresh, and `:97-112` removes them when an SSE terminal update arrives.
4. **Display:** `server-memory-jobs.svelte:19-28,163-203` renders only active jobs and falls through to the empty-active-queue message.

## Severity and user impact

**Medium-high.** Memory failures are indistinguishable from an empty or finished queue while expected summaries remain absent. This masks provider, model, authentication, and persistence errors and makes recurring failures difficult to diagnose.

## Recommended fix

Expose recent terminal jobs, including a safe error string and completion timestamp, through the list API and SSE events. Keep a bounded failed/completed history in the refresh controller, render terminal status separately from the active queue, and retain polling/ETag behavior for active jobs. Do not expose secrets that may appear in raw provider errors.

## Test coverage gap

Add route, event, refresh-controller, and component tests for a job transitioning `running -> failed`. Assert that the error survives persistence, reaches the client, remains visible after refresh and SSE delivery, and is not presented as an empty successful queue. Also cover completed and cancelled terminal states.
