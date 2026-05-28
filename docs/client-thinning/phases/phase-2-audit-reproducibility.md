# Phase 2: Audit Reproducibility

Date: 2026-05-29

Status: active and first priority.

## Goal

Define and complete the standalone audit reproducibility task: every
client-thinning audit rule has a committed pre-fix fixture and a test proving
the rule exits non-zero for that regression class.

## Current Boundary

- `pnpm client-thinning:audit` exists.
- Rules are structural and source-derived in many places.
- Rule inventory is reconciled with the 20 concrete checks in
  `util/client-thinning-audit.ts`; see `../coverage/audit.md`.
- Fixture/test proof for each rule is not yet present in this active workstream.

## Deliverables

- Audit fixture harness.
- One or more pre-fix fixture files per rule family.
- Tests that run rules against fixtures and assert failure.
- Documentation updates in `status/audit.md` and `coverage/audit.md`.

## Actionable Slices

1. Rule inventory.
   - Objective: enumerate the rule families currently enforced by
     `util/client-thinning-audit.ts` and reconcile the list with
     `status/audit.md` and `coverage/audit.md`.
   - Scope: planning docs and audit-test design only; do not mark a rule
     covered until fixture/test proof exists.
   - Status: complete as of 2026-05-29.
   - Done: each rule has a named fixture target, expected failing shape, and
     non-zero assertion to implement in `../coverage/audit.md`.
2. Fixture harness.
   - Objective: add a reusable test harness that runs the audit against
     committed fixture source trees and returns exit code, stdout, and stderr
     for assertions.
   - Scope: audit tooling and tests only. Preserve
     `pnpm client-thinning:audit` as the single package entry point for the
     live repository audit.
   - Status: complete as of 2026-05-29.
   - Done: a test can run one fixture in isolation and assert the audit exits
     non-zero without checking out old commits.
3. First rule-family proof.
   - Objective: implement the first complete pre-fix fixture and test for one
     rule family, preferably the smallest family from the inventory.
   - Scope: one rule family, its fixture files, and any harness adjustment
     needed to make the assertion specific to that rule.
   - Status: complete for `A4R-saveasset filename classification` as of
     2026-05-29.
   - Done: the test proves the fixture fails with the intended diagnostic, the
     live audit still passes, and the fixture layout is reusable for the
     remaining families.
4. Remaining rule families.
   - Objective: repeat the proven pattern for every remaining rule family
     listed in the inventory.
   - Scope: fixture and test additions for the current audit rules, plus narrow
     audit-runner seams only when a fixture cannot otherwise exercise the rule.
   - Status: active; `A4R-backup data dir inventory` is complete as of
     2026-05-29.
   - Done: each rule family has at least one committed pre-fix fixture, a test
     that asserts non-zero exit, and rule-specific proof that the intended
     regression class is caught.
5. Reproducibility docs and defaults.
   - Objective: document the completed fixture matrix and make fixture/test
     proof the expected default for future audit rules.
   - Scope: `status/audit.md`, `coverage/audit.md`, and any local audit test
     README created by the harness.
   - Done: reviewers can find the command, fixture path, covered rule family,
     and expected failure signal for every audit rule.

## Exit Criteria

- A reviewer can reproduce "this rule would have caught the old bug class"
  without checking out old commits.
- The audit still runs through one package script.
- New audit rules include fixture/test proof by default.

## Next Handoff

Continue slice 4 by adding the next rule-family fixture proof. Start with
`A4R-bounded process-lifetime accumulators` unless current source inventory
reveals a more urgent rule gap. Follow the established pattern in
`util/client-thinning-audit.test.ts` and
`util/client-thinning-audit-fixtures/backup-data-dir-inventory/`: add a
minimal fixture root, select one audit check with
`CLIENT_THINNING_AUDIT_CHECK_IDS`, assert non-zero exit with the intended check
id, and keep `pnpm client-thinning:audit` passing.
