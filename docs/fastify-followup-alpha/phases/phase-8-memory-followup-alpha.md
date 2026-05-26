# Phase 8 Alpha Follow-Up - Hypa V3 Memory

Date: 2026-05-27

Status: reopened by alpha audit.

## Goal

Memory job progress events should be observable without making committed
memory work depend on event subscriber success.

## Audit Finding

Memory event delivery does not isolate listener failures.

- `MemoryEventBus.emit` calls each listener without `try/catch`:
  `server/fastify/src/memoryEvents.ts:43`
- App-level memory event fanout can propagate a throwing external sink:
  `server/fastify/src/app.ts:93`
- The worker emits after claiming a job but before entering the handler
  `try` block, so a throwing listener can leave work claimed/running:
  `server/fastify/src/memoryWorker.ts:133`
- The enqueue route mutates storage and then emits; a throwing listener
  can turn committed enqueue work into a 500 response:
  `server/fastify/src/routes/memoryJobs.ts:117`
- Command event sinks already isolate failures:
  `server/fastify/src/commands/events.ts:319`

## Tasks

- Make memory event fanout best-effort. Subscriber or external sink
  exceptions should be caught and logged or otherwise isolated.
- Ensure worker job execution cannot be aborted by progress-event
  delivery failures after a job has been claimed.
- Ensure memory enqueue routes do not return 500 solely because event
  delivery failed after storage mutation.
- Add focused tests with throwing memory event subscribers/sinks for the
  event bus, worker, and route paths.

## Exit Criteria

- Memory event listeners cannot leave claimed jobs stuck or fail
  committed enqueue routes.
- Memory progress events still reach non-throwing subscribers.
- Failure handling is consistent with the command event sink pattern, or
  any difference is documented and tested.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

## Secondary Audit Note

The audit also noticed that mixed pending embed batches can make Voyage
contextual jobs fall back to single-job embedding when a chat has mixed
custom/OpenAI/Voyage pending work. Treat this as lower priority unless a
task agent is already in `memoryEmbedJobHandler`.

References:

- Pending embed claim:
  `server/fastify/src/memoryEmbedJobHandler.ts:91`
- Contextual batch gate:
  `server/fastify/src/memoryEmbedJobHandler.ts:425`

## References

- Original phase: `docs/fastify/phases/phase-8-memory.md`
- Completed follow-up: `docs/fastify-followup/phases/phase-8-memory-followup.md`
