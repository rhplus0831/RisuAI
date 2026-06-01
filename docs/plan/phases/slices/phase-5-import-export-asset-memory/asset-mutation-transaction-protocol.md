# Asset Mutation Transaction Protocol

Status: implemented.

## Source Anchors

- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/db.ts`
- `server/fastify/src/commands/events.ts`

## Scope

Make asset mutation durability explicit across file writes, metadata writes,
SQLite revision bumps, command-event persistence, and live fanout.

Current behavior: asset upload, bulk upload, Realm staged assets, and Realm
fetched assets now persist the revision bump and `asset.created` command event
together, then fan out live. If command-event persistence fails after new bytes
or metadata are staged, the implementation restores the prior manifest and
removes newly created files. Upload and bulk upload also remove newly staged
content-addressed files when a later file write or `db.json` metadata write
fails before the revisioned event can commit. Existing missing-blob repair keeps
its no-revision behavior: re-uploading bytes already present in metadata may
restore the immutable file without creating a new event.

## Protocol Behavior

- Asset metadata remains in `db.json`; upload and bulk upload use a
  command-like recovery rule for failures between file staging, `db.json`,
  revision, and event steps.
- Preserve content-addressed asset ids and immutable public reads.
- Keep asset upload active-writer guarded.

## Done When

- Asset mutation has a documented ordering contract. Done.
- Tests cover failure or recovery behavior where practical. Done.
- Asset events remain replayable when they bump revision. Done.

## Validation

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- Repository tests for selected transaction or recovery behavior.
