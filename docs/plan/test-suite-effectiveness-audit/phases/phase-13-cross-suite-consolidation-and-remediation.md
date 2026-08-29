# Phase 13: Cross-Suite Consolidation And Remediation

Status: In progress; all domain inventories from Phases 2-12 are complete and
the bounded synthesis entry gate is satisfied.

## Objective

Resolve only the cross-category decisions that could not be safely completed
inside a domain phase: equivalent duplication, shared harnesses, client/server
parity, mega-suite boundaries, remaining removals/replacements, and material
coverage gaps.

This is a bounded synthesis phase, not a second repository-wide audit.

## Scope

- Reconcile duplicate-contract findings across unit, storage, API, DOM, browser,
  compatibility, security, and performance layers.
- Merge repeated race/focus/rollback/provider/route matrices only when failure
  modes and lifecycle ownership are equivalent.
- Split mega-suites when independent failures or mocks obscure ownership; do not
  split mechanically by `describe` count.
- Consolidate shared fixtures/helpers/oracles where current copies can drift,
  while preserving per-file isolation and clear failure diagnostics.
- Add or generate shared parity contracts for typed routes, SSE vocabulary,
  provider capabilities/options, prompt/lore semantics, preset schemas, and
  asset-owner catalogs where domain findings justify them.
- Implement remaining evidence-approved removals and clean orphaned support
  artifacts, routing entries, inventories, goldens, snapshots, and docs.
- Add bounded high-risk browser/integration proof prioritized by confirmed gaps,
  not by global coverage percentage.

## Entry Gate

- Every Phase 2-12 inventory row has a disposition.
- Every cross-category candidate has a stable finding ID, exact owner, and
  bounded action.
- No new broad category search is scheduled here.
- Critical/High findings are already resolved or explicitly owned by this phase.

## Required Outputs

- Final duplicate/defense-in-depth map and rationale.
- Completed removal and merge evidence packages.
- Shared parity/harness changes with negative self-proof where appropriate.
- Material gap closure or explicit deferred owner/revisit condition.
- Reconciled inventory, finding ledger, decision totals, file/case counts, and
  specialized ownership.

## Exit Criteria

- No unowned Pending decision remains.
- Every Remove/Merge decision is implemented or rejected with evidence.
- No orphaned helper, fixture, registration, coverage owner, golden, snapshot,
  screenshot, or test-only export remains after accepted cleanup.
- Retained defense in depth is documented so future audits do not reclassify it
  as accidental duplication.
- Shared parity and harness changes have positive and negative proof.
- All Critical/High findings are Done or Deferred only under an explicit
  authority/external dependency with a concrete revisit condition.

## Validation

- Focused tests for every changed family
- `pnpm check:frontend-test-inventory`
- `pnpm test:affected --dry-run` and every selected lane
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:compat-harness` when affected and prerequisites are available
- `pnpm test:smoke`
- `pnpm check` and `pnpm check:server`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`
