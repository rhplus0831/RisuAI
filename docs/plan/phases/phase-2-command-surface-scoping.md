# Phase 2: Command-Surface Scoping (Theme 2)

Status: pending.

Goal: finish the scoped-read pattern's third ring. The mutation engine
(`applyTargetedCommandMutation`) silently defaults to the broad
`loadPersisted` whenever a route supplies no scoped read; wire the existing
levers (`chatScopedRead`, `skipDatabaseLoad`) into the missed callers and add
the two missing read scopes (settings, collection).

Findings: M1, M3, L11, L12, L13, L14, K2.

## Planned Slices

Author under `slices/phase-2-command-surface-scoping/` when starting.

- send-persist-chat-scoped-read (M1) — mirror the v2-K1 wiring in
  `persistAssemblyMutations` (`chatScopedRead: hasVarWrite ? undefined :
  { chatId }`); assert the `messages.replaced` event parentId equals the
  character id through the scoped loader (this path uses `character.chaId`,
  unlike K1's sibling).
- settings-scoped-read (M3) — a settings-only read for the
  settings/prompt-settings command routes (the v2-L3
  `loadServerIntentCompletionSettings` shape generalized into the mutation
  pipeline), broad fallback on the pre-extraction edge; the memory group's
  `hypaV3Presets` co-write reads the patched value, so settings-only
  suffices.
- collection-scoped-reads (L11) — a collection-scoped read for the
  preset/persona/loadout/plugin/global-lorebook/translator-preset routes,
  reusing the projection-side `COLLECTION_TABLE_MAP` field-loader machinery
  (extended to carry assets for the mutation contract).
- drop-validate-only-normalization (L12) — global-lorebook and
  script/trigger routes validate only the target row; remove the discarded
  `ensureAllChildLorebooks`/`ensureAllScriptDefinitionCollections` corpus
  passes from these routes.
- plugin-storage-skip-load (L13) — `skipDatabaseLoad: true` on the two
  single-key plugin-storage routes (one line each; the realmImport precedent
  proves the contract).
- single-lorebook-hydration-scope (L14) — single-row read via
  `getCharacterRowsByIds` (or express as the bulk sibling with one id).
- proxy-hub-single-auth (K2) — drop the redundant in-handler `requireAuth`
  on the proxy/hub routes (v2-L16 propagation); 401 behavior unchanged.
- phase-2-verification-refresh — gates, load-count proofs, full validation,
  latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M1, M3, L11-L14; K2 under Known-Item Overlaps.
- M1: `server/fastify/src/routes/generationChat.ts`
  (`persistAssemblyMutations`); contrast `persistServerGenerationResult`
  (the v2-K1 wiring); loader branch `commands/mutations.ts`.
- M3: `routes/commands.ts` (settings/prompt-settings PATCH);
  `commands/mutations.ts` (loader ladder); `repository.ts`
  (`loadSettingsFromSqlite`, `extractSettings`); precedent
  `routes/generation.ts` (`loadServerIntentCompletionSettings`).
- L11: `routes/commands.ts` collection routes; `repository.ts`
  (`COLLECTION_TABLE_MAP`, `loadPersistedDatabaseFields`).
- L12: `commands/lorebooks.ts` (`ensureAllChildLorebooks`),
  `commands/scriptDefinitions.ts` (`ensureAllScriptDefinitionCollections`),
  their route callers in `routes/commands.ts`.
- L13: `routes/commands.ts` (plugin-storage PUT/DELETE);
  `commands/mutations.ts` (`skipDatabaseLoad` contract);
  precedent `routes/realmImport.ts`.
- L14: `repository.ts` (`loadCharacterLorebookHydration` vs
  `loadCharacterLorebookHydrations`, `getCharacterRowsByIds`); caller
  `routes/projection.ts`.
- K2: `routes/proxy.ts`, `routes/hub.ts` (onRequest hook + in-handler
  double verify); the fixed shape on the bulk projection routes (v2-L16).

## Planned Shape

- M1 is wiring, not machinery (the K1 precedent); the var-write broad case
  stays (v1-L4 remains gated).
- New scoped reads must obey the `commands/mutations.ts` guard contracts
  (scoped reads are incompatible with `writeDatabase`; `skipDatabaseLoad`
  is incompatible with both) and fall back to broad on the
  null/pre-extraction edge.
- L12 must keep the route-local validation of the incoming payload
  (`readScriptDefinitions`/`readTriggerDefinitions`, the global collection's
  own `ensure*`); only the corpus-wide discarded passes go.
- Persisted rows, events, and responses stay byte-identical everywhere.

## Exit Criteria

- [ ] M1: a trigger/editinput persisting send performs zero whole-corpus
      loads (load-count harness); event parentId asserted; plain sends still
      early-return with no load.
- [ ] M3/L11: settings flushes and each collection mutation parse only the
      settings row (+ the one collection table); responses/events
      byte-identical.
- [ ] L12: lorebook/script routes no longer walk the corpus for validation;
      target-row validation preserved.
- [ ] L13: plugin-storage single-key routes perform zero database-shape
      loads.
- [ ] L14: single lorebook hydration reads one character row; bulk sibling
      unchanged.
- [ ] K2: proxy/hub verify auth exactly once; 401 behavior unchanged.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
