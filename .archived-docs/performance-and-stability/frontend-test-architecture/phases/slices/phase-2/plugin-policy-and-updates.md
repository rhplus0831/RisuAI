# Phase 2 Slice: Plugin Policy And Update Helpers

Status: Complete

## Scope

Promote `src/ts/plugins/pluginUpdates.test.ts` and its 14 update-planning tests
from Happy-DOM to Node. Retain `src/ts/plugins/pluginIconSafety.test.ts` and its
two DOMPurify sanitization tests in Happy-DOM after an exact broader Node probe.

No production code, test body, assertion, or mock changes in this slice.

## Capability And Behavior Boundaries

- The promoted suite covers semantic-version parsing/comparison, compatibility
  filtering, deterministic update planning, invalid metadata, archive payload
  routing, and failure isolation. Its fetch and install boundaries are explicit
  fakes; it performs no real network, storage, Svelte, or DOM operation.
- The retained icon suite executes the real DOMPurify sanitizer to prove that
  HTML icons lose network-capable elements and attributes while data-image
  sources remain accepted. Plain Node imports DOMPurify without the window
  binding needed to expose `sanitize`.
- Replacing DOMPurify with a fake solely for promotion would remove the
  security behavior under test, so the icon contract remains D-owned.

## Performance And Ownership Result

The pre-probe two-file Happy-DOM run passed 16 tests in 1.22s wall and 525ms
Vitest duration, with 391,916 KiB peak RSS and 238ms environment time. The
broader Node probe passed all 14 update tests and one icon test, while the
real-sanitizer icon test failed with `DOMPurify.sanitize is not a function`.

The exact promoted suite passed twice in Node: the measured run completed 14
tests in 1.01s wall and 404ms Vitest duration, with 338,508 KiB peak RSS and no
environment time; the repeat took 401ms Vitest duration.

The paired ordinary frontend distribution moved from 157 N / 2 S / 370 D to
158 N / 2 S / 369 D while retaining 529 files / 6,413 tests. Wall time moved
from 66.02s to 66.60s (+0.9%), Vitest duration from 65.15s to 65.76s, and peak
RSS from 5,063,636 KiB to 4,696,532 KiB (-7.2%). These movements are within
run-to-run variability and form slice evidence, not a phase-level claim.

The Node project moved from 4.27s / 3.60s Vitest / 975,084 KiB to 4.03s /
3.39s / 922,624 KiB. The DOM project moved from 63.79s / 63.00s Vitest /
4,579,460 KiB to 62.40s / 61.63s / 4,800,256 KiB.

## Validation

- Exact and repeated Node probes passed all 14 promoted tests.
- Complete Node, DOM, and aggregate ordinary frontend runs passed 158 files /
  941 tests, 369 files / 5,464 tests, and 529 files / 6,413 tests.
- The inventory gate remained exhaustive and disjoint at full 159 N / 2 S /
  376 D, standalone ordinary 159 N / 2 S / 374 D, and aggregate ordinary 158 N
  / 2 S / 369 D. Generated mismatches fell from 143 to 142.
- The affected plan passed 535 frontend files / 6,616 tests, 2 performance
  files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.
- `pnpm format:check` and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Deferral And Rollback

`pluginIconSafety.test.ts` remains D-owned as a real DOMPurify security
contract. Revisit only if the sanitizer gains an equally faithful Node binding
or ownership is deliberately redesigned.

To roll back the promotion, remove `pluginUpdates.test.ts` from
`vitest.node-tests.ts` and regenerate the inventory. Happy-DOM will resume
ownership without a production rollback.
