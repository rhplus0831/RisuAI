# Phase 3 Slice: Client State And Command Helpers

Status: Complete

## Scope

Route thirteen suites and 157 tests out of Happy-DOM after exact Svelte+Node
and Node capability probes.

Svelte+Node now owns two suites and 34 tests:

- `src/ts/pluginCommands.durable.test.ts`;
- `src/ts/pluginCommands.test.ts`.

Node now owns eleven suites and 123 tests:

- `src/lib/SideBars/EditorIconActions.svelte.test.ts`;
- `src/lib/UI/mainMenuProjection.test.ts`;
- `src/ts/agentLorebookInputs.test.ts`;
- `src/ts/agentPresetResolver.test.ts`;
- `src/ts/media/compressImage/tests/compressImage.test.ts`;
- `src/ts/model/modelProfileResolver.test.ts`;
- `src/ts/model/modelProfileUiState.test.ts`;
- `src/ts/moduleActivation.test.ts`;
- `src/ts/parser/tests/chatML.test.ts`;
- `src/ts/personaModuleLinks.test.ts`;
- `src/ts/playground.test.ts`.

No production module, test body, assertion, mock, or setup file changes in this
slice.

## Capability And Behavior Boundaries

- The plugin-command suites exercise the real durable mutation and resource
  projection graphs. Plain Node fails before collection when their dependency
  graph initializes `$state` in `persistenceActivity.svelte.ts`; Svelte+Node
  passes every command, ordering, resource-guard, and optimistic-projection
  assertion without a DOM.
- The eleven Node suites were statically labeled S because they import Svelte
  compiler/runtime packages, mock a `.svelte` module, or carry type-only imports
  from Svelte-named modules. The exact Node probe proves those imports do not
  require client transformation at runtime.
- Explicit IndexedDB, command, asset, module, and other browser-shaped fakes are
  unchanged. The tests do not mount components, observe rendered state, or
  execute browser globals or real network I/O.
- Mounted editor, menu, profile, persona, module, and command consumers retain
  their existing Happy-DOM contracts.

## Probe And Performance Result

The phase-wide static target-S probe assigned all 127 remaining candidates to
Svelte+Node temporarily. It passed 34 candidates unchanged and produced exact
runtime blockers for 93. A smaller-runtime probe then assigned the 34 passing
candidates to Node temporarily: 28 passed, while six failed at `$state`
initialization and therefore require Svelte+Node.

For this slice, the combined Happy-DOM owner passed 13 files / 157 tests in
3.08s wall and 2.36s Vitest duration, with 970,260 KiB peak RSS. Aggregate
transform, setup, import, test, and environment times were 3.94s, 1.50s, 4.94s,
790ms, and 2.34s.

The exact Node scope passed 11 files / 123 tests in 1.44s wall and 751ms Vitest
duration, with 565,356 KiB peak RSS. Aggregate transform, setup, import, test,
and environment times were 1.05s, 893ms, 1.15s, 539ms, and 1ms. The exact
Svelte+Node scope passed 2 files / 34 tests in 1.78s wall and 1.16s Vitest
duration, with 574,132 KiB peak RSS; aggregate transform, setup, import, test,
and environment times were 1.27s, 129ms, 1.65s, 264ms, and 33ms.

The two target projects are separate processes, so their focused wall and RSS
figures are not added into a synthetic comparison. The environment removal is
the expected mechanism; formal ordinary-lane measurements remain the phase
stopping-gate evidence.

## Validation

- The exact Node and Svelte+Node scopes passed all 157 tests without DOM setup.
- The complete Node and Svelte+Node projects passed 183 files / 1,186 tests.
- The broad target-S probe and smaller-runtime cross-check account for every
  routing decision in the slice.
- Inventory update and check commands passed with exhaustive and disjoint full,
  standalone ordinary, and aggregate ordinary discovery.
- No production, test-body, visible-state, coverage, setup, or browser-smoke
  contract changed.
- Formatting and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the eleven paths from `vitest.node-tests.ts` and the two paths from
`vitest.svelte-node-tests.ts`, then regenerate the inventory. Happy-DOM will
resume ownership without a production rollback.
