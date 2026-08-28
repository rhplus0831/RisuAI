# Phase 0 Slice: Baseline And Classification

Status: Complete

## Scope

- Ratify the capability, routing, and setup decisions.
- Add a source-controlled classifier and exhaustive/disjoint discovery checker.
- Generate the full per-file inventory without migrating existing tests.
- Establish the same-host cold and three-run warm baseline.
- Name the Phase 1 pilots.

## Source Anchors

- `vitest.config.ts`, `vitest.node.config.ts`, and `vitest.dom.config.ts` own the
  unchanged two-project topology.
- `vitest.node-tests.ts` and `vitest.ui-coverage-tests.ts` own the legacy Node
  and UI-map inventories.
- `util/test-all.ts` owns the aggregate ordinary/UI-map/performance partition.
- `util/frontend-test-inventory.ts` owns the Phase 0 proof and classifier.
- `../phase-0-classification.md` owns the ratified classification decisions.

## Runtime And Ownership

- Current runtime: explicit Node allowlist plus Happy-DOM fallback, with
  Playwright browser smoke separate.
- Target runtime: N, S, D, or B as recorded per file in the inventory.
- Ownership changes: none for pre-existing tests. The new checker unit test is
  assigned to Node.

## Invariants

- The configured project union equals an independent filesystem universe.
- Every file is assigned once in full, standalone ordinary, and aggregate
  ordinary views.
- UI-map and performance files retain their separate aggregate ownership.
- Static classification never migrates a file or weakens a visible-state
  contract.
- Isolation and DOM unexpected-fetch protection remain unchanged.

## Performance Mechanism

This is a proof slice, not an optimization slice. Its measurements establish
the reference against which later project migrations are evaluated.

## Validation

- `pnpm exec vitest run --project frontend-node util/frontend-test-inventory.test.ts`
- `pnpm check:frontend-test-inventory`
- cold-cache plus three warm ordinary frontend measurements
- independent Node and Happy-DOM measurements
- `pnpm coverage:ui-map`
- `pnpm test:all --dry-run`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`

Exact results are in [`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the checker scripts, generated inventory, classifier test, and new Node
allowlist entry. Runtime configuration and all pre-existing ownership remain as
they were before the slice.
