# Slice: Sliding Deadlines

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Findings: L2
and L5. Runtime resilience change.

## Scope

Convert the remaining fixed stream deadlines to activity-sliding deadlines.
The standalone `/api/v1/generate/completion` streaming path and local-network
proxy stream jobs should survive past their original timeout while meaningful
frames continue to flow, while idle streams still abort at the bounded
deadline.

This slice owns deadline refresh behavior only. It does not change provider
adapter timeouts, durable chat generation, proxy URL allow-listing, stream
buffer caps, or browser-side cancel DELETE behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L2 and L5.
- `server/fastify/src/routes/generation.ts`: `pipeStream`, streaming
  completion handlers, and `attachAbort()` cleanup.
- `server/fastify/src/requestAbort.ts`: `RequestAbort.refresh`.
- `server/fastify/src/routes/generationChat.ts`: `streamAssembly` refresh
  wiring precedent.
- `server/fastify/src/routes/streamJobs.ts`: proxy stream-job
  `registry.create()`.
- `server/fastify/src/streamJobs.ts`: `slidingDeadline`,
  `refreshDeadline()`, `pushRaw()`, `pushEvent()`,
  `isStreamDeadlineActivityFrame()`, and `tickGc()`.
- Focused tests:
  `server/fastify/__tests__/generation.completion.test.ts`,
  `server/fastify/__tests__/requestAbort.test.ts`,
  `server/fastify/__tests__/streamJobs.test.ts`, and
  `server/fastify/__tests__/streamJobsRoutes.test.ts`.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L2/L5 proof
  registration.

## Target Shape

- Let `pipeStream()` receive an optional refresh callback, or the narrow
  `RequestAbort` member it needs.
- Call `refresh()` when the completion stream emits real activity:
  non-empty token frames and any non-terminal progress/info frame that should
  prove the upstream is alive.
- Do not refresh on terminal `done`, terminal `error`, empty tokens, or passive
  heartbeat/no-op frames.
- Thread the refresh callback from every streaming completion handler that
  calls `attachAbort()`.
- Create proxy stream jobs with `slidingDeadline: true`.
- Verify the proxy job activity predicate actually sees proxy JSON events.
  Current durable generation activity is SSE-shaped; proxy jobs emit JSON via
  `pushEvent()`. If the existing predicate only recognizes SSE, extend it
  narrowly so proxy `chunk` and upstream header/progress events refresh the
  deadline while proxy `done`, `error`, and `ping` do not.
- Add fake-timer tests for:
  active completion streaming past the original deadline,
  idle completion streaming aborting at the deadline,
  active proxy stream jobs extending `deadlineAt`, and
  silent proxy stream jobs still aborting.
- Register L2 and L5 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Activity refreshes the deadline; it does not remove the deadline.
- Token-producing streams must not be killed at the original wall-clock limit.
- Idle or silent streams still abort within the configured timeout.
- Deadline timers and request close listeners are still cleaned up in all
  streaming completion paths.
- Durable chat generation behavior remains unchanged.
- Proxy pings and terminal frames do not keep a dead upstream alive.

## Done Criteria

- A streaming completion route that emits tokens over longer than the fixed
  timeout remains open while tokens flow.
- A streaming completion route that stops emitting activity aborts at the
  bounded deadline.
- Proxy stream jobs refresh their deadline on real upstream activity.
- Proxy stream jobs that produce no real activity still abort and release their
  slot.
- L2 and L5 are registered as `DONE` in the v3 gate and active-risk table, with
  no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.completion.test.ts \
  server/fastify/__tests__/requestAbort.test.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
