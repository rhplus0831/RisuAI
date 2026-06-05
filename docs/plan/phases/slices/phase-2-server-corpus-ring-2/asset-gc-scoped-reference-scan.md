# Slice: Asset GC Scoped Reference Scan

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: K2. Depends on the
v2 gate being present. May reuse the field-scoped projection loaders from
[`projection-field-scoped-loaders.md`](projection-field-scoped-loaders.md).
Runtime change.

## Scope

Remove `runAssetGc`'s periodic full persisted database load while preserving
the exact referenced/orphaned asset set. Message inlay references are already
covered by the column-only message token scan; this slice owns every
non-message reference that `buildRisuSaveAssetReport` currently finds by
walking the message-free persisted database.

This slice does not own asset upload, asset metadata schema, `.risu`
import/export codecs, message inlay token scanning, or broad export/report
paths that intentionally hydrate the whole save.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  Known-Item Overlaps K2 / v1-M10 residual.
- `server/fastify/src/assetGc.ts`: `runAssetGc`,
  `collectMessageInlayReferences`, `buildRisuSaveAssetReport`.
- `server/fastify/src/repository.ts`: `loadPersisted`,
  field-scoped loaders, collection/character/chat table readers.
- `server/fastify/src/risuSave/`: asset-reference report helpers.
- Existing focused tests:
  `server/fastify/__tests__/assetGc.test.ts`,
  `server/fastify/__tests__/assetMetadataIndex.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Replace `runAssetGc`'s `loadPersisted(opts.db, dataDir)` call with a
  scoped reference source that does not parse the whole character/chat corpus
  into a persisted `Database` object.
- Preserve identical orphan detection. Acceptable implementation shapes:
  - a SQLite JSON/text scan over settings, collection, character, and chat
    rows that extracts the same asset id/reference tokens used by the report;
  - or a minimal message-free database shape built from only the fields the
    asset-report walker needs, with no assets metadata scan hidden inside the
    loader.
- Avoid the current duplicate metadata read: `runAssetGc` already calls
  `getAllAssetMetadata(opts.db)`, so the replacement loader should not also
  fetch assets through `loadPersisted`.
- Keep `collectMessageInlayReferences` as the only message-table scan.
- Add regression fixtures with references from settings/collections,
  character rows, chat rows, and messages; the orphaned/referenced sets must
  match the pre-change report exactly.
- Register K2 as `DONE` in the v2 gate with focused behavior and load-count
  tests, and flip the K2 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- The GC must never delete an asset that the old report would have considered
  referenced.
- Grace-period handling, stray-file deletion, metadata deletion, and no-db
  behavior must stay unchanged.
- The periodic sweep must not parse active message JSON rows; only the
  existing token scan may touch messages.
- If a legacy/pre-extraction state cannot be safely served by the scoped
  reader, fall back broadly and test that fallback explicitly.

## Done Criteria

- Asset GC tests prove identical `referenced`, `orphaned`, deleted, skipped,
  and stray-file outcomes on representative fixtures.
- The load-cost harness fails if the normal GC sweep reaches `loadPersisted`
  or performs a full character-corpus parse.
- The v2 gate and active-risk row mark K2 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assetGc.test.ts \
  server/fastify/__tests__/assetMetadataIndex.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
