# Phase 4 Slice: Closeout And Re-Profile

Status: Complete

## Scope

Close Phase 4 after every approved ranked candidate has an implementation or
recorded deferral. Run the formal cold and three-run warm benchmark, independent
projects, aggregate ordinary frontend, focused UI coverage, affected routing,
browser smoke, server tests, type checks, formatting, inventory, and diff
checks.

No runtime, production, test-body, setup, coverage, or CI code changes are made
by this closeout slice.

## Ownership And Completeness

Phase 4 completed four slices/proof batches:

- chat-import full-create and tail-chunk planning moved to a new plain
  TypeScript leaf with six Node tests;
- Saved Toggles comparison, similarity, Pick selection, and active-key
  projection moved to a plain leaf with seven Node tests;
- both fixture corpora remained Happy-DOM integration owners after measured
  triage found no production pure seam or performance mechanism; and
- the existing router route leaf gained an eight-test Node matrix while 32
  history, store, guard, and freshness cases remained in Happy-DOM.

The full universe is 539 files at 192 N / 17 S / 330 D. Standalone ordinary is
537 files at 192 N / 17 S / 328 D, and aggregate ordinary is 531 files at 191 N
/ 17 S / 323 D. Relative to Phase 3, three more files execute in Node, one fewer
executes in Happy-DOM, and aggregate ordinary changes by +2 files / +10 tests.
The additional tests expand pure boundary coverage; no DOM/browser behavior
owner was removed.

## Formal Performance Result

The transform-cache-cleared cold run passed 531 files / 6,423 tests in 69.10s
wall and 68.00s Vitest duration, with 4,512,992 KiB peak RSS.

Three consecutive warm runs passed the same 531 files / 6,423 tests:

| Run | Wall | Vitest | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 68.49s | 67.57s | 644% | 4,893,640 |
| 2 | 70.32s | 69.28s | 628% | 4,759,324 |
| 3 | 70.10s | 69.22s | 650% | 4,905,256 |
| Median | 70.10s | 69.22s | 644% | 4,893,640 |

The wall range is 68.49-70.32s. Against Phase 3, wall median moves by +1.63s
(+2.4%), inside the established 5% ordinary-run noise band, while peak-RSS
median improves by 126,004 KiB (2.5%). Against Phase 0, wall median improves by
2.20s (3.0%) and peak-RSS median increases by 108,352 KiB (2.3%), inside the
10% guard. The 57.84s primary and 50.61s stretch targets are not met.

Median aggregate Vitest phases are 98.85s transform, 32.10s setup, 406.32s
import, 79.90s test bodies, and 43.39s environment. These worker totals do not
add to wall time.

The selected focused scopes do show the intended mechanism beyond noise. Their
sequential focused Vitest observations sum to 12.93s before Phase 4 and 9.35s
after it, a 3.58s (27.7%) reduction despite adding pure boundary cases. The chat
and settings slices account for that reduction. The router browser owner was
unchanged within noise and is retained for correctness and maintainability,
not counted as a performance win. Parallel whole-lane scheduling masks the
focused reduction at the formal median.

## Validation Result

- Independent Node passed 192 files / 1,285 tests in 4.84s Vitest duration;
  Svelte+Node passed 17 files / 167 tests in 1.86s; standalone Happy-DOM passed
  328 files / 5,174 tests in 62.71s.
- The focused UI coverage gate passed 6 files / 203 tests in 19.48s Vitest
  duration with all thresholds satisfied.
- `pnpm test:affected --dry-run` selected frontend, isolated performance, and
  server lanes. The same lanes passed in the aggregate closeout.
- `pnpm test:all --dry-run` showed the expected eight-lane graph.
- `pnpm test:all` passed every lane in 3m18.8s: 531 frontend files / 6,423
  tests, 154 server files / 3,295 passing tests with 1 skip, 34 browser-smoke
  cases, 6 UI coverage files / 203 tests, and 2 performance files / 6 tests.
- Client and server/browser-smoke type checks passed with zero errors and
  warnings. Formatting, inventory completeness, and `git diff --check` passed.

## Stopping Decision

Further Phase 4 extraction stops. Every Phase 3-ranked candidate now has an
implementation, a retained integration owner, or an explicit deferral. The
remaining measured settings, fixture, bootstrap, and plugin costs cross
persistence, lifecycle, focus, rollback, browser, Fastify, or SQLite contracts
without another demonstrated cohesive production pure seam.

The ordinary primary target remains open for Phases 5-7. Phase 5 owns repeated
Happy-DOM mount/setup and visible-behavior consolidation; Phase 6 owns final
routing and CI enforcement. Reopen pure extraction only with a fresh profile
and a planner/reducer that can move multiple behavioral cases without weakening
their integration contracts.

## Rollback

The closeout adds no runtime change to roll back. Each implementation slice has
its own local rollback instructions; replace the formal profile only with a
complete newer same-host benchmark.

