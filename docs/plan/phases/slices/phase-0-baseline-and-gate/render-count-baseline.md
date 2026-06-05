# Slice: Render-Count Baseline Test

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on
[`render-count-harness.md`](render-count-harness.md). No runtime change.

## Scope

Use the render-count harness to record the pre-fix H3/M17/L40 behavior as a
test contract: a var-only `ReloadGUIPointer` bump causes every mounted message
to re-run the cold render-parse path.

## Anchors

- `src/ts/__tests__/renderCostHarness.ts` from
  [`render-count-harness.md`](render-count-harness.md).
- `docs/plan/audit-stability-and-performance-v2.md` H3, M17, and L40.
- `docs/plan/latest-verification.md` (record the observed baseline counts).

## Target Shape

- Add a client test, e.g. `src/ts/__tests__/renderCountBaseline.test.ts`.
- Use a fixed small N that is large enough to prove linear scaling, for example
  5 or 10 visible messages.
- Assert current pre-fix behavior:
  `parsesAfterBump === mountedMessages` for the full markdown path,
  `risuChatParser`/`displaya` work scales with the mounted message count, and
  `cacheWiped === true`.
- Label the test as a baseline/pre-fix contract so Phase 1 H3 can intentionally
  flip the assertions after narrowing the reload/remount path.
- Record the exact N and observed counts in
  [`../../../latest-verification.md`](../../../latest-verification.md).

## Invariants

- The test must be count-based and deterministic; do not assert wall-clock
  timing.
- The test must not add production memoization or change reload behavior.
- Keep the fixture small enough for the regular `pnpm test` suite.

## Done Criteria

- The baseline test fails if a GUI reload no longer re-parses every mounted
  message or no longer wipes the caches.
- `latest-verification.md` includes the baseline render-count entry with the
  command used to produce it.
- The focused render baseline test and the client suite pass.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts
pnpm test
```
