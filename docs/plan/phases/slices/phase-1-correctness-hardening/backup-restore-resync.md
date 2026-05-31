# Backup Restore Resync

Status: active priority.

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

## Protocol Behavior

- Either return a trusted restored projection and apply it, or force a read-only
  full bootstrap after restore succeeds.
- Do not advance the cached command revision in a way that causes the restore
  event to be skipped before projection state changes.
- Preserve active-writer protection for restore.

## Done When

- The active client reflects restored state immediately after a successful
  restore.
- The event echo cannot leave the browser on stale pre-restore projection.
- A test proves restore changes the active projection.

## Validation

- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
