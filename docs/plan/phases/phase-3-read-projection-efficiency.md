# Phase 3: Read Projection Efficiency

Status: three optimizations implemented.

Goal: reduce repeated REST reads and full-projection work for targeted
projection, asset metadata, bulk hydration, and full resync fallbacks.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/bootstrap.ts`
- `src/ts/globalApi.svelte.ts`

## Slices

- [`targeted-projection-loaders.md`](slices/phase-3-read-projection-efficiency/targeted-projection-loaders.md)
- [`asset-metadata-index.md`](slices/phase-3-read-projection-efficiency/asset-metadata-index.md)
- [`bulk-chat-lorebook-reads.md`](slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md)
- [`full-bootstrap-resync-budget.md`](slices/phase-3-read-projection-efficiency/full-bootstrap-resync-budget.md)

## Exit Criteria

- Empty or small targeted projection resources avoid full stub projection load.
- Asset metadata lookup no longer parses `db.json` for every cold asset read.
- Bulk all-chat or lorebook readers have a lower request count path or a
  server-side assembly alternative.
- Full resync reasons are counted and treated as protocol health signals.

## Current Progress

- Empty-field targeted projection resources such as `asset` now skip full stub
  projection loading while preserving the existing response contract.
- Small non-empty targeted projection resources such as `preset`, `prompt`,
  `promptItem`, `persona`, `translatorPreset`, and `loadout` now use a narrow
  persisted-field selector with provider secret masking.
- Asset metadata lookup now uses an in-process repository index with
  `db.json` stat-based refresh and explicit invalidation on repository writes.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
