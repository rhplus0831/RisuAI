# Slice: Settings Scoped Read

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: M3. Depends on
the targeted settings write path and the v2 L3 settings-only loader precedent.
Runtime change.

## Scope

Add a settings-scoped read for the settings command routes so a scalar settings
flush does not parse characters, chats, collections, plugin storage, or asset
metadata before writing only the settings row.

This slice does not own bridge debounce/suppression behavior, provider-secret
masking outside the existing validators, or collection-route scoped reads.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M3.
- `server/fastify/src/routes/commands.ts`:
  `PATCH /api/v1/commands/settings/:group`,
  `PATCH /api/v1/commands/prompt-settings`, `applySettingsPatch`,
  `writeSettingsOnly`, and the memory-group `hypaV3Presets` co-write.
- `server/fastify/src/commands/mutations.ts`: loader ladder in
  `applyTargetedCommandMutation` and scoped-read guard contracts.
- `server/fastify/src/repository.ts`: `loadSettingsFromSqlite`,
  `loadServerIntentCompletionSettings`, `extractSettings`, and projection
  field-loader helpers.
- Existing focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Add a scoped settings read branch to the mutation pipeline, either as a
  `settingsScopedRead` option or a small settings-specific helper that keeps
  the same revision/event transaction semantics.
- Load only `loadSettingsFromSqlite(db)` for the normal extracted-SQLite case.
  If the settings row is absent or the route is on a pre-extraction edge that
  cannot be represented by settings alone, fall back to the broad loader.
- Pass the settings-scoped read to both settings routes.
- Preserve the memory group behavior: `applySettingsPatch` should write the
  patched `hypaV3Presets` value to the `hypa_v3_presets` table when the patch
  carries it. Do not pre-load the hypa presets table just for this co-write.
- Preserve settings validators, provider-secret sentinel handling, revision
  conflict behavior, command events, and response shapes.
- Extend protocol/load-count tests so normal settings and prompt-settings
  writes read the settings row only.

## Invariants

- Scoped settings reads are incompatible with `writeDatabase` and
  `skipDatabaseLoad`, matching the existing scoped-read guard style.
- A settings-only write must not read or parse character rows, chat rows,
  collection tables, plugin storage, or asset metadata.
- The `hypaV3Presets` memory-group co-write may write `hypa_v3_presets`, but
  it must read the patched request value rather than paying a collection read.
- Missing/uninitialized database behavior remains byte-identical through the
  broad fallback.

## Done Criteria

- `settings/:group` and `prompt-settings` commands perform zero whole-corpus
  payload reads in the load-cost harness.
- Protocol metrics still report `targeted-settings`, with `writtenTables`
  matching the existing settings-only and memory co-write budgets.
- Existing settings command tests pass for validation errors, stale revisions,
  provider-secret placeholders, and response/event bodies.
- M3 is registered as `DONE` in
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
