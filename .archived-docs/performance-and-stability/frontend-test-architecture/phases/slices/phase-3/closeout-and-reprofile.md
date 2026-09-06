# Phase 3 Slice: Closeout And Re-Profile

Status: Complete

## Scope

Close Phase 3 after every candidate has target-project evidence. Run the formal
cold and three-run warm benchmark, independent N/S/D projects, standalone root
frontend, retained DOM contracts, focused UI coverage, affected routing and
execution, aggregate quality suite, formatting, inventory, and diff checks.

No runtime, production, test-body, setup, coverage, or CI code changes in this
closeout slice.

## Ownership And Completeness

Phase 3 promoted 43 files / 471 tests from Happy-DOM: 15 files / 159 tests now
run in Svelte+Node and 28 files / 312 tests run in Node after exact
smaller-runtime cross-checks. The full universe remains 537 files at 189 N / 17
S / 331 D. Standalone ordinary remains 535 files at 189 N / 17 S / 329 D, and
aggregate ordinary remains 529 files at 188 N / 17 S / 324 D.

The 97 remaining static mismatches are all probe-backed: 93 target-S files have
browser-global or DOM-parser blockers in the ledger, and four target-N files
retain the Phase 2 pure-helper, sanitizer, filesystem-picker, or file-picker
owners. No candidate is unprobed.

## Formal Performance Result

The cold transform-cache run passed 529 files / 6,413 tests in 72.59s wall and
71.73s Vitest duration, with 4,425,224 KiB peak RSS.

Three consecutive warm runs passed the same 529 files / 6,413 tests:

| Run | Wall | Vitest | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 68.47s | 67.41s | 627% | 4,626,468 |
| 2 | 70.70s | 69.77s | 640% | 5,068,472 |
| 3 | 66.76s | 65.83s | 639% | 5,019,644 |
| Median | 68.47s | 67.41s | 639% | 5,019,644 |

The wall range is 66.76-70.70s. Against Phase 0, wall median improves by 3.83s
(5.3%) and peak-RSS median increases by 234,356 KiB (4.9%), inside the 10%
guard. The 57.84s primary and 50.61s stretch targets are not met.

Median aggregate Vitest phases are 103.67s transform, 29.09s setup, 405.31s
import, 81.39s test bodies, and 42.33s environment. These totals accumulate
across workers and do not add to wall time.

## Project And Coverage Result

In the aggregate ordinary view:

| Project | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| Node | 188 files / 1,259 tests | 4.74s | 5.51s | 1,052,504 |
| Svelte+Node | 17 files / 167 tests | 1.71s | 2.36s | 1,156,464 |
| Happy-DOM | 324 files / 4,987 tests | 60.97s | 61.86s | 4,811,348 |

The standalone root frontend passed 535 files / 6,616 tests in 72.26s wall and
71.39s Vitest duration. The focused UI coverage gate passed 6 files / 203 tests
in 19.76s wall, with 14.55% lines, 14.96% statements, 18.2% functions, and
9.52% branches, all above its thresholds.

Svelte+Node is retained as a durable useful layer. It owns real rune-dependent
tests with only 341ms aggregate environment time and avoids forcing them into
either invalid Node execution or a 4,987-test DOM fallback.

## Phase 4 Decision And Current Profile

The primary target is not met, so Phase 4 proceeds only with current measured
candidates. Three-run median per-file elapsed time ranks the approved families:

1. Chat command boundaries: `chatCommands.test.ts` at 5.00s.
2. Settings projection and reconciliation: `TranslatorPresetSettings.svelte.test.ts`
   at 2.73s, `chatGenerationSettingsControls.test.ts` at 2.21s, and
   `pickerGenerationSettings.test.ts` at 1.73s.
3. Server-backed fixture planning: `sendChat.fixtures.serverBacked.test.ts` at
   2.70s and `sendChat.fixtures.test.ts` at 1.72s.
4. Router construction/reset: `router.test.ts` at 1.44s.

`bootstrap.test.ts` (2.41s) and `plugins.test.ts` (2.36s) remain deferred despite
their high elapsed time because the current proofs are broad lifecycle/browser
contracts and no clean pure seam is approved yet. Revisit only after the ranked
slices or fresher profiler evidence.

## Validation

- Cold plus three warm aggregate ordinary frontend runs passed.
- Independent Node, Svelte+Node, and Happy-DOM projects passed.
- Standalone root frontend and all retained blocker companions passed.
- Focused UI coverage passed all thresholds.
- Affected dry-run selected frontend, performance, and server lanes; execution
  passed all three.
- `pnpm test:all --dry-run` showed the expected eight-lane graph.
- `pnpm test:all` passed every lane in 3m24.6s, including 34 browser-smoke
  cases and zero frontend check errors or warnings.
- Inventory, formatting, and `git diff --check` passed.

Exact commands, toolchain details, lane timings, and resource observations are
in [`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

The closeout adds no runtime change to roll back. Individual promotion slices
retain their own allowlist rollback instructions; replace the formal profile
only with a complete newer same-host benchmark.
