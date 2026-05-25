# Phase 9-4f - Plugin Storage

Date: 2026-05-26

Status: complete.

## Summary

9-4f moved plugin custom storage and plugin-facing database setter writes
behind Fastify command dispatch in server-backed web mode.

## Landed

- Added durable plugin-storage commands:
  - `PUT /api/v1/commands/plugin-storage/:key`
  - `DELETE /api/v1/commands/plugin-storage/:key`
  - `POST /api/v1/commands/plugin-storage/bulk`
- Added command events:
  - `pluginStorage.updated`
  - `pluginStorage.deleted`
  - `pluginStorage.bulkUpdated`
- Added typed browser helpers in `src/ts/server/commands.ts`.
- Extended `src/ts/pluginCommands.ts` with plugin-storage snapshots,
  rollback, and dispatch helpers.
- Routed server-backed web `pluginStorage.setItem`, `removeItem`, and
  `clear` through commands while preserving local optimistic projection.
- Added plugin database setter translation for `getDatabase` proxy writes,
  `setDatabaseLite`, and `setDatabase`:
  - `pluginCustomStorage` and unknown top-level keys use plugin-storage
    commands.
  - `currentPluginProvider` uses the plugin provider command.
  - `plugins` diffs create/update/delete/reorder through plugin commands.
  - scalar settings keys use grouped settings commands.
- Kept plugin code execution browser-side; only durable DB state is
  command-owned.

## Verification

- `pnpm api:test -- commands.test.ts` - 1115 tests passed.
- `pnpm test -- src/ts/server/commands.test.ts` - 694 tests passed, 4 skipped.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 694 tests passed, 4 skipped.
- `pnpm api:test` - 1115 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4g compatibility sweep and focused tests.
- 9-4g should audit remaining 9-4 direct writes around lorebooks, modules,
  plugins, assets, and plugin database adapters before 9-5 projection work.
- Full projection enforcement and read-only `DBState.db` guard remain 9-5.
