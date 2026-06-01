# Message And Chat Targeted Persistence

Status: partially implemented; `chat.updated` and `message.appended` completed
on 2026-06-01.

## Source Anchors

- `server/fastify/src/messageStore.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`

## Scope

Evaluate targeted helpers for message append/edit and chat metadata updates so
they can update message rows or message-free `db.json` without scanning every
chat.

Implemented batch:

- `PATCH /api/v1/commands/chats/:chatId` now uses a `message-free` mutation
  path for chat metadata updates.
- `POST /api/v1/commands/chats/:chatId/messages` now uses a
  `targeted-message` mutation path.
- Source files changed:
  - `server/fastify/src/commands/mutations.ts`
  - `server/fastify/src/messageStore.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/__tests__/commandMetrics.test.ts`
  - `server/fastify/__tests__/commands.test.ts`
- Durable mutation behavior: the command reads the message-free `db.json` only
  to validate the target chat, checks the SQLite active-message uid index for
  duplicate ids, appends one active `messages` row at the next sequence, then
  bumps the revision and persists one command event in the same transaction.
- Durable mutation behavior for `chat.updated`: the command reads and writes
  message-free `db.json`, preserves SQLite message rows, strips any normalized
  chat message payloads before writing `db.json`, then bumps the revision and
  persists one command event in the same transaction.
- Event behavior: unchanged `chat.updated` and `message.appended` event shapes
  with parent ids; one command still emits one event for one revision bump.
- Rollback behavior: stale revisions, missing chats, duplicate ids, or thrown
  validation errors roll back the SQLite append, revision bump, and event row
  before any event emission. The targeted-message append path does not write
  `db.json`; the message-free chat update writes `db.json` only after SQLite
  commit.

Remaining scope:

- Message update/delete/truncate/replace commands still use the hydrated path.

## Protocol Behavior

- Keep complex mutations on the generic path until targeted row ownership is
  proven.
- Preserve reroll alternates and `hypaV3Data` split-store semantics.
- Do not emit more than one event for one revision bump.

## Done When

- `message.appended` selected with explicit active-row ownership in the
  `messages` table. Completed.
- `chat.updated` selected with explicit message-free `db.json` ownership and no
  SQLite message-row ownership. Completed.
- Tests prove unchanged conflict and projection refresh behavior for the
  selected path. Completed for append through the command suite and hydration
  assertions; completed for chat metadata with rowid stability and message-free
  `db.json` assertions.
- Metrics show the path avoids full chat diff scans. Completed:
  `message.appended` moved from `hydrated` to `targeted-message` and recorded
  `dbJsonWriteMs: 0`; `chat.updated` moved from `hydrated` to `message-free`
  with the command harness recording `totalMs: 3.53`.
- Select the next chat/message family before expanding this slice further.

## Validation

- Focused command tests for selected message or chat family.
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
