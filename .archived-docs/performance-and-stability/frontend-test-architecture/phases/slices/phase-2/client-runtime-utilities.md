# Phase 2 Slice: Client Runtime Utilities

Status: Complete

## Scope

Promote these existing client-runtime utility suites from the Happy-DOM
fallback to the explicit Node inventory without changing their test bodies or
production subjects:

- `src/ts/polyfill.test.ts`
- `src/ts/sourcemap.test.ts`

The two files contain seven tests. They move from D to N ownership. Their
contracts cover dependency-injected runtime capability installation and
explicitly stubbed stack-trace source-map translation rather than rendered or
browser-shaped behavior.

## Source Anchors And Dependencies

- `polyfill.test.ts` supplies the runtime target, feature matrix, optional
  loaders, and a minimal `documentTarget` fake explicitly. The production
  subject guards its default `document` and `navigator` access and performs the
  exercised installation through injected collaborators.
- The polyfill subject's static dependencies are the platform query and the
  plain `safeStructuredClone` helper. Node 24 provides the standards used by
  the suite, while the test supplies every optional dynamic loader rather than
  importing drag/drop or browser ponyfills.
- `sourcemap.test.ts` replaces `source-map` with an in-memory consumer and
  stubs global `fetch` for every translated or failed request. Its subject uses
  Node-provided `URL`, `AbortController`, and timers; no real request occurs.
- Neither suite imports a Svelte module, mounts a component, reads browser
  storage, or relies on Happy-DOM setup. No mock was added or weakened for the
  promotion.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.
- `phase-0-inventory.tsv` remains generated classification evidence rather
  than routing authority.

## Behavior Invariants

- Baseline feature detection, native-global retention, selective fallback
  loading, safe-clone installation, drag/drop support detection, and async iOS
  drag-polyfill readiness retain all four assertions.
- Source-map translation retains successful frame mapping and consumer
  cleanup, failed-fetch fallback, and immediate no-map fallback across all
  three assertions.
- No DOM-visible, focus, event, browser-storage, navigation, or network
  contract changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their
focused run changed from 1.05s wall / 311ms Vitest / 341,440 KiB peak RSS /
236ms aggregate environment time in D to 0.84s / 171ms / 273,900 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 139 N / 2 S / 388 D to 141 N / 2 S / 386 D. Wall time changed
from 70.45s to 72.14s (+1.69s, +2.4%), Vitest duration changed from 69.39s to
71.13s, and peak RSS changed from 5,025,708 KiB to 5,018,288 KiB (-0.1%). The
paired DOM project fell from 70.25s to 68.06s while the Node project changed
from 4.08s to 4.60s.

The ordinary wall movement remains inside the Phase 0 warm range and observed
lane variability, while the owning DOM project and focused execution both
improved. This is a single paired slice observation, not a phase-level timing
claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 2 files / 7 tests.
- The focused `frontend-node` probe passed 2 files / 7 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 142 N / 2 S /
  393 D, standalone ordinary ownership at 142 N / 2 S / 391 D, and aggregate
  ordinary ownership at 141 N / 2 S / 386 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed, so the periodic Phase 2 `test:all` checkpoint remains satisfied
  by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- Both target-project probes and repeated owning-run executions pass.
- The generated inventory removes both target-N probe markers.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane remains inside observed run-to-run variability.

## Rollback

Remove the two paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
