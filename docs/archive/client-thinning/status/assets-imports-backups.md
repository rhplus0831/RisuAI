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
