# Phase 0: Baseline, Inventory, And Rubric

Status: Complete. See
[`slices/phase-0-baseline-inventory-and-rubric/phase-0-baseline-and-pilot.md`](slices/phase-0-baseline-inventory-and-rubric/phase-0-baseline-and-pilot.md).

## Objective

Create an exhaustive, reproducible test-system inventory and ratify the
effectiveness/removal model before judging or changing any test.

## Scope

- Freeze the commit, working-tree state, toolchain, and runner topology.
- Enumerate all required, opt-in, direct-only, generated-matrix, and support
  owners, not only `*.test.ts` and `*.spec.ts` files.
- Record file, test-case, skip, parameterized-row, duration, coverage, and
  resource baselines by lane where reproducible.
- Assign every tracked test one primary category and secondary lane/type/seam
  tags.
- Define and, where practical, automate exhaustive/disjoint inventory checks.
- Ratify the value classes, decision labels, severity model, finding schema, and
  removal/consolidation proof from `../plan.md`.
- Pilot the rubric on representative strong, weak, duplicated, architecture
  policy, performance, compatibility, DOM, server, and browser tests.
- Rank Phase 1 and the first domain slices by risk and workload.

## Required Inventory Fields

At minimum, record:

- file and case/matrix owner;
- current lane/capability and specialized gate ownership;
- primary category and seam tags;
- test kind and value class;
- stable production owner or supported compatibility/policy contract;
- plausible defect and risk;
- companion/overlapping evidence;
- mocks, fixtures, timers, network, filesystem, database, global, and browser
  dependencies;
- decision, confidence, rationale, finding ID, action, validation, and state.

Support artifacts need separate rows or a linked manifest for setup files,
configs, runners, helpers, fixtures, goldens, snapshots, screenshots, test-only
exports, and stress/performance harnesses.

## Baseline Procedure

- Record Node, pnpm, Vitest, Playwright, Chromium, OS, CPU count, and working
  tree state.
- Run independent filesystem and runner discovery.
- Record full, standalone ordinary, aggregate ordinary, server, browser,
  performance, UI coverage, compatibility, and direct-only stress ownership.
- Capture the complete `test:all` lane graph before timing it.
- Use separately labeled cold and warm measurements; report median/range for any
  performance claim.
- Keep broad frontend/backend coverage report-only unless Phase 0 ratifies a
  specific risk-based floor. Do not invent a global percentage target.
- Preserve baseline failures with exact ownership instead of normalizing them
  away.

## Pilot Selection

Include at least:

- a critical data-integrity or recovery matrix expected to Keep;
- a mounted DOM or browser behavior test with visible assertions;
- a provider/security contract with mocked boundaries;
- an architecture/source policy test;
- a narrow mapping/default test;
- an apparent same-layer duplicate;
- a shared test oracle or helper test;
- one performance or scale gate;
- one compatibility/golden owner;
- one suspected Strengthen, Merge, or Remove candidate.

The pilot tests the rubric; it does not pre-approve removal. Ambiguous candidates
must use counterfactual evidence or remain Deferred.

## Exit Criteria

- The current test and support universe is reproducible and exhaustively owned.
- Every tracked test has one primary category and required secondary fields.
- Counts reconcile across filesystem discovery, runner discovery, special
  inventories, and opt-in owners.
- Rubric pilot decisions are independently explainable without relying on a
  numeric score.
- Removal proof, finding format, severity, and decision labels are ratified.
- Phase 1 and the first domain slice have exact inventory ranges and no ownership
  blocker.
- `../status.md`, `../findings/README.md`, and
  `../latest-verification.md` reflect the formal baseline.

## Validation

- `pnpm check:frontend-test-inventory`
- `pnpm test:all --dry-run`
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:smoke`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:compat-harness` when its pinned prerequisites are available
- direct `realmImport.test.ts` stress case in a separately labeled run
- `pnpm format:check`
- `git diff --check`

Run the full `pnpm test:all` formal baseline after the discovery and isolated
lane baselines are understood, so load-sensitive results are not misattributed.
