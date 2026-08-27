# Phase 7: Verification And Closeout

Status: Pending Phase 6

## Objective

Prove the final architecture preserves behavior and materially reduces required
execution time, close all documentation, and archive the workstream.

## Final Measurement

On the same recorded host/toolchain:

- run three warm ordinary frontend measurements and report median/range;
- run one separately labeled cold-cache measurement;
- measure every frontend project independently;
- record file/test distribution, Vitest phases, wall/user/system time, average
  CPU, and peak RSS;
- run focused UI coverage and record its timing/threshold result;
- run the complete `test:all` aggregate and record every lane;
- compare all results with the formal Phase 0 baseline and each acceptance target.

Do not compare a quiet standalone final run only with a contended historical
aggregate run.

## Correctness Closeout

- Verify the exhaustive/disjoint project map from runner discovery.
- Verify test counts and explain every intentional delta since Phase 0.
- Run repeated/shuffled checks for any project or harness with reduced sharing
  boundaries.
- Confirm no unexpected network, leaked handles, order dependencies, or new
  retries.
- Confirm DOM-visible, accessibility, focus, optimistic-paint, rollback, and
  browser contracts remain represented.
- Confirm affected routing, UI coverage, performance gates, and CI match local
  ownership.

## Documentation Closeout

- Update `docs/structure/testing-and-operations.md` with final commands,
  environments, routing, setup, and lane behavior.
- Update `docs/tests/README.md` with classification rules and retained gaps.
- Update `STRUCTURE.md` and any runner/config comments that describe the old
  two-project topology.
- Replace provisional records in `../latest-verification.md` with final results.
- Mark all phases complete in `../status.md` and record any explicit deferred
  follow-up with a revisit condition.
- Move the intact workstream to
  `.archived-docs/performance-and-stability/frontend-test-architecture/` and
  update archive/current plan indexes.

## Acceptance Criteria

- All required correctness and quality lanes pass.
- The primary median frontend reduction target is met, or the status records an
  explicit accepted shortfall with evidence and decision rationale.
- Required UI coverage and full aggregate execution do not materially regress
  outside accepted new coverage.
- Peak RSS remains within the ratified budget.
- The file-to-project map is exhaustive and disjoint.
- No open correctness, routing, coverage, CI, or documentation blocker remains.
- The active-plan link is removed only after the archive link is valid.

## Validation

- Complete formal measurement matrix above
- `pnpm test:frontend`
- `pnpm test:frontend:all`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:server`
- `pnpm test:smoke`
- `pnpm check`
- `pnpm check:server`
- `pnpm format:check`
- `pnpm test:all`
- `git diff --check`
