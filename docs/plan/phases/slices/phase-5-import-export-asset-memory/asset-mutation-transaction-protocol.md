# Asset Mutation Transaction Protocol

Status: partially covered by server-owned event atomicity; broader asset
file/metadata ordering remains planned.

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
removes newly created files. This slice remains open for broader recovery rules
around file or `db.json` write failures outside that command-event window.

## Protocol Behavior

- Either move asset metadata to SQLite or document a command-like recovery rule
  for failures between file, `db.json`, revision, and event steps.
- Preserve content-addressed asset ids and immutable public reads.
- Keep asset upload active-writer guarded.

## Done When

- Asset mutation has a documented ordering contract.
- Tests cover failure or recovery behavior where practical.
- Asset events remain replayable when they bump revision.

## Validation

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- Repository tests for selected transaction or recovery behavior.
