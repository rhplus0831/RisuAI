# Phase 3 Slice: Process State Helpers

Status: Complete

## Scope

Promote eleven process suites and 119 tests from Happy-DOM to Node:

- `src/ts/process/__tests__/finalizeRequestBudget.test.ts`;
- `src/ts/process/acceptedSendCoordinator.test.ts`;
- `src/ts/process/chatUnread.test.ts`;
- `src/ts/process/coldstorage.test.ts`;
- `src/ts/process/generationActivity.test.ts`;
- `src/ts/process/generationDisplayProjection.test.ts`;
- `src/ts/process/inputHookActivity.test.ts`;
- `src/ts/process/modules.test.ts`;
- `src/ts/process/request/tests/serverMessagePatch.test.ts`;
- `src/ts/process/stableDiff.test.ts`;
- `src/ts/process/tts.test.ts`.

No production module, test body, assertion, mock, or setup file changes in this
slice.

## Capability And Behavior Boundaries

- The suites cover prompt-budget finalization, accepted-send coordination,
  unread and generation activity stores, cold storage, display projection,
  input hooks, module orchestration, server message patches, stable generation
  diffing, and TTS request/state behavior.
- Their static S classifications came from `svelte/store`, `.svelte` type
  imports, or mocked Svelte-named modules. The phase-wide Svelte+Node probe
  passed all eleven, and the exact Node cross-check proved none requires client
  transformation at runtime.
- Existing module, database, resource, speech, file-picker, request, and timer
  fakes remain explicit. The exercised contracts perform no component mount,
  rendered-state assertion, DOM operation, browser navigation, or real network
  request.
- Mounted generation, module, and TTS consumers retain Happy-DOM ownership.

## Performance And Ownership Result

The current-owner Happy-DOM scope passed 11 files / 119 tests in 1.88s wall and
1.18s Vitest duration, with 1,015,376 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 4.07s, 971ms, 4.96s, 650ms, and 1.77s.

The exact Node scope passed 11 files / 119 tests in 1.42s wall and 746ms Vitest
duration, with 660,292 KiB peak RSS. Aggregate transform, setup, import, test,
and environment times were 1.57s, 987ms, 1.76s, 589ms, and 1ms. A repeat passed
all 119 tests in 718ms Vitest duration.

The focused wall observation decreased by 460ms and peak RSS by 355,084 KiB.
The environment removal and reduced client-transform/import work are the
measured mechanisms; formal ordinary-lane measurements remain the phase-level
performance evidence.

## Validation

- The exact Node scope passed twice with all 119 tests.
- Inventory update and check commands passed with exhaustive and disjoint full,
  standalone ordinary, and aggregate ordinary discovery.
- No production, test-body, visible-state, setup, coverage, or browser-smoke
  contract changed.
- Formatting and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the eleven paths from `vitest.node-tests.ts` and regenerate the
inventory. Happy-DOM will resume ownership without a production rollback.
