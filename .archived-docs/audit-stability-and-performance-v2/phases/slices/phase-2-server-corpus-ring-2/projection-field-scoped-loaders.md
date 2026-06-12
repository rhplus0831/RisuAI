# Slice: Projection Field-Scoped Loaders

Phase: [2](../../phase-2-server-corpus-ring-2.md). Findings: M6, L16. Depends
on the v2 gate being present. Runtime change.

## Scope

Make field-mode projection read only the SQLite tables behind the requested
field keys, then remove the redundant in-handler auth verification from the
bulk projection routes. A projection for `preset`, `plugin`, `moduleEnabled`,
or another character-unrelated resource must not parse the `characters` table.

This slice does not own `characterRow` single-row projection, projection SSE
replay behavior, command-event routing, or any broad bootstrap route that
intentionally ships a whole database projection.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M6 and L16.
- `server/fastify/src/routes/projection.ts`: field branch around
  `resourceProjectionFields`, `loadPersistedDatabaseFields`,
  `loadStubbedProjectionFields`, `loadStubProjectionFields`, and the bulk
  routes with duplicate `requireAuth`.
- `server/fastify/src/repository.ts`: `loadPersistedDatabaseFields`,
  `loadStubbedProjectionFields`, `COLLECTION_TABLE_MAP`,
  `loadSingleCharacterStubRow`, `loadSettingsFromSqlite`.
- Existing focused tests:
  `server/fastify/__tests__/projection.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`,
  `server/fastify/__tests__/auth.test.ts`.

## Target Shape

- Replace the broad `loadPersisted` call inside
  `loadPersistedDatabaseFields`/`loadStubbedProjectionFields` with
  field-scoped loading:
  - load the settings row once;
  - for collection fields, read only the table named by
    `COLLECTION_TABLE_MAP`;
  - skip `loadCharactersFromSqlite` unless `fieldKeys` includes
    `characters`;
  - preserve empty-table/embedded-settings fallback semantics from the broad
    loader.
- Preserve the stubbed projection contract: if `characters` is requested,
  chats are message-free, `hypaV3Data` is removed, and `globalLore` is
  stripped when `enableLorebookStubs` is true.
- Preserve provider-secret masking in the same route branches as before.
- Keep zero-field resources as a cheap `{ fields: {} }` response without any
  database field load.
- Remove the second `requireAuth` call from the bulk projection routes that
  already use the route-level auth guard. Keep 401/403 behavior, response
  body shape, and audit/metrics behavior unchanged.
- Add load-count tests for a foreign `preset`/`plugin`/`moduleEnabled`
  projection that assert zero `characters` table reads and byte-identical
  payloads.
- Register M6 and L16 as `DONE` in the v2 gate with focused tests, and flip
  their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- Unknown resources, `fieldKeys === null`, empty field lists, and missing
  database/settings states must behave exactly as before.
- `characterRow` single-row projection should keep using
  `loadSingleCharacterStubRow`; do not regress it to a broad field load.
- A character-unrelated field projection must not read or parse any character
  or chat row.
- Bulk projection auth must still run exactly once before any protected data
  is read.

## Done Criteria

- Projection tests prove byte-identical field responses for settings fields,
  collection fields, stubbed character fields, and zero-field resources.
- The load-cost harness fails if a character-unrelated field projection reads
  the `characters` table.
- Auth tests prove protected bulk routes still reject unauthenticated requests
  and do not double-verify authenticated requests.
- The v2 gate and active-risk rows mark M6 and L16 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/auth.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
