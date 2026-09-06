# Phase 0: Baseline And Classification

Status: Complete

## Objective

Create a reproducible performance/correctness baseline and an exhaustive test
capability inventory before changing project ownership.

## Scope

- Ratify N, S, D, and B capability definitions from `../plan.md`.
- Decide the long-term suffix/manifest routing contract and transitional legacy
  mechanism.
- Enumerate every frontend test file and its current project.
- Produce a candidate target class with an evidence-backed reason for each file.
- Identify ambiguous files that require a probe or production seam extraction.
- Add or specify an executable completeness proof that the configured project
  union is exhaustive and disjoint.
- Establish the formal timing procedure and same-host baseline.
- Rank the first representative pilot files without migrating them.

## Required Inventory Fields

For each file, record:

- current project;
- proposed capability class;
- Svelte imports or rune/store requirements;
- DOM/browser globals or component mounting;
- explicit storage, network, timer, filesystem, or Fastify harness dependencies;
- coverage/gate ownership;
- ambiguity or migration blocker;
- owning domain and suggested slice.

The inventory may be generated, but its classification rules and exceptions must
be reviewable in source control.

## Measurement Procedure

- Record the commit, Node/pnpm/Vitest versions, CPU count, and working-tree state.
- Capture three warm standalone ordinary frontend runs; report median and range.
- Capture one separately labeled cold-cache run.
- Record file/test counts, project distribution, Vitest phase totals, wall time,
  user/system CPU, average CPU, and peak RSS.
- Measure Node and Happy-DOM projects independently.
- Record focused UI coverage and complete `test:all` results.
- Store only compact durable summaries in the plan; do not commit large raw JSON
  or transient profiler output unless a later tool consumes it.

## Initial Pilot Selection

Choose a small set containing:

- an obvious pure TypeScript N file;
- a Svelte/rune/store S file with no DOM behavior;
- a mounted or visible-state D file;
- one ambiguous file whose current dependencies test the classifier.

Avoid mega-suites, persistence-heavy bridges, and production refactors in the
first topology pilot.

## Exit Criteria

- Capability definitions and routing mechanism are ratified.
- The current discovered universe is recorded.
- Every current file has a target class or an explicit ambiguous/blocker state.
- Exhaustive/disjoint discovery proof is designed and preferably landed against
  the unchanged two-project topology.
- Formal baseline median/range and resource measurements are recorded in
  `../latest-verification.md`.
- Primary/stretch budgets are updated from the formal median.
- Phase 1 pilot files and expected setup requirements are named.
- `../status.md` is updated and Phase 1 has no unresolved classification blocker.

## Validation

- `pnpm test:frontend`
- `pnpm coverage:ui-map`
- `pnpm test:all --dry-run`
- `pnpm test:all`
- Focused tests for the inventory/completeness tool
- `pnpm format:check`
- `git diff --check`

## Outcome

The ratified decisions and inventory are in
[`../phase-0-classification.md`](../phase-0-classification.md). The concrete
proof slice is
[`slices/phase-0/baseline-and-classification.md`](slices/phase-0/baseline-and-classification.md),
and exact measurements are in `../latest-verification.md`.
