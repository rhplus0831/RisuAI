# Phase 9-4e - Plugin Records and Configuration

Date: 2026-05-26

Status: complete.

## Landed Scope

- Added Fastify plugin command validation and normalization for installed
  plugin records keyed by plugin `name`.
- Added command endpoints for plugin create, patch, delete, enable/disable,
  provider selection, and reorder:
  `POST /api/v1/commands/plugins`,
  `PATCH /api/v1/commands/plugins/:pluginId`,
  `DELETE /api/v1/commands/plugins/:pluginId`,
  `POST /api/v1/commands/plugins/:pluginId/enable`,
  `POST /api/v1/commands/plugins/provider`, and
  `POST /api/v1/commands/plugins/reorder`.
- Added plugin command events:
  `plugin.created`, `plugin.updated`, `plugin.deleted`,
  `plugin.enabled`, `plugin.provider.selected`, and `plugin.reordered`.
- Added typed browser command helpers and `src/ts/pluginCommands.ts` for
  optimistic dispatch plus rollback snapshots.
- Routed Fastify-mode plugin import/update, enable/disable, delete,
  plugin argument/config edits, plugin API `setArg` / `setArgument`, and
  plugin provider selection through command helpers.

## Guardrails

- Plugin code execution remains browser-side and sandboxed; the server owns
  durable plugin DB records only.
- Plugin `name` is the command id and is not renameable through plugin
  patch commands.
- Provider selection accepts the durable provider string as-is because
  provider names are registered by browser plugin code and do not always
  equal plugin record names.
- Plugin custom storage, `pluginStorage.*`, and plugin
  `setDatabase` / `setDatabaseLite` translation are still deferred to
  9-4f.
- Projection enforcement, storage gating, provider-key masking, and server
  `.risu` import/export remain deferred.

## Tests

- Added Fastify command tests for plugin create/update/enable/provider
  selection/reorder/delete, malformed payloads, missing plugins, stale
  revisions, event order, bootstrap visibility, and no revision bump on
  failure.
- Added browser command helper tests for all plugin endpoints.
- Focused verification:
  `pnpm api:test -- commands.test.ts` passed with 1112 tests.
- Focused browser verification:
  `pnpm test -- src/ts/server/commands.test.ts` passed with 693 tests and
  4 skipped.
- `pnpm check` is clean.
- `pnpm test` passes with 693 tests and 4 skipped.
- `pnpm api:test` passes with 1112 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4f plugin-storage kv and plugin database setter
  adapters.
- 9-4f should translate `pluginCustomStorage`, plugin `pluginStorage.*`,
  and plugin-facing `setDatabase` / `setDatabaseLite` writes without
  whole-DB replacement.
- 9-4g should do the compatibility sweep for remaining 9-4 direct writes
  before 9-5 projection enforcement.
