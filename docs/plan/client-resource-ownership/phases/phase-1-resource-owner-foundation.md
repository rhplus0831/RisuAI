# Phase 1: Resource-Owner Foundation

Status: active.

Depends on: Phase 0 inventory and per-family Workstream 1 contract availability.

## Objective

Fill owner-specific selector, hydration, command, optimistic, draft, rollback,
error, and test gaps so later migrations never reach through the compatibility
facade.

## Required Work

- Define narrow resource state/selectors with stable identity and scoped
  reactivity.
- Expose explicit unloaded/loading/ready/stale/error state and retry ownership.
- Provide command helpers with accepted/queued/failed outcomes, optimistic
  projections, current-attempt rollback, outbox keys, and writer-loss handling.
- Define owner-scoped drafts and lineage/writer fencing where editing requires
  them.
- Reuse common primitives only when they cannot return all resources or publish
  an any-resource epoch.
- Add owner-contract tests before consumer migration.

## Safety Contract

Foundation APIs preserve resource payloads, lazy body boundaries, command
routes, persistence/revisions/events, invalidation, cache, and authoritative
refresh. They may not broaden bootstrap or route requirements.

## Exit Criteria

- Eligible later phases can read and mutate through owner APIs without
  `getDatabase()`, trusted writes, bridge flushes, or a generic snapshot.
- Common APIs remain narrow and resource-keyed.
- Owner tests cover success, queued intent, failure rollback, stale response,
  writer loss, reload, and recovery.

## Validation

Focused owner/resource/command/outbox tests, affected frontend tests, contract
gates, typechecks, browser smoke for startup-sensitive foundations, formatting,
and diff checks.

Completed slice: [Owner API gap matrix and first foundations](slices/phase-1-resource-owner-foundation/owner-api-gap-matrix-and-first-foundations.md)
at `1727cbe35`.

Active slice: [Leaf setting owner contract](slices/phase-1-resource-owner-foundation/leaf-setting-owner-contract.md).
