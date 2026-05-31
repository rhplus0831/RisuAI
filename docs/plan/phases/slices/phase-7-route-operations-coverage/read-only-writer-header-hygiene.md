# Read-Only Writer Header Hygiene

Status: planned.

## Source Anchors

- `src/ts/server/bootstrap.ts`
- `src/ts/bootstrap.ts`
- `src/ts/server/activeWriterSession.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/activeWriter.ts`

## Scope

Keep passive resync and read-only observe paths from claiming active-writer
ownership or sending writer-intent headers accidentally.

## Protocol Behavior

- Read-only bootstrap for full resync should not steal writer ownership.
- Durable generation reattach, event streams, projection reads, and public asset
  reads should remain observe/read paths.
- Mutating server-owned routes should continue to include active-writer headers.

## Done When

- Tests prove read-only bootstrap does not latch a new active writer.
- Tests or route manifest checks cover observe routes that should not be
  writer-gated.
- Client helper names make writer-intent versus read-only behavior obvious.

## Validation

- `pnpm api:test -- server/fastify/__tests__/activeWriter.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
