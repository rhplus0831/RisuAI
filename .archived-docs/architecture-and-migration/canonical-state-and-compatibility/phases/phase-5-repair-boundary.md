# Phase 5: Repair Boundary

Status: complete through `223ff37d5`.

Depends on: canonical owners from Phases 2-4 for every affected helper.

## Objective

Move compatibility repair, stable-id minting, and pointer normalization out of
ordinary command paths into migration, import, or explicit recovery boundaries.

## Required Work

- Inventory command-called `ensure*` and `repair*` helpers by exact mutation
  range, including sibling collections and ids.
- Split validate-only command helpers from migration/recovery helpers
  structurally.
- Remove command-time sibling repair, ID minting, pointer normalization, and
  unrelated defaults unless the command explicitly owns that mutation.
- Preserve create-command initialization that is part of the declared new
  record, and explicit recovery actions classified by Phase 0.
- Add before/after database assertions proving unrelated records do not change.

## Safety Contract

Normal commands retain validation, atomicity, revision, one-event semantics,
receipts, idempotency, and rollback. Damaged state receives an explicit error or
recovery route rather than silent partial repair.

## Exit Criteria

- Ordinary commands are local, deterministic, and validate-only outside their
  declared mutation range.
- Every retained repair helper has a migration/import/recovery owner and test.
- Command tests prove no unrelated record/table changes.

## Validation

Focused command/database mutation-range tests, receipt/replay tests, migration/
recovery fixtures, complete server command lane, typechecks, formatting, and
diff checks.
