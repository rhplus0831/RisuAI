# Assets, Imports, And Backups Coverage

Date: 2026-05-29

Status: CLOSED. Proof pointers for asset routes + reference validation, `.risu`
import/export/bundle, and backup/restore; see
[`../status/assets-imports-backups.md`](../status/assets-imports-backups.md).

## Proof

Assets:

- `server/fastify/__tests__/assets.test.ts`
- `server/fastify/__tests__/risuSaveAssetReferences.test.ts`

Import/export/bundle:

- `server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`

Backups:

- `server/fastify/__tests__/backups.test.ts`
- `pnpm client-thinning:audit` — backup inventory rule.

If a new data directory child or durable asset-reference field is added, update
backup/restore, the audit inventory, and the walker parity in the same batch.
