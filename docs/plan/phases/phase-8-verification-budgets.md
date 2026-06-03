# Phase 8: Verification Budgets

Status: planned. Standing verification-gate layer.

Goal: ensure every narrowed hot path keeps a clone-cost gate. This phase does not
narrow new paths; it makes the gate map self-checking.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the clone-site inventory (the universe of hot paths a gate must cover) and the
  "General principle" closeout.
- `src/ts/compatibilityAdapters.test.ts` - the reference fix's snapshot +
  rollback proof (the per-slice gate template).
- [`slices/phase-0-baseline-foundations/clone-cost-regression-harness.md`](slices/phase-0-baseline-foundations/clone-cost-regression-harness.md) -
  the harness this phase keeps complete.

## Slices

- [`clone-cost-gate-completeness.md`](slices/phase-8-verification-budgets/clone-cost-gate-completeness.md) -
  list narrowed hot paths, assert each has a clone-cost test, and add a
  self-check that fails when an inventory entry lacks a gate. Keep
  [`../latest-verification.md`](../latest-verification.md) current.

## Exit Criteria

- [ ] Every Critical/High narrowed path has a clone-cost regression test and a
      rollback-correctness test.
- [ ] A self-checking test asserts the gate set covers the inventory's
      hot-path entries (no narrowed path is left ungated), and fails on drift.
- [ ] `latest-verification.md` records the latest before/after clone range; the
      maintenance rule (replace, do not append) is followed.
- [ ] `pnpm test`, `pnpm api:test`, and `pnpm client-thinning:audit` are green.

## Validation

- The clone-cost harness suite (gate-completeness self-check).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
