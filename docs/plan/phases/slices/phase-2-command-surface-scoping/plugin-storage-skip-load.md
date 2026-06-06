# Slice: Plugin Storage Skip Load

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: L13. Depends on
the existing `skipDatabaseLoad` contract. Runtime change.

## Scope

Set `skipDatabaseLoad: true` on the two single-key plugin-storage routes. The
callbacks do not read the database; they validate request input, write one key
or delete one key, and emit a command event.

This slice does not own the bulk plugin-storage route, which must still read
existing storage when it merges without `clear`.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L13.
- `server/fastify/src/routes/commands.ts`:
  `PUT /api/v1/commands/plugin-storage/:key`,
  `DELETE /api/v1/commands/plugin-storage/:key`,
  `POST /api/v1/commands/plugin-storage/bulk`.
- `server/fastify/src/commands/mutations.ts`: `skipDatabaseLoad` guard
  contracts and `TARGETED_MUTATION_PATHS.pluginStorage`.
- `server/fastify/src/commands/pluginStorage.ts`: key/value validators and
  bulk merge semantics.
- `server/fastify/src/repository.ts`: `writePluginStorageKey`,
  `deletePluginStorageKey`, `replacePluginStorage`.
- Precedent: `server/fastify/src/routes/realmImport.ts` targeted append uses
  `skipDatabaseLoad: true`.
- Focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Add `skipDatabaseLoad: true` to the single-key PUT and DELETE
  `applyTargetedCommandMutation` calls.
- Leave the callbacks accepting `_database` or no-oping the database argument;
  they must continue to use request-derived `key` and `value` only.
- Do not add `skipDatabaseLoad` to the bulk route unless its merge semantics
  are separately changed and tested. With `clear: false`, bulk needs current
  plugin storage.
- Preserve revision conflict checks, key/value validation, written table
  metrics, command events, and response shapes.
- Add load-count coverage proving PUT and DELETE perform zero database-shape
  loads while bulk keeps its required read.

## Invariants

- `skipDatabaseLoad` must not be combined with scoped reads or `writeDatabase`.
- Single-key PUT/DELETE remain atomic with revision bump and event
  persistence inside the existing transaction.
- Bulk plugin storage remains correct for merge, delete, replace, and clear
  semantics.
- No unrelated table writes or reads are introduced.

## Done Criteria

- Single-key plugin-storage PUT and DELETE perform zero database-shape loads.
- Bulk plugin storage tests still prove merge semantics against existing keys.
- Protocol metrics still report `targeted-plugin-storage` and
  `writtenTables: ['plugin_custom_storage']`.
- L13 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
