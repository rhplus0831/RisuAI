# Slice: Realm Import Targeted Character Append

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: L13. Depends on
the targeted writer kit and v2 gate being present. Runtime change.

## Scope

Persist Realm character imports through targeted character/chat writers instead
of the whole-corpus `applyJsonCommandMutation` path. A successful import should
still create exactly one character, preserve staged asset behavior, emit the
same `characterCreated` command event, and return the same `characterId`.

This slice does not own CharX streaming bounds, asset staging cleanup, normal
character-create routes, or broad import/restore flows that intentionally
replace the whole database.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L13 and its v1-L7-adjacent note.
- `server/fastify/src/routes/realmImport.ts`: `appendRealmCharacter`,
  `createCharacterRecord`, staged asset commit flow.
- `server/fastify/src/routes/commands.ts`: nearby targeted character/chat
  writer-kit examples.
- `server/fastify/src/commands/mutations.ts`:
  `applyJsonCommandMutation`, `applyTargetedCommandMutation`,
  `TARGETED_MUTATION_PATHS`.
- `server/fastify/src/repository.ts`: targeted character/chat writers. Add an
  insert helper for a new character row if one does not already exist.
- Existing focused tests:
  `server/fastify/__tests__/realmImport.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Replace `appendRealmCharacter`'s `applyJsonCommandMutation` call with
  `applyTargetedCommandMutation` and a targeted mutation path label.
- Check duplicate character ids with a targeted SQLite existence read instead
  of repairing/scanning the full character collection.
- Insert the new character row and any extracted chat rows through writer-kit
  helpers inside the mutation transaction. Preserve the storage contract:
  character `data_json` has no `chats`, chat `data_json` has no
  `message`/`hypaV3Data`, and message rows remain in the message store if the
  imported card creates any.
- Preserve character position/order semantics from the broad append path.
- Keep asset staging/commit error behavior outside the mutation path
  unchanged.
- Add load-count coverage proving one Realm append performs zero
  whole-corpus loads and zero full-database clones.
- Register L13 as `DONE` in the v2 gate with focused behavior and load-count
  tests, and flip the L13 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- Duplicate character id rejection must not bump the revision or emit a
  command event.
- Imported character rows, chat rows, command events, and returned payloads
  must remain byte-identical to the broad path fixtures.
- Asset metadata/content commit and cleanup semantics must not change.
- Do not use a broad rewrite to append the character unless a documented
  pre-extraction fallback state requires it.

## Done Criteria

- Realm import tests cover successful append, duplicate id rejection, and asset
  staging behavior.
- Load-count tests fail if `appendRealmCharacter` reaches `loadPersisted` for
  the normal append case.
- The v2 gate and active-risk row mark L13 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
