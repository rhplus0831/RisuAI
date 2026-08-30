# Phase 0: Consumer, Facade, And Bridge Inventory

Status: complete at `0432b32ba1bcb7f8a3d5ca68a5605dd47a26857f`.

Depends on: portfolio activation; coordinate gate conventions with Workstream 1
Phase 0.

## Objective

Inventory every aggregate facade, snapshot, epoch, trusted-write, write-guard,
bridge, lifecycle flush, and temporary seam consumer; prevent the inventory from
growing.

## Required Work

- Classify production, test, and browser-smoke consumers by resource family and
  read/mutation/render/hydration/draft/generation/recovery/diagnostic role.
- Assign target owner API, migration phase, Workstream 1/2 dependencies, and
  removal/review trigger.
- Record route payload, lazy body, startup, event, draft, and rollback
  dependencies for each family.
- Add fail-closed gates for new aggregate reads, trusted writes, bridge families,
  broad epochs, and temporary compatibility seams.

## Exit Criteria

- Every compatibility consumer has one target owner and dependency cursor.
- Exact counts are reproducible and checked in.
- Required quality lanes reject new or widened consumers.
- Phase 1 gaps and first eligible leaf families are explicit.

## Validation

Focused gate tests, existing facade/guard/bridge/resource structural tests,
affected tests, typechecks if orchestration changes, formatting, and diff checks.

Active slice: [Facade and bridge consumer baseline](slices/phase-0-consumer-facade-and-bridge-inventory/facade-and-bridge-consumer-baseline.md).

## Result

- The checked-in baseline classifies 9,917 references in 325 consumer groups,
  56 family/role policies, six bridge families, and 20 temporary-seam rows.
- The mandatory architecture gate rejects unreviewed aggregate reads or
  replacements, snapshots/proxies, broad epochs, trusted writes, write-guard
  control, bridge registry/lifecycle, flush infrastructure, and temporary-seam
  growth.
- Production, server, and test lanes are distinguished, and every group names a
  target owner, Workstream 1/2 dependency, migration phase, and removal trigger.
