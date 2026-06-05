# Slice: Registry Universe Final Sweep

Phase: [9](../../phase-9-verification-budgets.md). Depends on all scheduled
Phase 1-8 implementation and verification-refresh slices. No runtime change.

## Scope

Perform the final completeness sweep over the v2 audit universe before the
closing full verification run. This slice proves that every scheduled finding
has left the planning state and that the registry still mirrors the active risk
map exactly.

This slice does not archive the plan or run the full proof set.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  exit criteria.
- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  for the H/M/L/I/R universe and Known-Item Overlaps evidence.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  scheduled, gated, and no-action routing.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.

## Target Shape

- `SCHEDULED_FIXES` contains every scheduled ID that closed as `DONE`:
  H1-H3, M1-M22, L1-L11 except L12, L13-L59, and K1-K4.
- No live `PLANNED` entries remain in the v2 registry.
- No scheduled `PENDING` rows remain in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- Any scheduled ID that did not close is explicitly re-gated with an
  owner-approved reason in both the registry and risk map.
- `INTENTIONALLY_GATED` still owns L12 plus the v1 carry-over and
  `leftover.md` references; they are not duplicated as scheduled entries.
- `NO_ACTION` still owns I1-I18 and R1-R13 with substantive reasons.
- The gate's bidirectional doc checks still fail on new IDs, missing IDs,
  phase/status mismatch, and double classification.

## Invariants

- Each v2 ID appears in exactly one classification bucket.
- K1-K4 are scheduled v2 residuals, not v1 archive entries.
- Risk-map target-fix text and registry fix labels remain aligned unless the
  implementation intentionally refined the wording.
- Do not change production code in this slice.

## Done Criteria

- The v2 gate reports zero registry/doc drift problems.
- There are no `PLANNED` entries in `SCHEDULED_FIXES`.
- There are no scheduled `PENDING` rows in `active-risk-analysis.md`.
- The first two parent Phase 9 exit criteria are ready to check off.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts
```
