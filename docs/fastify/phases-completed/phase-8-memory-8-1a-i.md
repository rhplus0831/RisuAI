# Phase 8 8-1a-i - Migration Runner + Version Bump

Date: 2026-05-24

## Result

Closed. Fastify now has the first `risu.db` schema migration runner.

Landed:

- `CURRENT_SCHEMA_VERSION` advanced from 0 to 1.
- `server/fastify/src/db.ts` now exposes a typed ordered migration
  registry and `applyMigrations(db, fromVersion)`.
- `openDatabase()` bootstraps `schema_version`, rejects databases newer
  than the app, and applies pending migrations before routes receive the
  DB handle.
- Each migration step runs in a single transaction and updates the
  existing singleton `schema_version` row only after the step succeeds.
- Version 1 is framework-only; it intentionally creates no memory
  tables.
- `server/fastify/__tests__/db.test.ts` covers fresh open, upgrade from
  version 0, idempotent reopen / reapply, missing schema row handling,
  and newer-schema rejection.
- Bootstrap and health route expectations now report schema version 1.

## Verification

```bash
pnpm exec vitest run server/fastify/__tests__/db.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/smoke.test.ts --config server/fastify/vitest.config.ts
```

Result: 3 files passed, 12 tests passed.

Full closeout verification also passed:

- `pnpm check` - clean.
- `pnpm test` - 639 passed, 4 skipped.
- `pnpm api:test` - 900 passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next

Pick up **8-1a-ii - Memory tables on top of the runner**. Bump
`CURRENT_SCHEMA_VERSION` to 2 and add migration version 2 for
`memory_chunks`, `memory_summaries`, `memory_embeddings`, and
`memory_jobs`.
