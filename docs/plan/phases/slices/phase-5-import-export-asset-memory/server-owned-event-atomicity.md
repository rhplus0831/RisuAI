# Server-Owned Event Atomicity

Status: planned.

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

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`
