# Slice: Character/Chat PATCH Scoped Reads

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: M5. Depends on
the targeted writer kit and v2 gate being present. Runtime change.

## Scope

Convert the single-row character PATCH and chat PATCH routes from broad
message-free corpus reads plus whole-corpus repair into targeted reads and
target-row repair. The routes should still PATCH the same row, validate the
same links, write the same SQLite rows, and return the same
revision/event/extra shape.

This slice does not own chat-create, chat delete/fork/reorder behavior,
generation finalization, Realm import, or any command route that genuinely
needs a whole-corpus snapshot.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M5 and its modules-aware scoped-read constraint.
- [`../../phase-2-server-corpus-ring-2.md`](../../phase-2-server-corpus-ring-2.md)
  planned shape and exit criteria.
- `server/fastify/src/routes/commands.ts`: character PATCH around
  `ensureCharacterCollection`, and chat PATCH around
  `normalizeAllCharacterChats`, `ensureModuleRecords`, and
  `validateNormalModuleLinks`.
- `server/fastify/src/commands/characters.ts`: `ensureCharacterCollection`,
  `repairCharacterRecord`.
- `server/fastify/src/commands/chats.ts`: `normalizeAllCharacterChats`,
  `requireChatLocation`.
- `server/fastify/src/commands/mutations.ts`: `applyTargetedCommandMutation`,
  `TARGETED_MUTATION_PATHS`, `chatScopedRead`.
- `server/fastify/src/repository.ts`: `loadPersistedForChatMutation`,
  `writeSingleCharacterRow`, `writeSingleChatRow`,
  `writeCharacterChatRows`.
- Existing focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/commandSingleRowPaths.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Re-verify the route symbols before editing; the audit line numbers are
  anchors, not a substitute for reading current code.
- Character PATCH should repair and validate only the target character row.
  Collapse the duplicate `ensureCharacterCollection` pass into one targeted
  repair/write path.
- Chat PATCH should use a chat-scoped read for ordinary metadata patches:
  pass `chatScopedRead` to `applyTargetedCommandMutation` and write only the
  target chat/character rows that actually changed.
- Preserve the `patch.modules` validation semantics. Preferred shape: extend
  the scoped read so `loadPersistedForChatMutation` can carry module records
  for `ensureModuleRecords`/`validateNormalModuleLinks`. Acceptable fallback:
  use the broad read only when `patch.modules` is present, with a test that
  proves non-module chat PATCHes remain scoped.
- Keep `baseRevision`, transaction boundaries, active-writer origin,
  command-event persistence, and metric emission on the existing mutation
  framework.
- Add load-count coverage proving character PATCH parses only the target
  character row and chat PATCH parses only the target chat/parent character
  row unless the intentional `patch.modules` fallback is taken.
- Register M5 as `DONE` in the v2 gate with the focused behavior and
  load-count tests, and flip the M5 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- Unknown character/chat ids, invalid module links, duplicate ids, and
  revision mismatches must return the same status/body shape as before.
- Persisted character and chat rows must remain byte-identical for unchanged
  fields; message rows and unrelated rows must not be touched.
- Do not combine `chatScopedRead` with `writeDatabase`; scoped reads must be
  persisted through writer-kit calls only.
- A chat PATCH without `patch.modules` must not read or parse sibling
  character/chat rows.

## Done Criteria

- Focused tests fail if either PATCH route falls back to `loadPersisted` for a
  normal single-row edit.
- Behavior assertions prove patched state, event payloads, selected chat, and
  error cases match the previous broad path.
- The v2 gate and active-risk row mark M5 `DONE` with real regression-test
  evidence.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
