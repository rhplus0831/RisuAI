# Slice: Horde Delete Timeout

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Finding: L4.
Provider cleanup resilience change.

## Scope

Bound the fire-and-forget Horde cleanup DELETE so a cancelled or timed-out
Horde job cannot leave a DELETE socket alive until undici's default timeout.

This slice owns only the cleanup DELETE fired after a Horde job has already
been abandoned. It does not change Horde submit/poll deadlines, provider
request payloads, polling cadence, or user-visible result mapping.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L4.
- `server/fastify/src/generation/horde.ts`: `fireDeleteJob()`, abort listener,
  impossible/faulted/timeout paths.
- `server/fastify/__tests__/horde.test.ts`: existing assertions that DELETE is
  fired on abort, timeout, impossible, and faulted jobs.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L4 proof registration.

## Target Shape

- Add a small default cleanup DELETE timeout constant, likely in the 5-15
  second range.
- Pass an abort signal to the DELETE fetch using `AbortSignal.timeout()` when
  available in the supported Node runtime.
- If a compatibility helper is needed, keep it local and tiny.
- Preserve fire-and-forget behavior: `fireDeleteJob()` should still return
  `void`, ignore failures, and never delay the caller's abort/failure return.
- Add a test where the DELETE fetch never resolves and prove the fetch receives
  an aborting signal or is otherwise bounded without waiting for the long
  timeout in real time.
- Register L4 as `DONE` in the v3 gate and flip only the L4 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Cleanup DELETE remains best-effort.
- A hung DELETE cannot keep a socket alive past the cleanup timeout.
- Submit and polling fetches still use the caller's Horde request signal.
- Existing successful, impossible, faulted, explicit-abort, and timeout Horde
  behavior remains unchanged.

## Done Criteria

- Every `fireDeleteJob()` DELETE includes a bounded abort signal.
- A hung DELETE is aborted by the cleanup timeout in a focused test.
- Existing tests still prove DELETE is attempted on abort, impossible, faulted,
  and timeout paths.
- L4 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/horde.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
