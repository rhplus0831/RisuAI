# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Formal Phase 0 closeout baseline. This record authorizes Phase 1's representative
topology pilot; it does not authorize bulk test migration.

## Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Commit: `ece14168407b25960d3f3179460627e5dae71f25`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the commit plus the Phase 0 checker, inventory, package
  scripts, checker test, and its new Node allowlist entry; no unrelated working
  tree changes were present. The final aggregate rerun also included the Phase 0
  documentation.

Raw JSON, GNU `time`, and console artifacts were kept under `/tmp` and were not
committed. Coverage output remained under ignored `coverage/`.

## Discovery And Classification Proof

Command:

```sh
pnpm check:frontend-test-inventory
```

Result: passed. Resolved Vitest discovery and the independent filesystem
universe were exhaustive and disjoint in every supported view.

| View | Files | Node | Happy-DOM |
| --- | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 126 | 411 |
| Standalone ordinary frontend | 535 | 126 | 409 |
| `test:all` ordinary frontend | 529 | 125 | 404 |

Seven Playwright spec files were separately inventoried as B. The committed
candidate classification contains 174 N, 129 S, 234 D, and 7 B files. All 177
current-Happy-DOM files proposed for N or S retain an explicit target-project
probe requirement.

The previous 528-file provisional count was valid for the earlier `test:all`
ordinary tree. Phase 0 added one five-test Node checker, producing the formal
529-file/6,413-test ordinary universe.

## Formal Ordinary Frontend Baseline

Command shape:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v \
  pnpm exec vitest run \
  --reporter=default --reporter=json \
  --outputFile.json=/tmp/<run>.json
```

The cold-cache run was preceded by `pnpm exec vitest --clearCache`, which clears
Vitest's result and filesystem-module caches. It is not labeled as a cold OS
page-cache run.

### Cold Transform-Cache Run

- Result: 529 files and 6,413 tests passed.
- Wall: 70.73s.
- User/system: 422.30s / 36.30s.
- Average CPU: 648%.
- Peak RSS: 4,480,284 KiB.

### Warm Runs

| Run | Wall | Vitest | User | System | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 72.34s | 71.45s | 436.90s | 32.96s | 649% | 4,990,336 |
| 2 | 72.30s | 71.23s | 429.79s | 34.63s | 642% | 4,703,800 |
| 3 | 69.71s | 68.80s | 419.51s | 31.24s | 646% | 4,785,288 |
| **Median** | **72.30s** | **71.23s** | **429.79s** | **32.96s** | **646%** | **4,785,288** |

Wall range: 69.71-72.34s. All runs passed 529 files and 6,413 tests.

Median aggregate Vitest phases across the three warm runs:

| Phase | Median |
| --- | ---: |
| Transform | 102.15s |
| Setup | 29.48s |
| Import | 421.29s |
| Test bodies | 82.11s |
| Environment | 55.05s |

These phase values accumulate across parallel workers and do not add to wall
time.

## Independent Project Measurements

Both commands used the aggregate ordinary exclusion so their union matches the
529-file baseline.

| Project | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| `frontend-node` | 125 files / 771 tests passed | 3.20s | 4.06s | 987,312 |
| `frontend-dom` | 404 files / 5,642 tests passed | 69.76s | 70.67s | 4,930,972 |

Node phases were 3.64s transform, 8.16s setup, 5.02s import, 3.20s test,
and 0.01s environment. Happy-DOM phases were 101.45s transform, 22.43s setup,
423.61s import, 83.61s test, and 57.40s environment.

## Focused UI Coverage

Command:

```sh
pnpm coverage:ui-map
```

Result: 6 files and 203 tests passed. Vitest duration was 19.20s; wall time was
20.13s; peak RSS was 2,076,484 KiB.

| Metric | Result | Threshold |
| --- | ---: | ---: |
| Lines | 13.05% | 8% |
| Statements | 11.75% | 7% |
| Functions | 10.16% | 5% |
| Branches | 9.03% | 4% |

## Aggregate Closeout

`pnpm test:all --dry-run` reported the expected eight-lane graph. The final
`pnpm test:all` rerun passed in 208.53s wall time with 4,870,692 KiB peak RSS.

| Lane | Result | Lane time |
| --- | --- | ---: |
| Server and browser-smoke typecheck | Passed | 18.5s |
| Frontend tests | 529 files / 6,413 tests passed | 84.4s |
| Server tests | 154 files / 3,295 passed / 1 skipped | 17.8s |
| Browser smoke | 34 passed | 73.1s |
| Frontend check | Passed | 32.8s |
| UI coverage | 6 files / 203 tests passed | 19.7s |
| Format check | Passed | 30.9s |
| Frontend performance gates | 2 files / 6 tests passed | 13.2s |

The first aggregate attempt passed every lane except one browser-smoke case:
`queued finalization keeps a provisional row through reload and later settles`
observed six pending effects after completion and timed out. The exact focused
contract then passed in 6.2s, and the complete aggregate rerun passed it in 4.8s.
No Phase 0 runtime ownership or production behavior touched this contract. This
is recorded as a stability observation for the generation browser-smoke owner;
repeat occurrence during Phase 1 requires investigation before Phase 1
closeout.

The first direct `pnpm test:frontend` validation also observed a timing-sensitive
failure in `displaySources.test.ts`: two same-chat requests reached separate
zero-delay batches instead of the asserted single batch. The focused 8-test
file passed immediately, and the repeated complete standalone lane passed 535
files and 6,616 tests in 72.36s. This test and production path were unchanged by
Phase 0. A repeat during Phase 1 likewise blocks Phase 1 closeout pending an
owner investigation.

## Ratified Budgets

The 72.30s formal warm median establishes:

- primary ordinary-frontend target: 57.84s or lower (20% reduction);
- stretch ordinary-frontend target: 50.61s or lower (30% reduction);
- peak-RSS guard: no more than 5,263,817 KiB (10% over the median), absent an
  accepted reason;
- UI coverage and full `test:all`: no more than 5% regression from the Phase 0
  reference observations when compared with like-for-like phase-level runs;
- zero missing or multiply assigned files and zero new flaky retries, leaked
  handles, unhandled requests, or order dependencies.

These are phase-comparison budgets, not machine-independent CI timing failures.
