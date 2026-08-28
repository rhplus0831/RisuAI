# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Phase 2 storage-backup-export-helpers slice closeout. Phase 2 remains in
progress; this record does not authorize repository-wide default inversion, S
promotion, or bulk migration outside the active phase rules.

## Phase 2 Storage-Backup-Export-Helpers Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `6402e5116b3c6d370199449d1acb0eb934468215`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean startup-lifecycle-state-helpers commit plus the
  three-file Node ownership change, regenerated inventory, and Phase 2
  documentation in this slice; no unrelated working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Storage-Backup-Export-Helpers Probe And Ownership

The tenth bounded Phase 2 slice promotes:

- `src/ts/kei/backup.test.ts`
- `src/ts/storage/exportAsDataset.test.ts`
- `src/ts/storage/risuSave.test.ts`

The Risu-Kei suite explicitly replaces alert, endpoint, Svelte database, and
Svelte global-API boundaries and supplies every `fetch` result. The dataset
suite explicitly replaces Svelte database, download, alert, and hydration
boundaries. The RisuSave suite selects Fastify mode and replaces localforage,
Svelte database, and browser storage; its guard assertions reject any retired
cache access. Their remaining graphs are backup state transitions, strict
hydration and JSON export planning, and typed-array block encoding. No real
network, browser storage, Svelte rune, or DOM API is executed. No mock,
assertion, production dependency, or test body changed for promotion.

A broader Node probe also included `src/ts/storage/backup.test.ts`. Its manual
server-backup routing case passed, while seven device-import cases failed with
`HTMLInputElement is not defined`. The test constructs a `File`, intercepts
`HTMLInputElement.prototype.click`, assigns the input's `files`, and dispatches
a `change` event to prove the production file-picker contract. It remains in D
without weakened assertions, mocks, or production behavior.

Pre-promotion Happy-DOM command for the final promoted scope:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/kei/backup.test.ts \
  src/ts/storage/exportAsDataset.test.ts \
  src/ts/storage/risuSave.test.ts
```

Result: 3 files / 9 tests passed in 1.31s wall and 575ms Vitest duration,
with 438,876 KiB peak RSS and 469ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 9 tests
passed in 1.12s wall and 370ms Vitest duration, with 357,560 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Storage-Backup-Export-Helpers Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three promoted target-N probe
markers, retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 157 | 2 | 378 |
| Standalone ordinary frontend | 535 | 157 | 2 | 376 |
| `test:all` ordinary frontend | 529 | 156 | 2 | 371 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime mismatches fell from 147 to 144: 17 N and 127 S. Fourteen N
files remain unprobed; the other three N mismatches are the two failed
generation-effect probes and the failed device-backup probe retained in D.

## Phase 2 Storage-Backup-Export-Helpers Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 153 files / 917 tests | 4.55s | 3.75s | 681% | 943,028 |
| `frontend-node` | After | 156 files / 926 tests | 4.83s | 4.02s | 696% | 938,492 |
| `frontend-dom` | Before | 374 files / 5,488 tests | 67.34s | 66.38s | 630% | 5,006,784 |
| `frontend-dom` | After | 371 files / 5,479 tests | 69.15s | 68.25s | 636% | 4,853,776 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 68.90s | 68.04s | 642% | 4,847,236 |
| Ordinary frontend | After | 529 files / 6,413 tests | 70.10s | 69.15s | 635% | 5,064,564 |

The paired ordinary wall observation increased by 1.20s (1.7%) while peak RSS
increased by 217,328 KiB (4.5%). Both movements remain within observed lane
variability, so this is not a phase-level performance or regression claim. The
owning DOM project varied upward by 1.81s while its peak RSS decreased by
153,008 KiB; the Node project varied upward by 0.28s after absorbing the three
files.

## Phase 2 Storage-Backup-Export-Helpers Command Validation

Complete standalone `frontend-node` and `frontend-dom` project runs passed 157
files / 931 tests and 376 files / 5,677 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed.

No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
file changed in the promotion, so the preceding test-runtime-tooling `test:all`
checkpoint remains the current periodic Phase 2 aggregate proof.

## Phase 2 Startup-Lifecycle-State-Helpers Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `ffd018c37fe2807ad8ab84b2834899c4c4042bf3`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean generation-runtime-boundaries commit plus the
  two-file Node ownership change, regenerated inventory, and Phase 2
  documentation in this slice; no unrelated working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Startup-Lifecycle-State-Helpers Probe And Ownership

The ninth bounded Phase 2 slice promotes:

- `src/ts/process/legacyMemoryMigrationNotice.test.ts`
- `src/ts/server/startupTelemetry.test.ts`

The legacy-memory suite explicitly replaces its Svelte-named resource
projection and settings persistence boundaries, plus the alert surface. Its
remaining graph is retired-algorithm detection, once-per-database notice state,
and dismissal persistence planning; the production `Database` import is
type-only. The startup telemetry suite explicitly replaces authenticated server
storage and stubs `fetch`; its remaining graph is the plain startup-readiness
state machine, protocol validation, event buffering, and best-effort transport.
Node 24 supplies the `Response` used by the existing stub. Neither suite mounts
a component, accesses browser storage, or performs a real network request. No
mock, assertion, production dependency, or test body changed for promotion.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/process/legacyMemoryMigrationNotice.test.ts \
  src/ts/server/startupTelemetry.test.ts
```

Result: 2 files / 8 tests passed in 1.38s wall and 616ms Vitest duration,
with 391,080 KiB peak RSS and 333ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 2 files / 8 tests
passed in 1.13s wall and 411ms Vitest duration, with 332,100 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Startup-Lifecycle-State-Helpers Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the two promoted target-N probe
markers, retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 154 | 2 | 381 |
| Standalone ordinary frontend | 535 | 154 | 2 | 379 |
| `test:all` ordinary frontend | 529 | 153 | 2 | 374 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime mismatches fell from 149 to 147: 20 N and 127 S. Eighteen N
files remain unprobed; the other two N mismatches are the failed generation
effect probes retained in D.

## Phase 2 Startup-Lifecycle-State-Helpers Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 151 files / 909 tests | 4.34s | 3.56s | 679% | 953,552 |
| `frontend-node` | After | 153 files / 917 tests | 4.71s | 3.99s | 631% | 952,752 |
| `frontend-dom` | Before | 376 files / 5,496 tests | 67.58s | 66.73s | 636% | 4,842,932 |
| `frontend-dom` | After | 374 files / 5,488 tests | 63.88s | 62.99s | 630% | 4,650,008 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 72.82s | 71.84s | 634% | 4,980,964 |
| Ordinary frontend | After | 529 files / 6,413 tests | 74.21s | 73.26s | 638% | 4,898,600 |

The paired ordinary wall observation increased by 1.39s (1.9%) while peak RSS
decreased by 82,364 KiB (1.7%). Both movements remain within observed lane
variability, so this is not a phase-level performance claim. The owning DOM
project improved by 3.70s while the Node project varied upward by 0.37s after
absorbing the two files.

## Phase 2 Startup-Lifecycle-State-Helpers Command Validation

Complete standalone `frontend-node` and `frontend-dom` project runs passed 154
files / 922 tests and 379 files / 5,686 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed.

No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
file changed in the promotion, so the preceding test-runtime-tooling `test:all`
checkpoint remains the current periodic Phase 2 aggregate proof.

## Phase 2 Generation-Runtime-Boundaries Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `86fdbc9e177ecef670384d290266c55bd6c019cb`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean prompt-tokenization commit plus the three-file
  Node ownership change, regenerated inventory, and Phase 2 documentation in
  this slice; no unrelated working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Generation-Runtime-Boundaries Probe And Ownership

The eighth bounded Phase 2 slice promotes:

- `src/ts/process/generationRuntimeBridge.test.ts`
- `src/ts/process/inlayFinalization.test.ts`
- `src/ts/process/rawGenerationCallerAllowlist.test.ts`

The runtime-bridge subject uses only emitted registry state and type-erased
module references. The inlay suite explicitly replaces its Svelte-named
projection state and command dispatcher; its remaining graph is compare-and-set
command planning and conflict handling. The raw-caller suite is Node-native
filesystem source inspection and never imports or transforms the Svelte files
whose policy it checks. No DOM, browser storage, or network is accessed. No
mock, assertion, production dependency, or test body changed for promotion.

An initial broader Node probe also included
`generationEffectLedger.test.ts` and `recoveredGenerationEffects.test.ts`.
Those two suites failed before collection with `$state is not defined`:
the ledger reaches `persistenceActivity.svelte.ts` through `commands.ts`, while
the recovery suite's partial ledger mock reaches `coreStores.svelte.ts` through
`fastifyStorage.ts`. Both remain in D without weakened mocks or production
changes and require S-target reclassification or a later pure-boundary
decision.

Pre-promotion Happy-DOM command for the final promoted scope:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/process/generationRuntimeBridge.test.ts \
  src/ts/process/inlayFinalization.test.ts \
  src/ts/process/rawGenerationCallerAllowlist.test.ts
```

Result: 3 files / 6 tests passed in 1.03s wall and 343ms Vitest duration,
with 395,624 KiB peak RSS and 367ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 6 tests
passed in 0.94s wall and 269ms Vitest duration, with 312,660 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Generation-Runtime-Boundaries Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three promoted target-N probe
markers, retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 152 | 2 | 383 |
| Standalone ordinary frontend | 535 | 152 | 2 | 381 |
| `test:all` ordinary frontend | 529 | 151 | 2 | 376 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime mismatches fell from 152 to 149: 22 N and 127 S. Twenty N files
remain unprobed; the other two N mismatches are the failed generation-effect
probes recorded above.

## Phase 2 Generation-Runtime-Boundaries Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 148 files / 903 tests | 4.23s | 3.48s | 680% | 912,104 |
| `frontend-node` | After | 151 files / 909 tests | 4.24s | 3.50s | 676% | 925,640 |
| `frontend-dom` | Before | 379 files / 5,502 tests | 65.49s | 64.62s | 636% | 4,720,332 |
| `frontend-dom` | After | 376 files / 5,496 tests | 66.88s | 65.99s | 641% | 4,644,884 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 74.45s | 73.60s | 642% | 4,909,928 |
| Ordinary frontend | After | 529 files / 6,413 tests | 73.67s | 72.66s | 642% | 4,782,104 |

The paired ordinary wall observation improved by 0.78s (1.0%) while peak RSS
decreased by 127,824 KiB (2.6%). Both movements remain within observed lane
variability, so this is not a phase-level performance claim. The owning DOM
project varied upward by 1.39s; the Node project remained effectively flat
after absorbing the three files.

## Phase 2 Generation-Runtime-Boundaries Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 152 files / 914 tests and
381 files / 5,694 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed in the
promotion, so the preceding test-runtime-tooling `test:all` checkpoint remains
the current periodic Phase 2 aggregate proof.

## Phase 2 Prompt-Tokenization Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `edbd48dc6723a030b527f9a26d14f76ad21f8cef`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean base commit plus the three-file Node ownership
  change, regenerated inventory, and Phase 2 documentation in this slice; no
  unrelated working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Prompt-Tokenization Probe And Ownership

The seventh bounded Phase 2 slice promotes:

- `src/ts/process/prompt.conversionDurability.test.ts`
- `src/ts/process/promptTokenizeMemo.test.ts`
- `src/ts/tokenizer.test.ts`

The prompt suites explicitly replace their Svelte-named persistence boundary,
tokenizer, and alert surface. The tokenizer suite explicitly replaces its
Svelte-named database, plugin, parser, and global-fetch boundaries, as well as
local tokenization and provider operations. The remaining exercised graphs are
plain TypeScript conversion, data shaping, memoization, debounce sequencing,
bounded cache behavior, and tokenizer option data. Vitest fake timers are
installed explicitly. No DOM or browser storage is accessed, every provider
operation is mocked, and browser-only tokenizer branches remain outside these
contracts. No mock, assertion, production dependency, or test body changed for
promotion.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/process/prompt.conversionDurability.test.ts \
  src/ts/process/promptTokenizeMemo.test.ts \
  src/ts/tokenizer.test.ts
```

Result: 3 files / 16 tests passed in 1.39s wall and 596ms Vitest duration,
with 491,152 KiB peak RSS and 479ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 16 tests
passed in 1.16s wall and 398ms Vitest duration, with 436,736 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Prompt-Tokenization Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 149 | 2 | 386 |
| Standalone ordinary frontend | 535 | 149 | 2 | 384 |
| `test:all` ordinary frontend | 529 | 148 | 2 | 379 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 155 to 152: 25 N and 127 S.

## Phase 2 Prompt-Tokenization Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 145 files / 887 tests | 4.39s | 3.63s | 672% | 945,704 |
| `frontend-node` | After | 148 files / 903 tests | 4.27s | 3.53s | 689% | 937,580 |
| `frontend-dom` | Before | 382 files / 5,518 tests | 68.19s | 67.24s | 625% | 4,550,372 |
| `frontend-dom` | After | 379 files / 5,502 tests | 68.61s | 67.69s | 631% | 4,803,428 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 69.32s | 68.44s | 636% | 5,009,748 |
| Ordinary frontend | After | 529 files / 6,413 tests | 70.17s | 69.27s | 634% | 4,957,828 |

The paired ordinary wall observation increased by 0.85s (1.2%) while peak RSS
decreased by 51,920 KiB (1.0%). Both movements remain within observed lane
variability, so this is not a phase-level performance claim. The owning DOM
project varied upward by 0.42s; the Node project improved by 0.12s after
absorbing the three files.

## Phase 2 Prompt-Tokenization Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 149 files / 908 tests and
384 files / 5,700 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed in the
promotion, so the preceding test-runtime-tooling `test:all` checkpoint remains
the current periodic Phase 2 aggregate proof.

## Phase 2 Model-Provider-Catalogs Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `966cc68383f4163b7e9b878d96c4c80f3d9076d9`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean stabilization commit plus the four-file Node
  ownership change, regenerated inventory, and Phase 2 documentation in this
  slice; no unrelated working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Model-Provider-Catalogs Probe And Ownership

The sixth bounded Phase 2 slice promotes:

- `src/ts/model/modellist.dynamic.test.ts`
- `src/ts/model/nanogpt.test.ts`
- `src/ts/model/ollama.test.ts`
- `src/ts/model/openrouter.test.ts`

All four suites explicitly replace their Svelte-named storage, plugin, global
fetch, or provider-operation boundaries as applicable. Their remaining runtime
graphs are plain TypeScript model mapping, mutable registry cleanup, and the
shared keyed-request cache. The actual `svelte/store` package import retained
by `modellist.ts` does not require Svelte compilation and passed in Node. No DOM
or browser storage is accessed, and every upstream operation is represented by
an existing mock rather than a real network request. No mock, assertion,
production dependency, or test body changed for promotion.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/model/modellist.dynamic.test.ts \
  src/ts/model/nanogpt.test.ts \
  src/ts/model/ollama.test.ts \
  src/ts/model/openrouter.test.ts
```

Result: 4 files / 25 tests passed in 1.36s wall and 474ms Vitest duration,
with 452,412 KiB peak RSS and 550ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 4 files / 25 tests
passed in 0.98s wall and 294ms Vitest duration, with 353,132 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Model-Provider-Catalogs Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the four target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 146 | 2 | 389 |
| Standalone ordinary frontend | 535 | 146 | 2 | 387 |
| `test:all` ordinary frontend | 529 | 145 | 2 | 382 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 159 to 155: 28 N and 127 S.

## Phase 2 Model-Provider-Catalogs Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 141 files / 862 tests | 4.54s | 3.74s | 679% | 897,628 |
| `frontend-node` | After | 145 files / 887 tests | 4.72s | 4.01s | 607% | 919,508 |
| `frontend-dom` | Before | 386 files / 5,543 tests | 70.45s | 69.53s | 637% | 4,933,796 |
| `frontend-dom` | After | 382 files / 5,518 tests | 67.69s | 66.80s | 644% | 4,974,240 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 70.52s | 69.54s | 635% | 4,768,944 |
| Ordinary frontend | After | 529 files / 6,413 tests | 73.19s | 72.11s | 628% | 4,784,356 |

The paired ordinary wall observation increased by 2.67s (3.8%) while peak RSS
increased by 15,412 KiB (0.3%). Both remain within observed lane variability,
so this is not a phase-level performance claim. The owning DOM project improved
by 2.76s; the Node project varied upward by 0.18s after absorbing the four
files.

## Phase 2 Model-Provider-Catalogs Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 146 files / 892 tests and
387 files / 5,716 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed in the
promotion, so the preceding test-runtime-tooling `test:all` checkpoint remains
the current periodic Phase 2 aggregate proof.

## Phase 2 Display-Source Batching Stabilization

The pre-change aggregate-ordinary DOM baseline for the next model/provider
promotion slice reproduced the retained display-source observation. The run
passed 385 files and 5,542 tests but failed
`src/ts/server/displaySources.test.ts` at the same-chat batching assertion:
`requests` contained two one-target operations instead of one two-target
operation. The failed lane reported 65.60s wall, 64.76s Vitest duration, and
4,793,048 KiB peak RSS.

The dedicated stabilization decision treats this as a production scheduling
race rather than weakening the batching assertion. Each display request
previously awaited its source and context hashes before joining the pending
batch; under full-suite load, the first zero-delay timer could flush while its
sibling was still hashing. `displaySources.ts` now registers preparation under
the stable batch key before either hash settles, computes both hashes in
parallel, and schedules the flush only after all registered preparations for
that key complete. Namespace resets fence stale preparations, and the existing
dedupe, priority, revision, response-validation, and fallback contracts remain
unchanged.

Three consecutive focused runs passed all 8 `displaySources.test.ts` tests in
3.38-3.59s. The complete aggregate-ordinary DOM project then passed 386 files /
5,543 tests in 70.45s wall and 69.53s Vitest duration with 4,933,796 KiB peak
RSS. `pnpm check` passed with zero errors or warnings. The stabilization is an
independent prerequisite fix. The affected-test plan passed 339 frontend files
/ 5,164 tests and found no directly affected server test; `pnpm format:check`
and `git diff --check` passed. The model/provider ownership and paired timing
baseline begin only after this stabilization lands.

## Phase 2 Client-Runtime-Utilities Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `bbf330642920d03370c85e44ac9595602ea6c68c`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the two-file Node ownership change,
  regenerated inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Client-Runtime-Utilities Probe And Ownership

The fifth bounded Phase 2 slice promotes:

- `src/ts/polyfill.test.ts`
- `src/ts/sourcemap.test.ts`

The polyfill suite supplies the runtime target, optional feature loaders,
support matrix, platform choice, and a minimal document-shaped collaborator
explicitly. The source-map suite replaces the consumer and stubs every fetch;
its remaining runtime dependencies are Node-provided `URL`, `AbortController`,
and timers. Neither suite imports Svelte, mounts a component, performs a real
network request, reads browser storage, or relies on Happy-DOM setup. No mock,
assertion, production dependency, or test body changed for promotion.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/polyfill.test.ts \
  src/ts/sourcemap.test.ts
```

Result: 2 files / 7 tests passed in 1.05s wall and 311ms Vitest duration,
with 341,440 KiB peak RSS and 236ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 2 files / 7 tests
passed in 0.84s wall and 171ms Vitest duration, with 273,900 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Client-Runtime-Utilities Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the two target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 142 | 2 | 393 |
| Standalone ordinary frontend | 535 | 142 | 2 | 391 |
| `test:all` ordinary frontend | 529 | 141 | 2 | 386 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 161 to 159: 32 N and 127 S.

## Phase 2 Client-Runtime-Utilities Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 139 files / 855 tests | 4.08s | 3.36s | 676% | 990,892 |
| `frontend-node` | After | 141 files / 862 tests | 4.60s | 3.83s | 593% | 955,244 |
| `frontend-dom` | Before | 388 files / 5,550 tests | 70.25s | 69.36s | 639% | 4,831,920 |
| `frontend-dom` | After | 386 files / 5,543 tests | 68.06s | 67.15s | 639% | 4,906,616 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 70.45s | 69.39s | 634% | 5,025,708 |
| Ordinary frontend | After | 529 files / 6,413 tests | 72.14s | 71.13s | 630% | 5,018,288 |

The paired ordinary wall observation increased by 1.69s (2.4%) while peak RSS
decreased by 7,420 KiB (0.1%). The wall movement remains inside the Phase 0
69.71-72.34s warm range and observed ordinary-lane variability, so it does not
represent a material regression or a phase-level performance claim. The owning
DOM project improved by 2.19s; the Node project varied upward by 0.52s after
absorbing the two files.

## Phase 2 Client-Runtime-Utilities Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 142 files / 867 tests and
391 files / 5,741 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed, so the
preceding test-runtime-tooling `test:all` checkpoint remains the current
periodic Phase 2 aggregate proof.

## Phase 2 Client-Policy-Validation Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `3042cfc765714940186eb24893b2f16df946e7b9`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the five-file Node ownership change,
  regenerated inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Client-Policy-Validation Probe And Ownership

The fourth bounded Phase 2 slice promotes:

- `src/ts/model/scriptModelOverrides.test.ts`
- `src/ts/moduleEditorLeaveGuard.test.ts`
- `src/ts/observerRouteIntent.test.ts`
- `src/ts/presetFieldMirror.test.ts`
- `src/ts/process/request/tests/additionalParams.test.ts`

The first three suites import only Vitest and dependency-free or plain
TypeScript subjects. The preset-mirror and additional-parameter suites retain
their existing explicit mocks for the Svelte-named database boundary; their
remaining runtime graphs are plain TypeScript normalization and data shaping.
No DOM/browser global, Svelte transform, DOM setup, network, storage,
filesystem, timer, replacement mock, or assertion change was added.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/moduleEditorLeaveGuard.test.ts \
  src/ts/observerRouteIntent.test.ts \
  src/ts/model/scriptModelOverrides.test.ts \
  src/ts/presetFieldMirror.test.ts \
  src/ts/process/request/tests/additionalParams.test.ts
```

Result: 5 files / 22 tests passed in 1.32s wall and 492ms Vitest duration,
with 504,612 KiB peak RSS and 914ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 5 files / 22 tests
passed in 0.95s wall and 222ms Vitest duration, with 365,844 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Client-Policy-Validation Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the five target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 140 | 2 | 395 |
| Standalone ordinary frontend | 535 | 140 | 2 | 393 |
| `test:all` ordinary frontend | 529 | 139 | 2 | 388 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 166 to 161: 34 N and 127 S.

## Phase 2 Client-Policy-Validation Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 134 files / 833 tests | 4.35s | 3.63s | 633% | 987,448 |
| `frontend-node` | After | 139 files / 855 tests | 4.09s | 3.27s | 657% | 982,296 |
| `frontend-dom` | Before | 393 files / 5,572 tests | 66.61s | 65.73s | 635% | 4,788,528 |
| `frontend-dom` | After | 388 files / 5,550 tests | 65.36s | 64.47s | 635% | 5,080,288 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 76.01s | 74.73s | 639% | 5,009,076 |
| Ordinary frontend | After | 529 files / 6,413 tests | 74.79s | 73.61s | 646% | 4,842,704 |

The paired ordinary wall observation improved by 1.22s (1.6%) and peak RSS by
166,372 KiB (3.3%). The owning DOM project improved by 1.25s while its peak RSS
rose by 291,760 KiB (6.1%), within the phase's 10% RSS guard and observed lane
variability. The Node project improved by 0.26s after absorbing the five files.

## Phase 2 Client-Policy-Validation Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 140 files / 860 tests and
393 files / 5,748 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed, so the
preceding test-runtime-tooling `test:all` checkpoint remains the current
periodic Phase 2 aggregate proof.

## Phase 2 Accessibility-Source-Contracts Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `055d10067672a0fe9bf31c39403f534622339cef`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the three-file Node ownership change,
  regenerated inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Accessibility-Source-Contracts Probe And Ownership

The third bounded Phase 2 slice promotes:

- `src/lib/Others/AccessibleIconActions.test.ts`
- `src/lib/Setting/Pages/BotSettings.accessibility.test.ts`
- `src/lib/Setting/Pages/OtherBotSettings.slider-accessibility.test.ts`

All three suites import only Vitest and Node filesystem/path APIs. They read
Svelte component sources as UTF-8 and assert source-level accessibility and
durable-UI policy, but they do not import, compile, mount, or execute those
components. No DOM/browser global, Svelte transform, DOM setup, network,
storage, replacement mock, or assertion change was added.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/lib/Others/AccessibleIconActions.test.ts \
  src/lib/Setting/Pages/BotSettings.accessibility.test.ts \
  src/lib/Setting/Pages/OtherBotSettings.slider-accessibility.test.ts
```

Result: 3 files / 25 tests passed in 1.13s wall and 351ms Vitest duration,
with 397,384 KiB peak RSS and 473ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 25 tests
passed in 0.93s wall and 188ms Vitest duration, with 298,708 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Accessibility-Source-Contracts Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 135 | 2 | 400 |
| Standalone ordinary frontend | 535 | 135 | 2 | 398 |
| `test:all` ordinary frontend | 529 | 134 | 2 | 393 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 169 to 166: 39 N and 127 S.

## Phase 2 Accessibility-Source-Contracts Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 131 files / 808 tests | 4.56s | 3.84s | 614% | 960,344 |
| `frontend-node` | After | 134 files / 833 tests | 4.53s | 3.60s | 657% | 966,608 |
| `frontend-dom` | Before | 396 files / 5,597 tests | 67.74s | 66.87s | 631% | 5,031,412 |
| `frontend-dom` | After | 393 files / 5,572 tests | 66.68s | 65.77s | 638% | 4,727,132 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 72.99s | 72.15s | 644% | 4,784,700 |
| Ordinary frontend | After | 529 files / 6,413 tests | 72.03s | 71.19s | 641% | 4,919,184 |

The paired ordinary wall observation improved by 0.96s (1.3%) while peak RSS
increased by 134,484 KiB (2.8%). The RSS movement is within observed ordinary
lane variability and does not represent a material regression. The owning DOM
project improved by 1.06s while Node remained effectively flat after absorbing
the three files.

## Phase 2 Accessibility-Source-Contracts Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests. Complete standalone
`frontend-node` and `frontend-dom` project runs passed 135 files / 838 tests and
398 files / 5,770 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, rendered UI contract, or browser-smoke file changed, so the
preceding test-runtime-tooling `test:all` checkpoint remains the current
periodic Phase 2 aggregate proof.

## Phase 2 Test-Runtime-Tooling Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `bb5a94e98abf24d07ca74cf873cae51710429850`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the base commit plus the three-file Node ownership change,
  regenerated inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` and JSON/console artifacts remained under `/tmp` and were not
committed. Coverage output remained under ignored `coverage/`.

## Phase 2 Test-Runtime-Tooling Probe And Ownership

The second bounded Phase 2 slice promotes:

- `util/test-all.test.ts`
- `vitest.fetchGuard.test.ts`
- `vitest.setup.test.ts`

The aggregate-runner suite imports Node filesystem APIs and the Node-owned
`test-all` orchestrator. The fetch-guard suite imports a plain TypeScript module
and explicitly supplies every fetch implementation; Node 24 supplies the URL,
`Request`, and `Response` standards it exercises. The shared-setup suite imports
only Vitest and exercises `safeStructuredClone`, which `vitest.setup.ts` already
installs for N, S, and D. No Svelte transform, DOM/browser global, DOM setup,
network access, or replacement mock was added.

The DOM project still loads `vitest.dom.setup.ts`, which installs the unexpected
loopback-port fetch guard. Moving the guard's unit contract does not move or
weaken that D-only setup responsibility.

Pre-promotion Happy-DOM command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  util/test-all.test.ts \
  vitest.fetchGuard.test.ts \
  vitest.setup.test.ts
```

Result: 3 files / 18 tests passed in 1.05s wall and 305ms Vitest duration,
with 395,412 KiB peak RSS and 398ms aggregate environment time.

After adding the files to `vitest.node-tests.ts`, the target-project probe used
the same file list with `--project frontend-node`. Result: 3 files / 18 tests
passed in 1.00s wall and 216ms Vitest duration, with 301,108 KiB peak RSS and no
aggregate environment time. The later complete Node and frontend runs repeated
the same tests successfully.

## Phase 2 Test-Runtime-Tooling Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the three target-N probe markers,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 132 | 2 | 403 |
| Standalone ordinary frontend | 535 | 132 | 2 | 401 |
| `test:all` ordinary frontend | 529 | 131 | 2 | 396 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime probes fell from 172 to 169: 42 N and 127 S.

## Phase 2 Test-Runtime-Tooling Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 128 files / 790 tests | 4.02s | 3.31s | 679% | 937,812 |
| `frontend-node` | After | 131 files / 808 tests | 4.03s | 3.33s | 678% | 906,256 |
| `frontend-dom` | Before | 399 files / 5,615 tests | 71.95s | 71.06s | 643% | 5,072,248 |
| `frontend-dom` | After | 396 files / 5,597 tests | 69.52s | 68.67s | 638% | 4,941,504 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 68.90s | 68.05s | 640% | 4,734,372 |
| Ordinary frontend | After | 529 files / 6,413 tests | 69.19s | 68.36s | 641% | 4,938,776 |

The paired ordinary wall observation increased by 0.29s (0.4%) and peak RSS by
204,404 KiB (4.3%). Both are within observed ordinary-lane variability and do
not represent a material regression. The owning DOM project improved by 2.43s
while Node remained effectively flat after absorbing the three files.

## Phase 2 Test-Runtime-Tooling Command Validation

`pnpm test:frontend` passed 535 files / 6,616 tests in 71.55s Vitest duration.
Full standalone `frontend-node` and `frontend-dom` project runs passed 132 files
/ 813 tests and 401 files / 5,795 tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

The periodic Phase 2 `pnpm test:all` checkpoint passed all eight lanes in
3m25.6s runner time (3m26.04s wall, 4,756,760 KiB peak RSS): 529 frontend files
/ 6,413 tests, 154 server files / 3,295 passed / 1 skipped, 34 browser-smoke
tests, 6 UI-coverage files / 203 tests, 2 performance files / 6 tests, both
typecheck lanes, and formatting.

`pnpm format:check` and `git diff --check` passed. No production, setup,
coverage-map, CI, UI contract, or browser-smoke file changed.

## Phase 2 Protocol-Validation Environment And Source State

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
