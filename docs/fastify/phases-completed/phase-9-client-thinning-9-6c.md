# Phase 9-6c - Server Backup/Restore Projection

Date: 2026-05-26

## Summary

- Fastify backup restore now emits `state.restored` on the shared command
  event stream after `restoreBackup()` bumps the repository revision.
- Browser server-backup helpers were added in `src/ts/server/backups.ts` for
  create/list/restore/delete calls against `/api/v1/backups` with `risu-auth`.
- Fastify-mode backup UI/helper paths now use the server backup API for manual
  save and internal restore, while local file restore and partial local backup
  return explicit unsupported behavior before touching local storage.

## Verification

- `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  - passed; command selected the full client suite: 730 tests, 4 skipped.
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
  - passed; command selected the full Fastify API suite: 1119 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-6d residual local cache classification.
- Keep server `.risu` codec/import/export and asset bundle walking deferred to
  9-7 and 9-8.
