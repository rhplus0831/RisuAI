# Phase 5: Import, Export, And Asset Memory

Status: revision/event audit, event atomicity, and expanded import limits
complete; export memory and asset durability work remains planned.

Goal: reduce large-payload memory pressure and make asset mutation durability
explicit.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
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
- [`bundle-export-streaming.md`](slices/phase-5-import-export-asset-memory/bundle-export-streaming.md)
- [`asset-mutation-transaction-protocol.md`](slices/phase-5-import-export-asset-memory/asset-mutation-transaction-protocol.md)
- [`per-generation-asset-cache.md`](slices/phase-5-import-export-asset-memory/per-generation-asset-cache.md)

## Exit Criteria

- Import routes enforce expanded-size or post-inflate limits.
- Bundle export avoids double hydration or documents why it cannot.
- Asset file writes, metadata writes, revision bumps, and events have explicit
  recovery behavior.
- Repeated references to the same stored asset in one generation do not re-read
  and re-encode bytes.

## Validation

- `pnpm api:test -- server/fastify/__tests__/save.test.ts`
- `pnpm api:test -- server/fastify/__tests__/assets.test.ts`
- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`
