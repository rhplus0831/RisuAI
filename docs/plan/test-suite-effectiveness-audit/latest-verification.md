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
