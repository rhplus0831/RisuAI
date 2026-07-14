# Slice: Proxy Default Deadline

Phase: [8](../../phase-8-server-bounds.md). Finding: L31. Runtime change.

## Scope

Apply a default upstream deadline to `/api/v1/proxy/fetch` when
`risu-timeout-ms` is absent, while still honoring bounded client-supplied
timeouts.

This slice does not own proxy stream-job deadlines, hub forwards, provider
generation deadlines, or proxy response buffering.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L31.
- `server/fastify/src/routes/proxy.ts`: `/api/v1/proxy/fetch` timeout header
  parsing, close abort, and error mapping.
- `server/fastify/src/proxy.ts`: `getRequestTimeoutMs`,
  `createTimeoutController`, proxy-control header stripping, and timeout cap
  helper location.
- `server/fastify/src/requestAbort.ts`: `NON_DURABLE_REQUEST_DEADLINE_MS` if
  the default should mirror generation's backstop.
- Existing focused suites:
  `server/fastify/__tests__/proxy.test.ts` and
  `server/fastify/__tests__/routeProtection.test.ts`.

## Target Shape

- When `risu-timeout-ms` is absent or empty, use a default deadline matching
  `NON_DURABLE_REQUEST_DEADLINE_MS` or a shared constant with the same value.
- Keep explicit valid `risu-timeout-ms` values working, but cap excessive
  values to the accepted maximum instead of allowing an unbounded upstream
  wait.
- Reject or normalize invalid header values consistently with the existing
  behavior; document any intentional compatibility choice in tests.
- Keep request-close abort behavior so disconnects beat the timer.
- Clear timers on success, timeout, upstream error, and close abort.
- Add tests for absent header timeout, capped excessive header, valid explicit
  timeout, invalid header behavior, and no leaked control header upstream.
- Register L31 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful proxy fetch responses keep status, body, and allowed headers.
- Client disconnect still aborts upstream promptly.
- Proxy-control headers, including `risu-timeout-ms`, are not forwarded.
- The default deadline must not affect stream-job timeout normalization.

## Done Criteria

- A proxy fetch with no `risu-timeout-ms` times out under the default
  deadline.
- Excessive client timeout values are capped.
- Timers and abort controllers are cleaned up on every tested exit path.
- The L31 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof Details

- Runtime proof: `server/fastify/src/proxy.ts` normalizes missing, empty, and
  invalid `risu-timeout-ms` values to the shared 600s default request timeout;
  valid explicit values are preserved; excessive explicit values are capped at
  the shared maximum.
- Abort proof: `server/fastify/src/routes/proxy.ts` always combines the proxy
  timeout signal with the request-close signal, reports timeout failures
  explicitly, keeps close aborts distinct, and clears the timer/listener in
  `finally`.
- Regression proofs: `server/fastify/__tests__/proxy.test.ts` covers the
  absent-header default deadline, excessive-header cap, valid explicit timeout,
  invalid-header defaulting, timer cleanup, success passthrough, and proxy
  control-header filtering under `L31:` test names.
- Gate proof: `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L31 as
  `DONE` with the focused proxy proof paths;
  `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`
  marks L31 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/proxy.test.ts \
  server/fastify/__tests__/routeProtection.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
