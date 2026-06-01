# Asset Metadata Index

Status: implemented.

## Source Anchors

- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/assets.ts`
- `src/ts/globalApi.svelte.ts`
- `src/ts/server/assets.ts`

## Scope

Reduce cold asset read cost by avoiding a full `db.json` parse and linear asset
metadata scan for every `GET`, `HEAD`, or existence lookup.

Implementation scope:

- Add a `repository.ts` in-process metadata index keyed by `dataDir`.
- Use the index from `assetById()` and `missingAssetIds()`.
- Refresh the index when `db.json` file metadata changes, and invalidate it on
  repository writes and backup restore swaps.
- Do not change asset route payloads, auth/public-read behavior, revision
  behavior, or content-addressed filenames.

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

## Result

- `repository.ts` keeps an in-process asset metadata index per `dataDir`, keyed
  by `db.json` stat signature.
- `assetById()` and `missingAssetIds()` use the index, so repeated asset
  `GET`, `HEAD`, generation resolution, and existence checks avoid reparsing
  `db.json` while the metadata file is unchanged.
- `writePersisted()` invalidates the index after repository writes, and backup
  restore swaps invalidate the same cache explicitly. Direct `db.json`
  replacements refresh on the next lookup when file metadata changes.
- Route payloads, public immutable byte reads, `HEAD` behavior,
  content-addressed ids, and upload revision/event behavior are unchanged.

## Validation

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- Focused repository tests for metadata lookup.

Proof run:

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts server/fastify/__tests__/assetMetadataIndex.test.ts`
  - 81 test files passed; 1440 tests passed; 1 skipped.
