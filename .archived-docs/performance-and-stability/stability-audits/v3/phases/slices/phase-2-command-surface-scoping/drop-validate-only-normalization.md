# Slice: Drop Validate-Only Normalization

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: L12. Can land
independently, but pairs naturally with collection-scoped reads. Runtime
change.

## Scope

Remove discarded corpus-wide validation/repair passes from global-lorebook and
script/trigger-definition command routes. Keep validation of the incoming
target row or collection payload.

This slice does not own narrowing character/chat/module lorebook writes, the
collection-scoped read helper, or changing the persisted repair semantics for
the broad import/restore paths that intentionally normalize a whole database.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L12.
- `server/fastify/src/routes/commands.ts`: global-lorebook routes around
  `/api/v1/commands/lorebooks*` and script/trigger routes around
  `/api/v1/commands/characters/:id/scripts`,
  `/characters/:id/triggers`, `/modules/:id/scripts`, and
  `/modules/:id/triggers`.
- `server/fastify/src/commands/lorebooks.ts`: `ensureLorebookDatabase`,
  `ensureGlobalLorebookCollection`, `ensureAllChildLorebooks`,
  `validateLorebookEntries`, `validateGlobalLorebookCreate`,
  `readCharacterLorebooks`, `readModuleLorebooks`.
- `server/fastify/src/commands/scriptDefinitions.ts`:
  `normalizeScriptDefinitionDatabase`,
  `normalizeScriptDefinitionCollection`,
  `ensureAllScriptDefinitionCollections`, `readScriptDefinitions`,
  `readTriggerDefinitions`.
- Focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/commandMessageFreeCeiling.test.ts`.

## Target Shape

- Split route-local target validation from whole-database normalization where
  needed. For global lorebook routes, validate only the global collection or
  the incoming `entries` payload; do not walk every character/chat/module
  child lorebook when the result is not persisted.
- For script/trigger definition routes, keep `readScriptDefinitions` and
  `readTriggerDefinitions` on the incoming payload. Do not call the full
  `ensureAllScriptDefinitionCollections` corpus pass just to discard its
  repairs.
- Preserve import/restore and other intentional full-database normalization
  callers of `ensureAllChildLorebooks` and
  `ensureAllScriptDefinitionCollections`.
- Preserve comments or add short comments at route sites that explain the
  child/corpus repairs are validate-only and intentionally not persisted by
  these targeted commands.
- Add tests that fail if unrelated character/chat/module lorebook or script
  payloads are traversed or repaired by these routes.

## Invariants

- Incoming payload validation must stay strict: malformed entry ids, duplicate
  ids, non-array script/trigger payloads, and invalid global lorebook records
  still fail.
- Target route behavior, responses, events, and written tables stay unchanged.
- Broad import/restore normalization remains allowed to walk and repair the
  whole database.
- This slice must not silently drop target-row validation to gain speed.

## Done Criteria

- Global lorebook routes no longer invoke the corpus-wide child lorebook pass
  for create, patch, delete, reorder, select, or entries replacement.
- Character/module script and trigger routes validate only the incoming target
  payload and no longer invoke the whole script-definition corpus pass.
- Focused tests prove target validation is preserved and unrelated corpus
  rows are untouched.
- L12 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/commandMessageFreeCeiling.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
