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

No product behavior or existing test was removed. The affected policy gained
four cases; live totals are 699 files and 9,980 cases.

## Remaining Slice Gates

- Check resolved Fastify and Playwright discovery against independent tracked
  filesystem owners, matching the existing frontend proof.
- Validate the complete aggregate graph and local/CI owner parity.
- Ratify dispositions for every in-scope Category A test and runner/config
  support owner.
- Run representative changed/deleted dry-run cases, checked inventories, focused
  utility tests, and `pnpm test:all` before closing the slice.
