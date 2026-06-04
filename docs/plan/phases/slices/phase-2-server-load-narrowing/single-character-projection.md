# Single-Character Projection & Mask

Status: not started. Phase 2. Covers M4.

## Scope

`loadSingleCharacterRow` should ship one character, but it loads all characters,
then `maskProviderSecrets` deep-clones the array before `.find()` picks one row.
Narrow the row read and mask only owned fresh objects.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M4.
- `server/fastify/src/routes/projection.ts:519-536` (`loadSingleCharacterRow`),
  the `characterRow` branch `:358-385`.
- `server/fastify/src/providerSecrets.ts:59-66` (`maskProviderSecrets`),
  `:247-250` (`cloneJsonValue`).
- `server/fastify/src/repository.ts:767` (`loadStubbedProjectionFields`),
  `:352` (`loadCharacterSelectionRows` — the single-row precedent), `:391`
  (`loadCharacterSelectionProjection`).
- `server/fastify/src/routes/bootstrap.ts:31-45`.

## Planned Shape

- `loadSingleCharacterRow` does a `WHERE id = ?` read, strips messages on that
  row, masks only it, and still respects `enableLorebookStubs`.
- Add an opt-in `maskProviderSecretsInPlace` for callers that own a freshly
  parsed object (the SQLite loaders always do); do not change the existing
  `maskProviderSecrets` contract (it may be used on caller-shared objects).
- Leave the bootstrap full clone unless it is clearly safe to use the in-place
  variant.

## Behavior / Invariants

- The `characterRow` projection payload and the bootstrap payload are
  byte-identical to today (same masked fields, same wire shape).

## Done Criteria

- A load-count test shows `loadSingleCharacterRow` does a single-row read.
- The `characterRow` payload is asserted byte-identical on a multi-character
  fixture.
- Gate `M4` registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/bootstrap.test.ts`.
- `pnpm api:test`, both TypeScript checks.
