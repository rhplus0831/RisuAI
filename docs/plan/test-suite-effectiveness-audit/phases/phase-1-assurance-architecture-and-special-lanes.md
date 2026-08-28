# Phase 1: Assurance Architecture And Special Lanes

Status: Pending; depends on Phase 0.

## Objective

Prove that the test system discovers, routes, isolates, schedules, and reports
the intended evidence without omissions, double execution, misleading globals,
or self-invalidating harnesses.

## Scope

- Root frontend, Fastify, and Playwright configs and setup environments.
- Capability routing, legacy DOM registrations, inventory checks, and filename
  contracts.
- Affected-test selection, deletion widening, aggregate ordering/isolation, and
  local/CI parity.
- UI audit, focused UI coverage, broad coverage, performance gates, startup
  matrices, direct-only scale tests, and screenshot baselines.
- Compatibility baseline/current runners, normalization, fixtures, goldens, and
  external-worktree prerequisites.
- Shared server helpers, frontend test harnesses, fixture loaders, test-only
  exports, global mocks, unexpected-fetch protection, and cleanup.
- Mega-suite and browser-fixture organization where harness structure obscures
  failure ownership.

## Audit Questions

- Is discovery exhaustive and disjoint in every command view?
- Can a test pass under the wrong runtime because setup supplies unrelated
  globals or mocks?
- Do affected routing and CI run every lane implied by a changed or deleted
  owner?
- Are specialized gates measuring production contracts rather than test harness
  internals or distorted denominators?
- Do shared helpers preserve the current production wire/storage shape?
- Does compatibility normalization remove nondeterminism without hiding semantic
  differences?
- Are browser fixtures isolated enough to reproduce failures independent of file
  or case order?

## Required Outputs

- Dispositions for every assurance-category test and support artifact.
- An explicit list of global mocks and the production semantics they may hide.
- Special-lane owner map, including ordinary/aggregate inclusion and CI status.
- Compatibility and golden-governance verdict.
- Shared-helper consumer map and orphan/stale-helper findings.
- Confirmed gaps in discovery, scheduling, isolation, artifact reporting, or
  failure diagnostics.

## Exit Criteria

- Every runner/setup/helper/gate/compatibility owner has a disposition.
- Full and special inventories remain exhaustive and intentionally disjoint.
- No confirmed missing or double-executed test owner remains.
- Any harness flaw that can invalidate later audit evidence is fixed before
  Phase 2.
- Test deletions and runner/gate changes have complete affected and aggregate
  proof.
- Remaining infrastructure gaps have owner, reason, and revisit condition.

## Validation

- Focused util, root Vitest setup/routing, server-helper, and harness tests
- `pnpm check:frontend-test-inventory`
- `pnpm test:affected --dry-run` across representative changed/deleted owners
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:compat-harness` when prerequisites are available
- `pnpm test:smoke`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`
