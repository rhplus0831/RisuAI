# Facade, Trusted-Write, And Bridge Consumer Baseline

Status: complete at `0432b32ba1bcb7f8a3d5ca68a5605dd47a26857f`.

Parent: [Phase 0](../../phase-0-consumer-facade-and-bridge-inventory.md)

Opening Fastify cursor: `c0df82d5240a29a33efa5995e08cc970e0147573`.

## Objective

Create a reproducible, classified consumer inventory and fail-closed gates before
any resource-family migration begins.

## Required Inventory

- `getDatabase()` and aggregate snapshot consumers;
- explicit any-resource/facade epochs and diagnostic subscriptions;
- trusted-write and write-guard enable/control calls;
- all `*Bridge.svelte.ts` families, registrations, flushers, and lifecycle flush
  callers;
- compatibility-only tests/fixtures versus production consumers;
- broad resource endpoints, rollout aliases, and observer-shell overrides;
- target owner API, resource family, Workstream 1/2 dependency, migration phase,
  and removal/review trigger.

## Allowed Changes

- A focused inventory/gate utility and machine-readable baseline.
- Tests for aliases, Svelte files, re-exports, dynamic imports, and classified
  exceptions.
- Existing structural/affected/CI integration only as needed to make the gate
  mandatory.
- Workstream status, phase, and verification records.

No production resource consumer or bridge moves belong in this slice.

## Behavior Contract

- Mutations: none.
- Persistence, receipt, revision, event, hydration, cache, and payload effects:
  none.
- Rollback: remove the inventory/gate together; no runtime rollback is needed.

## Validation

Focused inventory/gate tests, existing bridge/write-guard/resource structural
tests, `pnpm test:affected`, typechecks if orchestration changes, formatting, and
`git diff --check`.

## Done When

- The inventory is deterministic and every compatibility consumer has one
  resource family, target owner, dependency cursor, and phase.
- New aggregate reads, trusted writes, bridge families, facade epochs, or broad
  seams fail the required quality lane.
- Baseline updates require explicit reviewed diffs.
- `status.md` records exact counts and Phase 1 gaps.

Stop if a gate would require replacing a consumer, if parsing cannot distinguish
tests from runtime, or if a target owner depends on an unreleased Workstream 1/2
decision.

## Result

- `client-resource-baseline.json` records 9,917 exact references across 325
  grouped consumer records and 56 resource-family/role policies.
- Lane totals are 3,346 production, 6 server, and 6,565 test references.
- The inventory covers six bridge families and 20 temporary-seam rows containing
  28 exact references.
- `check:server` now runs the AST-backed client ownership check through the
  shared mandatory architecture gate; baseline changes require reviewed policy
  metadata rather than an inline allowlist.
- No runtime consumer, bridge, payload, persistence, revision, event, or
  hydration behavior changed in this slice.
