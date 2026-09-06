# P01-S01: Frontend Discovery, Capability Routing, And Live Manifest

Date: 2026-08-29

Status: Complete.

## Exact Scope

This slice owns the root Vitest project/configuration files,
`vitest.frontend-routing.ts`, `vitest.performance-tests.ts`,
`vitest.ui-coverage-tests.ts`, the live frontend capability manifest,
`util/frontend-test-inventory.ts`, `util/affected-tests.ts`, `util/test-all.ts`,
their focused tests, checked audit manifests, package scripts, quality workflow,
and authoritative testing documentation. Global setup/mock semantics remain
P01-S02.

## Accepted Actions

- Moved the unchanged checked capability TSV from `.archived-docs` to
  [`../../../frontend-routing-inventory.tsv`](../../../frontend-routing-inventory.tsv)
  and updated every checker, affected owner, support manifest, and link.
- Closed `TSA-P01-001`: affected routing now covers protocol source/config,
  shared Fastify test support, support deletion, and rename-away deletion.
- Closed `TSA-P01-002`: independent filesystem owners now match resolved
  Fastify Vitest and Playwright discovery, alongside the three existing
  frontend project comparisons.
- Closed `TSA-P01-003`: the complete regular/isolated aggregate graph is
  validated, and every local lane has a checked CI command and required verify
  dependency. Initial preload remains the documented CI-only superset.
- Closed `TSA-P01-004`: local and CI now use the exact declared pnpm 11.23.0;
  the frozen lockfile installs unchanged.
- Closed `TSA-P01-005`: the focused UI coverage denominator excludes the exact
  28 checked test-only harness/stub owners while keeping the thresholds fixed.
- Closed `TSA-P01-006`: CI publishes the Phase 7 integration reports produced by
  normal smoke discovery and fails when expected smoke/UI artifacts are absent.
- Closed `TSA-P01-007`: current/cluster compatibility now runs independently of
  the missing historical worktree and preserves mismatch actuals for diagnosis.
- Closed `TSA-P01-008`: the 7,000-asset Realm case now has named isolated local
  aggregate and CI owners rather than an undocumented direct-only invocation.

No product behavior or existing test was removed. The runner/policy work gained
nine cases; live totals at slice close are 699 files and 9,985 cases.

## Closeout

- All 19 Category A files have complete Keep dispositions. Specialized product
  owners retain their later category review.
- Resolved discovery remains 538 frontend, 154 Fastify, and 7 browser files.
- The ten-lane aggregate graph and required CI jobs are checked for parity.
- Focused utility cases, changed/deleted planning counterexamples, live
  inventories, and aggregate lanes passed; final aggregate evidence is recorded
  in the Phase 1 verification section.
