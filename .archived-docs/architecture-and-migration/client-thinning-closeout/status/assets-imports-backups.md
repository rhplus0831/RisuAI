# Assets, Imports, And Backups

Date: 2026-05-29

Status: CLOSED / stable.

Closed: asset-byte routes and durable asset-reference validation (validated
through the owning resource commands, against the walker parity baseline);
`.risu` import/export and bundle export under the save routes; and backup/restore
over the known server data directory children (`db.json`, `assets`, `risu.db`,
`save`).

Proof:

- `server/fastify/__tests__/assets.test.ts`
- `server/fastify/__tests__/risuSaveImportRoute.test.ts`
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`
- `server/fastify/__tests__/backups.test.ts`

Do not reopen unless current source inventory proves drift — if a new data
directory child or durable asset-reference field is added, backup/restore, the
audit, and the walker parity must update in the same batch. See
[`../plan.md`](../plan.md) for the spine.

## Verification Coverage

The former proof-only coverage shard is consolidated with its canonical status record.

Date: 2026-05-29

Status: CLOSED. Proof pointers for asset routes + reference validation, `.risu`
import/export/bundle, and backup/restore; see
[`../status/assets-imports-backups.md`](assets-imports-backups.md).

### Proof

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
