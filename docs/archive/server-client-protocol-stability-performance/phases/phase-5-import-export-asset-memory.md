# Phase 5: Import, Export, And Asset Memory

Status: implemented. Revision/event audit, event atomicity, expanded import
limits, bundle export streaming, per-generation asset caching, and asset
mutation durability are complete. The ordinary `.risu` export materialization
measurement is implemented; a streaming envelope writer remains evidence-gated.

Goal: reduce large-payload memory pressure and make asset mutation durability
explicit.

## Source Anchors

- [`../../../AUDIT.md`](../../../AUDIT.md)
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/realmImport.ts`
- `src/ts/globalApi.svelte.ts`

## Slices

- [`server-owned-revision-bump-audit.md`](slices/phase-5-import-export-asset-memory/server-owned-revision-bump-audit.md)
- [`server-owned-event-atomicity.md`](slices/phase-5-import-export-asset-memory/server-owned-event-atomicity.md)
- [`expanded-import-size-limits.md`](slices/phase-5-import-export-asset-memory/expanded-import-size-limits.md) -
  implemented; `.risu` and Realm charx import paths reject oversized expanded
  payloads before durable writes.
- [`bundle-export-streaming.md`](slices/phase-5-import-export-asset-memory/bundle-export-streaming.md) -
  implemented; bundle export shares one hydrated snapshot and streams asset
  entries into the zip.
- [`asset-mutation-transaction-protocol.md`](slices/phase-5-import-export-asset-memory/asset-mutation-transaction-protocol.md) -
  implemented; upload and bulk upload now roll back newly staged asset files
  when file staging, metadata persistence, or command-event persistence fails
  before a revisioned `asset.created` event commits.
- [`per-generation-asset-cache.md`](slices/phase-5-import-export-asset-memory/per-generation-asset-cache.md) -
  implemented; repeated stored-asset references in one prompt assembly share a
  request-scoped read/base64 cache.
- [`ordinary-risu-export-materialization.md`](slices/phase-5-import-export-asset-memory/ordinary-risu-export-materialization.md) -
  measurement implemented; the ordinary and bundle export routes emit a
  `risusave_export` snapshot/encode/output split. A streaming envelope writer
  remains gated on large-export evidence.

## Exit Criteria

- Import routes enforce expanded-size or post-inflate limits.
- Bundle export avoids double hydration and does not collect all bundled asset
  bytes in one in-memory zip input map.
- Asset file writes, metadata writes, revision bumps, and events have explicit
  recovery behavior.
- Repeated references to the same stored asset in one generation do not re-read
  and re-encode bytes.

## Validation

- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`
