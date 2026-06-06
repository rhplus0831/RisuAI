# Slice: Single Lorebook Hydration Scope

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: L14. Depends on
the existing bulk character-lorebook hydration loader. Runtime change.

## Scope

Make `loadCharacterLorebookHydration` read only the requested character row
when SQLite character rows are authoritative, mirroring
`loadCharacterLorebookHydrations`.

This slice does not own the experimental `enableLorebookStubs` feature shape,
bulk hydration behavior, or any character projection response outside the
single character-lorebook endpoint.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L14.
- `server/fastify/src/repository.ts`: `loadCharacterLorebookHydration`,
  `loadCharacterLorebookHydrations`, `sqliteIsCharacterAuthority`,
  `getCharacterRowsByIds`, and the pre-extraction broad fallback.
- `server/fastify/src/routes/projection.ts`:
  `/api/v1/projection/characterLorebook`.
- Focused tests:
  `server/fastify/__tests__/projection.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Rework `loadCharacterLorebookHydration` to use the same authority decision as
  the bulk sibling.
- In the authoritative SQLite case, read the one character row via
  `getCharacterRowsByIds(db, [characterId])` or an equivalent single-row
  helper.
- Keep the broad `loadPersisted` fallback for pre-extraction or
  non-authoritative states so legacy embedded-character databases behave as
  before.
- Preserve unknown-character behavior: return `{ globalLore: [] }`.
- Preserve returned `globalLore` bytes for existing characters, including
  full un-stubbed lore entries.
- Add a load-cost test for the single endpoint beside the existing bulk
  hydration proof.

## Invariants

- Single hydration must not read every character row in normal extracted
  SQLite databases.
- Bulk hydration behavior and missing-id reporting remain unchanged.
- `enableLorebookStubs` continues to gate only the route that calls this
  loader; the loader does not invent new feature gating.
- Pre-extraction fallback remains broad and documented.

## Done Criteria

- Single character-lorebook hydration performs zero whole-corpus payload reads
  on the large-corpus fixture.
- Single and bulk hydration return identical `globalLore` for the same
  existing character.
- Legacy/pre-extraction fallback tests still pass.
- L14 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
