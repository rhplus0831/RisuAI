# Slice: Collection Scoped Reads

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: L11. Depends on
the targeted collection write path and the repository field-loader machinery.
Runtime change.

## Scope

Add collection-scoped mutation reads for collection command families:
presets, personas, loadouts, plugins, global lorebooks, and translator
presets. These routes already write through targeted SQLite writers; this
slice prevents their mutate callbacks from receiving a broad `loadPersisted`
database shape.

This slice does not own character/chat/module lorebook rows, script/trigger
definition routes, prompt-template-only routes, plugin custom storage, or any
route whose callback genuinely needs the character/chat corpus.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L11.
- `server/fastify/src/routes/commands.ts`: preset routes (`botPresets`),
  persona routes (`personas`), loadout routes (`loadouts`), plugin routes
  (`plugins`), global-lorebook routes (`loreBook`), and translator-preset
  routes (`translatorPresets`).
- `server/fastify/src/commands/mutations.ts`: `applyTargetedCommandMutation`,
  `TARGETED_MUTATION_PATHS.collection`, scoped-read guard contracts.
- `server/fastify/src/repository.ts`: `COLLECTION_TABLE_MAP`,
  `loadDatabaseFieldsFromSqlite`, `loadCollectionFieldFromSqlite`,
  `loadSettingsFromSqlite`, `writeSingleCollectionTable`,
  `writeSingleCollectionRow`, and settings/asset handling in the `Persisted`
  contract.
- Route validators in `server/fastify/src/commands/presets.ts`,
  `personas.ts`, `loadouts.ts`, `plugins.ts`, `lorebooks.ts`, and
  `translatorPresets.ts`.
- Focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandCollectionRange.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/commandMutationBudget.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Add a collection-scoped read branch to the mutation pipeline. The branch
  should build the minimal database object from the settings row plus the
  requested collection fields, using the same table mapping and empty-table /
  embedded-settings fallback semantics as projection field reads.
- Extend the repository field-loader machinery as needed so the returned shape
  satisfies mutation callbacks without loading unrelated tables. If a helper
  returns a `Persisted` object, keep the assets side of that contract intact
  without doing an unnecessary full asset scan for routes that do not need it.
- For each route family, pass only the collection field(s) the callback reads
  plus settings scalars. Most routes should need one collection table plus
  settings; if a route truly reads or writes a second collection, document that
  exception in the test name or assertion.
- Preserve the existing targeted write calls and metric labels. This slice is
  about replacing the read input, not changing the already-narrow writers.
- Keep broad fallback behavior for missing settings or pre-extraction states
  that the field loader cannot faithfully represent.
- Add a representative load-count test for each collection family, and at
  least one route-level behavior test for a settings pointer co-write.

## Invariants

- Collection-scoped reads must not load `characters`, `chats`, messages,
  plugin custom storage, unrelated collection tables, or asset metadata unless
  a route proves that dependency.
- Existing collection defaults, duplicate-id repairs, selected-index pointer
  handling, and legacy field mirroring stay byte-identical.
- `writeDatabase` must remain false for collection-scoped reads; the callback
  owns targeted SQLite writes.
- Provider-secret and asset-id validators keep using their existing authority
  sources. Do not weaken validation to avoid a read.

## Done Criteria

- Each covered collection family has load-cost proof that a normal command
  reads settings plus its needed collection table(s), with zero whole-corpus
  payload reads.
- Existing command behavior tests pass for create, patch, delete, select,
  reorder/import/copy where applicable.
- `commandMutationBudget.test.ts` still sees a gated `targeted-collection`
  mutation path with table budgets.
- L11 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandCollectionRange.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/commandMutationBudget.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
