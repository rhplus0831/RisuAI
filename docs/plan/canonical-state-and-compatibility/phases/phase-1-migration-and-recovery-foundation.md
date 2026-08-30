# Phase 1: Migration And Recovery Foundation

Status: active.

Depends on: Phase 0 retention policies and historical fixtures.

## Objective

Standardize versioned, idempotent, transactional, restart-safe migrations for
the in-scope persisted domains before any compatibility owner is removed.

## Required Work

- Extend the migration runner in `server/fastify/src/db.ts` through focused,
  contiguous, named steps rather than boot-time opportunism.
- Prove immediate-transaction rollback, schema-version advancement, interrupted
  retry, WAL/checkpoint ordering where relevant, and database-lineage behavior.
- Define pre-migration backup and restore proof for each domain.
- Separate automatic current-schema migration from an explicit
  damaged-database recovery action.
- Provide fixture harnesses for every supported historical starting state.

## Safety Contract

A failed or interrupted migration leaves the previous authoritative state
readable or rolls back atomically. Migration produces no user command receipt or
misleading acceptance event; any startup revision/event behavior is explicit and
tested.

## Exit Criteria

- Every historical fixture has a deterministic result.
- Re-running a completed or interrupted migration is safe.
- Partial canonical state cannot become visible.
- Backup/restore and lineage tests pass before Phase 2-4 rewrites begin.

## Validation

Focused DB migration/rollback/reopen tests, backup/restore tests, compatibility
fixtures, server lane, typechecks, formatting, and diff checks.
