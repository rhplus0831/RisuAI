# Phase 2 Slice: Server Resource And Bootstrap Node Probe

Status: Complete without promotion

## Scope

Evaluate four client-server suites for Node promotion:

- `src/ts/server/assets.test.ts`
- `src/ts/server/backups.test.ts`
- `src/ts/server/bootstrap.test.ts`
- `src/ts/server/replacementDatabaseOwnership.test.ts`

Retain their current owner after proving that the unchanged production graphs
require Svelte rune transformation. No production module, test body, mock,
assertion, or permanent runtime inventory changes in this proof batch.

## Capability And Behavior Boundaries

- The 34 tests cover asset projection/upload helpers, backup lifecycle and
  restore ownership, writer-aware bootstrap parsing, and replacement-database
  outbox settlement.
- Fetch, auth, command, refresh, bridge, and IndexedDB dependencies are supplied
  or explicitly replaced. The suites mount no component and directly exercise
  no DOM API or real network.
- Asset, backup, and bootstrap graphs reach
  `persistenceActivity.svelte.ts`, whose top-level state uses `$state`.
- Replacement-database ownership reaches `coreStores.svelte.ts` through the
  alert/Fastify-storage graph, also initializing `$state` at module evaluation.
- Replacing these real persistence and ownership edges solely for Node would
  weaken the behavior under test.

## Probe Result

The current Happy-DOM owner passed 4 files / 34 tests in 1.71s wall and 978ms
Vitest duration, with 699,808 KiB peak RSS and 515ms environment time.

The temporary Node probe failed all four suites before collection. Assets,
backups, and bootstrap reached `$state` in
`persistenceActivity.svelte.ts:3`; replacement-database ownership reached
`$state` in `stores/coreStores.svelte.ts:5`. The probe took 1.45s wall and
651ms Vitest duration, with 543,656 KiB peak RSS and no environment time.

The temporary Svelte+Node classification probe passed all 4 files / 34 tests in
1.49s wall and 867ms Vitest duration, with 621,280 KiB peak RSS and 68ms
environment time. S is the smallest current runtime for the unchanged suites.
All temporary inventory entries were removed.

## Validation And Deferral

- Current-owner and Svelte+Node runs passed all 34 tests; the exact Node probe
  failed for the two recorded rune edges.
- `pnpm check:frontend-test-inventory` retained exhaustive and disjoint full,
  standalone ordinary, and aggregate ordinary discovery.
- Formatting of changed files and `git diff --check` passed.

Owner: Phase 3 client-server S promotion. Reason: the resource, persistence,
bootstrap, and ownership graphs require rune transformation without DOM
behavior. Revisit when Phase 3 begins, or earlier only after a production graph
change and fresh target probes.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

No runtime rollback is required. Replace this proof only with fresher target
runtime evidence after a relevant import-graph change.
