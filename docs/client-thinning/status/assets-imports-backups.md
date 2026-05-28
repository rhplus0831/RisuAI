# Assets, Imports, And Backups

Date: 2026-05-28

Read this when changing asset references, asset routes, `.risu` import/export,
bundle export, backup/restore, or durable data directory ownership.

## Implemented

- Asset bytes route through Fastify asset APIs.
- Durable asset references are validated through owning resource commands.
- Server `.risu` import/export and bundle routes exist under save routes.
- Backup/restore owns known server data directory children:
  `db.json`, `assets`, `risu.db`, and `save`.
- The audit checks backup inventory against known data directory children.
- `saveAsset` call sites are classified for filename or image-default metadata.

## Bounded Or Partial

- Asset helper names and legacy paths can be deceptive. Check the active
  structure docs before deleting a helper.
- Unknown asset URL shapes should stay gated to documented shapes.
- If a future data directory child is added, backup/restore and the audit must
  update in the same batch.

## Active Direction

- Validate references where they are written.
- Keep import normalization and command-write validation aligned.
- Keep backup/restore atomic across all server-owned persisted stores.

## Proof Leads

- `server/fastify/__tests__/assets.test.ts`
- `src/ts/server/assets.test.ts`
- `server/fastify/__tests__/risuSaveAssetReferences.test.ts`
- `server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`
- `server/fastify/__tests__/backups.test.ts`
- `src/ts/server/backups.test.ts`
- `pnpm client-thinning:audit`
