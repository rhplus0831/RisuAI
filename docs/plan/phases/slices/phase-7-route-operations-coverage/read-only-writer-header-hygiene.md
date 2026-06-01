# Read-Only Writer Header Hygiene

Status: implemented.

## Source Anchors

- `src/ts/server/bootstrap.ts`
- `src/ts/bootstrap.ts`
- `src/ts/server/activeWriterSession.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/activeWriter.ts`

## Scope

Keep passive resync and read-only observe paths from claiming active-writer
ownership or sending writer-intent headers accidentally.

Implemented behavior:

- `fetchServerBootstrapProjection()` sends the active-writer session header for
  writer-intent startup.
- `fetchServerBootstrapProjectionReadOnly()` omits the writer header and can
  skip revision caching during trusted resync.
- `forceServerProjectionResync()` uses the read-only bootstrap path for backup
  restore and full-bootstrap recovery.
- Active-writer tests prove passive bootstrap reads do not reclaim ownership
  and observe routes such as event streams, durable reattach, and public asset
  reads stay outside the writer gate.

## Protocol Behavior

- Read-only bootstrap for full resync should not steal writer ownership.
- Durable generation reattach, event streams, projection reads, and public asset
  reads should remain observe/read paths.
- Mutating server-owned routes should continue to include active-writer headers.

## Done When

- Tests prove read-only bootstrap does not latch a new active writer.
- Tests and route manifest checks cover observe routes that should not be
  writer-gated.
- Client helper names distinguish writer-intent and read-only behavior.

## Validation

- `pnpm api:test -- server/fastify/__tests__/activeWriter.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
