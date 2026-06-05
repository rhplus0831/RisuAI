# Slice: Realm JSON Asset Batch Cleanup

Phase: [8](../../phase-8-server-bounds.md). Findings: L23 and L24. Runtime
change.

## Scope

Batch Realm JSON-card asset persistence and add compensating cleanup for assets
that were persisted before a character append fails.

This slice does not own `.charx` download caps, general asset GC, bundle
import/export codecs, or Realm search/request behavior.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L23 and L24.
- `server/fastify/src/routes/realmImport.ts`: JSON-card asset loop, character
  append path, charx batching precedent, and append failure handling.
- `server/fastify/src/repository.ts`: `addAsset`, `addAssets`, revision bumps,
  created-file rollback, and character append helpers.
- Existing focused suites:
  `server/fastify/__tests__/realmImport.test.ts`,
  `server/fastify/__tests__/assets.test.ts`, and
  `server/fastify/__tests__/assetMetadataIndex.test.ts`.

## Target Shape

- Convert Realm JSON-card asset persistence from one SQLite transaction,
  revision bump, and SSE broadcast per asset to one batched persist operation
  shaped like the charx path.
- Reuse `addAssets` or an equivalent batch helper so file rollback on asset
  write failure remains centralized.
- If assets have been persisted and the later character append fails, delete
  those newly-created assets and metadata immediately instead of relying on the
  60 minute asset-GC grace window.
- Keep cleanup compensating rather than wrapping remote fetches and character
  append in one long transaction.
- Preserve import result bytes, asset ids, character append semantics, and
  revision conflict responses.
- Add tests proving one batched asset revision/event for JSON-card import, no
  orphaned assets after append failure, and unchanged valid import output.
- Register L23 and L24 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid JSON-card and charx Realm imports persist the same character and asset
  bytes as before.
- Asset cleanup must delete only assets created by the failed import attempt.
- Existing repository rollback on asset write failure remains intact.
- Character append conflicts still surface through the same API failure shape.

## Done Criteria

- JSON-card asset import uses a batched persist path with one revision/event
  boundary for the asset batch.
- Character append failure leaves no newly-persisted orphan assets.
- Valid import/export bytes and result shapes are unchanged.
- L23 and L24 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/assets.test.ts \
  server/fastify/__tests__/assetMetadataIndex.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
