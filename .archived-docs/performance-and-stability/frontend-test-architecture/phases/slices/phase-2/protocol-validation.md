# Phase 2 Slice: Protocol Validation

Status: Complete

## Scope

Promote these existing pure TypeScript protocol-validation suites from the
Happy-DOM fallback to the explicit Node inventory without changing production
code:

- `src/ts/server/characterSummaryProtocol.test.ts`
- `src/ts/server/shellProtocol.test.ts`
- `src/ts/server/startupTelemetryProtocol.test.ts`

The three files contain 19 tests. They move from D to N ownership. This slice
does not include the adjacent `startupTelemetry.test.ts` transport suite or the
storage serialization candidates; those have broader dependencies and remain
available for later bounded probes.

## Source Anchors And Dependencies

- `characterSummaryProtocol.test.ts` imports only Vitest and
  `characterSummaryProtocol.ts`; the subject has no runtime imports and uses
  plain object, array, number, string, and set validation.
- `shellProtocol.test.ts` imports only Vitest, `shellProtocol.ts`, and the
  character-summary protocol. The subject's `Database` dependency is type-only,
  and its only runtime dependency is `characterSummaryProtocol.ts`.
- `startupTelemetryProtocol.test.ts` imports the browser-safe shared protocol
  package. Its subject depends only on TypeBox schema construction and
  validation.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` already excludes every file in that inventory.
- `phase-0-inventory.tsv` remains generated classification evidence rather
  than routing authority.

## Behavior Invariants

- Exact wire keys, versions, nested revision coherence, forbidden detail
  fields, unique character/chat metadata, startup taxonomy, event bounds, and
  configuration validation retain all 19 assertions.
- No browser global, Svelte transform, DOM setup, fetch guard, or replacement
  mock is introduced.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.
- UI-map, performance-gate, affected-test, and server lane membership remain
  unchanged; broad frontend coverage continues to include all three suites
  through their new Node ownership.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. A paired
same-host ordinary run kept 529 files and 6,413 tests while moving the aggregate
ordinary distribution from 125 N / 2 S / 402 D to 128 N / 2 S / 399 D. Wall
time changed from 70.92s to 70.34s (-0.58s, -0.8%), Vitest duration changed
from 69.81s to 69.30s, and peak RSS changed from 5,121,984 KiB to 4,741,508 KiB.

This is a single paired slice observation, not a phase-level timing claim. The
Phase 0 three-run median remains the comparison baseline until the next
phase-level measurement gate.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 19 tests.
- The focused `frontend-node` probe passed 3 files / 19 tests without DOM
  environment time.
- The aggregate-ordinary project runs passed 128 Node files / 790 tests and 399
  DOM files / 5,615 tests after promotion.
- `pnpm test:frontend` passed 535 files / 6,616 tests.
- `pnpm check:frontend-test-inventory` proved full ownership at 129 N / 2 S /
  406 D, standalone ordinary ownership at 129 N / 2 S / 404 D, and aggregate
  ordinary ownership at 128 N / 2 S / 399 D.
- `pnpm test:affected --dry-run` selected frontend, performance-gate, and server
  lanes. The selected run passed 535 frontend files / 6,616 tests, 2 gate files
  / 6 tests, and 154 server files / 3,295 tests with 1 skipped.
- Full standalone Node and DOM project runs, formatting, and `git diff --check`
  completed successfully.

Exact commands, phase totals, resource observations, and counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three target-project probes and repeated owning-run executions pass.
- The generated inventory removes all three target-N probe markers.
- File and test totals are unchanged, and no visible-state contract moves out
  of D or B.
- The paired ordinary lane does not materially regress.

## Rollback

Remove the three paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production or test-body rollback is required.
