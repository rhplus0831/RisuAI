# Phase 2 Slice: Startup Lifecycle State Helpers

Status: Complete

## Scope

Promote these existing startup lifecycle state-helper suites from the
Happy-DOM fallback to the explicit Node inventory without changing their test
bodies or production subjects:

- `src/ts/process/legacyMemoryMigrationNotice.test.ts`
- `src/ts/server/startupTelemetry.test.ts`

The two files contain eight tests. They move from D to N ownership as one
dependency-isolated startup lifecycle slice.

## Source Anchors And Dependencies

- `legacyMemoryMigrationNotice.test.ts` replaces the Svelte-named resource
  projection and settings persistence boundaries, plus the alert surface. The
  production subject's `Database` import is type-only, and the remaining graph
  is plain retired-algorithm detection, once-per-database notice state, and
  dismissal planning.
- `startupTelemetry.test.ts` replaces the server-auth boundary and explicitly
  stubs `fetch`. The subject depends on the plain startup-readiness state
  machine and browser-safe protocol constants; Node 24 supplies the `Response`
  used by the existing transport stub.
- Neither suite mounts a component, accesses the DOM or browser storage, or
  performs a real network request. No mock was added or weakened for promotion.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.

## Behavior Invariants

- Retired memory detection still distinguishes SupaMemory, legacy HypaMemory,
  Hypa V2, Hanurai, experimental Hypa V3, and maintained Hypa V3 selections.
- The legacy-memory notice remains non-blocking and once-per-database, and its
  dismissal is persisted only after the notice closes.
- Startup telemetry still backfills and deduplicates milestones, labels events
  with the settled observer rollout mode, and uses authenticated keepalive
  requests only after collection is enabled.
- Disabled or failing telemetry remains best-effort and cannot change startup
  readiness capabilities; pre-configuration diagnostics remain bounded.
- No rendered UI, Svelte rune, browser storage, or real-network contract
  changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their
focused run changed from 1.38s wall / 616ms Vitest / 391,080 KiB peak RSS /
333ms aggregate environment time in D to 1.13s / 411ms / 332,100 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 151 N / 2 S / 376 D to 153 N / 2 S / 374 D. Wall time
changed from 72.82s to 74.21s (+1.39s, +1.9%), Vitest duration changed from
71.84s to 73.26s, and peak RSS changed from 4,980,964 KiB to 4,898,600 KiB
(-1.7%). The paired DOM project improved from 67.58s to 63.88s while the Node
project changed from 4.34s to 4.71s.

The focused environment cost and ordinary peak RSS improved, while the
ordinary wall movement remains inside observed lane variability. This is one
paired slice observation, not a phase-level timing claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 2 files / 8 tests.
- The focused `frontend-node` probe passed 2 files / 8 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 154 N / 2 S /
  381 D, standalone ordinary ownership at 154 N / 2 S / 379 D, and aggregate
  ordinary ownership at 153 N / 2 S / 374 D.
- Complete standalone Node and DOM project runs passed 154 files / 922 tests
  and 379 files / 5,686 tests. The selected affected plan passed the complete
  535-file frontend lane, both performance gates, and the server lane.
- `pnpm format:check` and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed in this promotion, so the periodic Phase 2 `test:all` checkpoint
  remains satisfied by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- Both target-project probes and repeated owning-run executions pass.
- The generated inventory removes both promoted target-N probe markers.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove the two promoted paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
