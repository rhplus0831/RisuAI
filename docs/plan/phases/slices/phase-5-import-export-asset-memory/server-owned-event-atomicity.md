# Server-Owned Event Atomicity

Status: completed.

## Source Anchors

- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/realmImport.ts`
- `server/fastify/src/commands/events.ts`

## Scope

Close or explicitly recover the gap where server-owned mutation paths can bump
the SQLite revision before the matching command event is persisted.

Implemented scope:

- First-run initialization persists `state.initialized` in the same SQLite
  transaction as its revision bump.
- `.risu` import persists `state.imported` in the same transaction as message
  extraction, legacy Hypa V3 memory replacement, and the revision bump; live
  fanout happens after the durable event exists.
- Asset upload and bulk upload persist `asset.created` in one revision/event
  transaction after staging content-addressed bytes and metadata; event
  persistence failure restores the previous asset manifest and removes newly
  created bytes.
- Backup restore persists `state.restored` inside the SQLite table-restore
  transaction and swaps files before commit; event or file-swap failure rolls
  SQLite back and restores the pre-restore asset/save directories.
- Realm packaged asset staging and fetched asset saves use the same
  persisted-event-before-live-fanout contract as normal asset uploads.

## Protocol Behavior

- Preserve one replayable command event for every revision-tracked projected
  mutation.
- Match the command helper contract where practical: revision bump and command
  event persistence should succeed or fail together inside one SQLite
  transaction.
- If a path cannot share one transaction because it swaps files or writes asset
  bytes, document and test the recovery behavior that prevents silent projection
  staleness.
- Keep live fanout after the durable mutation and persisted event succeed.

## Done When

- Initialization, import, asset upload, backup restore, and Realm asset staging
  have an explicit ordering contract.
- Tests cover command-event persistence failure or recovery behavior for the
  selected implementation path.
- Event replay either remains contiguous after successful revision bumps or
  intentionally forces a full-bootstrap recovery with documented diagnostics.

Done. Failure-injection coverage now verifies rollback/no-live-fanout behavior
for first-run initialization, JSON `.risu` import, asset upload, and backup
restore when inserting into `command_events` fails.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`

Latest validation:

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/assets.test.ts server/fastify/__tests__/backups.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/realmImport.test.ts --runInBand`
  - Passed: 82 test files, 1461 tests.
