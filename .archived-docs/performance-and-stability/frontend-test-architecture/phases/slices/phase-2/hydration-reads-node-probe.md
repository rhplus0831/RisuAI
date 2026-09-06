# Phase 2 Proof Slice: Hydration Reads Node Probe

Status: Complete without promotion

## Scope

Probe `src/ts/server/hydrationReads.test.ts` in the explicit Node project and
retain it in the Happy-DOM fallback if its transitive graph requires a runtime
outside Phase 2. The file contains 12 tests.

No test body, mock, production subject, setup file, or permanent runtime
inventory changes in this proof slice.

## Source Anchors And Dependencies

- The suite replaces `getNodeServerProxyAuth`, stubs every executed `fetch`,
  and explicitly supplies `fake-indexeddb` for its cache-backed cases.
- Its remaining contracts cover authenticated hydration request planning,
  response validation, cache negotiation and reconstruction, legacy fallback,
  chat ranges and generation suffixes, bulk reads, and stable error handling.
- `hydrationReads.ts` imports `canUseServerResourceReads` from
  `resourceReads.ts`. That module has a runtime import from
  `resourceState.svelte.ts`, whose module initialization executes `$state`.
- The direct-file classifier cannot see that transitive rune requirement, so
  the target-project probe is authoritative for this decision.

## Behavior Invariants

- IndexedDB remains an explicit test dependency rather than an ambient browser
  facility.
- Every network-shaped path remains locally stubbed; no real request or DOM
  fetch guard is part of the proved behavior.
- Legacy presets, prompt templates, selected fallbacks, chat messages,
  generation suffixes, and character lorebooks retain their exact request and
  validation contracts.
- No mock is added or weakened solely to make a smaller runtime pass.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain unchanged and disjoint.

## Probe Result And Runtime Decision

The current Happy-DOM owner passed 1 file / 12 tests in 1.68s wall and 977ms
Vitest duration, with 440,468 KiB peak RSS and 115ms aggregate environment
time.

The temporary `frontend-node` target probe failed before collection with
`ReferenceError: $state is not defined` at
`src/ts/server/resourceState.svelte.ts:658`, reached through
`resourceReads.ts` and `hydrationReads.ts`. It took 1.17s wall and 478ms Vitest
duration, with 395,420 KiB peak RSS and no environment time.

A temporary `frontend-svelte-node` classification probe then passed the same
1 file / 12 tests in 1.69s wall and 1.01s Vitest duration, with 441,684 KiB
peak RSS and 19ms aggregate environment time. This proves the suite requires
Svelte transformation but no DOM setup.

The temporary N and S allowlist entries were removed after their probes. The
suite remains D-owned until Phase 3 deliberately promotes S-class suites; no
Phase 2 performance delta is claimed.

## Validation

- The focused current-owner Happy-DOM run passed 1 file / 12 tests.
- The focused `frontend-node` probe failed before collection at the transitive
  `$state` initialization, establishing that N is not a valid target.
- The focused `frontend-svelte-node` probe passed 1 file / 12 tests without
  Happy-DOM.
- With both temporary entries removed, the checked inventory remains unchanged
  at 157 N / 2 S / 378 D for the full universe, 157 N / 2 S / 376 D for the
  standalone ordinary universe, and 156 N / 2 S / 371 D for the aggregate
  ordinary universe.
- No production, test-body, setup, coverage, CI, UI, or browser-smoke contract
  changed.

Exact commands, resource observations, and the unchanged Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- The target Node incompatibility is reproduced and tied to an exact
  transitive runtime dependency.
- The smaller valid future runtime is proved without changing behavior.
- All temporary ownership changes are reverted and the suite remains
  discoverable only in the Happy-DOM fallback.
- The Phase 3 owner, reason, and revisit condition are recorded in the live
  status.

## Rollback

No runtime rollback is required because no ownership or production change
landed. Revert this proof record and its status/verification entries only if a
later production boundary removes the transitive Svelte dependency and a fresh
Node probe passes.
