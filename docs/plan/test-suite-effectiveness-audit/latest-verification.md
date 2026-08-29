# Test Suite Effectiveness Audit Verification

Date: 2026-08-29

This file records reproducible command evidence for the workstream. Phase 0
established the formal test-case, duration, coverage, support-file, and rubric
baseline below. The earlier planning anchor remains preserved separately from
the intentional inventory-tooling delta.

## Plan-Creation Anchor

Working tree before documentation changes: clean.

### Tracked test/spec owners

Command:

```sh
git ls-files | awk '/\.(test|spec)\.ts$/ {n++} END {print n}'
```

Result: `698` tracked files.

Separately counted owners:

- `154` Fastify `*.test.ts` files;
- `7` browser-smoke `*.spec.ts` files;
- `537` frontend Vitest files from checked runner discovery.

### Frontend discovery and capability ownership

Command:

```sh
pnpm check:frontend-test-inventory
```

Result: passed.

| View                            | Result                                |
| ------------------------------- | ------------------------------------- |
| Full Vitest discovery           | 537: 194 Node / 17 Svelte+Node / 326 DOM |
| Standalone ordinary discovery   | 535: 194 Node / 17 Svelte+Node / 324 DOM |
| `test:all` ordinary discovery   | 529: 193 Node / 17 Svelte+Node / 319 DOM |
| Browser-smoke discovery         | 7 files                               |
| Explicit capability ownership   | N=194 / S=17 / D=326 / B=7            |

### Aggregate lane graph

Command:

```sh
pnpm test:all --dry-run
```

Result: passed. At the plan-creation anchor the aggregate reported nine lanes:
frontend routing, server/browser typecheck, frontend tests, isolated server
tests, isolated browser smoke after server check, frontend check, UI coverage
after frontend, format check, and isolated frontend performance gates. Phase 1
subsequently added the Realm scale owner.

### Workstream documentation

- `21` Markdown files exist under the workstream, including `15` numbered phase
  contracts.
- All local Markdown links in the workstream and `docs/plan/README.md` resolve.
- `pnpm exec prettier --check docs/plan/README.md docs/plan/test-suite-effectiveness-audit`
  passed.
- `git diff --check` passed.
- `pnpm test:affected --dry-run` passed and selected no automated lane for the
  documentation-only change set.

## Formal Phase 0 Baseline

### Anchor and environment

- Frozen clean commit:
  `56796fa5a2f651a791e19b4223337b98874efa97`.
- Inventory enforcement commit: `b2ff30a16` after two tooling commits. It adds
  one focused frontend Node test, moving the live universe from 698 to 699.
- Node `v24.19.0`; pnpm `11.23.0`; Vitest `4.1.2`; Playwright `1.62.1`.
- Chrome for Testing `151.0.7922.34` from Playwright `chromium-1234`.
- Linux `7.0.0-30-generic` x86_64 under KVM, 10 available AMD Ryzen 9 9950X
  virtual CPUs.
- At the frozen baseline, CI used pnpm 10 while local evidence used pnpm
  11.23.0; Phase 1 subsequently aligned both to the exact package declaration.

Commands:

```sh
node --version
pnpm --version
pnpm exec vitest --version
pnpm exec playwright --version
uname -srvmo
getconf _NPROCESSORS_ONLN
lscpu
git rev-parse HEAD
git status --porcelain=v1
```

### Live exhaustive discovery

`pnpm check:test-inventories` passed:

- frontend full discovery: 538 files, N=195 / S=17 / D=326;
- standalone ordinary frontend: 536, N=195 / S=17 / D=324;
- aggregate ordinary frontend: 530, N=194 / S=17 / D=319;
- Fastify: 154 files;
- browser smoke: 7 files;
- all tracked test/spec files: 699, exactly one A-L primary category each;
- standalone support artifacts: 253;
- mixed production test seams: 64.

The linked machine-readable case inventory records:

| Lane                 | Files | Cases | Skips | Parameterized rows |
| -------------------- | ----: | ----: | ----: | -----------------: |
| Frontend Node        |   195 | 1,326 |     0 |                199 |
| Frontend Svelte+Node |    17 |   167 |     0 |                  0 |
| Frontend Happy-DOM   |   326 | 5,152 |     0 |                654 |
| Fastify Node         |   154 | 3,296 |     1 |                408 |
| Built Chromium       |     7 |    34 |     0 |                  0 |
| **Total**            | **699** | **9,975** | **1** | **1,261** |

Vitest `list --json` and Playwright `--list --reporter=json` supply expanded
case ownership. Measured JSON results add skip evidence. Parameterized rows are
the collected cases beyond syntactic non-`.each` registrations; this explicitly
records the estimator instead of claiming assertion-level precision.

### Required lane results and resource observations

First measured frontend attempt:

- `6,637` passed, `1` failed, `537` anchor files;
- 81.52 s wall; 431.39 s user; 35.49 s system; peak RSS 4,561,420 KiB;
- failure:
  `TranslatorPresetSettings ... reasserts a retryable optimistic delete after an authoritative collection projection`;
- the exact case passed alone in 10.44 s including file import; the next full
  run passed all `6,638` anchor cases.

Second measured frontend attempt:

- `6,638 / 6,638` passed;
- 73.96 s wall; 421.47 s user; 32.03 s system; peak RSS 4,831,652 KiB.

Fastify:

- `3,295` passed plus one intentional direct-only Realm scale skip;
- first measured: 20.29 s wall, peak RSS 963,348 KiB;
- next measured: 17.48 s wall, peak RSS 808,896 KiB;
- direct Realm case passed: one selected / 26 filtered in 3.15 s, peak RSS
  540,424 KiB.

Browser smoke:

- smoke build passed in 11.25 s, peak RSS 2,729,400 KiB;
- Chromium passed 34/34 with 0 skipped, flaky, or unexpected in 62.44 s;
  peak RSS 1,162,396 KiB.

Special owners:

- `pnpm test:gates`: 38/38 passed in 11.78 s; peak RSS 1,524,616 KiB;
- `pnpm coverage:ui-map`: 203/203 passed in 20.29 s; 14.55% lines,
  14.96% statements, 18.2% functions, 9.52% branches; all configured floors
  passed.

These durations are observations, not new performance budgets. The small
sample does not justify a median-based claim or threshold.

### Broad report-only coverage

Both report-only broad coverage commands passed:

| Report   | Lines | Statements | Functions | Branches | Wall | Peak RSS |
| -------- | ----: | ---------: | --------: | -------: | ---: | -------: |
| Frontend | 70.56% | 67.48% | 65.23% | 60.75% | 106.45 s | 4,928,208 KiB |
| Backend  | 87.55% | 85.13% | 92.95% | 74.89% | 27.88 s | 889,640 KiB |

No global threshold was inferred from these percentages.

### Compatibility prerequisite

`pnpm test:compat-harness` stopped before execution:

```text
Error: Fork-point worktree is missing: /home/codex/risu-baseline-71c476e9c
```

The exact pinned worktree and dependencies are the revisit condition. No
substitute baseline was used and no golden changed.

### Inventory and orchestration verification

The following passed after the live inventory landed:

```sh
pnpm exec vitest run util/test-effectiveness-inventory.test.ts \
  util/affected-tests.test.ts util/test-all.test.ts
pnpm check:test-inventories
pnpm test:affected --dry-run
pnpm test:all --dry-run
pnpm format:check
git diff --check
```

The affected dry-run correctly widened package/CI/runner/manifest changes to
the complete `pnpm test:all` aggregate. The full aggregate result is recorded
after the Phase 0 documentation commit rather than conflated with the frozen
pre-tooling measurements.

### Post-Phase 0 aggregate

`pnpm test:all` passed after the Phase 0 documentation commit in 3m 23.7s:

| Lane                              | Result | Duration |
| --------------------------------- | ------ | -------: |
| Test inventory and routing        | Pass   |    5.8 s |
| Server and browser-smoke typecheck | Pass   |   17.8 s |
| Frontend tests                    | Pass   | 1m 16.5s |
| Server tests                      | Pass   |   16.9 s |
| Browser smoke tests               | Pass   | 1m 12.6s |
| Frontend check                    | Pass   |   28.6 s |
| UI coverage gate                  | Pass   |   19.9 s |
| Format check                      | Pass   |   29.6 s |
| Frontend performance gates        | Pass   |   11.9 s |

The browser lane passed 34/34 journeys and the UI map passed 203/203 cases.
This is the clean aggregate checkpoint for beginning Phase 1.

## Phase 1 Evidence

### Protocol import-boundary remediation

`TSA-P00-001` is done. The policy owner now recursively discovers runtime
TypeScript modules and uses the TypeScript AST to inspect static imports and
exports, dynamic imports, `require`, and import-equals declarations. A negative
fixture covers nested Node dependencies and a relative package escape.

```sh
pnpm exec vitest run packages/protocol/src/importBoundary.test.ts \
  --project frontend-node
pnpm check:protocol
pnpm check:test-inventories
pnpm test:affected
```

Results: 2/2 focused cases passed; protocol typecheck and all checked inventories
passed. Affected execution passed 6,640/6,640 ordinary frontend cases, 6/6
isolated performance cases, and 3,295 passed plus one intentional skip in the
server lane. The file count remains 699; the added counterexample changes the
live case total from 9,975 to 9,976.

### Affected-selection remediation

`TSA-P01-001` is done. Four counterexample cases now cover protocol runtime and
configuration, shared Fastify helper/fixture changes and deletions, and the
source side of a rename. Protocol sources select typecheck plus dependency-aware
frontend/server execution; protocol config selects `test:all`; deleted shared
support and rename sources conservatively widen.

```sh
pnpm exec vitest run util/affected-tests.test.ts
```

Result: 15/15 passed. The file count is unchanged; four cases take the live
total from 9,976 to 9,980. Representative CLI dry runs and the complete
aggregate are recorded when P01-S01 closes.

### Resolved Fastify and Playwright discovery

`TSA-P01-002` is done. The live capability checker now compares independent
filesystem owners with resolved Fastify Vitest and Playwright discovery, in
addition to its existing three frontend project views.

```sh
pnpm exec vitest run util/frontend-test-inventory.test.ts
pnpm check:frontend-test-inventory
```

Results: 9/9 oracle cases passed; live discovery matched 538 frontend files,
154 Fastify files, and 7 browser specs. Two cases take the live collected total
from 9,980 to 9,982 without a file-count change.

### Aggregate graph and CI owner parity

`TSA-P01-003` is done. The aggregate validates dependencies across regular and
isolated phases before execution, and its focused policy test maps every local
lane to a CI command plus `verify.needs` dependency. Initial preload is retained
as the intentional CI-only superset.

```sh
pnpm exec vitest run util/test-all.test.ts
pnpm test:all --dry-run
```

Results: 6/6 policy cases and the then-nine-lane dry run passed. Two cases take the
live total from 9,982 to 9,984 without a file-count change.

### Package-manager parity

`TSA-P01-004` is done. `package.json` now declares `pnpm@11.23.0`, matching the
Phase 0 local evidence, and every quality job installs that exact version rather
than the prior pnpm 10 major.

```sh
pnpm install --frozen-lockfile
pnpm --version
```

Results: the frozen install was already up to date and reported pnpm `11.23.0`;
the lockfile did not change.

### Production-only UI coverage denominator

`TSA-P01-005` is done. The coverage config excludes exactly the 28 test-only UI
hosts/stubs/harnesses in the checked support manifest; a policy case prevents
the registry from drifting. Thresholds did not change.

```sh
pnpm exec vitest run util/test-all.test.ts
pnpm coverage:ui-map
```

Results: 7/7 policy cases and 203/203 UI cases passed. Production-only coverage
is 14.44% lines, 14.83% statements, 18.13% functions, and 9.45% branches. One
policy case takes the live total from 9,984 to 9,985.

### Phase 7 browser artifact ownership

`TSA-P01-006` is done. Normal smoke discovery includes all 7 specs and 34 cases,
including the Phase 7 integration matrix. CI now uploads its JSON/text reports
and treats missing smoke/UI artifacts as errors. The workflow policy assertion
checks these paths.

The Phase 0 aggregate's successful normal smoke execution produced both
`fast-bootstrap-results/phase7-integration.json` and `.txt`, confirming the
artifact path before workflow enforcement changed.

### Baseline-independent compatibility

`TSA-P01-007` is done. Current/cluster assurance no longer depends on the absent
historical worktree, and golden mismatches preserve actual JSON under ignored
`fast-bootstrap-results/compat-harness/` diagnostics.

```sh
pnpm exec vitest run util/affected-tests.test.ts
pnpm test:compat-current
```

Results: affected policy passed 15/15; current compatibility passed 18/18 in
5.56s and matched 16 matrix cells plus two healthy cluster regressions. The full
differential remains blocked by the exact Phase 0 prerequisite; no golden was
updated.

### Realm scale ownership

`TSA-P01-008` is done. The existing 7,000-asset case now has a named isolated
local aggregate lane and a separate required CI job; ordinary server execution
retains its skip to prevent duplicate/concurrent cost evidence.

```sh
pnpm exec vitest run util/test-all.test.ts
pnpm test:server:realm-scale
pnpm test:all --dry-run
```

Results: 7/7 aggregate policy cases passed; the scale lane passed its one
selected case with 26 filtered in 2.64s; the aggregate dry run reports ten lanes.

### Global setup fidelity

`TSA-P01-009` and `TSA-P01-010` are done. Shared setup no longer replaces KaTeX
for every frontend test and now establishes the generation-recovery dependency
promised by its all-ready baseline. The direct setup oracle pins the exact
capability vector, while a parser case proves real KaTeX MathML output.

```sh
pnpm exec vitest run vitest.setup.test.ts src/ts/parser/tests/renderFastPaths.test.ts
pnpm test:frontend:run
```

Results: the focused pair passed 14/14. The complete frontend lane passed all
6,651 cases across 536 files in 71.88s. Two cases take the live total from 9,985
to 9,987 without a file-count change.

## Phase 1 Closeout

The shared row/table oracles, support seam manifest, observable send drain,
frozen historical save vectors, and orphan-export cleanup were validated before
the phase aggregate. Four direct oracle cases take the live tracked total from
9,987 to 9,991; no file was added or removed.

```sh
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMutationBudget.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/risuSaveCodec.test.ts \
  server/fastify/__tests__/risuSaveBoundedInflate.test.ts
pnpm check:test-inventories
pnpm test:affected --dry-run
pnpm test:all
```

Focused results: mutation oracles 8/8 and single-row consumers 21/21;
server-backed send fixtures 27/27; save codec/bounded-inflate 39/39. Inventories
passed at 699 tests, 253 standalone support owners, and 65 mixed seams. The
affected dry run selected inventories, frontend, performance, and server lanes.

The first aggregate attempt is retained as red evidence: the send-drain import
changed a checked routing row, so the inventory lane failed stale while the
other nine lanes passed. After the intentional manifest refresh, the complete
ten-lane aggregate passed in 3m32.2s:

- inventory/routing, strict server/browser typecheck, Svelte check, and format;
- ordinary frontend 6,448/6,448 across 530 files;
- UI coverage 203/203 at 14.43% lines, 14.83% statements, 18.12% functions, and
  9.45% branches;
- Fastify 3,299 passed with the one direct-only scale case skipped in ordinary
  discovery, then that Realm scale case passed in its isolated lane;
- browser smoke 34/34 with required artifacts;
- frontend performance gates 6/6 under one worker.

Full historical compatibility remains blocked only by the exact missing pinned
worktree. Current/cluster assurance remains green under `test:compat-current`.

## Phase 2 Closeout

Phase 2 reviewed all 32 category-B owners and their 782 opening cases. Eighteen
counterexamples and lifecycle cases were added without adding or removing a
file, bringing the live tracked total from 9,991 to 10,009 cases. Thirty-one
owners remain category B with `Keep` dispositions; the DOM/media observer owner
was retained and reclassified to category D. The complete inventory therefore
records 51 `Keep`, one `Reclassify`, and 647 pending file dispositions.

The remediation preserves committed replay order, rejects mismatched lorebook
identities, cleans up DOM audio observation, exercises actual entry wiring and
lifecycle teardown, verifies bootstrap ownership and stale-writer side-effect
fencing, compares rollback snapshots semantically, adds cache budget/pruning
oracles, and replaces browser false-success signals with protocol outcomes.

```sh
pnpm exec vitest run \
  src/ts/bootstrap.test.ts \
  src/ts/entryStartup.test.ts \
  src/ts/observerProjectionLifecycle.test.ts \
  src/ts/observerRouteIntent.test.ts \
  src/ts/observerShellFlag.test.ts \
  src/ts/server/activeWriterSession.test.ts \
  src/ts/server/bootstrap.svelte-node.test.ts \
  src/ts/server/hydrationReads.svelte-node.test.ts \
  src/ts/server/lifecycleRecovery.test.ts \
  src/ts/server/pendingMutationOutbox.crossTab.test.ts \
  src/ts/server/pendingMutationOutbox.test.ts \
  src/ts/server/pendingMutationReplay.test.ts \
  src/ts/server/resourceCache.test.ts \
  src/ts/server/resourceInvalidation.test.ts \
  src/ts/server/resourceManifest.test.ts \
  src/ts/server/resourceRefresh.test.ts \
  src/ts/server/resourceState.svelte.test.ts \
  src/ts/server/routeResourceLoader.test.ts \
  src/ts/server/shellHydration.svelte-node.test.ts \
  src/ts/server/shellProtocol.test.ts \
  src/ts/server/staleStateGuards.test.ts \
  src/ts/startupReadiness.test.ts \
  src/ts/storage/database.resourceState.test.ts \
  src/ts/stores.runtimeEffects.svelte-node.test.ts \
  src/lib/ObserverShell.svelte.test.ts \
  src/ts/observer.svelte.test.ts \
  src/ts/server/characterShellHydration.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/activeWriter.test.ts \
  server/fastify/__tests__/bootstrap.test.ts
pnpm exec playwright test \
  server/fastify/browser-smoke/startupCachePopulationMatrix.spec.ts \
  server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts \
  server/fastify/browser-smoke/visibleStateRecovery.spec.ts
pnpm test:frontend:all
pnpm test:smoke
pnpm test:affected --dry-run
pnpm check:test-inventories
pnpm build:smoke
pnpm format:check
git diff --check
```

Focused results: 27 frontend owners passed 775/775 cases; two Fastify owners
passed 14/14; and three browser owners passed 11/11. The full frontend universe
passed 6,675/6,675 across 538 files in 69.25s. Browser smoke passed all 34
journeys in 1.1m. The built application completed with the existing allowed
build warnings, and the affected dry run selected inventories, frontend,
performance, and server lanes.

The checked manifests pass at 699 test files, 253 standalone support owners,
and 65 mixed production seams. Category B changes from 32 to 31 owners and
category D from 112 to 113 solely because of the observer reclassification.
All eight new actionable Phase 2 findings are done; `TSA-P02-009` records the
bounded Medium browser-storage/cache residuals and their Phase 13/14 revisit
condition. Full historical compatibility remains blocked only by the missing
exact pinned worktree; no historical claim or golden was changed.

## Phase 3 Closeout

Phase 3 reviewed all 52 category-C owners and their 1,565 opening cases.
Eighteen counterexamples and transaction/lifecycle cases were added without a
file or category-count change, bringing category C to 1,583 cases and the live
tracked total from 10,009 to 10,027. All 52 owners retain category C with
`Keep` dispositions. The complete inventory therefore records 103 `Keep`, one
`Reclassify`, and 595 pending file dispositions.

The remediation fails closed when durable SQLite state survives without valid
settings metadata, validates append-only message prefixes semantically, fences
debounced module lorebook projections by epoch, makes shared bridge teardown
idempotent, proves DELETE receipt replay across every route family, parses
mutation budgets through the TypeScript AST, exercises ordinary command races
and event-failure rollback, and preserves migrated receipt response payloads.

```sh
pnpm exec vitest run \
  src/ts/character/characterBridge.lifecycle.test.ts \
  src/ts/character/moduleLorebookProjection.test.ts \
  src/ts/process/__tests__/generation.chat.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMutationBudget.test.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/dbMigrationV24.test.ts \
  server/fastify/__tests__/deleteMutationRoutes.test.ts \
  server/fastify/__tests__/databaseStateClassification.test.ts \
  server/fastify/__tests__/initDatabase.test.ts \
  server/fastify/__tests__/messageStore.test.ts
pnpm exec vitest run --config server/fastify/vitest.load.config.ts \
  server/fastify/__tests__/generation-load.test.ts
pnpm test:frontend:run
pnpm test:server
pnpm build:smoke
pnpm exec playwright test -c playwright.fastify-smoke.config.ts \
  server/fastify/browser-smoke/rerollSwipePersistence.spec.ts \
  server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts \
  -g 'rerolled candidates|durable recovery'
pnpm test:affected --dry-run
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The exact Phase 3 frontend slice passed 1,003/1,003 cases across 30 owners in
11.18s, and its Fastify slice passed 580/580 across 22 owners in 14.67s. The
complete frontend lane passed 6,677/6,677 across 538 files in 74.58s. The
complete Fastify lane passed 3,316 cases across 154 files in 23.62s with the one
intentional direct-only Realm scale skip, and the isolated generation load
harness passed 38/38 under one worker in 6.78s.

The production smoke build passed in 11.17s with the existing allowed CSS and
bundle-size diagnostics. Both selected browser journeys passed in 4.1s. The
affected dry run selected inventories, frontend, performance, and server lanes.
The checked manifests pass at 699 test files, 253 standalone support owners,
and 65 mixed production seams.

Seven actionable Phase 3 findings are done. `TSA-P03-008` records the bounded
Medium residuals for unavailable historical fixtures, stable-ID fail-close
hardening, mounted-component rollback, multi-step browser journeys, and later
cross-suite consolidation. Full historical compatibility remains blocked only
by the missing exact pinned worktree; no historical claim or golden was
changed.

## Phase 4 App Navigation, Chat, And Shared UI

### Opening evidence and inventory correction

The phase opened with 113 category-D owners and 1,235 cases. The exact opening
frontend set passed 1,116/1,116 across 108 files in 26.59s, the three Fastify
owners passed 106/106 in 1.83s, and the two browser specs passed 13/13 in 14.3s.
The production smoke build passed in 11.17s.

Product-risk rules then moved nine owners with 279 cases from D to A, B, F, G,
K, or L and moved the 11-case language owner from L to D. Phase 4 also removed
the unreachable two-case legacy mobile-shell owner, added a one-case shared
Button owner, and strengthened existing owners. The final completed review set
is 114 live files and 1,261 cases. The 105 current category-D rows contain 982
cases and 62 parameterized rows; the nine outgoing rows remain part of the
completed Phase 4 evidence record.

### Commands

```sh
# Exact final frontend set: current D plus the six outgoing frontend owners.
mapfile -t phase4_frontend < <(jq -r '
  .rows[] | .file as $file |
  select(
    (.primaryCategory == "D" or
      (["src/ts/alert.importSafety.test.ts",
        "src/ts/gui/loginMessageOrigin.test.ts",
        "src/ts/chatImportPlanning.test.ts",
        "src/ts/server/chatMessageHydration.test.ts",
        "src/ts/server/chatMessageHydration.reactivity.svelte.test.ts",
        "src/ts/process/request/tests/serverChat.test.ts"] | index($file))) and
    (.lane == "frontend-node" or .lane == "frontend-dom")) |
  .file' docs/plan/test-suite-effectiveness-audit/inventory.json)
pnpm exec cross-env RISU_TEST_INCLUDE_GATES=true vitest run "${phase4_frontend[@]}"

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/chatDispatchLogitBias.test.ts \
  server/fastify/__tests__/chatDispatchProfileOptions.test.ts \
  server/fastify/__tests__/openrouterFreeModel.test.ts

pnpm test:frontend:all
pnpm test:server
pnpm test:gates:perf
pnpm coverage:ui-map
pnpm check
pnpm build:smoke
pnpm test:smoke
pnpm test:affected --dry-run
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The exact final frontend set passed 1,142/1,142 across 109 files in 27.31s,
and the reclassified Fastify set passed 106/106 across three files in 2.12s.
The complete frontend lane passed 6,693/6,693 across 538 files in 94.72s. The
complete Fastify lane passed 3,316 cases across 154 files in 19.61s with the one
intentional direct-only Realm scale skip. The two isolated performance owners
passed 6/6 in 22.76s.

`coverage:ui-map` passed 205/205 across its six deliberate owners in 21.65s:
14.82% statements, 9.45% branches, 18.1% functions, and 14.42% lines. These
figures clear the bounded sentinel thresholds but are not represented as broad
UI coverage. `svelte-check` reported zero errors and zero warnings.

The standalone production smoke build passed in 11.72s with the existing CSS,
externalization, and chunk-size diagnostics. `test:smoke` rebuilt in 11.65s and
passed all 34 Chromium cases in 1.5 minutes, including the strengthened
first-open route sweeps, responsive controls, send/reload recovery, startup
matrices, and multi-tab takeover.

The affected dry run selected inventory checks, frontend, performance, and
server lanes; every selected lane above passed. The checked manifests now prove
699 test/spec files, 252 standalone support artifacts, 65 mixed production
seams, 10,043 collected cases, one direct-only skip, and 1,278 parameterized
rows. Primary categories are A=20, B=33, C=52, D=105, E=96, F=91, G=98, H=43,
I=42, J=47, K=39, and L=33. Live decisions are 206 Keep, 11 Reclassify, and 482
Pending; the durable action ledger additionally records one removed legacy
owner and one added shared-control owner.

Eighteen Phase 4 findings are done. `TSA-P04-019` bounds visible browser,
mobile/touch, cross-browser, full-screen accessibility, and broader UI-map
fidelity until Phase 13, with a mandatory Phase 14 decision. Full historical
compatibility remains blocked only by the absent exact pinned worktree; no
substitute checkout or golden was used.

## Phase 5 Settings, Profiles, Authoring, And Catalogs

### Opening, routing, and final inventory

The phase opened with 96 category-E owners and 1,011 cases. The exact opening
frontend set passed 886/886 across 92 files in 28.41s and the four Fastify
owners passed 125/125 in 3.10s.

Product-risk review moved `hub.test.ts` to L, `lorebook.test.ts` and
`agentLorebookInputs.test.ts` to F, and the PNG/CharX import owner to K. The new
mounted PersonaSettings owner and twelve added cases produce a final reviewed
record of 97 files and 1,023 cases. Current category E is 93 files / 891 cases;
the four outgoing owners remain in the completed Phase 5 evidence record.

### Commands

```sh
# Exact completed frontend set: all Phase 5-reviewed frontend rows plus the
# previously reviewed persona display-name owner.
phase5_frontend_files=$(jq -r '
  .rows[] |
  select(
    ((.audit.state | startswith("phase5")) or
      .file == "src/ts/personaDisplayName.test.ts") and
    (.lane | startswith("frontend"))
  ) | .file' docs/plan/test-suite-effectiveness-audit/inventory.json)
pnpm exec vitest run $phase5_frontend_files --config vitest.config.ts

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/settingsGroupParity.test.ts \
  server/fastify/__tests__/splitPresets.test.ts

pnpm test:frontend:all
pnpm test:server
pnpm test:gates:perf
pnpm coverage:ui-map
pnpm check
pnpm build:smoke
pnpm test:affected --dry-run --base f46ad3e1e
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The exact completed frontend set passed 898/898 across 93 files in 28.15s;
the exact Fastify set passed 125/125 across four files in 3.50s. The complete
frontend lane passed 6,705/6,705 across 539 files in 72.38s. The complete
Fastify lane passed 3,316 cases across 154 files in 18.39s with the one
intentional direct-only Realm scale skip. The performance owners passed 6/6 in
10.79s.

The first complete frontend command stopped before execution because the new
PersonaSettings test made the checked routing TSV stale. Regenerating all three
linked manifests produced 539 resolved frontend files, 154 Fastify files, seven
browser specs, 252 standalone support artifacts, and 65 mixed production
seams; the rerun then passed. This red attempt is an expected live-manifest
guard, not a test failure.

`coverage:ui-map` passed 206/206 across six owners in 25.23s: 14.83% statements,
9.46% branches, 18.11% functions, and 14.43% lines. `svelte-check` initially
reported one explicit fixture typing mismatch in the new persona replacement
case; the fixture boundary was typed and the rerun reported zero errors and
zero warnings. Formatting and diff checks passed.

The production smoke build passed in 10.41s with the existing allowed CSS,
externalization, plugin-timing, and chunk-size diagnostics. No browser test
owner changed in Phase 5; the absent representative settings/restore journey is
recorded as `TSA-P05-013` for Phase 13 rather than inferred from unrelated
smoke cases.

The checked universe now records 700 test/spec files and 10,055 cases with one
direct-only skip and 1,283 parameterized rows. Primary categories are A=20,
B=33, C=52, D=105, E=93, F=93, G=98, H=43, I=42, J=47, K=40, and L=34. Live
decisions are 298 Keep, 15 Reclassify, and 387 Pending; the durable action
ledger additionally records one removal and two additions.

Twelve Phase 5 findings are done and `TSA-P00-002` is closed. `TSA-P05-013`
routes stale saved-asset cleanup to Phase 11, browser composition to Phase 13,
and the mandatory residual decision to Phase 14. Full historical compatibility
remains blocked only by the absent exact pinned worktree; no substitute checkout
or golden was used.

## Phase 6 Evidence

### Opening set and remediation validation

Phase 6 opened with 93 category-F owners and 1,922 cases: 69 frontend files /
990 cases, 22 Fastify files / 922 cases, and two browser files / ten cases. All
three exact sets passed before remediation in 23.57s, 14.32s, and 27.2s,
respectively.

The opening owners gained fourteen regression cases. Product-risk routing moved
18 unchanged owners / 430 cases to A/B/C/D/E/G/I/K/L, leaving current category
F at 75 owners / 1,506 cases. The exact original owners then passed 1,001/1,001
frontend cases in 17.68s, 924/924 Fastify cases in 9.21s, and 11/11 browser
cases in 20.7s.

Focused remediation commands passed throughout:

- client/Fastify final budget owners: 6/6 and 9/9;
- route-backed prompt semantics: 27/27;
- client lore placement and retrieved descriptions: 16/16 and 9/9;
- Agent execution: 25/25; records/resolver: 25/25;
- post-generation progress plus durable server chat: 79/79;
- client/Fastify preflight: 17/17 and 28/28;
- SSE parsing plus server chat: 88/88;
- executable routing policy: 8/8.

### Complete gates

Commands:

```sh
pnpm exec vitest run --config vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase6-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase6-server-results.json
pnpm test:smoke
pnpm test:gates:perf
pnpm check
pnpm test:affected --dry-run --include-smoke --base 5d6b47398
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete frontend universe passed 6,710/6,710 across 539 files. Complete
Fastify passed 3,318 cases with one intentional direct-only Realm scale skip
across 154 files. The production smoke build passed in 10.71s with the existing
allowed diagnostics, followed by all 35/35 Chromium journeys in 1.1 minutes;
the new accepted-response-loss journey passed inside that complete run.

The two isolated frontend performance owners passed 6/6 in 13.81s.
`svelte-check` reported zero errors and zero warnings in 26.20s. Affected
selection chose inventory, complete frontend, performance, complete Fastify,
and browser smoke owners; every selected lane is represented above. Inventory,
formatting, and diff gates passed.

Fresh Vitest/Playwright listing and measured skip results produce 700 live
test/spec owners and 10,070 collected cases, with one direct-only skip and 1,287
parameterized rows. Six cases belong to the two isolated performance owners and
therefore are intentionally outside ordinary frontend discovery results.
Primary categories are A=21, B=34, C=56, D=106, E=95, F=75, G=103, H=43,
I=43, J=47, K=41, and L=36. Live decisions are 370 Keep, 33 Reclassify, and
297 Pending.

Twelve Phase 6 findings are done. `TSA-P06-013` routes runtime/journal
observability to Phase 12, browser/provider/effect/parity composition to Phase
13, and the mandatory compatibility/residual decision to Phase 14. The exact
pinned compatibility worktree remains absent; no substitute checkout or golden
refresh was used.

## Phase 7 Evidence

### Opening set and remediation validation

Phase 7 opened with 103 category-G owners and 1,395 cases: 60 frontend files /
542 cases and 43 Fastify files / 853 cases. The opening sets passed before
remediation in 14.37s and 6.31s. Fourteen regressions were added across
provider, credential, translation, image, history, and TTS owners.

Eight unchanged owners / 69 cases moved to D/E/F after complete review. Eight
owners already entering G through Phase 4/6 reclassifications retained their
earlier dispositions. The exact original owners then passed 544/544 frontend
cases across 60 files in 13.38s and 864/864 Fastify cases across 43 files in
5.46s.

Focused remediation commands passed throughout:

- OpenAI auth/endpoint adapters and dispatch: 210/210 and 119/119;
- Ooba, Gemini, and Horde: 9/9, 56/56, and 19/19;
- SigV4 plus Bedrock: 31/31;
- raw/server translation and client cache: 28/28 and 23/23;
- request-history unit/route/completion: 104/104;
- image generation and TTS: 20/20 and 23/23;
- executable category boundaries: 9/9.

### Complete gates

Commands:

```sh
pnpm exec vitest run --config vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase7-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase7-server-results.json
pnpm test:gates:perf
pnpm check
pnpm check:server
pnpm test:smoke
pnpm test:compat-harness
pnpm test:affected --dry-run --include-smoke --base 5b88ffd47
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete ordinary frontend universe passed 6,713/6,713 across 537 files
in 82.95s; the two isolated performance owners passed 6/6 in 16.14s. Complete
Fastify passed 3,329 cases with one intentional direct-only Realm scale skip
across 154 files in 24.21s. `svelte-check` reported zero errors and zero
warnings. Protocol, client-library declaration, Fastify, and browser-smoke
typechecks passed.

The production smoke build passed in 10.51s with the existing allowed CSS,
externalization, plugin-timing, and chunk-size diagnostics. All 35/35 Chromium
journeys passed in 1.1 minutes. There is no category-G browser owner, so this is
application regression evidence rather than a live provider or media-device
claim.

The first affected/inventory check correctly rejected two stale routing TSV
line references after the TTS and routing-policy tests changed; regeneration
updated only those evidence locations. The first exact-set command contained a
bad jq context expression and therefore selected no file filters, causing full
frontend/Fastify runs instead; both passed, and the corrected 60/43-file exact
commands then produced the results above. The first server typecheck found an
untyped NovelAI fetch spy; explicit request parameters fixed that test-only
typing gap, after which its 20 cases and the complete server check passed.

Affected selection chose inventory, frontend, performance, Fastify, and smoke
lanes. Fresh Vitest/Playwright listings and measured results produce 700 live
test/spec owners and 10,084 collected cases, with one direct-only skip and
1,287 parameterized rows. Six cases belong to isolated performance owners and
are intentionally preserved from their dedicated results. Primary categories
are A=21, B=34, C=56, D=108, E=97, F=79, G=95, H=43, I=43, J=47, K=41, and
L=36. Live decisions are 457 Keep, 41 Reclassify, and 202 Pending.

Twelve Phase 7 findings are done. `TSA-P07-013` routes credential/runtime
observability to Phase 12, recorded-provider/browser/media composition to
Phase 13, and the Ollama support policy, compatibility, and final residual
decision to Phase 14. `pnpm test:compat-harness` remains prerequisite-blocked
by the absent exact `/home/codex/risu-baseline-71c476e9c` worktree; no
substitute checkout or golden refresh was used.

## Phase 8 Evidence

### Opening set and remediation validation

Phase 8 opened with 43 category-H owners and 454 cases: 20 frontend files / 127
cases and 23 Fastify files / 327 cases. Both opening sets passed before
remediation in 16.14s and 2.89s. Sixteen regressions were added inside the
opening owners.

Seventeen unchanged owners / 199 cases moved to B/D/F/G/L after complete
review, leaving current category H at 26 owners / 270 cases. The exact original
owners then passed 132/132 frontend cases in 12.59s and 338/338 Fastify cases
in 3.52s.

Focused remediation commands passed throughout:

- browser projection, refresh, events, and mounted modal: 27/27;
- embedding adapter/cache validation: 17/17;
- memory event presentation: 13/13;
- legacy-memory import plus save/import routes: 72/72;
- memory jobs route/repository bounds: 31/31;
- message-store and command invalidation: 251/251;
- executable category boundaries: 10/10.

### Complete gates

Commands:

```sh
pnpm exec vitest run --config vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase8-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase8-server-results.json
pnpm test:gates:perf
pnpm check
pnpm check:server
pnpm test:smoke
pnpm test:affected --dry-run --include-smoke --base 9e3e32199
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete ordinary frontend universe passed 6,719/6,719 across 537 files;
the two isolated performance owners passed 6/6 in 14.74s. Complete Fastify
passed 3,341 cases with one intentional direct-only Realm scale skip across 154
files. Client and server typechecks passed with zero diagnostics.

The production smoke build passed in 11.38s with the existing allowed
diagnostics and all 35/35 Chromium journeys passed in 1.0 minutes. Smoke
disables the memory worker and there is no category-H browser owner, so this is
application regression evidence rather than an end-to-end memory lifecycle
claim.

The terminal-history SQL bound initially exposed an overly narrow repository
tuple annotation; the explicit filter type was corrected, after which the 31
route/repository cases and server typecheck passed. Affected selection chose
inventory, frontend, performance, Fastify, and smoke lanes. Inventory,
formatting, and diff gates passed.

Fresh Vitest/Playwright listings and measured results produce 700 live
test/spec owners and 10,102 collected cases, with one direct-only skip and
1,294 parameterized rows. Primary categories are A=21, B=35, C=56, D=109,
E=97, F=83, G=104, H=26, I=43, J=47, K=41, and L=38. Live decisions are 483
Keep, 58 Reclassify, and 159 Pending.

Eleven Phase 8 findings are done. `TSA-P08-012` routes worker/query
observability to Phase 12, live browser/provider/restart composition and the
summarized-memory invalidation policy to Phase 13, and historical compatibility
plus the final residual decision to Phase 14. The exact pinned compatibility
worktree remains absent; no substitute checkout or golden refresh was used.

## Phase 9 Evidence

### Opening set and remediation validation

Phase 9 opened with 43 category-I owners and 544 cases: 36 frontend files / 305
cases and seven Fastify files / 239 cases. Both opening sets passed before
remediation. Thirty regressions were added inside the opening owners.

Four unchanged owners / 16 cases moved to D/F/G/L after complete review,
leaving current category I at 39 owners / 558 cases. The exact original owners
then passed 325/325 frontend cases in 13.44s and 249/249 Fastify cases in 2.85s.

Focused remediation commands passed throughout:

- prompt-variable recursion: 26/26;
- Trigger V2 imports: 17/17;
- client Lua/Python scripting: 28/28;
- server Lua runtime: 52/52;
- server bounded regex: 15/15;
- client script, trigger, cache, and editor boundaries: 75 focused cases;
- native replacement parity vectors and production Worker build;
- executable category boundaries and linked inventory.

### Complete gates

Commands:

```sh
RISU_TEST_INCLUDE_GATES=true pnpm exec vitest run \
  --reporter=json --outputFile=/tmp/phase9b-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase9-server-results.json
pnpm test:gates:perf
pnpm check
pnpm check:server
pnpm test:smoke
VITE_FASTIFY_BROWSER_SMOKE=TRUE pnpm exec playwright test \
  -c playwright.fastify-smoke.config.ts
pnpm test:compat-current
pnpm test:compat-harness
pnpm test:affected --dry-run --include-smoke --base 466fc7705
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete ordinary frontend universe passed 6,740/6,740 across 537 files;
the two isolated performance owners passed 6/6. Complete Fastify passed 3,351
cases with one intentional direct-only Realm scale skip across 154 files.
Client and server typechecks passed with zero diagnostics.

The production smoke build bundled the regex Worker and passed with the
existing allowed CSS, externalization, plugin-timing, and chunk-size
diagnostics. The first 35-journey run had one load-sensitive queued-finalization
red: durable state reached `completed`, but six effect jobs had not drained
inside the 20-second predicate. That unchanged journey passed alone in 5.4s
and the complete no-rebuild rerun passed 35/35. There is no category-I browser
owner, so smoke is application/Worker-bundle evidence rather than a saved
definition edit/reload/runtime claim.

Affected selection chose inventory, frontend, performance, and Fastify lanes;
the complete smoke lane was run explicitly. Current-only compatibility passed
18/18 and matched 16 cells plus the healthy cluster-10 regressions. Full
differential compatibility remains prerequisite-blocked by the absent exact
`/home/codex/risu-baseline-71c476e9c` worktree; no substitute or golden refresh
was used.

Fresh Vitest/Playwright listings and measured results produce 700 live
test/spec owners and 10,133 collected cases, with one direct-only skip and
1,308 parameterized rows. Primary categories are A=21, B=35, C=56, D=110,
E=97, F=84, G=105, H=26, I=39, J=47, K=41, and L=39. Live decisions are 521
Keep, 62 Reclassify, and 117 Pending.

Ten Phase 9 findings are done. `TSA-P09-011` routes runtime queue/timeout
observability to Phase 12, CBS/trigger parity and saved-definition browser
composition to Phase 13, and historical compatibility plus the final residual
decision to Phase 14.

## Phase 10 Evidence

### Opening set and remediation validation

Phase 10 opened with 47 category-J owners and 601 cases: 42 frontend files / 528
cases and five Fastify files / 73 cases. Both opening sets passed before
remediation. Eighteen regressions were added inside the opening owners.

Five unchanged owners / 39 cases moved to B/C/G/K after complete review, leaving
current category J at 42 owners / 580 cases. The exact original owners then
passed 546/546 frontend cases in 15.01s and 73/73 Fastify cases in 2.71s.

Focused remediation commands passed throughout:

- Plugin V3 delayed-listener lifecycle: 67/67;
- RisuAccess character/module stable-owner mutations: 34/34;
- module activation aggregation and memoization: 40/40;
- image translation request ownership and teardown: 18/18;
- MCP deadline, SSE, custom transport, and pagination: 41/41;
- filesystem/internal client catalogs and read caps: 9/9;
- executable category boundaries and linked inventory: 12/12.

A temporary Vite/Playwright Chromium 1.62.1 harness mounted the production
`PluginDefinedIcon.svelte` path. A renderable host SVG blob containing script,
event-handler, external image/use, CSS import, and CSS URL probes rendered 24×24
with zero requests and zero execution signals. The same SVG created inside an
opaque Plugin V3-style sandbox became `blob:null` and Chromium refused the host
image load; base64 SVG is already rejected by production normalization. This
closes the suspected High icon-egress path as not reproducible.

### Complete gates

Commands:

```sh
RISU_TEST_INCLUDE_GATES=true pnpm exec vitest run \
  --reporter=json --outputFile=/tmp/phase10-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase10-server-results.json
pnpm test:gates:perf
pnpm check
pnpm check:server
pnpm test:smoke
pnpm test:compat-current
pnpm test:compat-harness
pnpm test:affected --dry-run --include-smoke --base 31bdaa81c
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete ordinary frontend universe passed 6,759/6,759 across 537 files;
the two isolated performance owners passed 6/6. Complete Fastify passed 3,351
cases with one intentional direct-only Realm scale skip across 154 files.
Client and server typechecks passed with zero diagnostics.

The production smoke build emitted the changed Playground image, filesystem,
RisuAccess, and MCP chunks and passed with the existing allowed CSS,
externalization, plugin-timing, and chunk-size diagnostics. All 35/35 Chromium
journeys passed in 1.1 minutes. There is no category-J browser owner, so smoke
is application and real-chunk evidence rather than a plugin iframe, MCP server,
filesystem permission, or canvas/media interoperability claim.

Affected selection chose inventories, frontend, performance, and Fastify lanes.
Current-only compatibility passed 18/18 and matched 16 cells plus the healthy
cluster-10 regressions. Full differential compatibility remains
prerequisite-blocked by the absent exact
`/home/codex/risu-baseline-71c476e9c` worktree; no substitute or golden refresh
was used.

Fresh Vitest/Playwright listings and measured results produce 700 live
test/spec owners and 10,152 collected cases, with one direct-only skip and 1,314
parameterized rows. Primary categories are A=21, B=36, C=57, D=110, E=97,
F=84, G=107, H=26, I=39, J=42, K=42, and L=39. Live decisions are 563 Keep,
67 Reclassify, and 70 Pending.

Ten Phase 10 findings are done. `TSA-P10-011` routes uploaded-asset cleanup to
Phase 11, proxy/threat-model and runtime ownership to Phase 12, bounded live
browser/MCP composition plus support policy to Phase 13, and historical
compatibility plus the final residual decision to Phase 14.

## Phase 11 Evidence

### Opening set and remediation validation

Phase 11 opened with 42 category-K owners and 554 cases: 29 frontend files /
280 cases and 13 Fastify files / 274 cases, with 54 parameterized rows. Both
opening sets passed before remediation. Twenty-three regressions were added.

Seventeen unchanged owners / 134 opening cases moved to B/C/D/E/G/L after
complete review. One unreachable Kei test/seam with five cases was removed and
one three-case direct legacy-backup rewrite owner was added. Current category K
is therefore 25 owners / 433 cases. The retained exact opening owners passed
280/280 frontend cases across 28 files and 288/288 Fastify cases across 13
files.

Focused remediation commands passed throughout:

- ordinary save export/import reroll round trip;
- malformed/deduplicated block framing and bounded directories;
- bundle entry/cardinality/name/duplicate validation;
- legacy local-backup reference rewrite: 3/3;
- Realm/CharX cleanup and isolated 7,000-asset scale: 30/30 plus the direct
  single selected scale case;
- inlay migration and PDF resource cleanup;
- Fastify inline save-mode selection;
- executable category boundaries and linked inventory: 13/13.

### Complete gates

Commands:

```sh
RISU_TEST_INCLUDE_GATES=true pnpm exec vitest run \
  --reporter=json --outputFile=/tmp/phase11b-frontend-results.json
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  --reporter=json --outputFile=/tmp/phase11-server-results.json
pnpm test:gates:perf
pnpm test:server:realm-scale
pnpm check
pnpm check:server
pnpm check:protocol
pnpm test:smoke
pnpm test:compat-current
pnpm test:compat-harness
pnpm test:affected --dry-run --include-smoke --base 378d9aa60
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete frontend universe passed 6,766/6,766 cases; the two isolated
performance owners passed 6/6. Complete Fastify passed 3,368 cases with the one
intentional direct-only Realm scale skip; the direct scale owner then passed
with 29 ordinary cases filtered. Client, server, browser-smoke, and protocol
typechecks passed with zero diagnostics.

The first full frontend closeout run found one stale test-support count in the
inventory policy after the intentional Kei seam removal: expected 65 versus the
new 64 mixed production seams. The expectation and generated manifest were
updated; its 13/13 focused policy cases and the complete 6,766-case repeat then
passed. The bundle-report text printed during the performance policy's negative
fixture is expected evidence; the gate itself passed.

The production smoke build passed with the existing allowed CSS,
externalization, plugin-timing, and chunk-size diagnostics. All 35/35 Chromium
journeys passed in 1.0 minutes, including reroll persistence and old-lineage
import recovery. Smoke establishes built-application regression evidence; it
does not claim deep archive conversion or mid-import disconnect coverage.

Affected selection chose inventory, frontend, performance, and Fastify lanes;
smoke was run explicitly. Current-only compatibility passed 18/18 and matched
16 cells plus the healthy cluster-10 regressions. Full differential
compatibility remains prerequisite-blocked by the absent exact
`/home/codex/risu-baseline-71c476e9c` worktree. No substitute checkout was used
and no golden or compatibility fixture was refreshed.

Fresh Vitest/Playwright listings and green measured results produce 700 live
test/spec owners and 10,170 collected cases, with one direct-only skip and 1,319
parameterized rows. Primary categories are A=21, B=39, C=62, D=111, E=101,
F=84, G=108, H=26, I=39, J=42, K=25, and L=42. Live decisions are 586 Keep,
82 Reclassify, and 32 Pending. Support artifacts are 252 standalone and 64
mixed production seams.

Eleven Phase 11 findings are done. `TSA-P11-012` routes request-abort, limits,
and runtime observability to Phase 12; streaming/materialization, central
asset-owner parity, and bounded browser import/restore composition to Phase 13;
and independent historical fixture plus final residual-support decisions to
Phase 14.

## Phase 12 Evidence

### Opening review and focused remediation

Phase 12 opened with 42 category-L owners and 432 cases: 21 frontend files /
162 cases and 21 Fastify files / 270 cases, including 81 parameterized rows.
Read-only parallel review covered composition, auth/sandbox, egress/client
protocol, and resource budgets. One of eight Luna research tasks returned a
complete composition report; seven timed out, so the successful evidence was
preserved and the timed-out work was not represented as complete. Three
focused read-only subagent reviews then cross-checked the remaining boundaries
before scoped implementations were integrated as separate commits.

Focused remediation commands passed throughout:

- auth/config/sandbox hardening: 47/47;
- reviewed route auth/writer exceptions: 16/16;
- DNS-pinned local stream targets/routes: 82/82;
- browser proxy classification/parser/cancellation: 50/50;
- import abort and no-side-effect ordering: 70/70;
- completion/backpressure/job lifetime/snapshot budgets: 190/190;
- executable category boundaries and linked inventory: 13/13.

The fixes constrain development auth bypass to loopback, reject whitespace-only
password setup, make sandbox replacement symlink/canonical-overlap safe, pin
every local-stream DNS/redirect connection, terminate abandoned browser proxy
jobs, reject malformed WebSocket frames, cancel post-upload imports before
destructive replacement, bound completion output/backpressure, enforce a direct
absolute job lifetime, and cap durable terminal snapshots before side effects.

### Exact reviewed set

Commands:

```sh
mapfile -t phase12_frontend < <(jq -r '
  .rows[] |
  select(.primaryCategory == "L" and (.lane | startswith("frontend"))) |
  .file' docs/plan/test-suite-effectiveness-audit/inventory.json)
RISU_TEST_INCLUDE_GATES=true pnpm exec vitest run \
  "${phase12_frontend[@]}" --config vitest.config.ts

mapfile -t phase12_server < <(jq -r '
  .rows[] |
  select(
    (.primaryCategory == "L" or
      .file == "server/fastify/__tests__/echo.test.ts") and
    .lane == "fastify-node"
  ) | .file' docs/plan/test-suite-effectiveness-audit/inventory.json)
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  "${phase12_server[@]}"
```

The exact final review set passed 173/173 frontend cases across 21 files and
285/285 Fastify cases across 21 files. The eight-case echo owner is included in
this completed set but now routes to G because generation/provider compatibility
is its dominant product risk. Current L is 41 owners; the completed Phase 12
record remains 42 owners / 458 cases.

### Complete gates

Commands:

```sh
pnpm test:frontend:all
pnpm test:server
pnpm test:gates:perf
pnpm check
pnpm check:server
pnpm test:smoke
pnpm test:compat-current
pnpm test:compat-harness
pnpm test:affected --dry-run --base 527682a48
pnpm check:test-inventories
pnpm format:check
git diff --check
```

The complete frontend universe passed 6,777/6,777 cases across 538 files.
Complete Fastify passed 3,387 cases across 155 files with the one intentional
direct-only Realm scale skip. The two isolated performance owners passed 6/6.
Frontend, protocol, client-declaration, Fastify, and browser-smoke typechecks
reported zero diagnostics.

The production smoke build passed with the existing allowed CSS,
externalization, plugin-timing, and chunk-size diagnostics. All 35/35 Chromium
journeys passed in 1.1 minutes. Smoke supplies shipped-app composition but does
not claim a real VAPID provider, external MCP/provider service, other browser
engines, deployment proxy, or mid-stream multi-gigabyte import/export behavior.

Affected selection found 29 changed paths relative to the Phase 11 closeout and
selected inventories, frontend, performance, and Fastify lanes; each selected
lane passed. Current-only compatibility passed 18/18 and matched 16 cells plus
the healthy cluster-10 regressions. Full differential compatibility remains
prerequisite-blocked by the absent exact
`/home/codex/risu-baseline-71c476e9c` worktree. No substitute checkout was used
and no golden or fixture was refreshed.

Fresh Vitest/Playwright listings plus preserved measured skip metadata produce
700 live owners and 10,200 collected cases, with one direct-only skip and 1,326
parameterized rows. Primary categories are A=21, B=39, C=62, D=111, E=101,
F=84, G=109, H=26, I=39, J=42, K=25, and L=41. Live decisions are 617 Keep
and 83 Reclassify; no owner remains Pending. Support artifacts remain 252
standalone and 64 mixed production seams.

Eleven Phase 12 findings are done. `TSA-P12-012` routes large-entry
streaming/materialization, absolute response budgets, structural route capture,
bounded real browser/service composition, and cross-suite consolidation to
Phase 13; Phase 14 owns final historical, external-service, cross-browser, and
residual-support verdicts.

## Phase 13 Evidence

### Bounded synthesis and remediation

The required read-only parallel Luna synthesis completed 8/8 broad tasks, then
4/4 concise follow-ups cross-checked the actionable conclusions. No live test
pair met the mandatory Merge proof; no orphan fixture/golden/snapshot or
evidence-backed mega-suite split was found. The one approved cleanup was the
hidden resource-database bootstrap adapter. Concrete drift/capacity gaps were
legacy preset `additionalParams`, the duplicated persisted asset-owner
vocabulary, whole-asset local-backup materialization, and visible browser
backup-restore composition. A second independent subagent pass implemented and
cross-checked the three overlapping backend/browser changes without committing
or overwriting shared work.

Focused proof passed:

- resource-adapter removal and six-consumer migration: 9 owners / 582 cases;
- preset selection: complete commands owner / 224 cases;
- shared asset vocabulary: 3 owners / 28 cases;
- streamed local-backup staging and owning import/export routes: 90 cases;
- settings authoring → local-backup download → conflicting edit → visible
  restore → authoritative resync → full reload: owning browser spec 6/6;
- repeated server/browser typecheck, targeted Prettier, and diff checks.

The resource migration keeps real bootstrap JSON untouched, uses explicit
settings/collections/characters composition behind the existing equal-revision
fence, and preserves the browser-shaped fetch reader. Production bootstrap has
an initialized no-`database` assertion and repository search finds no installer
symbol. ZIP/legacy asset staging uses multi-megabyte positive probes plus
pre-allocation database-cap, hash-mismatch, and abort-cleanup negatives.

### Affected and live inventory proof

Commands:

```sh
pnpm test:affected --dry-run --base 936427e5f
pnpm update:frontend-test-inventory
pnpm check:test-inventories
pnpm test:affected --base 936427e5f --include-smoke
```

The first inventory check failed closed because the new 90-second browser case
shifted a checked line-level capability signal. Regenerating the reviewed TSV
changed only that exact browser-smoke line; all later inventory checks passed.
Affected selection widened the 18-path Phase 13 code/test set to inventories,
ordinary frontend, isolated performance, complete Fastify, and browser smoke.
Results were 6,771/6,771 ordinary frontend, 6/6 performance, 3,398 passed plus
the one intentional Realm skip across 155 Fastify owners, and 36/36 Chromium
journeys. The production smoke build emitted only the existing CSS,
externalization, plugin-timing, and chunk-size diagnostics.

Fresh Vitest and Playwright JSON listings independently collected 700 owners
and 10,211 ordinarily listed cases / 1,331 parameterized rows. Preserving the
separately measured direct-only Realm case produces the checked final total of
10,212 cases, one skip, and 1,332 parameterized rows. The only deltas are
commands `+1`, local-backup database parity `+1`, bundle import `+9`, and browser
smoke `+1`; no owner was added or removed. Categories remain A=21, B=39, C=62,
D=111, E=101, F=84, G=109, H=26, I=39, J=42, K=25, and L=41. Decisions remain
617 Keep / 83 Reclassify / zero Pending; support remains 252 standalone and 64
mixed production seams.

Seven Phase 13 findings are Done. `TSA-P13-008` defers only claims requiring
external/product authority or unavailable infrastructure: sanitized live or
recorded provider/media/Push and locally conformant MCP service evidence,
Firefox/WebKit/fault-injection lanes, historical baseline comparison, and a
streaming export-envelope design that does not make existing user data
unexportable. No substitute baseline, paid call, refreshed golden, or invented
response cap was used.

### Complete Phase 13 gates

`pnpm test:all` passed every lane in 4m 2.3s: inventory/routing 7.0s;
server/browser typecheck 17.7s; partitioned frontend 6,565/6,565 in 1m 20.8s;
Fastify 3,398 passed plus one intentional skip in 27.8s; direct Realm scale
1/1 in 2.7s; Chromium 36/36 in 1m 31.0s; zero-diagnostic frontend check in
30.7s; UI coverage 206/206 with 14.43% lines, 14.83% statements, 18.12%
functions, and 9.45% branches in 20.7s; format in 32.2s; and isolated
performance 6/6 in 12.3s. The ordinary/UI/performance partition accounts for
all 6,777 full frontend cases without duplicate execution.

`pnpm test:compat-current` passed 18/18 and matched 16 cells plus the healthy
cluster-10 regressions. `pnpm test:compat-harness` stopped before execution at
the unchanged missing prerequisite:
`/home/codex/risu-baseline-71c476e9c`. This is the only Phase 13 validation
blocker and applies only to historical comparison claims.
