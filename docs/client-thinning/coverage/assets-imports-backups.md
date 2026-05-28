# Assets, Imports, And Backups Coverage

Date: 2026-05-28

## Current Proof

Assets:

- `server/fastify/__tests__/assets.test.ts`
- `src/ts/server/assets.test.ts`
- `server/fastify/__tests__/risuSaveAssetReferences.test.ts`

Import/export/bundle:

- `server/fastify/__tests__/risuSaveCodec.test.ts`
- `server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`
- `src/ts/storage/risuSave.test.ts`

Backups:

- `server/fastify/__tests__/backups.test.ts`
- `src/ts/server/backups.test.ts`
- `pnpm client-thinning:audit` backup inventory rule

## Expected Coverage Shape

Changes here should prove:

- asset refs are validated where durable references are written
- optional clear values remain supported where documented
- missing blobs and metadata drift are handled intentionally
- `.risu` import normalizes to current command-addressable shape
- bundle export walks only documented asset references
- backup/restore covers every server-owned data directory child

## Known Gaps

- Add backup inventory audit updates in the same batch as any new data directory
  child.
- Add asset walker/validator parity updates in the same batch as any new
  durable asset-reference field.
