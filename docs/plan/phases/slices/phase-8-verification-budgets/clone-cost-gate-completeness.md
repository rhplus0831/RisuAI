# Clone-Cost Gate Completeness

Status: planned. Phase 8. The standing verification-gate layer.

## Scope

Ensure every narrowed hot path keeps a clone-cost regression gate, and make the
gate map self-checking against the audit's clone-site inventory so a future edit
cannot silently reintroduce the whole-characters / whole-`Database` clone or leave
a narrowed path ungated.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the clone-site inventory (the universe of hot paths) and the "General principle"
  closeout.
- [`../phase-0-baseline-foundations/clone-cost-regression-harness.md`](../phase-0-baseline-foundations/clone-cost-regression-harness.md) -
  the harness this slice keeps complete.
- `src/ts/compatibilityAdapters.test.ts` - the per-slice gate template.

## Target Implementation

- Maintain a single list of the narrowed hot paths (file:line + the snapshot/guard
  helper each uses), derived from the inventory's critical/high/medium rows that
  this plan narrows.
- For each entry assert: (a) the snapshot it captures omits the full collection
  (`assertSnapshotIsScalar`), and (b) the path does not invoke the whole-DB /
  whole-characters clone primitive (`withCloneInstrumentation`).
- Add a self-checking test that fails if an inventory hot-path entry this plan
  claims to have narrowed lacks a gate (the analog of the mutation-range plan's
  "gate set == emitted set" budget test).
- Record any path intentionally left broad (e.g. a downgraded/benign item, or a
  genuine restructure that keeps the full clone) with the reason, so "no gate" is
  never silently ambiguous.

## Maintenance

- Keep [`../../../latest-verification.md`](../../../latest-verification.md) current
  after each focused or full run, recording the before/after clone range for the slice
  under test (the analog of the before/after written-table set). Replace the
  latest-run section; do not append history.
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
