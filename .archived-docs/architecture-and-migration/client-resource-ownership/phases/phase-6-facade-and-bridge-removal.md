# Phase 6: Facade And Bridge Infrastructure Removal

Status: complete through `f6dca576c`.

Depends on: Phase 0 inventory proves zero production consumer for every removed
facility and Phases 2-5 are complete.

## Objective

Delete compatibility state infrastructure after resource owners are the only
application API for server-backed data.

## Required Work

- Remove the aggregate compatibility proxy and `getDatabase()` server-backed
  access path.
- Remove resource write guard, trusted-write API, facade/resource broad epochs,
  pending bridge flush registry, lifecycle flushing, and dead rollback helpers.
- Delete bridge modules and compatibility-only tests; replace retained assurance
  with owner-contract tests.
- Remove obsolete snapshot/projection glue while preserving explicit export or
  compatibility materialization classified as permanent.
- Re-run architecture/inventory gates to detect an aggregate replacement.

## Safety Contract

Infrastructure removal introduces no resource mutation, route, persistence,
revision, event, payload, or recovery behavior. If a consumer is discovered,
restore the facility and migrate that consumer in its owning phase.

## Exit Criteria

- Checked-in inventories report zero consumer and deleted facilities cannot be
  imported.
- Resource owners are the only normal browser state API for server-backed data.
- No generic snapshot, all-resource store, or any-resource epoch replaced the
  facade.
- Complete frontend and browser recovery/generation lanes pass.

## Validation

Architecture/inventory gates, complete frontend lane, owning server lane where
shared fixtures change, browser smoke, both typechecks, bundle checks,
formatting, and diff checks.
