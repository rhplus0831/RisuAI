# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-30

## Current Task

Execute the [transactional migration and historical-fixture
harness](phases/slices/phase-1-migration-and-recovery-foundation/transactional-migration-fixture-harness.md).

1. Make the domain migration runner expose focused, contiguous named steps with
   test-only failure injection at a transaction boundary.
2. Prove immediate-transaction rollback, schema/domain-version advancement,
   completed-step idempotency, interrupted retry, and reopen behavior.
3. Reuse the Phase 0 historical fixtures for model, prompt, translator, stable
   ids, legacy db.json, RisuSave, and backup/restore starting states.
4. Prove the pre-migration backup/restore and database-lineage behavior needed
   by Phases 2–4.
5. Keep damaged-database recovery explicit; the automatic migration runner must
   refuse corruption it cannot transactionally normalize.

## Phase 0 Release

`cd04b0e11` established 19 compatibility surfaces and 38 live probes. Runtime
rewrites may implement only the recorded disposition, precedence, failure,
fixture, rollback, and Workstream 3 hold/release for their row.

## Not In This Slice

- Do not migrate flat model configuration, prompt mirrors, or translator
  mirrors yet.
- Do not remove a compatibility reader, exporter, table, field, or route.
- Do not turn legacy conversion or damaged-state repair into an implicit normal
  command.
- Do not remove a Workstream 3 bridge for any resource family.

## Handoff

After the foundation passes, update [`status.md`](status.md), refresh
[`latest-verification.md`](latest-verification.md), and open the model
configuration migration as the first persisted-owner rewrite.
