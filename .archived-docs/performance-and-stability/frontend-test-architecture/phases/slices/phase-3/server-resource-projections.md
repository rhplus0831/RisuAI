# Phase 3 Slice: Server Resource Projections

Status: Complete

## Scope

Route ten suites and 116 tests out of Happy-DOM after exact Svelte+Node and Node
capability probes.

Svelte+Node now owns four suites and 46 tests:

- `src/ts/server/persistenceActivity.svelte.test.ts`;
- `src/ts/server/resourceReads.test.ts`;
- `src/ts/server/shellHydration.test.ts`;
- `src/ts/translator/translator.cache.test.ts`.

Node now owns six suites and 70 tests:

- `src/ts/server/generationOperations.test.ts`;
- `src/ts/server/greetingTranslations.test.ts`;
- `src/ts/server/memoryJobProjection.test.ts`;
- `src/ts/server/pushNotificationSetting.test.ts`;
- `src/ts/server/scopedLorebookMutationUiState.test.ts`;
- `src/ts/server/seperateParametersImport.test.ts`.

No production module, test body, assertion, mock, or setup file changes in this
slice.

## Capability And Behavior Boundaries

- The four Svelte+Node suites execute real `$state` initialization in
  persistence activity, resource state, or core-store modules. Their exact Node
  probes fail before collection at `persistenceActivity.svelte.ts:3`,
  `resourceState.svelte.ts:658`, or `coreStores.svelte.ts:5`; the unchanged
  suites pass under the client transform without DOM setup.
- The six Node suites assert generation-operation stores, greeting translation
  state, memory-job projection, push-setting policy, scoped lorebook mutation
  status, and parameter import shaping. Their Svelte store or type imports run
  in Node without client transformation.
- Authenticated commands, fetch, caches, timers, stores, and persistence
  boundaries remain explicitly supplied or replaced. No suite mounts a
  component, reads a browser global, observes rendered state, or performs real
  network I/O.
- Visible settings, generation, memory, lorebook, and translation consumers
  retain Happy-DOM ownership.

## Performance And Ownership Result

The combined current-owner Happy-DOM scope passed 10 files / 116 tests in 2.35s
wall and 1.64s Vitest duration, with 985,920 KiB peak RSS. Aggregate transform,
setup, import, test, and environment times were 5.42s, 1.22s, 6.69s, 542ms, and
2.33s.

The exact Node scope passed 6 files / 70 tests in 1.02s wall and 372ms Vitest
duration, with 442,440 KiB peak RSS. Aggregate transform, setup, import, test,
and environment times were 483ms, 456ms, 465ms, 291ms, and 0ms. The exact
Svelte+Node scope passed 4 files / 46 tests in 1.78s wall and 1.15s Vitest
duration, with 684,352 KiB peak RSS; aggregate transform, setup, import, test,
and environment times were 2.45s, 280ms, 3.21s, 228ms, and 55ms.

Both exact scopes passed again, in 373ms and 1.13s Vitest duration. The two
target projects are separate processes, so their focused wall and RSS figures
are not combined into a synthetic comparison. Environment removal remains the
expected mechanism; formal ordinary-lane measurements own the phase result.

## Validation

- The exact Node and Svelte+Node scopes passed twice with all 116 tests.
- Inventory update and check commands passed with exhaustive and disjoint full,
  standalone ordinary, and aggregate ordinary discovery.
- No production, test-body, visible-state, setup, coverage, or browser-smoke
  contract changed.
- Formatting and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the six paths from `vitest.node-tests.ts` and the four paths from
`vitest.svelte-node-tests.ts`, then regenerate the inventory. Happy-DOM will
resume ownership without a production rollback.
