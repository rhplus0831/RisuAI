# Phase 8 Alpha - Memory Event Isolation

Date: 2026-05-27

## Scope

Closed the reopened Phase 8 alpha finding where memory event
subscriber or sink failures could abort committed memory route and
worker work.

## Landed Changes

- Added a shared best-effort memory event delivery helper.
- Memory event bus subscribers are now isolated so one throwing
  subscriber cannot prevent later subscribers from seeing the event.
- App-level external memory sinks are isolated before events fan out to
  `/api/v1/events`.
- Memory worker progress emits are isolated, including the claimed-job
  event that fires before handler execution.
- Memory job route progress emits are isolated after enqueue/cancel
  storage mutations.
- Focused regression tests cover throwing subscribers/sinks for the
  event bus, app/SSE fanout, worker execution, and enqueue route path.

## Verification

Passed:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

## Broad Closeout

Functional Phase 8 alpha work is closed. Broad verification status lives
in [`../status.md`](../status.md).

The lower-priority mixed pending embed batch note from the Phase 8
audit was not changed in this slice; treat it as future work only if
`memoryEmbedJobHandler` is reopened.
