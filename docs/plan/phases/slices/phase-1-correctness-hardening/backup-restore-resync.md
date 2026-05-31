# Backup Restore Resync

Status: implemented.

## Source Anchors

- `server/fastify/src/routes/backups.ts`
- `src/ts/server/backups.ts`
- `src/ts/globalApi.svelte.ts`
- `src/ts/bootstrap.ts`

## Scope

Ensure backup restore updates the active browser projection before the browser
continues editing at the restored revision. The audit found that the route
returns only revision/event, while the client can advance the cached revision
and then skip the restore echo.

Implementation batch:

- Source files: `src/ts/server/backups.ts`, `src/ts/server/projectionResync.ts`,
  `src/ts/server/bootstrap.ts`, `src/ts/bootstrap.ts`, and focused tests.
- Protocol surface: keep `/api/v1/backups/:id/restore` returning
  `{ revision, event }`; make the browser perform a trusted read-only bootstrap
  resync after a successful restore response.
- Revision/event behavior: do not cache the restore revision from the restore
  response alone; advance the browser command cursor only after the restored
  projection is applied.
- Rollback/resync behavior: if the restore succeeds but the follow-up bootstrap
  resync fails, surface an explicit partial-success error so the browser does
  not report a fully-loaded backup while still showing stale state.
- Proof command: run the backup route/helper tests and bootstrap projection
  tests listed below.

## Protocol Behavior

- Either return a trusted restored projection and apply it, or force a read-only
  full bootstrap after restore succeeds.
- Do not advance the cached command revision in a way that causes the restore
  event to be skipped before projection state changes.
- Preserve active-writer protection for restore.

## Done When

- [x] The active client reflects restored state immediately after a successful
      restore.
- [x] The event echo cannot leave the browser on stale pre-restore projection.
- [x] A test proves restore changes the active projection.

## Implementation Notes

- `restoreServerBackup()` keeps the restore route response as `{ revision,
event }`, but no longer caches that revision directly.
- After restore, the client runs a trusted read-only bootstrap resync through
  `forceServerProjectionResync('backup-restore')`.
- The resync fetch disables bootstrap revision caching until after the restored
  projection is applied, then refreshes active generation jobs and hydration
  caches.
- If the restore succeeds but the bootstrap resync fails, the helper reports a
  partial-success error so the UI does not show a successful load over stale
  state.

## Validation

- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/server/bootstrap.test.ts`
