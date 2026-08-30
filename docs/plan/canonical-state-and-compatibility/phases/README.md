# Canonical State And Compatibility Phase Guide

The phase files translate [`PLAN.md`](../PLAN.md) into bounded outcomes.
[`status.md`](../status.md) owns the current and per-resource dependency cursors.

## Execution Order

Phase 0 decides ownership and retention before runtime change. Phase 1 proves the
migration/recovery mechanism. Phases 2-4 migrate resource families and release
matching Workstream 3 cursors. Phase 5 removes command-time repair only after
canonical owners exist. Phase 6 closes interchange and obsolete storage. Phase
7 verifies and archives.

## Phase Index

- [Phase 0: Compatibility inventory and retention policy](phase-0-compatibility-inventory-and-retention-policy.md)
- [Phase 1: Migration and recovery foundation](phase-1-migration-and-recovery-foundation.md)
- [Phase 2: Model configuration ownership](phase-2-model-configuration-ownership.md)
- [Phase 3: Prompt-template ownership](phase-3-prompt-template-ownership.md)
- [Phase 4: Translator and smaller mirrors](phase-4-translator-and-smaller-mirrors.md)
- [Phase 5: Repair boundary](phase-5-repair-boundary.md)
- [Phase 6: Interchange, backup, and obsolete storage](phase-6-interchange-backup-and-obsolete-storage.md)
- [Phase 7: Verification and closeout](phase-7-verification-and-closeout.md)

## Slice Template

Use `phases/slices/phase-<n>-<slug>/<slice>.md`. Record status, owner, exact
cursors, surfaces/dispositions, historical fixtures and provenance, current and
target precedence, tables/records mutated, transaction and revision/event
behavior, interruption/restart/rollback behavior, old reader/exporter retained,
allowed files, validation, residual risk, Workstream 3 release, and stopping
condition.

## Common Entry Gate

- Workstream 1 conventions and the preceding migration/owner cursor are open.
- Phase 0 gives the exact resource family an accepted disposition.
- Historical fixtures and a pre-migration backup/old reader are available.
- The active slice is linked from `status.md`; Workstream 3 is not changing the
  same resource family.

## Common Exit Gate

- Migration is idempotent, atomic, restart-safe, and deterministic on fixtures.
- Canonical read/write behavior, commands, reload, export, and rollback pass.
- No stale mirror or fallback can affect normal runtime behavior.
- Residual compatibility surfaces and Workstream 3 release/hold are explicit.
- Exact proof is recorded in `latest-verification.md`.

See [`slices/README.md`](slices/README.md) for slice rules.
