# Phase 2 Slice: Storage Backup And Export Helpers

Status: Complete

## Scope

Promote these existing storage backup, export, and encoding-helper suites from
the Happy-DOM fallback to the explicit Node inventory without changing their
test bodies or production subjects:

- `src/ts/kei/backup.test.ts`
- `src/ts/storage/exportAsDataset.test.ts`
- `src/ts/storage/risuSave.test.ts`

The three files contain nine tests. They move from D to N ownership as one
dependency-isolated storage-helper slice.

A broader target probe also evaluated `src/ts/storage/backup.test.ts`. Seven of
its eight tests failed in Node with `HTMLInputElement is not defined`; those
contracts intentionally drive the production file-input picker through
`File`, `HTMLInputElement.prototype.click`, assigned `files`, and a dispatched
`change` event. That suite remains in D as a genuine file-picker DOM contract.

## Source Anchors And Dependencies

- `kei/backup.test.ts` replaces the alert, Kei endpoint, Svelte database, and
  Svelte global-API boundaries. Every request uses an explicit `fetch` stub and
  Node 24 `Response`; the remaining subject graph is backup response handling,
  menu pagination, cancellation, retry, coalescing, and success throttling.
- `exportAsDataset.test.ts` replaces the Svelte database, download, alert, and
  chat/lorebook hydration boundaries. The remaining graph strictly sequences
  hydration, data shaping, Buffer serialization, download settlement, and
  success/error reporting.
- `risuSave.test.ts` explicitly selects Fastify mode and replaces localforage,
  the Svelte database, and global browser storage. The exercised uncompressed
  block encoder uses typed arrays and `TextEncoder`, while assertions ensure
  the retired RISUSAVE block cache is not accessed.
- `storage/backup.test.ts` directly exercises a browser file input, while its
  production subject uses `document`, `window`, and input/change-event
  behavior. Moving it would remove the runtime that proves its contract.
- No mock was added or weakened for promotion, and no real network or browser
  storage access occurs in the promoted suites.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.

## Behavior Invariants

- Risu-Kei backup failures still surface the resolved server response, exact
  page-size pagination still wraps to the final non-empty page, cancellation
  still avoids restore, and automatic saves still retry, coalesce, and
  throttle only after success.
- Dataset export still requires complete chat and character-lorebook hydration
  before serialization, reports hydration/download failures, and reports
  success only after the fully shaped JSON download settles.
- Fastify-mode RisuSave block encoding still returns encoded bytes without
  reading, listing, or writing the retired browser block cache.
- Device-backup import still owns its file-picker and change-event DOM contract
  in D.
- No rendered UI, Svelte rune, browser storage, or real-network contract
  changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The promoted files no longer start Happy-DOM or load `vitest.dom.setup.ts`.
Their focused run changed from 1.31s wall / 575ms Vitest / 438,876 KiB peak RSS
/ 469ms aggregate environment time in D to 1.12s / 370ms / 357,560 KiB / 0ms
in N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 153 N / 2 S / 374 D to 156 N / 2 S / 371 D. Wall time
changed from 68.90s to 70.10s (+1.20s, +1.7%), Vitest duration changed from
68.04s to 69.15s, and peak RSS changed from 4,847,236 KiB to 5,064,564 KiB
(+4.5%). The paired DOM project changed from 67.34s to 69.15s while the Node
project changed from 4.55s to 4.83s.

The focused environment cost and peak RSS improved. The paired owning and
ordinary movements remain inside observed lane variability, so this is one
slice observation rather than a phase-level timing or regression claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 9 tests.
- The focused `frontend-node` probe passed 3 files / 9 tests with no aggregate
  environment time.
- The broader `storage/backup.test.ts` Node probe failed 7 file-picker tests
  with `HTMLInputElement is not defined` and passed its non-DOM manual-backup
  routing test; the file remains in D without test or production changes.
- `pnpm check:frontend-test-inventory` proved full ownership at 157 N / 2 S /
  378 D, standalone ordinary ownership at 157 N / 2 S / 376 D, and aggregate
  ordinary ownership at 156 N / 2 S / 371 D.
- Complete standalone Node and DOM project runs passed 157 files / 931 tests
  and 376 files / 5,677 tests. The selected affected plan passed the complete
  535-file frontend lane, both performance gates, and the server lane.
- `pnpm format:check` and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed in this promotion, so the periodic Phase 2 `test:all` checkpoint
  remains satisfied by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three promoted target-project probes and repeated owning-run executions
  pass.
- The generated inventory removes the three promoted target-N probe markers.
- The failed device-backup probe remains in D with its exact DOM requirement
  recorded.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove the three promoted paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
