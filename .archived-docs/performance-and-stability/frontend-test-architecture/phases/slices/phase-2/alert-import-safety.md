# Phase 2 Slice: Alert Import Safety

Status: Complete

## Scope

Promote `src/ts/alert.importSafety.test.ts` and its one import-isolation test
from the Happy-DOM fallback to the explicit Node inventory.

The existing UI-store mock still targeted the historical `stores.svelte`
barrel after `alert.ts` moved its runtime dependency to
`stores/coreStores.svelte.ts`. The slice corrects that mock target so the test
continues to replace the dependency it was created to isolate. No production
module, alert helper behavior, or rendered alert contract changes.

## Source Anchors And Dependencies

- The suite replaces the actual core UI-store module with an empty partial
  mock, replaces the language projection, and retains its historical
  database-module mock before dynamically importing `alert.ts`.
- The empty UI-store mock is intentional: importing `alert.ts` may bind the
  mocked `alertStore` and `selectedCharID` names, but it must not subscribe to,
  read, or write either value until an alert helper is used.
- `alert.ts` creates its own plain Svelte writable at import time, but its
  passive-alert and result-dialog subscriptions remain lazy. Its database
  import is type-only, and the runtime `alertDatabase.ts` accessor is plain
  TypeScript.
- The real `stores/coreStores.svelte.ts` module initializes `$state`; executing
  that production UI-store module is outside the import-isolation contract.
  The stale mock path let Happy-DOM transform and execute it accidentally and
  caused the first unmodified Node probe to fail.
- No DOM API, browser storage, component mount, network request, or Svelte rune
  executes after the corrected dependency replacement.
- `alert.test.ts` remains in D with the full queue, timer, localStorage, and
  service integration contracts. Rendered alert components and browser smoke
  retain their existing D and B ownership.

## Behavior Invariants

- Importing alert helpers with deliberately partial UI dependencies does not
  subscribe to or access shared UI stores before a helper is invoked.
- Result-dialog and passive-alert bookkeeping remains lazy; this slice does not
  change FIFO ordering, caller ownership, stale-response rejection, or passive
  notice deferral.
- Full alert service, rendered focus/accessibility, browser storage, and Realm
  acceptance behavior remain under their existing DOM and browser owners.
- Correcting the stale mock restores the test's original dependency boundary;
  it does not replace a dependency exercised by the behavior under test.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The suite no longer starts Happy-DOM or loads `vitest.dom.setup.ts`. Its
focused run changed from 1.35s wall / 570ms Vitest / 308,312 KiB peak RSS /
105ms aggregate environment time in D to 0.97s / 203ms / 248,012 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 156 N / 2 S / 371 D to 157 N / 2 S / 370 D. Wall time
changed from 69.11s to 68.57s (-0.54s, -0.8%), Vitest duration changed from
68.21s to 67.71s, and peak RSS changed from 4,999,492 KiB to 4,751,748 KiB
(-5.0%). The paired DOM project changed from 71.46s to 68.67s while the Node
project changed from 4.63s to 4.88s.

The focused environment cost and peak RSS improved. The paired owning and
ordinary movements remain inside observed lane variability, so this is one
slice observation rather than a phase-level performance claim.

## Validation

- The pre-promotion Happy-DOM owner passed 1 file / 1 test.
- After adding the suite to the Node inventory but before correcting the stale
  mock, the target probe failed with `$state is not defined` in
  `stores/coreStores.svelte.ts`. This established the exact outdated boundary.
- After correcting the mock to the actual core-store module, two focused Node
  probes passed 1 file / 1 test with no environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 158 N / 2 S /
  377 D, standalone ordinary ownership at 158 N / 2 S / 375 D, and aggregate
  ordinary ownership at 157 N / 2 S / 370 D.
- Complete ordinary Node, DOM, and aggregate frontend runs passed 157 files /
  927 tests, 370 files / 5,478 tests, and 529 files / 6,413 tests.
- The selected affected plan passed the complete 535-file frontend lane, both
  performance gates, and the 154-file server lane.
- `pnpm format:check` and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI, or browser-smoke file
  changed, so the periodic Phase 2 `test:all` checkpoint remains satisfied by
  the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- The corrected import-isolation test passes repeatedly in the target Node
  project and through complete owning runs.
- The generated inventory removes the promoted target-N probe marker.
- The stale store mock is aligned with the production import without changing
  production behavior or weakening the intended lazy-access oracle.
- File and test totals are unchanged, and browser-shaped alert contracts remain
  in D or B.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove `src/ts/alert.importSafety.test.ts` from `vitest.node-tests.ts`, restore
its historical mock path only if `alert.ts` also returns to that dependency,
and regenerate `phase-0-inventory.tsv`. The DOM fallback will resume ownership;
no production rollback is required.
