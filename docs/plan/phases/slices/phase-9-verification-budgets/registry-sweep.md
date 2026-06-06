# Slice: Registry Sweep

Phase: [9](../../phase-9-verification-budgets.md). Depends on all scheduled
Phase 1-8 implementation and verification-refresh slices. No runtime change.

## Scope

Perform the final v3 completeness sweep before closeout. This slice proves
that every scheduled finding ID has left the planning state and that the v3
gate registry, risk map, and audit universe agree exactly.

This slice does not run the full closeout command set and does not archive the
plan.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  exit criteria.
- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  for the H/M/L/I/R universe and Known-Item Overlaps evidence.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  scheduled, gated, and no-action routing.
- [`../../../latest-verification.md`](../../../latest-verification.md) for the
  most recent proof entries backing status flips.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`.
- Frozen prior gates:
  `src/ts/__tests__/fixCompletenessGate.test.ts` and
  `src/ts/__tests__/fixCompletenessGateV2.test.ts`.

## Target Shape

- `SCHEDULED_FIXES` in the v3 gate contains every scheduled v3 ID that closed
  as `DONE`: H1, M1-M9, L1-L56, and K1-K4.
- No live `PLANNED` entries remain in the v3 registry.
- No scheduled `PENDING` rows remain in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- Any scheduled ID that did not close is explicitly re-gated with an
  owner-approved reason in both the registry and risk map.
- The v3 gate still classifies all non-scheduled IDs exactly once:
  informational I1-I23 as no-action, dismissed R1-R5 as dismissed/no-action,
  and the inherited v2/v1/leftover evidence gates as intentionally gated.
- No `PLANNED`/`PENDING` drift exists between the v3 registry,
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md), and
  [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md).
- Prior v1/v2 gates still pass unchanged while the v3 registry is swept.

## Invariants

- Each v3 audit ID appears in exactly one classification bucket.
- K1-K4 remain scheduled v3 known-overlap residuals; do not move them into
  the v1 or v2 archived registries.
- Risk-map target-fix text and registry labels remain aligned unless a landed
  implementation intentionally refined the wording.
- Do not mark an ID `DONE` unless its landed slice already added focused
  regression proof.
- Do not change production code in this slice.

## Done Criteria

- The v3 gate reports zero registry/doc/risk-map drift problems.
- There are no `PLANNED` entries in the v3 `SCHEDULED_FIXES`.
- There are no scheduled `PENDING` rows in `active-risk-analysis.md`.
- Any re-gated scheduled ID has explicit owner-decision text in the registry,
  risk map, and verification log.
- The parent Phase 9 registry-sweep exit criterion is ready to check off.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
```
