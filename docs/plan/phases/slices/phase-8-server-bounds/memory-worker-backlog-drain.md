# Slice: Memory Worker Backlog Drain

Phase: [8](../../phase-8-server-bounds.md). Finding: L18. Runtime change.

## Scope

Remove the fixed 1 second idle gap between productive memory-worker ticks so a
backlog can drain promptly.

This slice does not own within-batch fairness, `summarizationMaxConcurrent`,
job failure semantics, contextual embedding grouping, or memory job retention.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L18.
- `server/fastify/src/memoryWorker.ts`: worker loop, fixed poll interval,
  batch result accounting, timer lifecycle, and stop/start behavior.
- `server/fastify/src/memoryRepository.ts`: job claim/list helpers if result
  accounting needs a clearer "did work" signal.
- Existing focused suite: `server/fastify/__tests__/memoryWorker.test.ts`.

## Target Shape

- Detect whether a worker tick claimed, completed, retried, failed, or
  cancelled any job.
- When a tick did useful work and the worker is still desired, schedule the
  next tick immediately or through a zero-delay timer/microtask.
- Keep the existing idle poll delay when no jobs were available.
- Preserve the one-timer invariant: repeated triggers while a timer is pending
  must not create duplicate worker loops.
- Reset timers cleanly on worker stop and on app teardown.
- Add fake-timer tests showing a multi-batch backlog drains without 1 second
  gaps, idle polling still waits, and stop prevents further fast-path ticks.
- Register L18 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- The worker still respects batch size and concurrency settings.
- A continuously failing job cannot spin the CPU without the existing retry or
  failure backoff rules applying.
- Starting and stopping the worker remains idempotent.
- Within-batch blocking is the accepted residual from v1-L17 and is not
  reopened here.

## Done Criteria

- A queued backlog spanning multiple batches drains through immediate
  productive ticks.
- An empty queue uses the normal poll interval.
- Timer-count tests prove no duplicate worker loops are scheduled.
- The L18 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryWorker.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
