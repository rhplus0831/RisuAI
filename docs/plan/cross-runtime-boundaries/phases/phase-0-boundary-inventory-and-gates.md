# Phase 0: Boundary Inventory And No-New-Debt Gates

Status: ready.

Depends on: portfolio activation only.

## Objective

Freeze a reproducible, classified view of every Fastify production, server-test,
and browser-smoke dependency on `src/`, then prevent the baseline from growing.

## Required Work

- Inventory static/dynamic imports, re-exports, aliases, type-only use, and
  TypeScript project references.
- Classify each edge as wire contract, pure behavior, application model, test
  fixture, server-only behavior, or accidental dependency.
- Inventory duplicated route, durability, stream, cache, resource, and event
  declarations.
- Give every edge a target owner, migration phase, exception owner, and review
  or removal trigger.
- Add an AST-backed grandfathered gate and capture the clean-worktree server
  typecheck/declaration inputs.

## Starting Anchors

- `util/check-server.ts`, `util/check-server.test.ts`
- `tsconfig.client-lib.json`, `server/fastify/tsconfig.json`,
  `tsconfig.browser-smoke.json`
- `packages/protocol/src/importBoundary.test.ts`
- `server/fastify/__tests__/protocolPackage.test.ts`
- `server/fastify/__tests__/routeProtection.test.ts`

## Exit Criteria

- The manifest is deterministic, reviewable, and complete for all three lanes.
- Every edge has one classification and destination.
- CI rejects new or widened unapproved edges and baseline changes are explicit.
- The current generated-declaration dependency is recorded without removing it.

## Validation

Focused gate tests, `pnpm check:protocol`, `pnpm check:server`, affected tests,
formatting, and `git diff --check`.

Active slice: [Boundary baseline and no-new-debt gate](slices/phase-0-boundary-inventory-and-gates/baseline-and-no-new-debt-gate.md).
