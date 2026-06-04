# Stability And Performance Remediation Phases

Date: 2026-06-04

Use these files for phase scope, exit criteria, and slice routing. Concrete
slices live under `slices/[phase]/[slice-name].md`. Every finding ID is defined
in
[`../audit-stability-and-performance.md`](../audit-stability-and-performance.md);
the finding -> phase map is in
[`../active-risk-analysis.md`](../active-risk-analysis.md).

- Phase 0, complete (foundations; no runtime change):
  [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md),
  [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/).
- Phase 1, complete (the three high-severity fixes):
  [`phase-1-high-severity-hot-paths.md`](phase-1-high-severity-hot-paths.md),
  [`slices/phase-1-high-severity-hot-paths/`](slices/phase-1-high-severity-hot-paths/).
- Phase 2, complete (Root 1 — server broad-load narrowing; all four slices
  landed: M1/L1/L2, M3/L5/L6, M4, M5/L10/U1):
  [`phase-2-server-load-narrowing.md`](phase-2-server-load-narrowing.md),
  [`slices/phase-2-server-load-narrowing/`](slices/phase-2-server-load-narrowing/).
- Phase 3, complete (Root 2 — client clone narrowing; one batch landed:
  M12-M14, L31-L36, U4):
  [`phase-3-client-clone-narrowing.md`](phase-3-client-clone-narrowing.md),
  [`slices/phase-3-client-clone-narrowing/`](slices/phase-3-client-clone-narrowing/).
- Phase 4, not started (Root 4 — outbound request lifecycle):
  [`phase-4-outbound-request-lifecycle.md`](phase-4-outbound-request-lifecycle.md),
  [`slices/phase-4-outbound-request-lifecycle/`](slices/phase-4-outbound-request-lifecycle/).
- Phase 5, not started (Root 5 — materialization & lifecycle):
  [`phase-5-materialization-and-lifecycle.md`](phase-5-materialization-and-lifecycle.md),
  [`slices/phase-5-materialization-and-lifecycle/`](slices/phase-5-materialization-and-lifecycle/).
- Phase 6, not started (memory & Lua):
  [`phase-6-memory-and-lua.md`](phase-6-memory-and-lua.md),
  [`slices/phase-6-memory-and-lua/`](slices/phase-6-memory-and-lua/).
- Phase 7, not started (memoization & hygiene):
  [`phase-7-memoization-and-hygiene.md`](phase-7-memoization-and-hygiene.md),
  [`slices/phase-7-memoization-and-hygiene/`](slices/phase-7-memoization-and-hygiene/).
- Phase 8, standing (verification budgets; scaffold live):
  [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md),
  [`slices/phase-8-verification-budgets/`](slices/phase-8-verification-budgets/).

## Slice Rules

- One slice is one implementation or proof batch.
- Each slice includes scope, anchors, target shape, invariants, done criteria,
  and validation.
- Keep slices small enough to pick up from [`../next-steps.md`](../next-steps.md).
- Every fix needs a regression test: clone-cost/scoped-load for narrowing,
  behavior for bounds/correctness, round-trip for codec/export changes. Register
  the gate per
  [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md).
- Preserve the broad path for its genuine consumer; narrow only the hot path.
