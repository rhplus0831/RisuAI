# Phase 7 Slice: Verification And Closeout

Status: Complete

Date: 2026-08-29

## Scope

Close the workstream on the final explicit Node, Svelte+Node, Happy-DOM, and
built-browser topology. Run the same-host formal benchmark, prove every local
and CI ownership boundary, resolve any correctness failures exposed by the
closeout, update current documentation, decide the ratified budgets, and move
the intact record to the performance-and-stability archive.

## Correctness Changes Found During Closeout

The browser matrix exposed two timing-dependent oracles during final
verification:

- response-loss recovery can legitimately make more than two HTTP attempts
  when a live heartbeat replay begins and the forced reload interrupts it; the
  proof now requires every attempt to preserve the retained mutation ID while
  retaining the exact one-revision and one-receipt assertions; and
- a queued finalization previously cleared its refresh-driving projection
  before recovered effects completed. A transient effect-runtime failure could
  therefore leave six effects pending with no retry owner. Finalization
  projection clearing now occurs only after effect reconciliation succeeds.

The retry fix has a fail-once fake-timer contract. The exact queued-finalization
browser journey passed three consecutive runs, the response-loss journey passed
focused validation, and the complete 34-case browser lane passed afterward
with Playwright retries disabled.

## Final Ownership And Counts

The exhaustive gate passed all full, standalone ordinary, and aggregate
ordinary views:

| View                | Files | Distribution         |
| ------------------- | ----: | -------------------- |
| Full Vitest         |   537 | 194 N / 17 S / 326 D |
| Standalone ordinary |   535 | 194 N / 17 S / 324 D |
| Aggregate ordinary  |   529 | 193 N / 17 S / 319 D |
| Browser smoke       |     7 | 7 B                  |

The final explicit capability inventory is N=194, S=17, D=326, B=7. The 187
reviewed pre-suffix DOM registrations remain exact and stale-checked; there is
no implicit Happy-DOM fallback.

Aggregate ordinary test count is 6,429 versus 6,413 at Phase 0. The intentional
delta is +10 Phase 4 planner cases, +5 Phase 6 routing/runner cases, and +1
Phase 7 finalization-retry regression. Full file count and aggregate ordinary
file count both return to their Phase 0 totals after Phase 4 added two files,
Phase 5 removed three consolidated boundaries, and Phase 6 added one explicit
routing owner.

## Formal Performance Result

The measurement tree was clean at `c12da3a11` on Node 24.19.0, pnpm 11.23.0,
Vitest 4.1.2, and 10 CPUs. The formal ordinary command excluded the six UI-map
sentinels so its 529-file scope matches Phase 0.

The transform-cache-cleared run passed 529 files / 6,429 tests in 76.98s wall
and 75.91s Vitest with 4,606,780 KiB peak RSS. Its worker sums were 118.98s
transform, 33.68s setup, 458.36s import, 84.12s tests, and 50.76s environment.

Three unchanged warm runs passed:

| Run    |   Wall | Vitest |    User | System |  CPU | Peak RSS KiB |
| ------ | -----: | -----: | ------: | -----: | ---: | -----------: |
| 1      | 68.49s | 67.43s | 394.13s | 30.66s | 620% |    4,902,032 |
| 2      | 70.61s | 69.55s | 408.14s | 30.94s | 621% |    4,603,188 |
| 3      | 67.75s | 66.69s | 399.02s | 28.37s | 630% |    4,953,804 |
| Median | 68.49s | 67.43s | 399.02s | 30.66s | 621% |    4,902,032 |

The wall range is 67.75-70.61s. Median worker sums are 107.44s transform,
28.76s setup, 406.77s import, 80.51s tests, and 41.53s environment.

Against Phase 0, median wall improves 3.81s (5.3%) and peak RSS rises 116,744
KiB (2.4%), inside the 10% guard. Against Phase 5, wall is effectively
unchanged (-0.1%) and peak RSS rises 2.8%, also inside budget.

The 57.84s primary and 50.61s stretch targets are not met. The shortfall is
accepted because every N/S candidate has an exact probe disposition, all DOM
owners are explicit, the measured Phase 4 and 5 extraction/consolidation seams
were completed, and the remaining expensive owners cross real mounted,
browser, persistence, focus, rollback, or lifecycle boundaries. Further
rename-only movement or suite merging would not remove the production import
graphs and would weaken ownership clarity. Revisit only when a fresh profile
identifies a cohesive production seam that moves multiple behavioral cases, or
when runner/runtime changes materially alter the cost distribution.

## Independent Projects And Coverage

| Project/lane                   | Result                  | Vitest |   Wall | Peak RSS KiB |
| ------------------------------ | ----------------------- | -----: | -----: | -----------: |
| Node aggregate ordinary        | 193 files / 1,314 tests |  5.05s |  5.85s |    1,078,200 |
| Svelte+Node aggregate ordinary | 17 / 167                |  1.74s |  2.42s |    1,150,388 |
| Happy-DOM aggregate ordinary   | 319 / 4,948             | 66.44s | 67.43s |    4,787,800 |
| Focused UI coverage            | 6 / 203                 | 20.41s | 21.42s |    2,069,200 |

UI coverage passed at 14.54% lines, 14.96% statements, 18.18% functions, and
9.51% branches against 8/7/5/4 thresholds. Its wall observation is inside the
Phase 5-6 range and does not represent a material regression from the Phase 0
point estimate.

## Final Validation

- `pnpm test:frontend`: 535 files / 6,632 tests passed.
- `pnpm test:frontend:all`: 537 / 6,638 passed.
- `pnpm test:gates`: 4 / 38 passed.
- `pnpm coverage:ui-map`: 6 / 203 passed with all thresholds.
- `pnpm test:server`: 154 files / 3,295 tests passed with one expected skip.
- `pnpm test:smoke`: all 34 cases passed after the two closeout fixes.
- the four reduced-sharing owners passed shuffled test-order seeds 101, 202,
  and 303 as 4 files / 51 tests with retries disabled.
- frontend and server/browser-smoke type checks passed with zero diagnostics.
- `pnpm test:all --dry-run` showed the expected nine-lane graph.
- `pnpm test:all`: all nine lanes passed in 3m23.5s, including 529 frontend
  files / 6,429 tests, 154 server files / 3,295 tests with one skip, all 34
  browser cases, 6 UI-map files / 203 tests, and 2 performance files / 6 tests.
- inventory completeness, Prettier, and `git diff --check` passed.

Exact command output, phases, resource measurements, and historical comparisons
are retained in [`../../../latest-verification.md`](../../../latest-verification.md).

## Closeout Decision

Phase 7 and the workstream are complete with one accepted performance shortfall
and no correctness, routing, coverage, CI, memory, or documentation blocker.
The current architecture guides own live behavior; this subtree is historical
evidence after archival.
