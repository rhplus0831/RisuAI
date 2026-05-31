# Asset Metadata Index

Status: planned.

## Source Anchors

- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `src/ts/globalApi.svelte.ts`
- `src/ts/server/assets.ts`

## Scope

Reduce cold asset read cost by avoiding a full `db.json` parse and linear asset
metadata scan for every `GET`, `HEAD`, or existence lookup.

## Protocol Behavior

- Preserve public immutable asset byte reads.
- Invalidate any in-process cache on asset revision bumps, or move metadata to
  SQLite with a clear migration.
- Preserve content-addressed asset ids and existing `HEAD` behavior.

## Done When

- Asset metadata lookup is indexed or cached.
- Asset upload, bulk upload, read, head, exists, and GC behavior remain
  compatible.
- Asset-heavy cold paths show fewer `db.json` parses.

## Validation

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- Focused repository tests for metadata lookup.
