# Slice: Standing Gate Maintenance

Phase: [9](../../phase-9-verification-budgets.md). Depends on the Phase 0 v2
gate and whichever Phase 1-8 fix is being flipped. No runtime change.

## Scope

Maintain the Phase 9 flip contract whenever a scheduled finding fix lands. This
is a repeatable maintenance slice: take it after the runtime/proof slice has
added its focused regression test and is ready to mark one or more IDs `DONE`.

This slice does not implement the finding fix, invent substitute proof, or close
Phase 9.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  standing contract.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- `src/ts/__tests__/fixCompletenessGate.test.ts` for the frozen v1 archive
  gate.

## Target Shape

- For each landed scheduled ID, flip the v2 gate registry entry from `PLANNED`
  to `DONE` with its phase, real `testPath`, `testName`, and any `extraTests`
  needed for multi-proof fixes.
- Flip the matching
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) row
  from `PENDING` to `DONE` in the same commit.
- Refresh [`../../../latest-verification.md`](../../../latest-verification.md)
  with the focused proof and gate result for the landed ID. If a phase-level
  verification-refresh slice owns the broad command run, link or summarize that
  entry instead of duplicating it.
- Keep `INTENTIONALLY_GATED` and `NO_ACTION` classifications unchanged unless
  an owner-approved decision explicitly re-gates a scheduled ID.
- If an owner-approved re-gate happens, move the ID out of `SCHEDULED_FIXES`,
  add a substantive reason to `INTENTIONALLY_GATED`, update the risk-map row,
  and record the decision in
  [`../../../latest-verification.md`](../../../latest-verification.md).

## Invariants

- Do not mark an ID `DONE` without a regression test that proves the exact
  bounded/narrowed behavior from its implementation slice.
- The v2 gate is the only registry for v2 IDs; do not mix entries into the v1
  gate.
- The v1 gate remains pointed at
  `docs/archive/audit-stability-and-performance/` and must stay green.
- A focused test failure is not papered over by a passing gate; both must be
  recorded honestly.

## Done Criteria

- Every ID touched by the landed fix is `DONE` in both the v2 gate registry and
  the active risk map, or explicitly re-gated with a recorded reason.
- The registered test path exists and contains the named test.
- The v2 gate and v1 gate both pass.
- `latest-verification.md` has a fresh entry for the flip.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
```
