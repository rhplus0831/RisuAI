# Phase 8: Verification Budgets

Status: planned. Standing verification-gate layer.

Goal: ensure every narrowed hot path keeps a clone-cost gate. This phase does not
narrow new paths; it makes the gate map self-checking.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the clone-site inventory (the universe of hot paths a gate must cover) and the
  "General principle" closeout.
- `src/ts/__tests__/cloneCostHarness.ts` - the reusable structural,
  rollback-correctness, and clone-instrumentation helper.
- Existing Phase 0-2 coverage lives across `chatCommands.test.ts`,
  `characterCommands.test.ts`, `lorebookBridge*.test.ts`,
  `chatBridge.svelte.test.ts`, and `rerollNavigation*.test.ts`.

## Slices

- [`clone-cost-gate-completeness.md`](slices/phase-8-verification-budgets/clone-cost-gate-completeness.md) -
  list narrowed hot paths, map them to their existing or new clone-cost tests, and
  add a self-check that fails when an inventory entry lacks a gate. Keep
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
