# Message And Chat Targeted Persistence

Status: partially implemented; `message.appended` completed on 2026-06-01.

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

- `POST /api/v1/commands/chats/:chatId/messages` now uses a
  `targeted-message` mutation path.
- Source files changed:
  - `server/fastify/src/commands/mutations.ts`
  - `server/fastify/src/messageStore.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/__tests__/commandMetrics.test.ts`
- Durable mutation behavior: the command reads the message-free `db.json` only
  to validate the target chat, checks the SQLite active-message uid index for
  duplicate ids, appends one active `messages` row at the next sequence, then
  bumps the revision and persists one command event in the same transaction.
- Event behavior: unchanged `message.appended` event shape with parent chat id;
  one command still emits one event for one revision bump.
- Rollback behavior: stale revisions, missing chats, duplicate ids, or thrown
  validation errors roll back the SQLite append, revision bump, and event row
  before any event emission. The path does not write `db.json`.

Remaining scope:

- Message update/delete/truncate/replace commands still use the hydrated path.
- Chat metadata commands still use the hydrated path.

## Protocol Behavior

- Keep complex mutations on the generic path until targeted row ownership is
  proven.
- Preserve reroll alternates and `hypaV3Data` split-store semantics.
- Do not emit more than one event for one revision bump.

## Done When

- `message.appended` selected with explicit active-row ownership in the
  `messages` table. Completed.
- Tests prove unchanged conflict and projection refresh behavior for the
  selected path. Completed for append through the command suite and hydration
  assertions.
- Metrics show the path avoids full chat diff scans. Completed:
  `message.appended` moved from `hydrated` to `targeted-message` and recorded
  `dbJsonWriteMs: 0`.
- Select the next chat/message family before expanding this slice further.

## Validation

- Focused command tests for selected message or chat family.
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
