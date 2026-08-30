# Canonical State And Compatibility Retirement Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `1e758cd22`
- Phase 0 predecessor: `cd04b0e11f2c8629e988af1ef6c99a2646a746f1`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Workstream 1 convention release: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 1 migration/recovery foundation. Existing-database startup now
  validates migration identity/current table completeness and refuses damaged
  state outside the automatic envelope. No model, prompt, translator, smaller
  mirror, revision, receipt, event, import/export, or canonical owner changed.

## Foundation Proof

- All 33 production migration steps have contiguous versions, unique stable
  names, and a closed current-version relation checked on every run.
- A test-only SQLite trigger fails after a named step's writes and before its
  schema-version update. The step writes and version both roll back; revision
  41 remains unchanged; removal of the trigger permits retry; a second reopen
  is a no-op.
- Existing databases missing the schema table/singleton or required current
  tables receive an actionable `DamagedDatabaseRefusalError`; fresh database
  creation remains supported.
- All 19 Phase 0 surfaces map into the common historical-fixture adapter with a
  server, frontend, or current-compatibility verification command.
- Existing WAL checkpoint, safety snapshot, restore rollback, database-lineage,
  receipt, writer, and command-event history behavior passed without changes.

## Commands And Results

- Focused migration/database/missing-database suites passed: 3 files and 40
  tests.
- Focused legacy db.json import passed 4 tests; focused backup/WAL/restore/
  lineage coverage passed 7 tests.
- `pnpm check:server` passed protocol, architecture inventory, client
  declarations, Fastify, and browser-smoke typechecks.
- Historical `pnpm test:affected` (now retired) passed 2 frontend files/30 tests, 113 server files/2,494
  tests plus one skip, and the current 16-cell compatibility harness.
- Historical `pnpm test:server` (now retired) passed the complete 179-file server lane with 3,655 tests
  plus one skip.
- `pnpm test:watch:status`, focused Prettier, and `git diff --check` passed.
- `git diff --check` — passed.

## Verdict

Phase 1 passes. Named migrations are fail-closed, atomic, restart-safe, and
fixture-backed, while backup/restore and lineage behavior remains authoritative.
No canonical resource owner is released yet. Phase 2 may begin with the flat
model configuration migration.
