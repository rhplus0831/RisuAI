# Phase 2 Slice: Character-Card PNG Import Node Probe

Status: Complete without promotion

## Scope

Evaluate `src/ts/characterCards.pngImport.test.ts` for promotion from the
Happy-DOM fallback to the explicit Node inventory, then retain its current
owner after proving that the production import graph requires Svelte rune
transformation.

No production module, test body, mock, assertion, or permanent runtime
inventory changes in this proof batch.

## Source Anchors And Dependencies

- The 21-test suite covers PNG embedded-asset decoding, import progress,
  durable character creation outcomes, v2/v3 and CharX normalization, bounded
  salvage reporting, PNG/JSON/CharX export, and source-character immutability.
- Alert, database, global API, Svelte store, parser, asset, command, hydration,
  lorebook, script-definition, and Fastify-auth boundaries are explicitly
  replaced. The exercised suite uses Node-safe binary primitives and performs
  no component mount, DOM operation, browser-storage access, or real network
  request.
- The unmocked production subject imports
  `server/resourceWriteGuard.svelte.ts`, which imports
  `server/resourceState.svelte.ts`. That state module initializes `$state`
  during module evaluation.
- Replacing the resource-write guard solely to pass Node would remove a real
  durable-import dependency from the tested production graph and is forbidden
  by the Phase 2 promotion rules.

## Behavior Invariants

- PNG and CharX import/export coverage remains unchanged at 21 tests.
- Durable character creation, queued/failed outcomes, asset salvage, progress
  ordering, and immutability assertions keep their real production subject.
- The existing browser-shaped boundary mocks remain explicit and no new mock
  is introduced to bypass the Svelte rune edge.
- The full, standalone ordinary, and aggregate ordinary discovery universes
  remain exhaustive and disjoint.

## Probe Result

The current Happy-DOM owner passed 1 file / 21 tests in 1.80s wall and 1.02s
Vitest duration, with 409,568 KiB peak RSS and 182ms aggregate environment
time.

After temporarily adding the suite to `vitest.node-tests.ts`, the exact Node
probe failed before collection with `ReferenceError: $state is not defined` at
`src/ts/server/resourceState.svelte.ts:658`, reached through
`resourceWriteGuard.svelte.ts:1` and `characterCards.ts:72`. The failed probe
took 0.94s wall and 300ms Vitest duration, with 285,980 KiB peak RSS and no
environment time.

After moving the temporary entry to `vitest.svelte-node-tests.ts`, the exact
classification probe passed 1 file / 21 tests in 1.31s wall and 708ms Vitest
duration, with 379,636 KiB peak RSS and 18ms aggregate environment time. This
proves S is the smallest current runtime capable of executing the unchanged
suite.

The temporary entries were removed. There is no before/after ownership or
ordinary-lane performance claim because no migration landed.

## Validation

- The current-owner Happy-DOM run passed all 21 tests.
- The exact Node target probe failed for the recorded transitive rune reason.
- The exact Svelte+Node classification probe passed all 21 tests.
- `pnpm check:frontend-test-inventory` passed with unchanged exhaustive and
  disjoint counts: full 158 N / 2 S / 377 D, standalone ordinary 158 N / 2 S /
  375 D, and aggregate ordinary 157 N / 2 S / 370 D.
- Formatting of changed files and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- The target runtime has an exact, reproducible failure reason.
- The next-smallest runtime passes the unchanged suite.
- The suite remains D-owned pending deliberate Phase 3 S promotion.
- No behavior, coverage, setup, or discovery ownership is weakened.

## Deferral

Owner: Phase 3 client-core S promotion. Reason: the production import graph
requires Svelte rune transformation but no DOM behavior. Revisit when Phase 3
begins, or earlier only if the production graph removes the rune edge and a
fresh Node probe passes.

## Rollback

No runtime rollback is required. Remove this proof record only if a later
source change invalidates both recorded target probes and replaces them with
fresh evidence.
