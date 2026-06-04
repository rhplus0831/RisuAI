# Stability And Performance Remediation Phases

Date: 2026-06-04

Use these files for phase status, scope, exit criteria, and slice routing.
Concrete slices live under `slices/[phase]/[slice-name].md`. Every finding ID is
defined in
[`../audit-stability-and-performance.md`](../audit-stability-and-performance.md);
the finding -> phase map is in
[`../active-risk-analysis.md`](../active-risk-analysis.md).

- Phase 0, not started (foundations; no runtime change):
  [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md),
  [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/).
- Phase 1, not started (the three high-severity fixes):
  [`phase-1-high-severity-hot-paths.md`](phase-1-high-severity-hot-paths.md),
  [`slices/phase-1-high-severity-hot-paths/`](slices/phase-1-high-severity-hot-paths/).
- Phase 2, not started (Root 1 — server broad-load narrowing):
  [`phase-2-server-load-narrowing.md`](phase-2-server-load-narrowing.md),
  [`slices/phase-2-server-load-narrowing/`](slices/phase-2-server-load-narrowing/).
- Phase 3, not started (Root 2 — client clone narrowing):
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
- Phase 8, not started (verification budgets):
  [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md),
  [`slices/phase-8-verification-budgets/`](slices/phase-8-verification-budgets/).

## Slice Rules

- One slice names one implementation batch or proof batch.
- Each slice includes scope, source anchors, the work being narrowed/bounded,
  the trigger, the target shape, the correctness/output invariant, done criteria,
  and validation.
- A phase can have many slices, but a slice should be small enough for an agent
  to pick up directly from [`../next-steps.md`](../next-steps.md).
- Every fix lands with a regression test: a clone-cost / scoped-load assertion
  for narrowing, a behavior test for a bound/correctness fix, a round-trip test
  for any codec/export change. Register the gate per
  [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md).
- Preserve the broad path for its genuine consumer; narrow only the hot path.
