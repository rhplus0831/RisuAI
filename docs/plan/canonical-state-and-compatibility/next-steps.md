# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-30

## Current Gate

Wait for Workstream 1 to release its Phase 0 package/dependency conventions.
That decision controls where migration schemas, compatibility normalizers, and
shared fixtures may live. A later slice that introduces a shared contract must
also wait for that contract family's Workstream 1 Phase 1 release.

## First Task After Release

Execute the [compatibility surface inventory and disposition matrix](phases/slices/phase-0-compatibility-inventory-and-retention-policy/compatibility-surface-inventory.md).

1. Inventory fields, tables, routes, commands, adapters, fallback reads,
   projections, boot repairs, import normalizers, exports, backups, and recovery
   actions for model, prompt, translator, and candidate smaller mirrors.
2. Assign exactly one disposition to every surface.
3. Record current precedence plus missing/null/malformed, downgrade/export,
   failure, interrupted-migration, and damaged-database behavior.
4. Name real historical fixtures and their provenance; do not substitute newly
   invented fixtures for all history.
5. Record the Workstream 3 hold/release cursor for every resource family.

## Required Scope Before Editing

The slice must identify inventory schema/path, classification vocabulary,
historical references, decision owner, validation commands, and why it makes no
runtime mutation. Runtime migration belongs in later slices.

## Not First

- Do not invoke or extend the legacy model-conversion command as an automatic
  migration before precedence and rollback are locked.
- Do not remove resolver fallback, aggregate `promptTemplate`, translator
  scalars, SQLite tables, or `ensure*` helpers.
- Do not remove a Workstream 3 bridge for the same resource family.
- Do not treat import/export compatibility as normal-runtime ownership.
- Do not activate Workstream 4.

## Handoff

After Phase 0 acceptance, update [`status.md`](status.md), refresh
[`latest-verification.md`](latest-verification.md), then open the migration and
recovery foundation before any resource-family data rewrite.
