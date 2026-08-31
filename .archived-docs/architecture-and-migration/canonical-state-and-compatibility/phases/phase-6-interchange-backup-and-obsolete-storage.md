# Phase 6: Import, Export, Backup, And Obsolete Storage

Status: complete through `49c9c6f3e`.

Depends on: replacement canonical readers/writers and their rollback proofs.

## Objective

Prove supported interchange and recovery through canonical state, generate old
fields only at explicit legacy export boundaries, and remove or quarantine
obsolete storage after all live consumers are gone.

## Required Work

- Normalize every supported legacy input into canonical current state.
- Generate supported old fields only in explicit legacy export/codecs.
- Update current backup/restore allowlists, table ownership, compatibility files,
  asset/reference handling, and recovery journals.
- Remove or quarantine obsolete tables, columns, fields, command shapes, and
  routes only after current readers, old readers, and rollback proofs pass.
- Test current-to-current and current-to-supported-legacy round trips without a
  second normal-runtime owner.

## Safety Contract

Import and restore remain atomic, bounded, lineage-aware, and recoverable;
exports remain deterministic and do not leak newly canonical secrets. Storage
deletion is isolated from the first replacement migration slice.

## Exit Criteria

- Supported inputs normalize deterministically and exports round-trip as defined.
- Backup/restore includes every canonical owner and excludes obsolete state.
- All removed storage has no live consumer and a recorded rollback/archive path.

## Validation

Compatibility harness, current/historical import/export and backup/restore tests,
restart/recovery tests, asset integrity where relevant, server and browser
interchange lanes, typechecks, formatting, and diff checks.
