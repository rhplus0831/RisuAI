# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Phase 1 runtime-topology closeout. This record authorizes bounded Phase 2 Node
promotion slices; it does not authorize repository-wide default inversion or
bulk migration outside the active phase rules.

## Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `62a889b345c61581d26ce9737e32e5623cd47078`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the Phase 1 topology, inventory,
  checker/tests, and documentation in this slice; no unrelated working-tree
  changes were present.

Raw JSON, GNU `time`, and console artifacts were kept under `/tmp` and were not
committed. Coverage output remained under ignored `coverage/`.

## Phase 1 Implementation And Pilot Proof

`vitest.config.ts` now composes `frontend-node`, `frontend-svelte-node`, and
`frontend-dom`. The S project loads the Svelte plugin and shared setup but not
Happy-DOM or `vitest.dom.setup.ts`. Its environment delegates to Vitest's Node
setup while selecting Vite's client transform; this was required because the
built-in Node environment selects the SSR transform and made the stress pilot's
client `$effect` inert.

The explicit `vitest.svelte-node-tests.ts` inventory contains only the two Phase
1 S pilots. `vitest.dom.config.ts` excludes the N and S inventories and retains
the conservative fallback for every other file.

Direct root selection command:

```sh
pnpm exec vitest run \
  src/ts/parser/sentenceBreaks.test.ts \
  src/ts/parser/tests/chatVar.svelte.test.ts \
  src/ts/stores.runtimeEffects.svelte.test.ts \
  src/lib/UI/GUI/CheckInput.svelte.test.ts
```

Result: 4 files and 26 tests passed, with one N, two S, and one D owner. Focused
target-project runs separately passed 14 N tests, 8 S tests, and 4 D tests. The
S stress pilot failed under the first plain-Node/SSR-transform probe because its
`$effect` did not run, then passed under the final Node-backed client-transform
environment without DOM setup.

## Phase 1 Discovery And Classification Proof

Command:

```sh
pnpm check:frontend-test-inventory
```

Result: passed. The filesystem universe and resolved Vitest ownership remained
exhaustive and disjoint in all supported views.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 126 | 2 | 409 |
| Standalone ordinary frontend | 535 | 126 | 2 | 407 |
| `test:all` ordinary frontend | 529 | 125 | 2 | 402 |

All views retain their Phase 0 total. The target candidate distribution remains
174 N, 129 S, 234 D, and 7 B. The two validated S pilots no longer carry probe
markers, reducing outstanding target-runtime probes from 177 to 175.

## Phase 1 Warm Ordinary Measurements

Command shape:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v \
  pnpm exec vitest run --reporter=json --outputFile=/tmp/<run>.json
```

| Run | Wall | Vitest | User | System | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 73.07s | 72.05s | 428.77s | 35.42s | 635% | 4,818,792 |
| 2 | 70.44s | 69.59s | 419.50s | 31.00s | 639% | 4,800,148 |
| 3 | 75.22s | 74.28s | 450.79s | 35.43s | 646% | 4,661,000 |
| **Median** | **73.07s** | **72.05s** | **428.77s** | **35.42s** | **639%** | **4,800,148** |

All three runs passed 529 files and 6,413 tests. Wall range was 70.44-75.22s.
The wall median is 1.1% above the 72.30s Phase 0 reference and remains within
the 5% Phase 1 topology budget. Median peak RSS is 0.3% above the 4,785,288 KiB
reference and remains within the 10% guard. The first warm run reported 107.29s
transform, 29.36s setup, 422.61s import, 83.99s test, and 54.26s environment
aggregate worker time.

## Phase 1 Project And Command Validation

| Command/project | Result | Vitest duration |
| --- | --- | ---: |
| `frontend-node` | 126 files / 776 tests passed | 3.11s |
| `frontend-svelte-node` | 2 files / 8 tests passed | 1.18s |
| `frontend-dom` final rerun | 407 files / 5,832 tests passed | 68.95s |
| `pnpm test:frontend` | 535 files / 6,616 tests passed | 72.74s |
| `pnpm test:frontend:all` | 537 files / 6,622 tests passed | 77.32s |
| `pnpm test:gates` | 4 files / 9 tests passed | 10.76s |

`pnpm coverage:ui-map` passed 6 files and 203 tests in 18.44s. Lines were
14.56%, statements 14.97%, functions 18.22%, and branches 9.52%, all above the
8%/7%/5%/4% thresholds.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane for the runner changes. Running the selected
plan passed 535 frontend files/6,616 tests, 2 performance files/6 tests, and 154
server files/3,295 tests with 1 skipped. Direct-file selection, UI-map exclusion,
gate inclusion, and the unchanged aggregate lane graph all passed.

## Phase 1 Aggregate Closeout

`pnpm test:all --dry-run` reported the expected eight-lane graph. The final
`pnpm test:all` passed in 206.30s wall time with 5,029,460 KiB peak RSS.

| Lane | Result | Lane time |
| --- | --- | ---: |
| Server and browser-smoke typecheck | Passed | 17.8s |
| Frontend tests | 529 files / 6,413 tests passed | 85.0s |
| Server tests | 154 files / 3,295 passed / 1 skipped | 17.6s |
| Browser smoke | 34 passed | 70.6s |
| Frontend check | Passed | 33.9s |
| UI coverage | 6 files / 203 tests passed | 19.9s |
| Format check | Passed | 30.4s |
| Frontend performance gates | 2 files / 6 tests passed | 12.9s |

The aggregate wall result is 1.1% below the 208.53s Phase 0 observation and its
peak RSS remains below the 5,263,817 KiB guard. The previously observed
queued-finalization browser-smoke case passed in 5.4s.

## Phase 1 Accepted Display-Source Observation

The first complete DOM-project run passed 406 files but failed five assertions
in `src/ts/server/displaySources.test.ts`. The initial failure observed only
`latest-a` where the test expected `latest-a` and `latest-b` in one critical
batch. Because that assertion fired before resolving its deferred response, the
shared revision lane remained held and four later tests in the file failed or
timed out. This is consistent with the Phase 0 observation that asynchronous
same-chat work can reach separate zero-delay batches under full-suite load.

Three consecutive focused reruns passed all 8 tests in 3.20-3.34s, the complete
407-file DOM rerun passed, all later complete frontend runs passed, and the
final aggregate passed. The Phase 1 slice changed only project ownership and did
not touch this production/test path. Owner: display-source batching. Revisit
condition: another full-lane occurrence requires a dedicated stabilization
decision before the active promotion slice continues.

## Phase 0 Discovery And Classification Proof

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

## Phase 0 Formal Ordinary Frontend Baseline

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

## Phase 0 Independent Project Measurements

Both commands used the aggregate ordinary exclusion so their union matches the
529-file baseline.

| Project | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| `frontend-node` | 125 files / 771 tests passed | 3.20s | 4.06s | 987,312 |
| `frontend-dom` | 404 files / 5,642 tests passed | 69.76s | 70.67s | 4,930,972 |

Node phases were 3.64s transform, 8.16s setup, 5.02s import, 3.20s test,
and 0.01s environment. Happy-DOM phases were 101.45s transform, 22.43s setup,
423.61s import, 83.61s test, and 57.40s environment.

## Phase 0 Focused UI Coverage

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

## Phase 0 Aggregate Closeout

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

## Phase 0 Ratified Budgets

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
