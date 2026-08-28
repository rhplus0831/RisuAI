# P01-S01: Frontend Discovery, Capability Routing, And Live Manifest

Date: 2026-08-29

Status: In progress.

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

No product behavior or existing test was removed. The affected policy gained
eight cases; live totals are 699 files and 9,984 cases.

## Remaining Slice Gates

- Ratify dispositions for every in-scope Category A test and runner/config
  support owner.
- Run representative changed/deleted dry-run cases, checked inventories, focused
  utility tests, and `pnpm test:all` before closing the slice.
