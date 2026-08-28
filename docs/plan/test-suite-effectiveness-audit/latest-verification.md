# Test Suite Effectiveness Audit Verification

Date: 2026-08-29

This file records reproducible command evidence for the workstream. Phase 0 has
not yet established the formal test-case, duration, coverage, and support-file
baseline. The entries below validate only the planning anchor and current runner
topology.

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

Pending. Phase 0 must record:

- commit and working-tree state;
- Node, pnpm, Vitest, Playwright, and Chromium versions;
- filesystem and runner discovery for every required and opt-in lane;
- file, case, skip, and parameterized-matrix counts;
- runtime and resource measurements for required lanes;
- frontend/backend broad coverage reports and focused UI thresholds;
- direct-only stress and compatibility prerequisites/results;
- support-artifact inventory and per-category totals;
- any red baseline with exact failure ownership.
