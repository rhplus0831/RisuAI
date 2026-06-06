# Slice: Proxy Stream Cancel

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Finding: L56.
Client transport cancellation change.

## Scope

Keep the browser proxy-job abort path armed for the full response stream. A
mid-stream client cancel should DELETE the server-side proxy stream job so the
upstream request aborts and the 64-job slot is released.

This slice owns the client-side proxy-job fetch path. It does not change proxy
job creation, server job deadlines, WebSocket auth, URL allow-listing, or
durable chat generation cancel behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L56.
- `src/ts/globalApi.svelte.ts`: `fetchViaProxyJobWs`, `abortHandler`,
  `closeAndEnd()`, `ws.onclose`, and the current removal of the abort listener
  immediately after headers arrive.
- `src/ts/network/proxyJobWs.test.ts`: proxy-job WebSocket helpers and
  parsing tests.
- `src/ts/globalApi.proxy.test.ts`: client proxy fetch behavior.
- Server-side confirmation tests, if needed:
  `server/fastify/__tests__/streamJobs.test.ts` and
  `server/fastify/__tests__/streamJobsRoutes.test.ts`.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L56 proof
  registration.

## Target Shape

- Keep the request abort listener attached after headers are ready and until
  the stream has truly closed.
- Track whether the server emitted a terminal proxy frame (`done` or `error`).
- On request abort before a terminal frame, issue
  `DELETE /api/v1/proxy/stream-jobs/:id` with the existing `risu-auth` header,
  then close the stream.
- On normal terminal `done` or terminal `error`, close the stream without
  sending a DELETE.
- On WebSocket close before a terminal frame, close the stream and decide
  whether the job should be deleted only if the local request was aborted; do
  not delete on ordinary server-side terminal close.
- Make `closeAndEnd()` responsible for clearing the listener exactly once.
- Preserve the pre-header abort behavior and the 499 response shape.
- Add tests that simulate:
  abort before headers,
  abort after headers but before `done`,
  normal `done`,
  server `error`, and
  WebSocket close without a local abort.
- Register L56 as `DONE` in the v3 gate and flip only the L56 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Client abort DELETEs the job at most once.
- Normal completion does not DELETE an already-finished job.
- The listener is removed on every local close path to avoid retaining
  request-scoped objects.
- The returned `Response` still resolves as soon as headers are available.
- Existing proxy error formatting and response headers remain unchanged.

## Done Criteria

- A mid-stream abort after headers causes one authenticated DELETE request for
  the proxy job.
- The server job's abort controller fires and the active job count drops.
- Normal `done` and server `error` paths do not issue a cancel DELETE.
- The abort listener is not left attached after `closeAndEnd()` or `ws.onclose`.
- L56 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/globalApi.proxy.test.ts \
  src/ts/network/proxyJobWs.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
