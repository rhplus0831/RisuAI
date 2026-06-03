# Clone-Cost Gate Completeness

Status: planned. Phase 8. Standing verification-gate layer.

## Scope

Ensure every narrowed hot path keeps a clone-cost regression gate. Make the gate
map self-checking against the audit inventory.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the clone-site inventory (the universe of hot paths) and the "General principle"
  closeout.
- [`../phase-0-baseline-foundations/clone-cost-regression-harness.md`](../phase-0-baseline-foundations/clone-cost-regression-harness.md) -
  the harness this slice keeps complete.
- `src/ts/compatibilityAdapters.test.ts` - the per-slice gate template.

## Target Implementation

- Maintain one list of narrowed hot paths: file:line plus the snapshot/guard
  helper used.
- For each entry assert: (a) the snapshot it captures omits the full collection
  (`assertSnapshotIsScalar`), and (b) the path does not invoke the whole-DB /
  whole-characters clone primitive (`withCloneInstrumentation`).
- Add a self-checking test that fails if a narrowed inventory entry lacks a gate.
- Record intentionally broad paths with the reason, so "no gate" is never
  ambiguous.

## Maintenance

- Keep [`../../../latest-verification.md`](../../../latest-verification.md)
  current after each focused or full run. Record the before/after clone range for
  the slice under test. Replace the latest-run section; do not append history.
- Add the matching gate as each Phase 2-7 slice lands; do not mark a slice
  implemented without it.

## Done When

- Every Critical/High narrowed path has a clone-cost regression test and a
  rollback-correctness test.
- The self-checking test asserts the gate set covers the inventory's narrowed
  hot-path entries and fails on drift.
- `latest-verification.md` reflects the latest run; the replace-not-append rule is
  followed.
- `pnpm test`, `pnpm api:test`, and `pnpm client-thinning:audit` are green.

## Validation

- The clone-cost harness suite (gate-completeness self-check).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
