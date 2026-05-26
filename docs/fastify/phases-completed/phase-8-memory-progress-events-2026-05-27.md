# Phase 8 Memory Progress Events - 2026-05-27

Slice 8B landed.

## What Changed

- Added a production Fastify memory event bus and fan-out path so memory
  job route and worker events still reach test hooks while also streaming
  to `/api/v1/events`.
- Extended `/api/v1/events` to emit `event: memory` SSE frames alongside
  existing `event: command` frames.
- Extended the browser server event subscriber to parse memory job
  frames and apply `hypav3_progress` side effects to the existing Hypa V3
  progress store during Fastify-served web mode.

## Notes

- The existing command event contract is unchanged; command projection
  refresh still listens to `event: command`.
- No compatibility migration was added because there are no actual
  Fastify users yet.
- At this slice closeout, Phase 8 still needed slice 8C:
  missing-summary diagnostics for chunks that have neither embedding nor
  summary.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

## Historical Next Pickup

At this slice closeout, Phase 8 Slice 8C was the default pickup: update
memory diagnostics and follow-up enqueue logic so chunks missing both
embedding and summary still schedule summary jobs.
