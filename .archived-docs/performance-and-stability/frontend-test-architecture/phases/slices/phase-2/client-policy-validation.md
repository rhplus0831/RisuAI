# Phase 2 Slice: Client Policy And Validation Helpers

Status: Complete

## Scope

Promote these existing client policy and validation suites from the Happy-DOM
fallback to the explicit Node inventory without changing their test bodies or
production subjects:

- `src/ts/model/scriptModelOverrides.test.ts`
- `src/ts/moduleEditorLeaveGuard.test.ts`
- `src/ts/observerRouteIntent.test.ts`
- `src/ts/presetFieldMirror.test.ts`
- `src/ts/process/request/tests/additionalParams.test.ts`

The five files contain 22 tests. They move from D to N ownership. Their
contracts cover plain validation, deterministic policy resolution, in-memory
state, and dependency-injected data shaping rather than rendered or
browser-shaped behavior.

## Source Anchors And Dependencies

- `scriptModelOverrides.test.ts` imports a dependency-free TypeScript module
  that normalizes and strictly validates the two supported script profile ids.
- `moduleEditorLeaveGuard.test.ts` imports a dependency-free in-memory registry
  implemented with a `Set` and synchronous guard functions.
- `observerRouteIntent.test.ts` imports the in-memory route-intent owner, whose
  only dependency is the plain TypeScript `routerRoute.ts` parser/key helper.
- `presetFieldMirror.test.ts` retains its existing explicit mock of
  `database.svelte.ts`. Its remaining runtime path is plain TypeScript through
  `presetSplit.ts`, `promptTemplateNormalization.ts`, and
  `safeStructuredClone.ts`; prompt types are type-only and erased.
- `additionalParams.test.ts` retains its existing explicit mock of the
  `database.svelte.ts` accessor. Its subjects otherwise use plain TypeScript
  JSON parsing, parameter selection, and array/object shaping.
- None of the suites accesses a DOM/browser global, compiles Svelte, mounts a
  component, performs network or storage work, reads the filesystem, or relies
  on timers. No mock was added or weakened for promotion.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.
- `phase-0-inventory.tsv` remains generated classification evidence rather
  than routing authority.

## Behavior Invariants

- Script model overrides keep their whitespace normalization, supported-key
  allowlist, strict command-payload errors, role lookup, and role-scoped update
  behavior.
- Module editor leave requests keep newest-guard-first evaluation, cancellation,
  and idempotent unregistration.
- Observer route intent remains latest-wins, semantically deduplicated,
  exact-sequence consumed, and protected from stale reconciliation.
- Top-level preset mirroring continues to reject generic prompt-template
  writes, preserve the preset id captured before selection changes, and return
  the selected mutation outcome.
- Additional-parameter parsing continues to support standard JSON and
  unquoted Python-style booleans/null without rewriting quoted strings;
  global, custom-model, reverse-proxy, and profile-owned parameter precedence
  remains unchanged.
- No rendered UI, browser storage, browser navigation, or network contract
  changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their focused
run changed from 1.32s wall / 492ms Vitest / 504,612 KiB peak RSS / 914ms
aggregate environment time in D to 0.95s / 222ms / 365,844 KiB / 0ms in N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 134 N / 2 S / 393 D to 139 N / 2 S / 388 D. Wall time changed
from 76.01s to 74.79s (-1.22s, -1.6%), Vitest duration changed from 74.73s to
73.61s, and peak RSS changed from 5,009,076 KiB to 4,842,704 KiB (-3.3%). The
paired DOM project fell from 66.61s to 65.36s while the Node project changed
from 4.35s to 4.09s.

This is a single paired slice observation, not a phase-level timing claim. The
Phase 0 three-run median remains the comparison baseline until the next
phase-level measurement gate.

## Validation

- The pre-promotion focused Happy-DOM run passed 5 files / 22 tests.
- The focused `frontend-node` probe passed 5 files / 22 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 140 N / 2 S /
  395 D, standalone ordinary ownership at 140 N / 2 S / 393 D, and aggregate
  ordinary ownership at 139 N / 2 S / 388 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed, so the periodic Phase 2 `test:all` checkpoint remains satisfied
  by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All five target-project probes and repeated owning-run executions pass.
- The generated inventory removes all five target-N probe markers.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not materially regress.

## Rollback

Remove the five paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
