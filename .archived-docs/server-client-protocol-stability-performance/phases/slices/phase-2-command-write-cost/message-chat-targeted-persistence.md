# Message And Chat Targeted Persistence

Status: implemented on 2026-06-01 for `chat.updated`, `message.appended`,
`message.updated`, `message.deleted`, `message.truncated`, and
`messages.replaced`.

## Source Anchors

- `server/fastify/src/messageStore.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`

## Scope

Narrow chat metadata and one-chat message history commands so they no longer
scan every chat or hydrate every message.

Implemented routes:

- `PATCH /api/v1/commands/chats/:chatId` uses `message-free` mutation for chat
  metadata.
- `POST /api/v1/commands/chats/:chatId/messages` uses `targeted-message` append.
- `PATCH`/`DELETE /api/v1/commands/messages/:messageId`,
  `POST /api/v1/commands/chats/:chatId/messages/truncate`, and
  `PUT /api/v1/commands/chats/:chatId/messages` use `targeted-message` for
  edit/delete/truncate/replace.

Current behavior:

- Chat metadata updates read and write message-free `db.json`, keep SQLite
  message rows intact, and write `db.json` only after SQLite revision/event
  commit.
- Message commands read message-free `db.json` only to validate chat ownership,
  then update active SQLite `messages` rows for one chat in the same transaction
  as the revision bump and command event.
- Reroll alternate rows and `hypaV3Data` split-store semantics are preserved.
- Existing event shapes and one-event-per-revision behavior are unchanged.
- Stale revisions, missing chats/messages, duplicate ids, and validation
  failures roll back row writes, revision bumps, and event rows before live
  event emission.

Remaining Phase 2 scope is broader generation/prompt side-effect cost, not this
chat/message slice.

## Protocol Behavior

- Keep complex mutations on the generic path until targeted row ownership is
  proven.
- Preserve reroll alternates and `hypaV3Data` split-store semantics.
- Do not emit more than one event for one revision bump.

## Done When

- `chat.updated` reports `message-free`.
- Message append/edit/delete/truncate/replace report `targeted-message` and
  avoid `db.json` writes.
- Focused command tests cover conflicts, rollback, projection refresh behavior,
  row ownership, and reroll alternate preservation.

## Validation

- Focused command tests for selected message or chat family.
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
