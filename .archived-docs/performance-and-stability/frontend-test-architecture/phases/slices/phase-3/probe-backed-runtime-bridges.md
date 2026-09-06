# Phase 3 Slice: Probe-Backed Runtime Bridges

Status: Complete

## Scope

Promote seven suites and 69 tests from Happy-DOM to Svelte+Node:

- `src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts`;
- `src/ts/characterCards.pngImport.test.ts`;
- `src/ts/server/assets.test.ts`;
- `src/ts/server/backups.test.ts`;
- `src/ts/server/bootstrap.test.ts`;
- `src/ts/server/hydrationReads.test.ts`;
- `src/ts/server/replacementDatabaseOwnership.test.ts`.

No production module, test body, assertion, mock, or setup file changes in this
slice.

## Capability And Behavior Boundaries

- The production graphs initialize `$state` in resource or persistence state,
  so plain Node is not a valid runtime for the unchanged suites.
- Exact Phase 2 classification probes already passed every suite in
  Svelte+Node. Their 69 tests cover ordered durable prompt mutations,
  character-card PNG/CharX import and export, asset and backup ownership,
  bootstrap normalization, authenticated hydration reads, and replacement
  database settlement.
- IndexedDB, authenticated commands, fetch, alerts, assets, and other
  browser-shaped dependencies remain explicitly supplied or replaced by the
  tests. No suite mounts a component, observes rendered state, reads a DOM
  global, or performs real network I/O.
- Companion UI and browser contracts retain Happy-DOM or Playwright ownership;
  this slice changes only the data and durable-bridge proofs.

## Performance And Ownership Result

The combined current-owner Happy-DOM run passed 7 files / 69 tests in 2.52s
wall and 1.60s Vitest duration, with 939,396 KiB peak RSS. Its aggregate
transform, setup, import, test, and environment times were 5.14s, 736ms,
7.19s, 270ms, and 1.35s.

The exact Svelte+Node promotion scope passed 7 files / 69 tests in 1.97s wall
and 1.32s Vitest duration, with 785,804 KiB peak RSS. Aggregate transform,
setup, import, test, and environment times were 5.53s, 538ms, 6.91s, 358ms,
and 170ms. The expected mechanism is visible in the 1.18s environment-time
reduction; the transform and import observations remain slice evidence rather
than a general performance claim.

The full discovery distribution moved from 161 N / 2 S / 374 D to 161 N / 9 S
/ 367 D. Standalone ordinary moved to 161 N / 9 S / 365 D, while aggregate
ordinary moved to 160 N / 9 S / 360 D. All universes remain exhaustive and
disjoint.

## Validation

- The exact Svelte+Node scope passed twice with all 69 tests.
- The generated inventory was updated and its full, standalone ordinary, and
  aggregate ordinary completeness checks passed.
- No test body, production dependency, DOM contract, setup boundary, coverage
  owner, or browser-smoke contract changed.
- Formatting and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the seven paths from `vitest.svelte-node-tests.ts` and regenerate the
inventory. Happy-DOM will resume ownership without a production rollback.
