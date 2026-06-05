# Slice: Chat-Create Targeted Writer Kit

Phase: [1](../../phase-1-high-severity-hot-paths.md). Finding: H2. Depends on
the Phase 0 v2 gate being present. Runtime change.

## Scope

Convert `POST /api/v1/commands/characters/:characterId/chats` from the broad
hydrated mutation path to the targeted writer-kit path. The route should still
create one chat, optionally select it, persist any client-supplied messages for
that new chat, and return the same revision/event/extra shape.

This slice does not own Realm import (L13), chat patch/delete/fork behavior, or
any broad mutation consumer that truly needs a whole-corpus snapshot.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  H2 and the verifier note that H2 is not covered by the `v1-L7` gate.
- `server/fastify/src/routes/commands.ts`:
  `POST /api/v1/commands/characters/:characterId/chats` and the fork route's
  `applyTargetedCommandMutation` writer-kit shape.
- `server/fastify/src/commands/mutations.ts`:
  `applyJsonCommandMutation`, `applyTargetedCommandMutation`,
  `TARGETED_MUTATION_PATHS.characterRow`.
- `server/fastify/src/messageStore.ts`:
  `activeMessageIdExists`, `replaceActiveChatMessages`.
- Existing focused tests:
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Keep request parsing and validation names unchanged:
  `readCharacterId`, `readBaseRevision`, `createChatRecord`,
  `readReplacementMessages`, and the default `selectCreated = true`.
- Replace the route's `applyJsonCommandMutation` call with
  `applyTargetedCommandMutation` using
  `mutationPath: TARGETED_MUTATION_PATHS.characterRow`.
- In the mutator, continue to build the same message-free command database
  surface used by neighboring character/chat targeted routes:
  `ensureModuleCommandDatabase`, `normalizeAllCharacterChats`, and
  `ensureModuleRecords`.
- Preserve duplicate validation:
  duplicate chat ids are checked across character chat rows, and duplicate
  message ids are checked with the targeted message-store helper instead of
  a whole-corpus hydrated scan.
- Preserve module and folder validation before writing.
- Persist the narrow writes in the fork-route pattern:
  `writeCharacterChatRows(innerDb, characterId, character.chats)`,
  `insertCharacterChatRow(innerDb, characterId, 0, chat)`,
  `replaceActiveChatMessages(innerDb, chat.id, chatMessages)`, and
  `writeSingleCharacterRow(innerDb, characterId, character)`.
- Add or update regression coverage so the created-chat response, selected chat,
  revision bump, command event, chat order, message rows, and duplicate-id
  failures match the previous broad-path fixture semantics.
- Register H2 as `DONE` in the v2 gate with the focused load-cost and behavior
  tests, and flip the H2 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- The chat-create route must perform zero whole-corpus message reads,
  zero `loadPersistedWithMessages` hydrates, and zero full database deep clones.
- Existing chats' messages are untouched; only the new chat's message rows may
  be inserted/replaced.
- `baseRevision` handling, active-writer origin, revision bumping, command-event
  persistence, and route auth stay on the existing mutation framework.
- `select: false` must preserve the previous selected chat when one exists.
- Broad mutation helpers remain available for routes that genuinely need them.

## Done Criteria

- Focused load-count assertions fail if chat-create hydrates all messages or
  falls back to `applyJsonCommandMutation`.
- Behavior assertions prove the response and persisted state are byte-identical
  to the broad path on the fixture, including duplicate chat/message id
  rejection without a revision bump.
- The H2 v2 gate entry points at real tests and the risk-map row is `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
