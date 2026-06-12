# Slice: Generation Deadline Bounds

Phase: [8](../../phase-8-server-bounds.md). Finding: L1. Pair with the
non-durable fixed-deadline residual called out under Known-Item Overlaps.
Runtime change.

Status: done. Implemented as a sliding idle deadline: durable generation jobs
opt in to deadline refresh on non-terminal chat SSE activity, and non-durable
chat generation refreshes the same normalized abort window when it writes active
chat frames. Silent jobs still abort after the bounded timeout window.

## Scope

Make durable chat generation and the non-durable request-abort wrapper survive
legitimate slow active streams while still killing runaway jobs that produce no
activity.

This slice does not own provider retry behavior, prompt assembly, detached job
reattach semantics beyond deadline metadata, or proxy stream buffer bounds.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L1 and the non-durable generation deadline residual.
- `server/fastify/src/routes/generationChat.ts`: `startDurableGeneration`,
  durable job creation, chat route option parsing, and lock/finalization
  cleanup.
- `server/fastify/src/streamJobs.ts`: `PROXY_STREAM_DEFAULT_TIMEOUT_MS`,
  `PROXY_STREAM_MAX_TIMEOUT_MS`, `normalizeStreamTimeoutMs`, durable job
  deadline fields, activity/heartbeat handling, and timeout reaping.
- `server/fastify/src/routes/streamJobs.ts`: durable stream job `timeoutMs`
  request surface.
- `server/fastify/src/requestAbort.ts`: `NON_DURABLE_REQUEST_DEADLINE_MS` and
  request abort timer.
- Existing focused suites:
  `server/fastify/__tests__/streamJobs.test.ts`,
  `server/fastify/__tests__/streamJobsRoutes.test.ts`,
  `server/fastify/__tests__/durableGeneration.test.ts`, and
  `server/fastify/__tests__/requestAbort.test.ts`.

## Target Shape

- Choose and implement one explicit policy for long-running active streams:
  either a client/configurable `timeoutMs` cap shared by durable and
  non-durable chat generation, or a sliding deadline advanced by provider
  activity.
- Normalize all client-supplied or configured timeout values through one
  bounded helper and cap them at `PROXY_STREAM_MAX_TIMEOUT_MS`.
- Apply the same policy to `startDurableGeneration` and the non-durable
  `withRequestAbort` path so the two send modes do not diverge.
- If using a sliding deadline, refresh the deadline on token/content activity
  and heartbeat frames that prove the provider is still alive. Idle jobs with no
  activity must still time out.
- Persist or reconstruct enough deadline metadata for detached durable jobs so
  reattach and timeout cleanup stay coherent after a reconnect.
- Preserve user cancel, client disconnect, and explicit abort behavior ahead of
  the longer/sliding deadline.
- Add fake-timer tests for an actively-streaming generation that exceeds the
  old 600 second wall clock, a no-token generation that still dies, explicit
  timeout normalization/capping, and the non-durable twin.
- Register L1 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Default successful generations keep the same response and persisted message
  shape.
- A runaway provider that produces no usable activity cannot live forever.
- Manual cancel, lock cleanup, finalization retry behavior, and reattach status
  semantics remain unchanged.
- Timeout changes must not widen request body or stream buffer limits.

## Done Criteria

- A >deadline active stream survives under the selected policy.
- A silent or hung generation is still cancelled within the bounded deadline.
- Durable and non-durable paths share the same timeout normalization and cap.
- The L1 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/requestAbort.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
