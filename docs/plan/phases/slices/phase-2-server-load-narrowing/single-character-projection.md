# Single-Character Projection & Mask

Status: DONE (`254b3112`). Phase 2. Covers M4.

## Landed Shape

- `repository.loadSingleCharacterStubRow` — `WHERE id = ?` character read +
  `WHERE character_id = ?` chat rows, same stub contract as the broad loader
  (message-free chats, `enableLorebookStubs` strip). Falls back to the broad
  stubbed loader for any state the row read cannot serve (uninitialized
  settings, missing SQLite row: unknown-id 404s and pre-extraction embedded
  characters stay identical).
- `providerSecrets.maskProviderSecretsInPlace` — opt-in no-clone variant for
  owned freshly-parsed objects; the copying `maskProviderSecrets` contract is
  unchanged (it delegates to the in-place variant after its clone).
- `routes/projection.loadSingleCharacterRow` masks just the owned row (wrapped
  as `{ characters: [row] }` so the root-relative secret paths still apply);
  `routes/bootstrap` masks the freshly-built stub projection in place (clearly
  safe: nothing else references it).
- Regressions in `server/fastify/__tests__/serverLoadCostHarness.test.ts` (M4
  block: route load-count, per-character byte-identity vs the pre-M4 broad
  composition, lorebook-stub parity, embedded-characters fallback, bootstrap
  byte-identity + on-disk secrets intact) and
  `server/fastify/__tests__/providerSecrets.test.ts` (mask parity/mutation).

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

- [x] A load-count test shows `loadSingleCharacterRow` does a single-row read
      (`M4: the characterRow projection performs zero whole-corpus payload
      reads`).
- [x] The `characterRow` payload is asserted byte-identical on a
      multi-character fixture (`M4: the single-row loader is byte-identical to
      the broad composition for every character`).
- [x] Gate `M4` registered in Phase 8 (`fixCompletenessGate.test.ts`).

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/bootstrap.test.ts`.
- `pnpm api:test`, both TypeScript checks.
