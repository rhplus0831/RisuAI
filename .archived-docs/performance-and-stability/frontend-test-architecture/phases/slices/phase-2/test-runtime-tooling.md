# Phase 2 Slice: Test Runtime Tooling

Status: Complete

## Scope

Promote these existing test-runtime and aggregate-runner contract suites from
the Happy-DOM fallback to the explicit Node inventory without changing their
assertions, subjects, or shared setup:

- `util/test-all.test.ts`
- `vitest.fetchGuard.test.ts`
- `vitest.setup.test.ts`

The three files contain 18 tests. They move from D to N ownership. This slice
does not change `vitest.dom.setup.ts`: the unexpected-fetch guard remains
installed exclusively for DOM-owned suites even though its plain TypeScript
unit contract now runs in Node.

## Source Anchors And Dependencies

- `util/test-all.test.ts` imports Node filesystem APIs, the static UI-coverage
  inventory, and `util/test-all.ts`. Its subject uses Node process, path,
  filesystem, URL, and child-process APIs; the executable entry point is guarded
  so importing it does not launch quality lanes.
- `vitest.fetchGuard.test.ts` imports only Vitest and
  `vitest.fetchGuard.ts`. URL, `Request`, `Response`, and `fetch` are available
  in the supported Node 24 runtime. Every fetch implementation is an explicit
  test double, so the suite performs no network access.
- `vitest.setup.test.ts` imports only Vitest and exercises
  `safeStructuredClone` through the shared `vitest.setup.ts`. The shared setup
  already runs in N, S, and D and has no DOM dependency.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.
- `phase-0-inventory.tsv` remains generated classification evidence rather
  than routing authority.

## Behavior Invariants

- Aggregate-lane concurrency, ordering, dependency-failure handling, cycle
  rejection, UI-map exclusion, and performance-gate isolation retain their
  existing assertions.
- Loopback-port URL detection, relative and `Request` URL resolution,
  pre-network rejection with the originating stack, allowed-fetch forwarding,
  and global-fetch restoration retain their existing assertions.
- Native structured-clone values, production fallback cloning, and global
  restoration retain their existing assertions.
- `vitest.dom.setup.ts` continues to install and audit the Happy-DOM fetch guard
  for D-owned suites. No DOM/browser contract or setup ownership changes.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their focused
run changed from 1.05s wall / 305ms Vitest / 395,412 KiB peak RSS / 398ms
aggregate environment time in D to 1.00s / 216ms / 301,108 KiB / 0ms in N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 128 N / 2 S / 399 D to 131 N / 2 S / 396 D. Wall time changed
from 68.90s to 69.19s (+0.29s, +0.4%), Vitest duration changed from 68.05s to
68.36s, and peak RSS changed from 4,734,372 KiB to 4,938,776 KiB. The small
ordinary-lane movement is within run-to-run noise and is not a material
regression; the paired DOM project fell from 71.95s to 69.52s while the Node
project remained effectively flat at 4.02s to 4.03s.

This is a single paired slice observation, not a phase-level timing claim. The
Phase 0 three-run median remains the comparison baseline until the next
phase-level measurement gate.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 18 tests.
- The focused `frontend-node` probe passed 3 files / 18 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 132 N / 2 S /
  403 D, standalone ordinary ownership at 132 N / 2 S / 401 D, and aggregate
  ordinary ownership at 131 N / 2 S / 396 D.
- Full standalone Node and DOM runs passed 132 files / 813 tests and 401 files /
  5,795 tests respectively.
- `pnpm test:frontend` passed 535 files / 6,616 tests.
- `pnpm test:affected --dry-run` selected frontend, performance-gate, and server
  lanes. The selected run passed 535 frontend files / 6,616 tests, 2 gate files /
  6 tests, and 154 server files / 3,295 tests with 1 skipped.
- The periodic Phase 2 `pnpm test:all` checkpoint passed all eight lanes in
  3m25.6s runner time; formatting and `git diff --check` also passed.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three target-project probes and repeated owning-run executions pass.
- The generated inventory removes all three target-N probe markers.
- File and test totals are unchanged, and the DOM-only fetch-guard installation
  remains in D.
- The paired ordinary lane does not materially regress.

## Rollback

Remove the three paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
