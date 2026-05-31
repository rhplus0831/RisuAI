# Asset Mutation Transaction Protocol

Status: planned.

## Source Anchors

- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/db.ts`
- `server/fastify/src/commands/events.ts`

## Scope

Make asset mutation durability explicit across file write, metadata write,
SQLite revision bump, command-event persistence, and live fanout.

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
