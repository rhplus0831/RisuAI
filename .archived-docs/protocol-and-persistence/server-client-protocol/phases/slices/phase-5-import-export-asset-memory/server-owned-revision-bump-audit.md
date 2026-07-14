# Server-Owned Revision Bump Audit

Status: completed.

## Source Anchors

- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/realmImport.ts`
- `server/fastify/src/commands/events.ts`

## Scope

Inventory revision bumps outside the normal JSON command helper and prove each
one has a matching persisted command event or a documented live-only/non-domain
exception.

## Audit Result

All `bumpRevision()` callsites are accounted for.

Normal command helpers co-commit the revision bump and replayable command event:

- `applyTargetedCommandMutation()` for targeted message and generation writes.
- `applyMessageFreeJsonCommandMutation()` for message-free JSON commands such as
  settings, plugin storage, and chat metadata.
- `applyJsonCommandMutation()` for remaining hydrated JSON command families.

Server-owned mutation paths now have matching replay events or documented
non-domain exceptions:

| Path                                                 | Current contract                                                                                                                                                                                                   | Proof                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| First-run state initialization                       | `initializeDefaultDatabase()` persists `state.initialized` with the revision bump inside one SQLite transaction. Already-initialized databases do not bump or emit.                                                | `server/fastify/__tests__/commands.test.ts`            |
| `.risu` import                                       | `applyImport()` writes message rows and legacy memory backfill work, then persists `state.imported` with the revision bump before live fanout. The message-free `db.json` write still happens after SQLite commit. | `server/fastify/__tests__/risuSaveImportRoute.test.ts` |
| Asset upload and bulk upload                         | `addAssets()` stages content-addressed bytes/metadata, then persists one `asset.created` event with the revision bump. Command-event failure restores the previous manifest and removes new bytes.                 | `server/fastify/__tests__/assets.test.ts`              |
| Backup restore                                       | `restoreBackup()` restores SQLite tables, persists `state.restored`, and swaps `db.json`/asset/save directories inside the restore rollback boundary.                                                              | `server/fastify/__tests__/backups.test.ts`             |
| Realm packaged asset staging and fetched asset saves | Newly created assets emit persisted `asset.created` before live fanout; deduped assets do not bump or emit. Realm character creation itself goes through the normal command helper.                                | `server/fastify/__tests__/realmImport.test.ts`         |

The implementation follow-up from this audit,
[`server-owned-event-atomicity.md`](server-owned-event-atomicity.md), has
landed. Broader file/metadata ordering questions remain in
[`asset-mutation-transaction-protocol.md`](asset-mutation-transaction-protocol.md).

## Exceptions

- `state.exported` is a live-only export notification. Export routes do not
  mutate projected domain state, do not bump the repository revision, and do
  not persist command-event history.
- Memory progress events are non-domain job notifications and are outside the
  command-event replay contract.

## Protocol Behavior

- Preserve one replayable command event for every revision-tracked projected
  mutation.
- Explicitly document exceptions such as live-only export notifications or
  non-domain memory progress events.
- Connect this audit to asset, import, restore, and generation persistence
  durability work.

## Done When

- All non-`applyJsonCommandMutation()` revision bumps are listed.
- Each listed path has tests or documentation for event persistence and live
  fanout behavior.
- Missing replay records become tracked implementation slices.

Done. No happy-path replay event is missing for a revision-tracked projected
mutation.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test`
