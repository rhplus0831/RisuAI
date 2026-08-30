# Phase 2: Leaf Settings And Collection Resources

Status: active for the standalone `loreBookPage` pointer.

Depends on: Phase 1 owner APIs and per-family Workstream 1/2 releases.

## Objective

Migrate low-fanout, stable-id settings and collection resources before complex
editor and generation owners.

## Required Work

- Select only families with singular persisted ownership and complete owner APIs.
- Move reads, route hydration, commands, optimistic projection, drafts,
  accepted/queued/failed UI, rollback, reload, and tests together.
- Preserve stable ids, selection/order, cache hashes, invalidation keys, and
  route-specific loading.
- Remove that family's compatibility mutation path and bridge registration only
  after its final consumer moves and browser proof passes.
- Record reactive wakeups and payloads for representative list sizes.

## Safety Contract

No migration widens shell/bootstrap payloads or reports queued intent as
accepted. Command persistence, revision/event, receipt, outbox, and recovery
contracts remain unchanged.

## Exit Criteria

- Selected families have zero aggregate consumer and bridge fallback.
- Owner read/mutation/failure/rollback/reload/browser evidence passes.
- Inventory/gates and current resource docs reflect the new owner.

## Validation

Focused owner/command/resource tests, settings/collection UI tests, affected
frontend/server lanes, browser smoke for visible reload, payload/reactivity
measurements, typechecks, formatting, and diff checks.

Active slice: [Lorebook page consumer migration](slices/phase-2-leaf-settings-and-collections/lorebook-page-consumer-migration.md).
