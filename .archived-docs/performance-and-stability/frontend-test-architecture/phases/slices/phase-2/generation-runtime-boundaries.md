# Phase 2 Slice: Generation Runtime Boundaries

Status: Complete

## Scope

Promote these existing generation runtime registration, finalization planning,
and source-policy suites from the Happy-DOM fallback to the explicit Node
inventory without changing their test bodies or production subjects:

- `src/ts/process/generationRuntimeBridge.test.ts`
- `src/ts/process/inlayFinalization.test.ts`
- `src/ts/process/rawGenerationCallerAllowlist.test.ts`

The three files contain six tests. They move from D to N ownership as one
generation-runtime-boundary slice.

An initial broader target probe also evaluated
`generationEffectLedger.test.ts` and `recoveredGenerationEffects.test.ts`.
Both execute transitive Svelte rune modules in the Node project and failed with
`$state is not defined`. They remain in D without mock or production changes
and require S-target reclassification or a later pure-boundary decision.

## Source Anchors And Dependencies

- `generationRuntimeBridge.test.ts` imports only the registry subject. Every
  production module referenced by `generationRuntimeBridge.ts` is a type-only
  `typeof import`, so the emitted runtime is a set of nullable capability slots,
  registration/access functions, and a test reset.
- `inlayFinalization.test.ts` replaces both direct dependencies: the
  Svelte-named resource projection state and server command dispatcher. The
  remaining subject is plain TypeScript command construction, result handling,
  and one-conflict retry planning.
- `rawGenerationCallerAllowlist.test.ts` is a Node-native source-policy suite.
  It uses `node:fs`, `node:path`, and `process.cwd()` to inspect repository
  source text without importing, transforming, or executing Svelte modules.
- No suite mounts a component, accesses DOM/browser storage, performs a network
  request, or relies on Happy-DOM setup. No mock was added or weakened for
  promotion.
- `generationEffectLedger.test.ts` reaches
  `persistenceActivity.svelte.ts` through the unmocked `commands.ts` constant
  import. `recoveredGenerationEffects.test.ts` imports the real ledger module
  from its partial mock and reaches `coreStores.svelte.ts` through
  `fastifyStorage.ts`. Those rune dependencies justify retaining both suites
  outside N.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.

## Behavior Invariants

- Every generation runtime capability still throws before registration,
  returns its exact registered owner afterward, and resets independently for
  tests.
- Server-backed inlay finalization still sends owner-, chat-, generation-, and
  expected-data-scoped compare-and-set fields with the captured optimistic
  projection epoch.
- Inlay finalization still retries one unrelated global revision conflict while
  preserving all compare-and-set conditions.
- Raw generation callers remain restricted to the explicit accepted-send
  coordinator set, and Wave 3 append-and-generate callers retain capability
  gating plus their compatibility paths.
- No rendered UI, Svelte rune, browser storage, browser navigation, or
  real-network contract changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their
focused run changed from 1.03s wall / 343ms Vitest / 395,624 KiB peak RSS /
367ms aggregate environment time in D to 0.94s / 269ms / 312,660 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 148 N / 2 S / 379 D to 151 N / 2 S / 376 D. Wall time changed
from 74.45s to 73.67s (-0.78s, -1.0%), Vitest duration changed from 73.60s to
72.66s, and peak RSS changed from 4,909,928 KiB to 4,782,104 KiB (-2.6%). The
paired DOM project changed from 65.49s to 66.88s while the Node project remained
effectively flat at 4.23s and 4.24s.

The owning-project movements remain within observed lane variability, while
focused execution, ordinary wall time, and ordinary peak RSS improved. This is
a single paired slice observation, not a phase-level timing claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 6 tests.
- The focused `frontend-node` probe passed 3 files / 6 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 152 N / 2 S /
  383 D, standalone ordinary ownership at 152 N / 2 S / 381 D, and aggregate
  ordinary ownership at 151 N / 2 S / 376 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed in this promotion, so the periodic Phase 2 `test:all` checkpoint
  remains satisfied by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three promoted target-project probes and repeated owning-run executions
  pass.
- The generated inventory removes the three promoted target-N probe markers.
- The two failed broader probes remain in D with their exact transitive Svelte
  blocker recorded.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove the three promoted paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
