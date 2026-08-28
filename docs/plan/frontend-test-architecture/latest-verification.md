# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Phase 5 is in progress after its fresh Happy-DOM profile and ownership
accounting selected three repeated-import families plus one explicit
static-source-policy follow-up. This record does not authorize repository-wide
default inversion or migration outside the later phase rules.

## Phase 5 Baseline Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `32042205a`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: clean Phase 4 closeout source with no uncommitted changes.

Inventory checking passed before measurement. Full discovery is 539 files at
192 N / 17 S / 330 D, standalone ordinary is 537 at 192 N / 17 S / 328 D, and
aggregate ordinary is 531 at 191 N / 17 S / 323 D.

All 330 full-discovery D owners are accounted for: 234 carry direct mounted or
DOM/browser evidence, 91 have exact eager-`window` Phase 3 probe failures, two
exercise real `DOMParser`, and three retain real DOMPurify, directory-picker,
or `HTMLInputElement` contracts after exact Phase 2 probes.

## Phase 5 Current Happy-DOM Profile

The ordinary D project excluding the six separately owned UI-map suites and two
explicit performance gates passed 323 files / 4,976 tests in 61.46s Vitest and
62.30s wall. CPU was 627% and peak RSS was 4,707,148 KiB. Worker-phase sums were
94.23s transform, 17.06s setup, 387.39s import, 75.30s tests, and 41.79s
environment.

The focused selected families passed as follows:

| Family | Files / tests | Vitest | Import | Environment | Wall | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Toggles audit gates | 2 / 3 | 12.14s | 23.28s | 349ms | 13.17s | 1,452,164 |
| AlertComp contracts | 3 / 15 | 10.15s | 29.18s | 365ms | 11.10s | 1,812,376 |
| Ooba/provider controls | 2 / 4 | 7.32s | 13.95s | 237ms | 8.03s | 1,142,032 |

These families share the same production component, mocked graph, fixture, and
lifecycle while retaining adjacent visible-behavior ownership. The current
profile rejects merging the differing DefaultChatScreen, HypaV3, Chat parser,
Bookmark/resource-guard, and broad settings/lifecycle owners. Seven D suites
with embedded source-policy assertions are owned by one later explicit static
Node architecture-gate slice; fixture reads and VM execution are not
source-string assertions.

## Phase 4 Closeout Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `a5b80e0ea`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the four committed Phase 4 implementation/proof batches
  with no uncommitted source changes. Vitest's `--clearCache` command prepared
  the cold run.

## Phase 4 Formal Performance Result

The cache-cleared cold run passed 531 files / 6,423 tests in 69.10s wall and
68.00s Vitest duration, with 4,512,992 KiB peak RSS.

Three consecutive unchanged warm runs passed the same 531 files / 6,423 tests:

| Run | Wall | Vitest | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 68.49s | 67.57s | 644% | 4,893,640 |
| 2 | 70.32s | 69.28s | 628% | 4,759,324 |
| 3 | 70.10s | 69.22s | 650% | 4,905,256 |
| Median | 70.10s | 69.22s | 644% | 4,893,640 |

The warm range is 68.49-70.32s. Wall median is +2.4% from Phase 3, inside the
5% ordinary-run noise band, and 3.0% below Phase 0. Peak-RSS median improves
2.5% from Phase 3 and remains 2.3% above Phase 0, inside the 10% guard. The
57.84s primary and 50.61s stretch targets remain open.

The selected focused candidate observations sum to 12.93s before Phase 4 and
9.35s after it, a 27.7% reduction while expanding pure boundary coverage. Chat
import and Saved Toggles produce the focused gain; the router's retained D
owner is unchanged within noise and is justified by planner correctness and
maintainability. Parallel whole-lane scheduling masks the focused reduction at
the formal median.

## Phase 4 Closeout Validation And Stopping Decision

Independent projects passed 192 Node files / 1,285 tests in 4.84s Vitest, 17
Svelte+Node files / 167 tests in 1.86s, and 328 standalone Happy-DOM files /
5,174 tests in 62.71s. Full discovery is 539 files at 192 N / 17 S / 330 D;
standalone ordinary is 537 at 192 N / 17 S / 328 D; aggregate ordinary is 531
at 191 N / 17 S / 323 D.

`pnpm test:affected --dry-run` selected frontend, isolated performance, and
server lanes. `pnpm test:all --dry-run` showed the expected eight-lane graph,
and `pnpm test:all` passed every lane in 3m18.8s. The aggregate included 531
frontend files / 6,423 tests, 154 server files / 3,295 passing tests with 1
skip, 34 browser-smoke cases, 6 UI coverage files / 203 tests, and 2 performance
files / 6 tests. Client, server, and browser-smoke type checks, UI coverage
thresholds, formatting, inventory completeness, and `git diff --check` passed.

Every approved Phase 4 candidate now has an implementation, retained
integration proof, or reason and revisit condition. Further extraction stops
because the remaining settings, fixture, bootstrap, and plugin costs cross
browser/persistence/lifecycle boundaries without another demonstrated
production pure seam. Phase 5 owns the next profile of repeated Happy-DOM setup
and visible-behavior consolidation.

## Phase 4 Router Route Planning

The pre-change 37-test Happy-DOM router owner passed in 1.86s Vitest duration
and 2.58s measured wall. Its phases were 552ms transform, 74ms setup, 147ms
import, 1.46s tests, and 110ms environment; peak RSS was 800,824 KiB.

The new eight-test Node owner passed in 149ms Vitest duration and 0.80s wall,
with 9ms import, 6ms tests, no environment time, and 235,012 KiB peak RSS. The
retained 32-test Happy-DOM owner passed in 1.86s and 2.53s wall, with 142ms
import, 1.47s tests, 110ms environment, and 775,232 KiB peak RSS. The D movement
is inside focused noise; this slice is retained for the expanded
environment-independent planner oracle and cleaner capability ownership, not
counted as a performance improvement.

Complete current-source observations passed 192 Node files / 1,285 tests in
4.84s Vitest and 5.57s wall, 328 standalone Happy-DOM files / 5,174 tests in
62.71s and 63.60s wall, and 531 ordinary frontend files / 6,423 tests in 69.72s
and 70.63s wall. Peak RSS was 1,033,712, 4,946,704, and 4,909,096 KiB,
respectively.

Inventory regeneration and check passed. Full discovery is 539 files at 192 N
/ 17 S / 330 D, standalone ordinary is 537 files at 192 N / 17 S / 328 D, and
aggregate ordinary is 531 files at 191 N / 17 S / 323 D. Five D mapping cases
became an eight-test Node matrix, for a net ordinary change of +1 file and +3
tests. The complete Phase 4 validation and formal benchmark remain owned by
closeout.

## Phase 4 Server-Backed Fixture-Planning Triage

The current-source local fixture owner passed 1 file / 39 tests in 4.24s Vitest
duration and 4.94s measured wall. Its phases were 2.33s transform, 76ms setup,
2.47s import, 1.52s tests, and 107ms environment; peak RSS was 1,222,448 KiB.

The current-source server-backed owner passed 1 file / 27 tests in 5.93s
Vitest duration and 6.63s wall. Its phases were 2.97s transform, 71ms setup,
3.61s import, 2.06s tests, and 110ms environment; peak RSS was 938,060 KiB.

Source tracing confirmed that the local matrix executes the real `sendChat`
and Svelte resource/provider lifecycle, while the server-backed matrix builds
authenticated Fastify applications over temporary SQLite state and exercises
browser-fetch, command, persistence, replay, streaming, rollback, and terminal
consumer behavior. The available fixture-reader and snapshot-normalization
helpers are test-only and have no production call site. Extracting them would
not move any of the 66 integration cases or reduce the measured graph, so this
candidate is deferred under the Phase 4 selection criteria. Focused runs are
the complete validation for this no-code proof batch; inventory and discovery
remain unchanged.

## Phase 4 Toggle Preset Planning Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `d7a9dacdb`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean chat-import planning commit plus the Saved
  Toggles leaf, direct production consumers, Node ownership change, expanded
  pure matrix, inventory, and slice records. No unrelated changes were present.

## Phase 4 Toggle Preset Planning Measurements

The pre-change five-test Happy-DOM owner passed in 2.86s Vitest duration and
3.59s measured wall, with 2.19s transform, 77ms setup, 2.60s import, 5ms tests,
109ms environment, and 664,596 KiB peak RSS. The expanded seven-test Node owner
passed in 169ms Vitest duration, with 38ms transform, 74ms setup, 12ms import,
6ms tests, and no environment time.

The retained 40-test sidebar owner passed before the slice in 12.66s Vitest
duration and 13.38s wall, with 10.40s import and 1.99s tests. After the slice it
passed in 12.45s Vitest duration and 13.20s wall, with 10.22s import and 1.96s
tests. These retained-owner movements are inside focused run noise.

The first complete post-extraction project observations passed 190 Node files /
1,270 tests in 4.41s Vitest and 5.11s wall, then 323 Happy-DOM files / 4,981
tests in 60.52s Vitest and 61.35s wall. The first ordinary frontend observation
passed 530 files / 6,418 tests in 70.67s Vitest and 71.54s wall, with 4,686,416
KiB peak RSS.

After two comparison/default-projection cases completed the Node matrix, the
current-source Node project passed 190 files / 1,272 tests in 4.39s Vitest and
5.11s wall. The current-source ordinary frontend passed 530 files / 6,420 tests
in 69.97s Vitest and 70.83s wall, with 4,680,480 KiB peak RSS.

The focused suite removes 2.59s of browser-shaped import/environment work. The
ordinary observations remain near the Phase 3 warm range and are not a
phase-level performance claim.

## Phase 4 Toggle Preset Planning Validation And Deferrals

The Node leaf owns similarity and deterministic tie-breaks, full comparison
classification, Pick key/kind eligibility and exact value projection,
active-key/default projection, and legacy record normalization. The mounted
sidebar owner retains visible mismatch/edited/unlinked labels, confirmations,
ineligible Pick rows, exact chosen values, active-chat persistence status, and
failed-save rollback. The active-chat helper companion passed 19 tests.

Inventory regeneration and check passed. Full discovery is 538 files at 191 N
/ 17 S / 330 D, standalone ordinary is 536 files at 191 N / 17 S / 328 D, and
aggregate ordinary is 530 files at 190 N / 17 S / 323 D. The remaining static
probe count falls from 97 to 96.

`TranslatorPresetSettings.svelte.test.ts` remains D because its measured cases
cross resource epochs, local-effect receipts, lifecycle flushes, pending writes,
and rollback; extracting record helpers would leave the same expensive import
graph. `pickerGenerationSettings.test.ts` remains D because its cases own focus,
archive/rename/reorder interaction, scoped selection, pending state, and
rollback. Revisit either only with a fresh profile and a reducer/planner that
moves multiple behavioral cases without weakening those retained contracts.

`pnpm test:affected --dry-run` selected frontend, isolated performance, and
server lanes. Execution passed 536 frontend files / 6,623 tests in 69.83s, 2
performance files / 6 tests in 11.78s, and 154 server files / 3,295 passing
tests with 1 skip in 17.81s. `pnpm check`, formatting, inventory completeness,
and `git diff --check` passed.

## Phase 4 Chat Import Request Planning Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `d00d612f54f08225d759c3f85c48d9895f2508b0`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean Phase 3 closeout plus the chat-import planner,
  Node matrix, consolidated retained D contract, routing inventory, and slice
  records. No unrelated working-tree changes were present.

## Phase 4 Chat Import Request Planning Measurements

The focused pre-change Happy-DOM owner passed 1 file / 184 tests in 8.21s
Vitest duration and 8.94s measured wall. Its phases were 2.38s transform, 74ms
setup, 2.86s import, 5.08s tests, and 117ms environment; peak RSS was 1,570,304
KiB.

After extraction and consolidation, the retained Happy-DOM owner passed 1 file
/ 183 tests in 7.01s Vitest duration and 7.70s wall. Its phases were 2.29s
transform, 78ms setup, 2.73s import, 4.03s tests, and 105ms environment; peak
RSS was 1,372,248 KiB. The new Node owner passed 1 file / 6 tests in 163ms
Vitest duration with 5ms test-body time and no environment time.

The complete aggregate-ordinary project and root observations passed:

| Scope | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| Node | 189 files / 1,265 tests | 4.38s | 5.09s | 1,045,676 |
| Happy-DOM | 324 files / 4,986 tests | 59.91s | 60.76s | 4,988,772 |
| Ordinary frontend | 530 files / 6,418 tests | 68.94s | 69.80s | 4,842,688 |

The focused D test-body observation improves by 1.05s (20.7%). The ordinary
wall result is a single observation inside the Phase 3 66.76-70.70s warm range,
not a phase-level claim. Phase 4 closeout owns the cold plus three-run warm
benchmark.

## Phase 4 Chat Import Request Planning Validation

The planner preserves exact full-create versus metadata-plus-tail decisions,
encoded paths, greedy packing, UTF-8 sizing, anchors, and accepted-prefix
lengths. The retained integration owner pins the production limit at
`16 * 1024 * 1024`, asserts exact live create/tail request bodies, and covers
terminal-prefix rollback and unchunkable no-send behavior through the real
outbox/transport path.

Inventory regeneration and check passed. Full discovery is 538 files at 190 N
/ 17 S / 331 D, standalone ordinary is 536 files at 190 N / 17 S / 329 D, and
aggregate ordinary is 530 files at 189 N / 17 S / 324 D. Aggregate ordinary
coverage changes by +1 file and +5 tests: six Node planning cases replace one
consolidated duplicate production-sized D case.

`pnpm check` passed with zero errors and warnings. Focused Node and retained D
runs, complete Node and D projects, the ordinary frontend, formatting, inventory
completeness, and `git diff --check` passed.

`pnpm test:affected --dry-run` selected frontend, isolated performance, and
server lanes. Execution passed 536 frontend files / 6,621 tests in 69.33s, 2
performance files / 6 tests in 10.34s, and 154 server files / 3,295 passing
tests with 1 skip in 18.23s.

## Phase 3 Closeout Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `9a65b6d7b7a403fed42f3a21198133ce42c30c24`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean target-S blocker-ledger commit with all permanent
  Phase 3 promotions already landed. No unrelated working-tree changes were
  present.

## Phase 3 Exit Ownership And Completeness

Phase 3 promoted 43 files / 471 tests out of Happy-DOM. Fifteen files / 159
tests moved to Svelte+Node; a smaller-runtime cross-check moved 28 static
false-positive S candidates / 312 tests to Node. The exhaustive target-S probe
retained 93 files / 1,503 tests with exact browser-global or DOM-parser
blockers.

Final discovery remains exhaustive and disjoint:

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 189 | 17 | 331 |
| Standalone ordinary frontend | 535 | 189 | 17 | 329 |
| `test:all` ordinary frontend | 529 | 188 | 17 | 324 |

The aggregate ordinary test count remains 6,413. The 97 remaining generated
mismatches are 4 N and 93 S, all with target-project evidence and recorded
owners. No Phase 3 candidate remains unprobed.

## Phase 3 Formal Ordinary Frontend Benchmark

The cold transform-cache run was preceded by `pnpm exec vitest --clearCache`;
it is not an OS page-cache claim. It passed 529 files / 6,413 tests in 72.59s
wall and 71.73s Vitest duration, with 435.88s user, 37.41s system, 651% CPU, and
4,425,224 KiB peak RSS.

Three consecutive warm runs passed the same 529 files / 6,413 tests:

| Run | Wall | Vitest | User | System | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 68.47s | 67.41s | 399.30s | 30.67s | 627% | 4,626,468 |
| 2 | 70.70s | 69.77s | 420.77s | 32.06s | 640% | 5,068,472 |
| 3 | 66.76s | 65.83s | 397.75s | 29.37s | 639% | 5,019,644 |
| Median | 68.47s | 67.41s | 399.30s | 30.67s | 639% | 5,019,644 |

The warm wall range is 66.76-70.70s. Against Phase 0, wall median improves by
3.83s (5.3%) and peak-RSS median increases by 234,356 KiB (4.9%), inside the
10% guard. Against Phase 2, wall median improves by 1.03s (1.5%). The 57.84s
primary and 50.61s stretch targets are not met.

Median aggregate Vitest phases are 103.67s transform, 29.09s setup, 405.31s
import, 81.39s test bodies, and 42.33s environment. These values accumulate
across parallel workers and do not add to wall time.

## Phase 3 Independent Projects, Root, And Coverage

All independent aggregate ordinary projects passed:

| Project | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| `frontend-node` | 188 files / 1,259 tests | 4.74s | 5.51s | 1,052,504 |
| `frontend-svelte-node` | 17 files / 167 tests | 1.71s | 2.36s | 1,156,464 |
| `frontend-dom` | 324 files / 4,987 tests | 60.97s | 61.86s | 4,811,348 |

Svelte+Node reported 341ms aggregate environment time. It remains a durable
useful layer for real rune-dependent contracts without DOM setup.

The standalone root frontend passed 535 files / 6,616 tests in 72.26s wall and
71.39s Vitest duration, with 4,730,268 KiB peak RSS. The focused UI coverage
gate passed 6 files / 203 tests in 19.76s wall and 18.89s Vitest duration, with
14.55% lines, 14.96% statements, 18.2% functions, and 9.52% branches. This is a
1.8% wall improvement from the 20.13s Phase 0 coverage baseline.

## Phase 3 Re-Profile And Phase 4 Decision

The primary target is not met, so Phase 4 proceeds using current warm-run
evidence. Three-run median per-file elapsed time ranks the approved families:

1. `chatCommands.test.ts`: 5.00s; start with cohesive chat import/chunk planning.
2. Settings projection/reconciliation: `TranslatorPresetSettings.svelte.test.ts`
   at 2.73s, `chatGenerationSettingsControls.test.ts` at 2.21s, and
   `pickerGenerationSettings.test.ts` at 1.73s.
3. Server-backed fixture planning: `sendChat.fixtures.serverBacked.test.ts` at
   2.70s and `sendChat.fixtures.test.ts` at 1.72s.
4. `router.test.ts`: 1.44s; isolate route-to-state planning while retaining
   history/location contracts.

`bootstrap.test.ts` (2.41s) and `plugins.test.ts` (2.36s) remain deferred because
their current high-cost proofs are broad lifecycle/browser contracts without an
approved pure seam. Revisit after the ranked slices or fresher profile evidence.

## Phase 3 Affected And Aggregate Validation

The affected dry-run against the Phase 2 closeout base
`88d4b43986d54c88b68b7dc206e01ae0c946cd16` selected the complete frontend,
frontend performance gates, and server lanes. Execution passed 535 frontend
files / 6,616 tests in 71.31s Vitest duration, 2 performance files / 6 tests in
10.10s, and 154 server files / 3,295 passing tests with 1 skip in 16.73s.

`pnpm test:all --dry-run` showed the expected eight-lane graph. The complete
aggregate passed in 3m24.6s internal duration and 204.98s measured wall:

- server and browser-smoke typecheck: 15.6s;
- frontend tests: 529 files / 6,413 tests in 1m19.7s;
- server tests: 154 files / 3,295 passing with 1 skip in 17.1s;
- browser smoke: 34 tests in 1m13.7s;
- frontend Svelte check: zero errors and warnings in 30.1s;
- UI coverage: 6 files / 203 tests in 20.0s;
- format check: 32.0s;
- frontend performance gates: 2 files / 6 tests in 14.0s.

The measured aggregate wall improves by 3.55s (1.7%) from the 208.53s Phase 0
baseline. `pnpm check:frontend-test-inventory`, `pnpm format:check`, and
`git diff --check` also passed. All Phase 3 exit criteria are satisfied.

## Phase 3 Target-S Blocker Ledger Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Target-S probe base: `f362a56156d29ceabfadf1e0f5c9301bb5e22cff`
- Retained-owner validation base: `091bf0c91ab85c01af0213fe9a53e51080213df1`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement trees: temporary allowlist changes only for the exhaustive probe;
  all temporary entries were removed. The retained-owner validation ran with
  permanent successful promotions already landed and no production/test-body
  changes.

## Phase 3 Target-S Blocker Proof And Retained-Owner Validation

The exhaustive target-S probe produced 93 exact blockers. Ninety-one files
failed because their unchanged collection or execution graph reads `window`;
the recurring anchors are `stores.svelte.ts:23` and
`plugins/pluginSafeClass.ts:33`. Two files collected but exercised real
`DOMParser`: `process/files/multisend.test.ts` through `multisend.ts:221`, and
`translator/translator.html.test.ts` through `translator.ts:888`.

The exact retained ordinary Happy-DOM scope passed 92 files / 1,502 tests in
22.26s wall with 2,920,532 KiB peak RSS. The performance-gated
`sendCloneCountProbe.test.ts` is intentionally excluded from ordinary discovery;
with `RISU_TEST_INCLUDE_GATES=true`, it passed 1 file / 1 test in 3.73s wall and
3.01s Vitest duration, with 723,292 KiB peak RSS and 116ms environment time.
Together the retained owners pass all 93 files / 1,503 tests.

Every retained candidate is listed in the blocker ledger with an owner, exact
reason, and revisit condition. The 91 eager-browser graphs belong to the Phase
4 stopping-gate triage and may be extracted only when current profiler evidence
justifies the seam; otherwise Phase 5 records durable D ownership. The two real
parser contracts belong to Phase 5. No project-wide browser fake or weaker mock
was introduced. Formatting, inventory completeness, and `git diff --check`
passed.

## Phase 3 Generation Effect State Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `091bf0c91ab85c01af0213fe9a53e51080213df1`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean server-resource-projection commit plus the
  two-file Svelte+Node ownership change and regenerated inventory. No
  production or test-body file changed.

## Phase 3 Generation Effect State Measurements And Validation

The current-owner Happy-DOM scope passed 2 files / 10 tests in 1.52s wall and
862ms Vitest duration, with 506,072 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 840ms, 158ms, 1.11s, 16ms, and 251ms.

The exact Svelte+Node scope passed 2 files / 10 tests in 1.40s wall and 787ms
Vitest duration, with 499,836 KiB peak RSS. Aggregate transform, setup, import,
test, and environment times were 942ms, 127ms, 1.23s, 32ms, and 35ms. The exact
scope passed again in 750ms Vitest duration. Phase 2's exact Node failures at
the persistence-activity and core-store `$state` boundaries remain the
smallest-runtime evidence.

Inventory update and check commands passed. Full discovery is 537 files at 189
N / 17 S / 331 D, standalone ordinary is 535 files at 189 N / 17 S / 329 D,
and aggregate ordinary is 529 files at 188 N / 17 S / 324 D. The generated
target distribution is 193 N / 110 S / 234 D / 7 B, with 97 still-unpromoted
static candidates. Formatting and `git diff --check` passed. Complete project
and root validation remain Phase 3 exit work.

## Phase 3 Server Resource Projections Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `67ab909d8ff4c0a655897a2b7915f23788f12621`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean process-state-helper commit plus the ten-file
  split Node/Svelte+Node ownership change and regenerated inventory. No
  production or test-body file changed.

## Phase 3 Server Resource Projections Measurements And Validation

The combined current-owner Happy-DOM scope passed 10 files / 116 tests in 2.35s
wall and 1.64s Vitest duration, with 985,920 KiB peak RSS. Aggregate transform,
setup, import, test, and environment times were 5.42s, 1.22s, 6.69s, 542ms, and
2.33s.

The exact Node promotion scope passed 6 files / 70 tests in 1.02s wall and
372ms Vitest duration, with 442,440 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 483ms, 456ms, 465ms, 291ms, and 0ms.
The exact Svelte+Node scope passed 4 files / 46 tests in 1.78s wall and 1.15s
Vitest duration, with 684,352 KiB peak RSS. Aggregate transform, setup, import,
test, and environment times were 2.45s, 280ms, 3.21s, 228ms, and 55ms. Both
scopes passed again in 373ms and 1.13s Vitest duration.

Inventory update and check commands passed. Full discovery is 537 files at 189
N / 15 S / 333 D, standalone ordinary is 535 files at 189 N / 15 S / 331 D,
and aggregate ordinary is 529 files at 188 N / 15 S / 326 D. The generated
target distribution is 195 N / 108 S / 234 D / 7 B, with 99 still-unpromoted
static candidates. Formatting and `git diff --check` passed. Complete project
and root validation remain Phase 3 exit work.

## Phase 3 Process State Helpers Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `337214c026f2d60ddd2f6e689fcb53b09d5e4360`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean client-state-and-command commit plus the
  eleven-file Node ownership change and regenerated inventory. No production or
  test-body file changed.

## Phase 3 Process State Helpers Measurements And Validation

The current-owner Happy-DOM scope passed 11 files / 119 tests in 1.88s wall and
1.18s Vitest duration, with 1,015,376 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 4.07s, 971ms, 4.96s, 650ms, and 1.77s.

The exact Node promotion scope passed 11 files / 119 tests in 1.42s wall and
746ms Vitest duration, with 660,292 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 1.57s, 987ms, 1.76s, 589ms, and 1ms.
The exact scope passed again in 718ms Vitest duration.

Inventory update and check commands passed. Full discovery is 537 files at 183
N / 11 S / 343 D, standalone ordinary is 535 files at 183 N / 11 S / 341 D,
and aggregate ordinary is 529 files at 182 N / 11 S / 336 D. The generated
target distribution is 189 N / 114 S / 234 D / 7 B, with 109 still-unpromoted
static candidates. Formatting and `git diff --check` passed. Complete project
and root validation remain Phase 3 exit work.

## Phase 3 Client State And Command Helpers Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `f362a56156d29ceabfadf1e0f5c9301bb5e22cff`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean first Phase 3 slice plus temporary exhaustive
  target-S and smaller-runtime Node probe entries. Temporary failures were
  pruned before the permanent thirteen-file ownership change.

## Phase 3 Exhaustive Target-S And Smaller-Runtime Probes

All 127 remaining static target-S candidates were added temporarily to
`frontend-svelte-node`. The 136-file project, including nine existing owners,
reported 43 passing files and 93 failing files. The 34 passing candidates were
then assigned temporarily to `frontend-node`: 28 passed unchanged and six
failed before collection with `$state is not defined`.

The failed Node scope consisted of `pluginCommands.durable.test.ts`,
`pluginCommands.test.ts`, `persistenceActivity.svelte.test.ts`,
`resourceReads.test.ts`, `shellHydration.test.ts`, and
`translator.cache.test.ts`. Their exact rune boundaries are
`persistenceActivity.svelte.ts:3`, `resourceState.svelte.ts:658`, or
`coreStores.svelte.ts:5`. Svelte+Node is the smallest valid runtime for those
six unchanged suites. The other 28 do not require client transformation despite
their static type-only, mock, compiler-library, or runtime-package Svelte signal.

The broad S probe took 9.73s wall and 8.80s Vitest duration, with 1,287,804 KiB
peak RSS. Its aggregate transform, setup, import, test, and environment times
were 18.73s, 8.65s, 9.54s, 2.63s, and 1.72s. These partial-collection figures
are capability evidence only. The 34-file Node cross-check took 2.38s wall and
891,904 KiB peak RSS; 28 files passed and the six rune owners failed before
collection as expected.

## Phase 3 Client State And Command Helpers Measurements And Validation

The current-owner Happy-DOM scope passed 13 files / 157 tests in 3.08s wall and
2.36s Vitest duration, with 970,260 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 3.94s, 1.50s, 4.94s, 790ms, and 2.34s.

The exact Node promotion scope passed 11 files / 123 tests in 1.44s wall and
751ms Vitest duration, with 565,356 KiB peak RSS. Aggregate transform, setup,
import, test, and environment times were 1.05s, 893ms, 1.15s, 539ms, and 1ms.
The exact Svelte+Node scope passed 2 files / 34 tests in 1.78s wall and 1.16s
Vitest duration, with 574,132 KiB peak RSS. Aggregate transform, setup, import,
test, and environment times were 1.27s, 129ms, 1.65s, 264ms, and 33ms.

Inventory update and check commands passed. Full discovery is 537 files at 172
N / 11 S / 354 D, standalone ordinary is 535 files at 172 N / 11 S / 352 D,
and aggregate ordinary is 529 files at 171 N / 11 S / 347 D. The generated
target distribution is 178 N / 125 S / 234 D / 7 B, with 120 still-unpromoted
static candidates. Exact target-project scopes passed; formatting and
`git diff --check` passed. The complete Node and Svelte+Node projects passed 183
files / 1,186 tests in 5.69s Vitest duration. Complete DOM and root validation
remain Phase 3 exit work.

## Phase 3 Probe-Backed Runtime Bridges Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `88d4b43986d54c88b68b7dc206e01ae0c946cd16`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Isolation: enabled
- Measurement tree: the clean Phase 2 closeout plus the seven-file Svelte+Node
  ownership change and regenerated inventory. No production or test-body file
  changed.

## Phase 3 Probe-Backed Runtime Bridges Capability And Measurements

The first Phase 3 slice promoted seven suites and 69 tests with exact
Svelte+Node passes already recorded during Phase 2. Plain Node is invalid for
the unchanged graphs because they initialize resource or persistence `$state`;
the tests execute no DOM behavior and supply explicit IndexedDB, network,
command, alert, asset, and storage boundaries.

The combined Happy-DOM owner passed 7 files / 69 tests in 2.52s wall and 1.60s
Vitest duration, with 939,396 KiB peak RSS. Aggregate transform, setup, import,
test, and environment times were 5.14s, 736ms, 7.19s, 270ms, and 1.35s.

The exact Svelte+Node promotion scope passed 7 files / 69 tests in 1.97s wall
and 1.32s Vitest duration, with 785,804 KiB peak RSS. Aggregate transform,
setup, import, test, and environment times were 5.53s, 538ms, 6.91s, 358ms,
and 170ms. The same scope passed again in 1.20s Vitest duration. Environment
removal saved 1.18s of aggregate setup work in the measured comparison; the
transform and import totals are recorded without claiming deterministic gains.

## Phase 3 Probe-Backed Runtime Bridges Discovery And Validation

Inventory update and check commands passed. Full discovery is 537 files at 161
N / 9 S / 367 D, standalone ordinary is 535 files at 161 N / 9 S / 365 D, and
aggregate ordinary is 529 files at 160 N / 9 S / 360 D. The generated target
distribution is 167 N / 136 S / 234 D / 7 B, with 133 target-runtime probes
remaining.

The exact target scope passed twice, and the exhaustive/disjoint checks passed
in all three frontend discovery views. Formatting and `git diff --check`
passed. Complete project, ordinary, coverage, affected, aggregate, and formal
benchmark evidence remain Phase 3 exit work rather than per-slice claims.

## Phase 2 Exit Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `2ca9e5bb4d6f5105ee864ea34e492cce96edd684`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean final Phase 2 probe commit with all permanent
  promotion slices already committed. No unrelated working-tree changes were
  present.

## Phase 2 Exit Ownership And Completeness

Phase 2 promoted 35 files and 176 tests from Happy-DOM to Node across 13
bounded implementation slices. Eighteen promotion or proof batches account for
every candidate evaluated during the phase.

Final discovery remains exhaustive and disjoint:

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 161 | 2 | 374 |
| Standalone ordinary frontend | 535 | 161 | 2 | 372 |
| `test:all` ordinary frontend | 529 | 160 | 2 | 367 |

The ordinary test count remains 6,413. Generated target distribution remains
174 N / 129 S / 234 D / 7 B. The 140 remaining generated mismatches are 13 N
and 127 S. Every N mismatch now has target-project evidence and a recorded
owner: rune-only cases move to Phase 3, the saved-toggle helper seam belongs to
Phase 4 extraction, and real DOMPurify, filesystem-picker, and device-picker
contracts remain D-owned.

## Phase 2 Three-Run Timing Gate

Three consecutive warm `RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm
test:frontend` runs passed 529 files / 6,413 tests:

| Run | Wall | Vitest | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 69.55s | 68.65s | 633% | 4,655,636 |
| 2 | 69.50s | 68.60s | 643% | 4,866,016 |
| 3 | 68.75s | 67.84s | 640% | 4,988,448 |
| Median | 69.50s | 68.60s | 640% | 4,866,016 |

Against the Phase 0 warm wall median of 72.30s, Phase 2 improves the ordinary
frontend median by 2.80s (3.9%). Peak-RSS median moves from 4,785,288 KiB to
4,866,016 KiB (+1.7%), inside the 10% guard. Phase 2 does not yet meet the
57.84s workstream-wide 20% target; Phases 3-7 retain that objective. No Phase 2
exit criterion requires the multi-phase end-state target to be met early.

## Phase 2 Final Aggregate Validation

The first `pnpm test:all` attempt passed typechecks, 529 frontend files / 6,413
tests, 154 server files / 3,295 tests with 1 skipped, 6 UI coverage files / 203
tests, formatting, and 2 performance files / 6 tests. One of 34 browser-smoke
cases failed while preparing the two-concurrent-chat fixture: its settings
request received a 409 `revision_conflict` instead of 200.

The exact Playwright case at `acceptedSendProtocol.spec.ts:547` passed in
isolation in 2.6s without a code change. The complete `pnpm test:all` rerun then
passed in 3m19.2s:

- server and browser-smoke typecheck: 17.3s;
- frontend tests: 529 files / 6,413 tests in 1m19.1s;
- server tests: 154 files / 3,295 tests with 1 skipped in 18.2s;
- browser smoke: 34 tests in 1m12.3s;
- frontend Svelte check: zero errors and warnings in 28.9s;
- UI coverage: 6 files / 203 tests in 18.4s;
- format check: 30.0s;
- frontend performance gates: 2 files / 6 tests in 11.2s.

`pnpm check:frontend-test-inventory` and `git diff --check` also passed. The
accepted browser observation is recorded in `status.md` with an owner and
revisit condition. Final aggregate evidence is green, and all Phase 2 exit
criteria are satisfied.

## Phase 2 Server Resource And Bootstrap Probe Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `459d9f18386e503898180c33cf032d0363f6d535`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean MCP-and-transformer-helpers commit. Temporary
  Node and Svelte+Node entries were removed before documentation changes.

## Phase 2 Server Resource And Bootstrap Capability Proof

The proposed four-file slice evaluated assets, backups, bootstrap, and
replacement-database ownership. Their 34 tests cover server asset operations,
backup/restore ownership, bootstrap normalization, and durable outbox
settlement with explicit external boundaries and no direct DOM behavior.

The current-owner command passed 4 files / 34 tests in 1.71s wall and 978ms
Vitest duration, with 699,808 KiB peak RSS and 515ms environment time.

After temporarily adding all four files to `vitest.node-tests.ts`, all suites
failed before collection. Assets, backups, and bootstrap reached
`persistenceActivity.svelte.ts:3`; replacement-database ownership reached
`stores/coreStores.svelte.ts:5`. Both locations initialize `$state`. The Node
probe took 1.45s wall and 651ms Vitest duration, with 543,656 KiB peak RSS and
no environment time.

After moving the temporary entries to `vitest.svelte-node-tests.ts`, the exact
classification probe passed 4 files / 34 tests in 1.49s wall and 867ms Vitest
duration, with 621,280 KiB peak RSS and 68ms environment time. This proves S is
the smallest current runtime for the unchanged suites. All temporary entries
were removed.

## Phase 2 Server Resource And Bootstrap Discovery And Validation

`pnpm check:frontend-test-inventory` passed with unchanged exhaustive and
disjoint counts: full 537 files at 161 N / 2 S / 374 D, standalone ordinary
535 files at 161 N / 2 S / 372 D, and aggregate ordinary 529 files at 160 N /
2 S / 367 D. The generated 140 mismatches now consist of 13 probe-backed N
retainers and 127 Phase 3 S candidates; no Phase 2 N candidate remains
unprobed.

The current-owner and exact Svelte+Node probes passed all 34 tests; the exact
Node probe failed for the recorded rune reasons. Formatting of changed files
and `git diff --check` passed. No permanent ownership changed, so no paired
ordinary or affected execution was required.

## Phase 2 MCP And Transformer Helpers Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `ebb8ba34909ec703c1205f2b1eef2521f2971c33`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean plugin-policy-and-updates commit plus the
  two-file Node ownership change, regenerated inventory, and documentation.

## Phase 2 MCP And Transformer Helpers Probe And Ownership

The bounded slice evaluated Google-search response shaping, transformer device
selection, and internal MCP client behavior. The three-file current owner
passed 3 files / 9 tests in 1.02s wall and 364ms Vitest duration, with 401,720
KiB peak RSS and 333ms environment time.

The broader Node probe passed the six Google-search and transformer cases plus
one internal-client case. Two real directory-handle reuse cases failed with
`window is not defined` at `filesystemclient.ts:360`, so the internal-client
suite remains D-owned without a weaker browser-capability fake.

The exact two-file promotion scope passed twice in Node. The measured probe
completed 2 files / 6 tests in 1.03s wall and 277ms Vitest duration, with
272,252 KiB peak RSS and no environment time; the repeat took 240ms Vitest
duration.

## Phase 2 MCP And Transformer Helpers Discovery And Measurements

Inventory update and check commands passed. Full discovery is 537 files at 161
N / 2 S / 374 D, standalone ordinary is 535 files at 161 N / 2 S / 372 D, and
aggregate ordinary is 529 files at 160 N / 2 S / 367 D. Mismatches fell from
142 to 140.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 158 files / 941 tests | 4.03s | 3.39s | 689% | 922,624 |
| `frontend-node` | After | 160 files / 947 tests | 4.38s | 3.70s | 696% | 1,058,464 |
| `frontend-dom` | Before | 369 files / 5,464 tests | 62.40s | 61.63s | 631% | 4,800,256 |
| `frontend-dom` | After | 367 files / 5,458 tests | 63.54s | 62.74s | 633% | 4,761,868 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 66.60s | 65.76s | 635% | 4,696,532 |
| Ordinary frontend | After | 529 files / 6,413 tests | 68.24s | 67.42s | 644% | 5,128,488 |

The paired ordinary wall observation increased by 1.64s (2.5%) and peak RSS by
431,956 KiB (9.2%). Both remain inside the slice acceptance guards; final
phase-level conclusions require the three-run closeout median.

## Phase 2 MCP And Transformer Helpers Validation

Complete Node, DOM, and ordinary frontend runs passed 160 files / 947 tests,
367 files / 5,458 tests, and 529 files / 6,413 tests. The affected plan passed
535 frontend files / 6,616 tests, 2 performance files / 6 tests, and 154 server
files / 3,295 tests with 1 skipped. `pnpm format:check` and `git diff --check`
passed.

## Phase 2 Plugin Policy And Updates Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `4b6aeb44594a18755c1bbe9c8d91ae80583707e0`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean chat-toggle probe commit plus the one-file Node
  ownership change, regenerated inventory, and Phase 2 documentation.

## Phase 2 Plugin Policy And Updates Probe And Ownership

The bounded slice evaluated `pluginIconSafety.test.ts` and
`pluginUpdates.test.ts`. The 14-test update suite covers version parsing,
compatibility filtering, deterministic planning, invalid metadata, install
routing, and failure isolation with explicit fetch/install fakes. The two icon
tests execute the real DOMPurify sanitizer as their network-safety oracle.

The current-owner two-file command passed 2 files / 16 tests in 1.22s wall and
525ms Vitest duration, with 391,916 KiB peak RSS and 238ms environment time.
The broader Node probe passed all 14 update tests and one icon test, but the
real sanitizer case failed with `DOMPurify.sanitize is not a function`.

After retaining the icon suite in D, the exact update suite passed twice in
Node. The measured probe completed 1 file / 14 tests in 1.01s wall and 404ms
Vitest duration, with 338,508 KiB peak RSS and no environment time; the repeat
took 401ms Vitest duration.

## Phase 2 Plugin Policy And Updates Discovery And Measurements

Inventory update and check commands passed. Full discovery is 537 files at 159
N / 2 S / 376 D, standalone ordinary is 535 files at 159 N / 2 S / 374 D, and
aggregate ordinary is 529 files at 158 N / 2 S / 369 D. The 174 N / 129 S /
234 D / 7 B target distribution is unchanged; mismatches fell to 142.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 157 files / 927 tests | 4.27s | 3.60s | 679% | 975,084 |
| `frontend-node` | After | 158 files / 941 tests | 4.03s | 3.39s | 689% | 922,624 |
| `frontend-dom` | Before | 370 files / 5,478 tests | 63.79s | 63.00s | 641% | 4,579,460 |
| `frontend-dom` | After | 369 files / 5,464 tests | 62.40s | 61.63s | 631% | 4,800,256 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 66.02s | 65.15s | 640% | 5,063,636 |
| Ordinary frontend | After | 529 files / 6,413 tests | 66.60s | 65.76s | 635% | 4,696,532 |

The paired ordinary wall observation moved by +0.58s (+0.9%) while peak RSS
decreased by 367,104 KiB (-7.2%). Both are inside observed variability; this is
slice evidence rather than a phase-level claim.

## Phase 2 Plugin Policy And Updates Validation

Complete Node, DOM, and ordinary frontend runs passed 158 files / 941 tests,
369 files / 5,464 tests, and 529 files / 6,413 tests. The affected dry-run
selected the complete frontend, performance-gate, and server lanes. Execution
passed 535 frontend files / 6,616 tests, 2 performance files / 6 tests, and 154
server files / 3,295 tests with 1 skipped. `pnpm format:check` and
`git diff --check` passed.

## Phase 2 Chat-Generation Toggle-Presets Probe Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `ad1acfe52fe2ce7d782f67e6a704a75ed5edbfb3`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean prompt-toggle probe commit. Temporary Node and
  Svelte+Node entries were removed before documentation changes.

## Phase 2 Chat-Generation Toggle-Presets Capability Proof

The proposed slice evaluated `src/ts/chatGenerationTogglePresets.test.ts`. Its
five tests cover saved-toggle normalization, similarity, deterministic best
matching, cloning, and fallback selection without direct DOM assertions.

The current-owner command passed 1 file / 5 tests in 3.87s wall and 3.17s
Vitest duration, with 673,244 KiB peak RSS and 104ms environment time.

After temporarily adding the suite to `vitest.node-tests.ts`, the exact Node
command failed before collection with `ReferenceError: $state is not defined`
at `src/ts/stores/coreStores.svelte.ts:5`, reached through `alert.ts` and
`storage/fastifyStorage.ts`. It took 1.19s wall and 549ms Vitest duration, with
413,952 KiB peak RSS and no environment time.

After moving the temporary entry to `vitest.svelte-node-tests.ts`, the exact
Svelte+Node command failed before collection with `ReferenceError: window is
not defined` at `src/ts/stores.svelte.ts:23`, reached through `chatCommands.ts`
and `activeChatGenerationSettings.ts`. It took 1.60s wall and 981ms Vitest
duration, with 458,124 KiB peak RSS and 16ms environment time.

D is the smallest current runtime for the unchanged subject graph. Both
temporary entries were removed; no production or test boundary changed.

## Phase 2 Chat-Generation Toggle-Presets Discovery And Validation

`pnpm check:frontend-test-inventory` passed with unchanged exhaustive and
disjoint counts: full 537 files at 158 N / 2 S / 377 D, standalone ordinary
535 files at 158 N / 2 S / 375 D, and aggregate ordinary 529 files at 157 N /
2 S / 370 D. The current owner passed all five tests; the exact N and S probes
failed for the recorded reasons. Formatting of changed files and
`git diff --check` passed. With no ownership change, no paired ordinary or
affected execution was required.

## Phase 2 Prompt-Toggle Durability Probe Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `87aec2931736a35668b3cc6d1d37f4b8fd33f4da`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean character-card probe commit. The Node and
  Svelte+Node allowlist additions existed only for their focused probes and
  were removed before documentation changes; no unrelated working-tree
  changes were present.

## Phase 2 Prompt-Toggle Durability Capability And Ownership Proof

The proposed one-file slice evaluated
`src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts`. Its two tests
exercise ordered pending-mutation staging and failed-predecessor replay. The
suite explicitly supplies IndexedDB and replaces authenticated command
dispatch; it performs no component mount, DOM operation, implicit browser
storage, or real network request.

The real pending-mutation outbox imports
`server/persistenceActivity.svelte.ts`, which initializes `$state` during
module evaluation. Replacing that production dependency solely for promotion
would weaken the durable staging/replay graph under test.

Current-owner command:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts
```

Result: 1 file / 2 tests passed in 1.44s wall and 696ms Vitest duration, with
318,004 KiB peak RSS and 102ms aggregate environment time.

The temporary Node command added `--project frontend-node` to the same file.
It failed before collection with `ReferenceError: $state is not defined` at
`src/ts/server/persistenceActivity.svelte.ts:3`. The probe took 0.85s wall and
219ms Vitest duration, with 268,192 KiB peak RSS and no environment time.

After moving the temporary entry to `vitest.svelte-node-tests.ts`, the same
command with `--project frontend-svelte-node` passed 1 file / 2 tests in 1.11s
wall and 545ms Vitest duration, with 288,136 KiB peak RSS and 16ms aggregate
environment time. This proves S is the smallest current runtime for the
unchanged suite. Both temporary entries were removed.

## Phase 2 Prompt-Toggle Durability Discovery And Validation

`pnpm check:frontend-test-inventory` passed with unchanged exhaustive and
disjoint counts: full 537 files at 158 N / 2 S / 377 D, standalone ordinary
535 files at 158 N / 2 S / 375 D, and aggregate ordinary 529 files at 157 N /
2 S / 370 D. Target distribution and mismatch counts remain unchanged.

The current-owner and exact Svelte+Node probes passed all two tests; the exact
Node probe failed for the recorded rune reason. Formatting of changed files and
`git diff --check` passed. No runtime inventory or production file changed, so
no affected execution lane, paired ordinary measurement, or `test:all`
checkpoint was required for this proof-only batch.

## Phase 2 Character-Card PNG-Import Probe Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `a97c4ee5bbdf74cd2ef216f3ccf67e5648c8bc16`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean alert-import-safety commit. The Node and
  Svelte+Node allowlist additions existed only for their focused probes and
  were removed before documentation changes; no unrelated working-tree
  changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Character-Card PNG-Import Capability And Ownership Proof

The proposed one-file Phase 2 slice evaluated:

- `src/ts/characterCards.pngImport.test.ts`

The suite contains 21 tests covering PNG embedded-asset decoding, progress and
durable creation outcomes, v2/v3 and CharX normalization, bounded salvage,
PNG/JSON/CharX export, and source immutability. It explicitly replaces its UI,
storage, command, asset, hydration, bridge, parser, and Fastify-auth boundaries.
It mounts no component and performs no DOM operation, browser-storage access,
or real network request.

The production subject imports `resourceWriteGuard.svelte.ts`, which imports
`resourceState.svelte.ts` and initializes `$state` at module evaluation. The
test does not replace that real durable-write boundary, and adding a mock only
to pass Node would weaken the production import contract.

Current-owner command:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  src/ts/characterCards.pngImport.test.ts
```

Result: 1 file / 21 tests passed in 1.80s wall and 1.02s Vitest duration,
with 409,568 KiB peak RSS and 182ms aggregate environment time.

After temporarily adding the file to `vitest.node-tests.ts`, the target command
was:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  --project frontend-node src/ts/characterCards.pngImport.test.ts
```

Result: the suite failed before collection with
`ReferenceError: $state is not defined` at
`src/ts/server/resourceState.svelte.ts:658`, reached through
`resourceWriteGuard.svelte.ts:1` and `characterCards.ts:72`. The failed probe
took 0.94s wall and 300ms Vitest duration, with 285,980 KiB peak RSS and no
aggregate environment time.

After removing the Node entry and temporarily adding the file to
`vitest.svelte-node-tests.ts`, the classification command was:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  --project frontend-svelte-node src/ts/characterCards.pngImport.test.ts
```

Result: 1 file / 21 tests passed in 1.31s wall and 708ms Vitest duration,
with 379,636 KiB peak RSS and 18ms aggregate environment time. This proves S is
the smallest current runtime capable of executing the suite without DOM setup.
The temporary S entry was then removed. The suite remains D-owned pending Phase
3; no test, mock, production dependency, setup, or permanent runtime inventory
changed.

## Phase 2 Character-Card PNG-Import Discovery And Validation

`pnpm check:frontend-test-inventory` passed after both temporary entries were
removed. The inventory remained byte-for-byte current, exhaustive, and
disjoint: full 537 files at 158 N / 2 S / 377 D, standalone ordinary 535 files
at 158 N / 2 S / 375 D, and aggregate ordinary 529 files at 157 N / 2 S /
370 D. Target distribution and generated mismatch counts remain 174 N, 129 S,
234 D, 7 B, and 143 mismatches.

The current-owner suite and the exact Svelte+Node classification probe passed
all 21 tests. The exact Node target probe failed for the recorded Svelte-rune
reason. Formatting of changed files and `git diff --check` passed. No runtime
inventory or production file changed, so no affected execution lane,
before/after ordinary measurement, or new `test:all` checkpoint was required
for this proof-only batch.

## Phase 2 Alert-Import-Safety Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `3f71f8ca1f80401edd6c03cc2ba4e113f1033835`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean hydration-reads proof commit plus the one-file
  Node ownership change, corrected import-isolation mock, regenerated
  inventory, and Phase 2 documentation in this slice; no unrelated
  working-tree changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Alert-Import-Safety Probe And Ownership

The eleventh bounded Phase 2 promotion slice promotes:

- `src/ts/alert.importSafety.test.ts`

The suite contains one test. It deliberately replaces the UI-store module with
an empty partial mock, replaces language, and retains its historical
database-module mock before dynamically importing `alert.ts`. A successful
import proves that `alert.ts` does not subscribe to, read, or write those
partial UI-store bindings until an alert helper is invoked.

The test's UI-store mock still targeted `./stores.svelte` after `alert.ts` moved
its runtime import to `./stores/coreStores.svelte`. The real core-store module
initializes `$state`; Happy-DOM transformed and executed it accidentally, so the
stale test no longer isolated the dependency named by its contract. Correcting
the mock path to the actual core-store import restores the test's original
boundary. No production code, alert helper, store behavior, assertion, or
rendered contract changed.

`alert.ts` still creates a plain Svelte writable at module evaluation, while its
passive-alert and result-dialog subscriptions remain helper-triggered. Its
database import is type-only, and the runtime `alertDatabase.ts` accessor is
plain TypeScript. After the intended dependency replacement, the suite executes
no rune, DOM API, browser storage, component mount, or network request.

Pre-promotion Happy-DOM command:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  src/ts/alert.importSafety.test.ts
```

Result: 1 file / 1 test passed in 1.35s wall and 570ms Vitest duration,
with 308,312 KiB peak RSS and 105ms aggregate environment time.

After adding the file to `vitest.node-tests.ts` but before correcting its stale
mock path, the target command was:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v pnpm exec vitest run \
  --project frontend-node src/ts/alert.importSafety.test.ts
```

Result: the test failed with `ReferenceError: $state is not defined` at
`src/ts/stores/coreStores.svelte.ts:5`, reached through `alert.ts:4`. The failed
probe took 0.85s wall and 200ms Vitest duration, with 247,772 KiB peak RSS and no
environment time. This proved the mock targeted an obsolete dependency.

After changing only the mock path from `./stores.svelte` to
`./stores/coreStores.svelte`, the same target command passed 1 file / 1 test in
0.97s wall and 203ms Vitest duration, with 248,012 KiB peak RSS and no
environment time. An immediate repeated target probe passed again in 198ms
Vitest duration. The complete Node and frontend runs repeated the test
successfully.

The full `alert.test.ts` service contract remains in Happy-DOM. Rendered alert
components and browser-smoke focus/accessibility cases retain their D and B
ownership; the promotion changes only the dependency-isolated import oracle.

## Phase 2 Alert-Import-Safety Discovery And Classification Proof

Commands:

```sh
pnpm update:frontend-test-inventory
pnpm check:frontend-test-inventory
```

Both passed. The generated inventory removed the promoted target-N probe marker,
retained the 537-file universe, and remained exhaustive and disjoint.

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 158 | 2 | 377 |
| Standalone ordinary frontend | 535 | 158 | 2 | 375 |
| `test:all` ordinary frontend | 529 | 157 | 2 | 370 |

The target distribution remains 174 N, 129 S, 234 D, and 7 B. Outstanding
target-runtime mismatches fell from 144 to 143: 16 N and 127 S. Twelve N files
remain unprobed; the other four N mismatches are the hydration-read and two
generation-effect suites with recorded Svelte-rune probe results plus the
device-backup suite with its recorded file-picker DOM contract.

## Phase 2 Alert-Import-Safety Paired Measurements

All paired commands ran on the same host with
`RISU_TEST_EXCLUDE_UI_MAP=true /usr/bin/time -v`. This is one paired slice
observation, not the three-run phase-level timing gate.

| Lane | State | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | Before | 156 files / 926 tests | 4.63s | 3.85s | 674% | 920,432 |
| `frontend-node` | After | 157 files / 927 tests | 4.88s | 4.08s | 695% | 966,364 |
| `frontend-dom` | Before | 371 files / 5,479 tests | 71.46s | 70.52s | 641% | 5,036,776 |
| `frontend-dom` | After | 370 files / 5,478 tests | 68.67s | 67.71s | 628% | 4,798,368 |
| Ordinary frontend | Before | 529 files / 6,413 tests | 69.11s | 68.21s | 638% | 4,999,492 |
| Ordinary frontend | After | 529 files / 6,413 tests | 68.57s | 67.71s | 640% | 4,751,748 |

The paired ordinary wall observation decreased by 0.54s (0.8%) while peak RSS
decreased by 247,744 KiB (5.0%). Both movements remain inside observed lane
variability, so this is not a phase-level performance claim. The owning DOM
project varied downward by 2.79s and 238,408 KiB while the Node project varied
upward by 0.25s and 45,932 KiB after absorbing the file.

The focused environment cost fell from 105ms to zero, focused wall fell by
0.38s, and focused peak RSS fell by 60,300 KiB.

## Phase 2 Alert-Import-Safety Command Validation

The current-owner focused suite passed 1 file / 1 test. The exact uncorrected
Node target probe failed for the stale-mock Svelte-rune reason, and two exact
corrected target probes passed without Happy-DOM.

Complete ordinary `frontend-node`, `frontend-dom`, and aggregate frontend runs
passed 157 files / 927 tests, 370 files / 5,478 tests, and 529 files / 6,413
tests respectively.

`pnpm test:affected --dry-run` selected the complete frontend lane, isolated
performance gates, and server lane because the explicit runtime inventory
changed. Running the selected plan passed 535 frontend files / 6,616 tests, 2
performance files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.

`pnpm format:check` and `git diff --check` passed.

No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
file changed in the promotion, so the preceding test-runtime-tooling `test:all`
checkpoint remains the current periodic Phase 2 aggregate proof.

## Phase 2 Hydration-Reads Probe Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `590f21ea9e104b7d6f9a29f43d68807419db7bf8`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled
- Measurement tree: the clean storage-backup-export-helpers commit. The Node
  and Svelte+Node allowlist additions existed only for their focused probes and
  were reverted before documentation changes; no unrelated working-tree
  changes were present.

GNU `time` console observations remained uncommitted. Coverage output remained
under ignored `coverage/`.

## Phase 2 Hydration-Reads Capability And Ownership Proof

The proposed one-file Phase 2 slice evaluated:

- `src/ts/server/hydrationReads.test.ts`

The suite contains 12 tests. It replaces the Fastify auth boundary, stubs every
executed `fetch`, and supplies `fake-indexeddb` explicitly for cache-backed
cases. Its assertions cover cache-negotiated legacy-preset, prompt-template,
chat-message, generation-suffix, bulk-chat, and character-lorebook reads,
including cache reconstruction, legacy fallback, query construction, malformed
responses, and network errors. It mounts no component and uses no DOM API,
browser storage, or real network.

Its production subject imports `canUseServerResourceReads` from
`resourceReads.ts`. That module imports runtime constants from
`resourceState.svelte.ts`, which initializes state with `$state` during module
evaluation. The test does not mock that boundary, and adding such a mock only
to pass Node would weaken the transitive contract.

Current-owner command:

```sh
/usr/bin/time -v pnpm exec vitest run \
  src/ts/server/hydrationReads.test.ts
```

Result: 1 file / 12 tests passed in 1.68s wall and 977ms Vitest duration,
with 440,468 KiB peak RSS and 115ms aggregate environment time.

After temporarily adding the file to `vitest.node-tests.ts`, the target command
was:

```sh
/usr/bin/time -v pnpm exec vitest run --project frontend-node \
  src/ts/server/hydrationReads.test.ts
```

Result: the suite failed before collection with
`ReferenceError: $state is not defined` at
`src/ts/server/resourceState.svelte.ts:658`, reached through
`resourceReads.ts:19` and `hydrationReads.ts:2`. The failed probe took 1.17s
wall and 478ms Vitest duration, with 395,420 KiB peak RSS and no aggregate
environment time.

After removing the Node entry and temporarily adding the file to
`vitest.svelte-node-tests.ts`, the classification command was:

```sh
/usr/bin/time -v pnpm exec vitest run --project frontend-svelte-node \
  src/ts/server/hydrationReads.test.ts
```

Result: 1 file / 12 tests passed in 1.69s wall and 1.01s Vitest duration,
with 441,684 KiB peak RSS and 19ms aggregate environment time. This proves S is
the smallest current runtime capable of executing the suite without DOM setup.
The temporary S entry was then removed. The suite remains D-owned pending Phase
3; no test, mock, production dependency, setup, or permanent runtime inventory
changed.

## Phase 2 Hydration-Reads Discovery And Classification Proof

Command:

```sh
pnpm check:frontend-test-inventory
```

The checked inventory remained byte-for-byte current after both temporary
allowlist entries were removed. Ownership and target-distribution counters are
unchanged:

| View | Files | Node | Svelte+Node | Happy-DOM |
| --- | ---: | ---: | ---: | ---: |
| Full, including explicit performance gates | 537 | 157 | 2 | 378 |
| Standalone ordinary frontend | 535 | 157 | 2 | 376 |
| `test:all` ordinary frontend | 529 | 156 | 2 | 371 |

The generated static inventory still reports 174 N, 129 S, 234 D, and 7 B
because it records direct-file evidence and cannot see the transitive rune
edge. Outstanding generated target-runtime mismatches remain 144: 17 N and 127
S. Thirteen N candidates remain unprobed; the other four generated N
mismatches are this hydration-read suite, the two generation-effect suites, and
the device-backup suite with recorded target-runtime probe results.

## Phase 2 Hydration-Reads Baseline Observations

No ownership change landed, so there is no before/after performance claim and
no after-migration measurement. The same-host pre-probe ordinary observations
were:

| Lane | Result | Wall | Vitest | CPU | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: | ---: |
| `frontend-node` | 156 files / 926 tests | 4.42s | 3.75s | 671% | 939,216 |
| `frontend-dom` | 371 files / 5,479 tests | 72.16s | 71.25s | 625% | 4,765,916 |
| Ordinary frontend | 529 files / 6,413 tests | 70.45s | 69.49s | 630% | 5,004,432 |

These are reproducibility observations only, not a paired slice measurement or
phase-level timing gate.

## Phase 2 Hydration-Reads Command Validation

The current-owner focused suite, ordinary Node project, ordinary DOM project,
and ordinary aggregate frontend runs passed 1 file / 12 tests, 156 files / 926
tests, 371 files / 5,479 tests, and 529 files / 6,413 tests respectively before
the temporary probes. The exact Node target probe failed for the recorded Svelte
rune reason, and the exact Svelte+Node classification probe passed all 12 tests.

`pnpm check:frontend-test-inventory`, `pnpm test:affected --dry-run`, formatting
of changed files, and `git diff --check` passed after the temporary ownership
entries were removed.

No runtime inventory, production, setup, coverage-map, CI, rendered UI, or
browser-smoke file changed, so no affected execution lane or new `test:all`
checkpoint was required for this proof-only batch.

## Phase 2 Storage-Backup-Export-Helpers Closeout

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
