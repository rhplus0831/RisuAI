# Single-Character Projection & Mask

Status: not started. Phase 2. Covers M4.

## Scope

`loadSingleCharacterRow` — the per-character `characterRow` projection that
exists specifically to ship one character cheaply — calls
`loadStubbedProjectionFields(['characters'])` (a whole-corpus SQLite read +
parse) and then `maskProviderSecrets`, which JSON-deep-clones the **entire**
characters array, only to `.find()` one row. Bootstrap pays the same full clone
once per page load. Narrow both.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M4**.
- `server/fastify/src/routes/projection.ts:519-536` (`loadSingleCharacterRow`),
  the `characterRow` branch `:358-385`.
- `server/fastify/src/providerSecrets.ts:59-66` (`maskProviderSecrets`),
  `:247-250` (`cloneJsonValue`).
- `server/fastify/src/repository.ts:767` (`loadStubbedProjectionFields`),
  `:352` (`loadCharacterSelectionRows` — the single-row precedent), `:391`
  (`loadCharacterSelectionProjection`).
- `server/fastify/src/routes/bootstrap.ts:31-45`.

## Planned Shape

- `loadSingleCharacterRow` does a `WHERE id = ?` single-row read (precedent
  `loadCharacterSelectionRows`), strips messages on that one row, and masks only
  it. Must still respect `enableLorebookStubs` (strip `globalLore`) for wire
  parity with `loadStubbedProjectionFields`.
- Add an opt-in `maskProviderSecretsInPlace` for callers that own a freshly
  parsed object (the SQLite loaders always do); do not change the existing
  `maskProviderSecrets` contract (it may be used on caller-shared objects).
- The bootstrap full clone is lower-impact and harder to avoid cleanly (it masks
  before serialization); leave it or use the in-place variant only after
  confirming no caller reuses `persisted.database`.

## Behavior / Invariants

- The `characterRow` projection payload and the bootstrap payload are
  byte-identical to today (same masked fields, same wire shape).

## Done Criteria

- A load-count test shows `loadSingleCharacterRow` does a single-row read (no
  whole-corpus parse or whole-array clone).
- The `characterRow` payload is asserted byte-identical on a multi-character
  fixture.
- Gate `M4` registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/bootstrap.test.ts`.
- `pnpm api:test`, both TypeScript checks.
