# Phase 13 — Consolidation, Adjudication, And Remediation

Status: Pending  
Depends on: Phases 0-12

## Objective

Turn completed domain inventories into one deduplicated, decision-complete,
bounded remediation queue; land shared structural gates and fix waves without
reopening discovery or allowing one regression test to bless an unsigned policy.

## Required Work

1. Map every raw report exactly once and merge duplicates by observable cause,
   not merely shared files.
2. Independently re-verify every Critical/High and every single-track finding.
3. Split multi-observable findings when remediation or authority differs.
4. Present each `decide` item with baseline/current evidence, user/data impact,
   parity option, migration cost, proposed behavior, tests, and revisit trigger.
5. Sequence remediation by shared mechanism and blast radius: data-loss and
   security first, then request/prompt correctness, lifecycle/recovery,
   interchange, and visible/diagnostic mismatches.
6. Land closed-world gates before or with fixes when they prevent the same
   omission class.
7. Re-run affected domain evidence after every shared harness, fixture,
   normalizer, persistence, or protocol change.

## Required Outputs

- Canonical findings/decisions with no orphan raw reports or duplicate ownership.
- Signed decision records for all accepted differences.
- Bounded remediation slices with exact inventory rows, rollback, regression
  proof, verification commits, and residual risks.
- Shared structural gates and updated current architecture/test documentation.
- Phase 14 run manifest with exact commands, prerequisites, and artifacts.

## Exit Criteria

- No unowned pending finding, unsigned expected difference, or silent
  unsupported surface remains.
- Critical/High findings are resolved or individually accepted with authority
  and revisit rules.
- Every implementation change has focused regression proof and updated
  inventory/finding state.
- All Phase 14 prerequisites and final test selections are reproducible.

## Validation

Each remediation slice runs focused tests, `pnpm test:affected --dry-run` and all
selected lanes, required domain/compatibility/browser gates, formatting, and
`git diff --check`. Broad harness/runner changes also run complete owning lanes
and `pnpm test:all` as required by `PLAN.md`.
