# Phase 4: Stream And Generation Resilience

Status: planned.

Goal: make SSE, generation reattach, resend, and terminal persistence behavior
bounded and observable.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/routes/events.ts`
- `server/fastify/src/streamJobs.ts`
- `server/fastify/src/generationJobs.ts`
- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/reattach.ts`
- `src/ts/process/request/serverChat.ts`

## Slices

- [`sse-taxonomy-alignment.md`](slices/phase-4-stream-generation-resilience/sse-taxonomy-alignment.md)
- [`sse-backpressure-policy.md`](slices/phase-4-stream-generation-resilience/sse-backpressure-policy.md)
- [`generation-reattach-triggers.md`](slices/phase-4-stream-generation-resilience/generation-reattach-triggers.md)
- [`resend-cycle-cap.md`](slices/phase-4-stream-generation-resilience/resend-cycle-cap.md)
- [`finalization-retry-queue.md`](slices/phase-4-stream-generation-resilience/finalization-retry-queue.md)

## Exit Criteria

- Slow SSE and stream consumers cannot create unbounded server memory pressure.
- Active chat changes and full resyncs can trigger relevant generation reattach.
- Server-owned resend loops have a per-root-action cap.
- Final result persistence can be retried without duplicating assistant rows.

## Validation

- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
