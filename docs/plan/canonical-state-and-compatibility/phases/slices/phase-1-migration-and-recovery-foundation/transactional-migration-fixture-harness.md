# Transactional Migration And Historical-Fixture Harness

Status: complete at `1e758cd22`.

Parent: [Phase 1](../../phase-1-migration-and-recovery-foundation.md)

Depends on: Phase 0 matrix at `cd04b0e11f2c8629e988af1ef6c99a2646a746f1`.

## Objective

Prove a reusable, versioned, transactional, idempotent, restart-safe migration
boundary and historical-fixture harness before model, prompt, or translator
state is rewritten.

## Scope

- The migration runner and schema/domain version records in
  `server/fastify/src/db.ts`.
- Test-only failure injection that cannot enter production configuration.
- Historical fixture adapters named by `compatibility-baseline.json`.
- Pre-migration backup, restore, reopen, WAL/checkpoint, and database-lineage
  proof used by later domain migrations.
- Explicit refusal/diagnostics for damaged state outside the supported automatic
  migration envelope.

## Behavior Contract

- No model, prompt, translator, or smaller-mirror owner changes in this slice.
- A successful migration advances its version atomically; a failed step exposes
  neither its writes nor its version.
- Retrying interrupted work is safe and produces the same authoritative state.
- Startup migrations emit no user command receipt or misleading mutation event.
- Restore never rewinds lineage, writer epoch, receipts, or event history
  independently of the authoritative restore protocol.

## Validation

- Focused migration rollback/retry/reopen and fixture-harness tests.
- Existing DB, legacy import, RisuSave, backup/restore, and lineage owners.
- User/CI complete server and aggregate evidence because the migration boundary
  is cross-domain.
- `pnpm check:server`, Prettier, and `git diff --check`.

## Done When

- Every Phase 0 historical fixture can enter the common harness.
- Failure before commit leaves the prior state and version intact.
- Completed and interrupted steps are idempotent across reopen.
- Backup/restore and lineage proofs pass.
- Phase 2–4 resource rewrites may rely on the foundation without introducing
  command-time repair.

## Result

- The 33-step production catalog is checked for contiguous versions, stable
  names, valid naming, and duplicate names on every migration run.
- A test-only SQLite trigger injects failure after step writes and before the
  version update; rollback, retry, revision preservation, and reopen are proven
  without a production failure-injection option.
- Existing databases with missing/malformed schema identity or incomplete
  current tables now fail closed with an explicit damaged-database refusal
  instead of being opportunistically treated as fresh/current.
- All 19 Phase 0 surfaces enter a common fixture adapter with an owning server,
  frontend, or compatibility lane.
- Existing backup checkpoint, safety snapshot, restore rollback, database
  lineage, receipt, and event-history proofs passed unchanged.
