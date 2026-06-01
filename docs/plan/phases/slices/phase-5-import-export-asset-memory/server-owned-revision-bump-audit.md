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

All `bumpRevision()` callsites are now accounted for. The normal command helper
family already persists the command event in the same SQLite transaction as the
revision bump:

| Helper | Source | Event behavior | Proof |
| --- | --- | --- | --- |
| `applyTargetedCommandMutation()` | `server/fastify/src/commands/mutations.ts` | Bumps revision, persists the command event, commits, then emits live fanout. Used by targeted message and generation persistence paths. | `server/fastify/__tests__/commands.test.ts`, `server/fastify/__tests__/events.test.ts` |
| `applyMessageFreeJsonCommandMutation()` | `server/fastify/src/commands/mutations.ts` | Bumps revision, persists the command event, commits, writes message-free `db.json`, then emits live fanout. | `server/fastify/__tests__/commandMetrics.test.ts`, command route coverage |
| `applyJsonCommandMutation()` | `server/fastify/src/commands/mutations.ts` | Syncs message rows, bumps revision, persists the command event, commits, writes `db.json`, then emits live fanout. | `server/fastify/__tests__/commands.test.ts`, `server/fastify/__tests__/events.test.ts` |

The remaining server-owned revision bumps sit outside that helper family:

| Path | Revision bump | Event behavior | Current proof | Follow-up |
| --- | --- | --- | --- | --- |
| First-run state initialization | `initializeDefaultDatabase()` in `server/fastify/src/repository.ts`; route in `server/fastify/src/routes/commands.ts` | On an actual initialization, the route persists and emits `state.initialized`. Existing databases do not bump and emit no event. | `server/fastify/__tests__/commands.test.ts` checks the returned event. | Include in `server-owned-event-atomicity.md` because the event is persisted after the helper returns. |
| `.risu` import | `applyImport()` in `server/fastify/src/repository.ts`; route in `server/fastify/src/routes/save.ts` | The route persists and emits `state.imported` for multipart and JSON imports. Export routes emit live-only `state.exported` without a revision bump. | `server/fastify/__tests__/risuSaveImportRoute.test.ts` checks `state.imported`; export live-only notifications are non-domain exceptions. | Include in `server-owned-event-atomicity.md`; import also remains covered by `expanded-import-size-limits.md` for memory pressure. |
| Asset upload and bulk upload | `addAssets()` in `server/fastify/src/repository.ts`; route in `server/fastify/src/routes/assets.ts` | Newly created assets get one persisted/live `asset.created` event at the bumped revision. Deduped uploads do not bump and emit no event. | `server/fastify/__tests__/assets.test.ts` checks single and bulk `asset.created` behavior. | Covered by `asset-mutation-transaction-protocol.md`; also include in `server-owned-event-atomicity.md` for the replay gap if event persistence fails after the bump. |
| Backup restore | `restoreBackup()` in `server/fastify/src/repository.ts`; route in `server/fastify/src/routes/backups.ts` | The route persists and emits `state.restored` after the restore revision bump. Backup create/delete do not bump the main projection revision. | `server/fastify/__tests__/backups.test.ts` checks the restore event and restored state. | Include in `server-owned-event-atomicity.md` because restore currently emits after the repository operation. |
| Realm packaged asset staging | `importStagedAssets()` in `server/fastify/src/routes/realmImport.ts` | Newly staged package assets persist and emit `asset.created`; the character append itself uses `applyJsonCommandMutation()` and emits `character.created`. | Covered indirectly by Realm import tests and command helper behavior. | Include staged asset writes in `asset-mutation-transaction-protocol.md` and `server-owned-event-atomicity.md`. |
| Realm fetched asset save | `addAsset()` through `saveFetchedAsset()` in `server/fastify/src/routes/realmImport.ts` | Newly fetched assets persist and emit `asset.created`; deduped assets do not bump or emit. | Covered indirectly by Realm import tests. | Same as asset upload. |

No happy-path replay event is missing for a revision-tracked projected mutation.
The open durability gap is atomicity: several server-owned paths can commit a
revision bump before the matching command event is persisted. If event
persistence fails in that window, later `/api/v1/events` replay can observe a
revision gap and force full bootstrap. That is recoverable, but not as clean as
the command helper contract.

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

Done. The tracked implementation follow-up is
[`server-owned-event-atomicity.md`](server-owned-event-atomicity.md), with asset
ordering details still owned by
[`asset-mutation-transaction-protocol.md`](asset-mutation-transaction-protocol.md).

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test`
