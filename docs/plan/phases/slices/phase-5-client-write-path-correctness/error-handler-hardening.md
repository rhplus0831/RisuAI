# Slice: Error Handler Hardening

Phase: [5](../../phase-5-client-write-path-correctness.md). Finding: L37.
Riding informational item: I21. Client error handling hardening.

## Scope

Make global error and rejection handlers null-safe, and ensure alert
formatting can handle undefined or non-string payloads without throwing inside
the handler.

This slice owns the global browser `error` and `unhandledrejection` handlers
plus `alertError` coercion. It does not change logging policy, alert UI
layout, or unrelated alert helpers.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L37 and I21.
- `src/ts/bootstrap.ts`: global `error` and `unhandledrejection` listeners.
- `src/ts/alert.ts`: `alertError`.
- `src/ts/bootstrap.test.ts`: bootstrap handler coverage.
- Add or extend alert helper tests near `src/ts/alert.ts` if no current focused
  file exists.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  `docs/plan/active-risk-analysis.md` for L37 proof registration.

## Target Shape

- In the global `error` handler, check `event.target`, not
  `event.error.target`, when deciding whether the event came from a resource
  load failure.
- Treat missing `event.error`, missing `event.message`, and nullish targets as
  valid inputs that must not throw.
- Skip user alerts when there is no usable error message or error object to
  show.
- Keep resource-load error handling from producing useless application error
  alerts.
- In `unhandledrejection`, tolerate undefined, null, and arbitrary-object
  `event.reason` values.
- In `alertError`, coerce message payloads with `String(msg)` after the `Error`
  branch so undefined rejection reasons and plain objects do not throw inside
  alert rendering.
- Add focused tests for null-error events, resource-target events,
  undefined rejection reasons, and non-string `alertError` payloads.
- Register L37 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`;
  mention I21 in proof text and flip only the L37 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md)
  unless the table has an explicit informational row.

## Invariants

- Error handlers never throw while handling an error event.
- Empty or unusable global errors do not produce blank or misleading alerts.
- Useful thrown `Error` objects and useful message strings still alert.
- Resource load failures still bypass generic application error alerting.
- `alertError(new Error('x'))` keeps the current error-message behavior.

## Done Criteria

- A global `error` event with no `error` object and no useful message does not
  throw and does not alert.
- A resource-target `error` event reads `event.target` safely and does not
  throw.
- An `unhandledrejection` with `undefined` reason does not throw or create a
  useless alert.
- `alertError` accepts `Error`, string, undefined, null, and object payloads
  without throwing.
- L37 is registered as `DONE` in the v3 gate and active-risk table, with I21
  covered by the same proof text and no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/bootstrap.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
