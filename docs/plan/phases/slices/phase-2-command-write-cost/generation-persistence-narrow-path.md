# Generation Persistence Narrow Path

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/messageStore.ts`

## Scope

Reduce whole-corpus persistence passes around chat generation side effects and
final result persistence where the required writes can be represented as
targeted message, scriptstate, or metadata changes.

Selected batch:

- Move `generation.persisted` final assistant-message writes for
  `/api/v1/commands/chats/:chatId/generation-result` and server-owned chat
  generation finalization from the hydrated command path to a targeted SQLite
  message-row path.
- Source files:
  - `server/fastify/src/commands/mutations.ts`
  - `server/fastify/src/messageStore.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/src/routes/generationChat.ts`
  - focused command / durable generation tests
- Durable mutation behavior:
  - read message-free `db.json` only to validate the target chat and apply
    optional post-generation scriptstate changes;
  - append or replace one active SQLite message row in the selected chat;
  - preserve regenerate alternates and clear send/continue alternates in the
    same transaction;
  - write `db.json` after commit only when scriptstate changed.
- Event behavior: unchanged `generation.persisted` shape with one revision bump
  and one command event.
- Rollback behavior: stale revisions, missing chats or targets, duplicate
  message ids, and validation failures roll back message-row writes, alternate
  writes, revision bumps, and event rows before event emission. `db.json` is not
  written before the SQLite commit.

Implemented result:

- `applyTargetedCommandMutation` can optionally persist message-free `db.json`
  after commit for targeted writes that also change projected metadata such as
  scriptstate.
- `writeGenerationChatMessage` appends or replaces one active SQLite message row
  by generation id or explicit target id.
- The browser command route and server-owned finalization route both emit the
  unchanged `generation.persisted` event through `targeted-generation`.
- Focused command coverage proves a repeated `generationId` replaces the
  existing row instead of appending a duplicate.
- Latest isolated metric harness sample:

| Command type           | mutationPath        | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ---------------------- | ------------------- | -----: | ------------: | -----------: | ------------: | ------: |
| `generation.persisted` | targeted-generation |   0.38 |          1.06 |         0.07 |          0.00 |    3.06 |

## Protocol Behavior

- Preserve idempotence by `generationId`.
- Preserve final assistant message persistence and scriptstate behavior.
- Keep prompt assembly side effects explicit, measured, and revision-tracked
  when they affect projected state.

## Done When

- Generation persistence avoids unnecessary full database clone work for a
  selected path.
- Transient and terminal persistence failures remain visible.
- Tests prove no duplicate assistant rows for repeated persistence attempts.

## Validation

- Passed: `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- Passed:
  `pnpm api:test -- server/fastify/__tests__/commands.test.ts -t "generation persistence command"`
- Passed:
  `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Passed: `pnpm client-thinning:audit`
