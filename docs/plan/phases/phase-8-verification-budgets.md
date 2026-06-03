# Phase 8: Verification Budgets

Status: planned. The standing verification-gate layer; analogous to the
mutation-range plan's "verification budgets" phase.

Goal: ensure every narrowed hot path keeps a clone-cost regression gate so a
future edit cannot silently reintroduce the whole-characters / whole-`Database`
clone. This phase does not narrow a new path; it makes the narrowings durable and
the gate map self-checking.

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
  enumerate the narrowed hot paths from the inventory, assert each has a
  clone-cost regression test (snapshot omits the full collection AND the path does
  not invoke the whole-DB/whole-characters clone primitive), and add a
  self-checking test that fails if a narrowed path in the inventory lacks a gate.
  Keep [`../latest-verification.md`](../latest-verification.md) current after each
  focused or full run, recording the before/after clone range for the slice under
  test.

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
