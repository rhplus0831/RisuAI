# Command-Mutation Read Narrowing

Status: DONE (`e0e86ab1`). Phase 2. Covers M3, L5, L6: command-mutation read cost.

Landed shape:

- `loadPersistedForChatMutation(db, dataDir, { chatId | messageId })`
  (`server/fastify/src/repository.ts`): loads exactly the target chat row +
  its parent character row — no collection tables, no plugin storage, no
  assets scan, no sibling character/chat payload parse. `messageId` targets
  resolve their chat through the indexed `uid` column (id-only read). Unknown
  ids and the pre-extraction embedded state fall back to the broad
  `loadPersisted`, so 404 contracts and the global dedup edge are unchanged.
- `applyTargetedCommandMutation` gains opt-in `chatScopedRead`, hard-guarded
  against `writeDatabase` (a one-character read written back whole would
  delete every other character).
- Wired routes (all writes already targeted, reads now too): scriptstate
  PATCH, message append / PATCH / DELETE / truncate / PUT, generation-result.
- Dedup invariant: the chats table PRIMARY KEY makes cross-character chat-id
  duplicates impossible in every state the scoped read serves; the embedded
  state (the one place duplicates can exist) falls back broad where
  `normalizeAllCharacterChats` still repairs them — regression-tested.
- Harness: `messages.uid` registered as a row-scoping predicate
  (`loadCostHarness.ts`).
- Regression tests: `commandMutationReadNarrowing.test.ts` (scoped scriptstate
  PATCH, scoped full message lifecycle, loader equivalence, broad-fallback
  404s, embedded-state dedup, writeDatabase guard).

## Scope

Every command mutation calls `loadPersisted`, which loads collections,
characters/chat metadata, and assets. Message/scriptstate/generation hot paths
only touch `characters`. Narrow the read.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M3, L5, L6.
- `server/fastify/src/repository.ts:735/747` (`loadPersisted`),
  `:129-155` (`loadCollectionsFromSqlite`), `:288` (`loadCharactersFromSqlite`),
  `:629` (`getAllAssetMetadata`).
- `server/fastify/src/commands/mutations.ts:147` (`applyTargetedCommandMutation`);
  the message/scriptstate/generation mutate callbacks.
- `server/fastify/src/commands/chats.ts:417` (`normalizeAllCharacterChats`),
  `:305` (`requireChatLocation`).
- Hot routes: `server/fastify/src/routes/commands.ts` scriptstate `:3310`,
  message append `:3360`, message PATCH `:3402`, message DELETE `:3447`,
  messages PUT `:3537`, generation-result `:3578`.

## Planned Shape

- Add a field-scoped SQLite loader or a per-request memo so each mutation parses
  only the tables it reads.
- Note: `loadPersistedDatabaseFields`/`selectDatabaseFields` do not help —
  they call `loadPersisted` then slice the already-parsed result. A real fix needs
  a new field-scoped read or memo.
- L5: skip the asset-table scan for mutations that do not read assets.
- L6: narrow message-only character/chat reads while preserving
  `normalizeAllCharacterChats` cross-character dedup.

## Behavior / Invariants

- Revision contract, command-event emission, and the persisted result are
  unchanged.
- `normalizeAllCharacterChats` global dedup still holds (it is the main risk of
  the character-read narrowing — verify on a multi-character fixture).
- Write side is already narrowed (these routes leave `writeDatabase` falsy); do
  not touch it.

## Done Criteria

- [x] A load-count test shows a message/scriptstate/generation mutation parses only
  the tables it reads (no collection / asset / message-body parse) —
  `commandMutationReadNarrowing.test.ts` wraps the seven routes in
  `assertScopedLoadOnHotPath`.
- [x] The cross-character chat/folder-id dedup invariant is covered by a test
  (embedded-state fallback + `normalizeAllCharacterChats` repair).
- [x] Gates `M3`, `L5`, `L6` registered in Phase 8 (`fixCompletenessGate.test.ts`).

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts`.
- `pnpm api:test -- server/fastify/__tests__/commands*.test.ts`.
- `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.
