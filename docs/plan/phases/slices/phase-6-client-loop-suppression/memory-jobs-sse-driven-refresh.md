# Memory Jobs SSE Driven Refresh

Status: planned.

## Source Anchors

- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`
- `src/ts/process/request/serverMemory.ts`
- `server/fastify/src/routes/memoryJobs.ts`
- `server/fastify/src/memoryEvents.ts`

## Scope

Reduce memory job modal polling and prevent overlapping list requests by using
memory SSE progress events as the main refresh trigger where possible.

## Protocol Behavior

- Keep initial list fetch on modal open or chat change.
- Skip or abort refresh when a previous request is in flight.
- Pause periodic polling when no pending or running jobs exist.
- Use memory events to refresh affected job state.

## Done When

- The modal cannot overlap repeated job-list requests.
- Polling backs off or stops when SSE is sufficient.
- Large job histories have pagination, counts, or a documented cap.

## Validation

- Focused component or adapter tests for refresh scheduling.
- Server tests if list pagination or count shape changes.
