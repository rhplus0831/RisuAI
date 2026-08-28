# Phase 5 Slice: Alert Component Consolidation

Status: Complete

## Scope

Consolidate the three AlertComp suites into `AlertComp.dom.test.ts` with one
component mount and cleanup harness. Retain all 15 branch, request-data,
stack-translation, input, workflow, selection, backdrop, focus, and confirmation
queue cases.

## Ownership And Invariants

- Every case mounts the real `AlertComp.svelte` into a fresh target and unmounts
  it after resetting the alert store.
- Branch and request-data describes seed only their own database and selected
  character state; common teardown clears both.
- The branch focus-restoration case owns and removes its outside focus target.
- The deferred stack-translation race still proves an older result cannot paint
  over the latest error.
- Request metadata remains tied to message identity across index movement and
  reports removal visibly.
- Dialog focus, keyboard, backdrop, required-selection, and serial queue results
  remain DOM/result contracts rather than internal-state substitutes.

## Measurement

| Observation | Files / tests | Vitest | Transform | Setup | Import | Tests | Environment | Wall | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 3 / 15 | 10.15s | 23.69s | 235ms | 29.18s | 220ms | 365ms | 11.10s | 1,812,376 |
| After | 1 / 15 | 10.32s | 8.17s | 97ms | 9.74s | 176ms | 138ms | 11.20s | 1,160,192 |

Focused Vitest moves +1.7% and wall +0.9%, both inside the established 5% noise
band. The intended repeated-file mechanism is still demonstrated: summed import
falls 66.6%, environment 62.2%, transform 65.5%, and peak RSS 36.0%. The slice is
retained for that structural reduction and clearer component ownership, not
claimed as a focused wall-time win.

Relative to the preceding Toggles slice, full discovery changes from 538 to 536
files, standalone ordinary from 536 to 534, and aggregate ordinary from 530 to
528. Runtime ownership changes by two D files; all 15 behavior cases remain.

## Validation

- Focused consolidated owner: 1 file / 15 tests passed.
- Shuffled test-order runs with seeds 101, 202, and 303 passed with isolation
  and retries disabled.
- Frontend inventory regeneration and the three-view completeness proof passed.
- Prettier and `git diff --check` passed.

## Rollback

Split the branch and request-data describes back into their prior files, rename
the remaining owner to `AlertComp.stackTrace.test.ts`, restore test-document
references, and regenerate the inventory.
