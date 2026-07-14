# Memory Jobs SSE Driven Refresh

Status: implemented.

## Source Anchors

- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`
- `src/ts/process/request/serverMemory.ts`
- `server/fastify/src/routes/memoryJobs.ts`
- `server/fastify/src/memoryEvents.ts`

## Scope

Reduce memory job modal polling and prevent overlapping list requests by using
memory SSE progress events as the main refresh trigger where possible.

Current behavior: `server-memory-jobs.svelte` refreshes on modal open/chat
change and subscribes to parsed `memory.job` SSE events. Matching chat events
trigger a refresh through a controller that prevents overlapping list requests.
Timer polling runs only while the visible job list contains pending or running
jobs.

## Protocol Behavior

- Keep initial list fetch on modal open or chat change.
- Skip or queue refresh when a previous request is in flight.
- Pause periodic polling when no pending or running jobs exist.
- Use memory events to refresh affected job state.

## Done When

- The modal cannot overlap repeated job-list requests. Done.
- Polling backs off or stops when SSE is sufficient. Done.
- Large job histories have pagination, counts, or a documented cap. Current
  list route still returns pending/running jobs by default; no wire shape change
  was needed for this slice.

## Validation

- `pnpm test -- src/ts/server/memoryJobEvents.test.ts src/ts/server/memoryJobRefresh.test.ts src/ts/bootstrap.test.ts`
- `pnpm test -- src/ts/server`
