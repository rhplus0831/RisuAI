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
- CI uses pnpm 10; Phase 1 owns the local/CI package-manager skew verdict.

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
