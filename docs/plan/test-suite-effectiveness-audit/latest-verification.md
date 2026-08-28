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

Result: passed. The current aggregate reports nine lanes: frontend routing,
server/browser typecheck, frontend tests, isolated server tests, isolated
browser smoke after server check, frontend check, UI coverage after frontend,
format check, and isolated frontend performance gates.

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

Results: 6/6 policy cases and the nine-lane dry run passed. Two cases take the
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
