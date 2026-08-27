# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Phase 2 protocol-validation slice closeout. Phase 2 remains in progress; this
record does not authorize repository-wide default inversion, S promotion, or
bulk migration outside the active phase rules.

## Phase 2 Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `253670c3c280497462adde0d607610548cf9eace`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the three-file Node ownership change,
  regenerated inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` and console artifacts were not committed. Coverage output remained
under ignored `coverage/`.

## Phase 2 Protocol-Validation Probe And Ownership

The first bounded Phase 2 slice promotes:

- `src/ts/server/characterSummaryProtocol.test.ts`
- `src/ts/server/shellProtocol.test.ts`
- `src/ts/server/startupTelemetryProtocol.test.ts`

The tests import only Vitest and plain protocol modules. Their runtime subjects
use plain TypeScript validation or the browser-safe TypeBox protocol package;
the only `Database` dependency is type-only. No Svelte transform, DOM/browser
global, DOM setup, fetch guard, or replacement mock is part of their proof.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/server/characterSummaryProtocol.test.ts \
  src/ts/server/shellProtocol.test.ts \
  src/ts/server/startupTelemetryProtocol.test.ts
```

Result: 3 files / 19 tests passed in 1.03s wall and 281ms Vitest duration,
with 392,620 KiB peak RSS and 354ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 19 tests
passed in 0.81s wall and 164ms Vitest duration, with 301,484 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 129 | 2 | 406 |
| Standalone ordinary frontend | 535 | 129 | 2 | 404 |
| `test:all` ordinary frontend | 529 | 128 | 2 | 399 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 175 to 172: 45 N and 127 S.

## Phase 2 Paired Project And Ordinary Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 125 files / 771 tests | 3.74s | 3.02s | 661% | 990,304 |
| `frontend-node` | After | 128 files / 790 tests | 4.24s | 3.54s | 588% | 950,836 |
| `frontend-dom` | Before | 402 files / 5,634 tests | 72.18s | 71.23s | 646% | 5,021,316 |
| `frontend-dom` | After | 399 files / 5,615 tests | 69.19s | 68.27s | 645% | 4,832,972 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 70.92s | 69.81s | 636% | 5,121,984 |
| Ordinary frontend | After | 529 files / 6,413 tests | 70.34s | 69.30s | 635% | 4,741,508 |

The paired ordinary wall observation improved by 0.58s (0.8%) and peak RSS by
380,476 KiB. Aggregate worker phases changed from 104.12s transform / 27.74s
setup / 407.98s import / 82.88s tests / 52.98s environment to 101.07s /
28.54s / 406.13s / 83.66s / 50.49s. The small complete-Node wall increase is
the expected cost of adding 3 files and does not produce an ordinary-lane
regression.

## Phase 2 Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests in 71.92s Vitest duration.
Full standalone `frontend-node` and `frontend-dom` project runs passed 129 files
/ 795 tests and 404 files / 5,813 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, UI contract, or browser-smoke file changed, so the periodic
Phase 2 `test:all` checkpoint remains deferred. Owner: frontend test
architecture. Reason: this slice changes only three explicit file-ownership
entries, and every affected lane passed. Revisit condition: the next
runner/setup/coverage/CI change or the next cumulative Phase 2 checkpoint.

## Phase 1 Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `62a889b345c61581d26ce9737e32e5623cd47078`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the Phase 1 topology, inventory,
  checker/tests, and documentation in that slice; no unrelated working-tree
  changes were present.

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
