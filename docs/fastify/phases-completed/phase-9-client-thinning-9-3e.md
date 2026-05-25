# Phase 9-3e - Chat `scriptstate` And Scripting Side Effects

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added `PATCH /api/v1/commands/chats/:chatId/scriptstate` with the
  standard command contract: `baseRevision`, one JSON mutation, one
  revision bump, one event, and 409 `revision_conflict` handling.
- Added the `chat.scriptstate.updated` command event.
- Added typed browser helper and chat command dispatch helpers for
  partial scriptstate patches plus optional delete keys.
- Routed server-backed chat-var mutations from `/api/v1/generate/chat`
  `message_patch` replay through the scriptstate command.
- Routed browser CBS/chat-var writes, trigger `setVar` writes, and slash
  `/setvar`/`/addvar` writes through scriptstate command dispatch in
  Fastify mode while preserving local optimistic state.
- Removed the older direct `/api/v1/generate/chat` `applyImport`
  persistence path for chat-var writes; durable persistence is command
  owned now.

## Guardrails

- `PATCH /api/v1/commands/chats/:chatId` still rejects `scriptstate`;
  chat record metadata remains on the 9-3b command.
- Generation persistence remains isolated on
  `POST /api/v1/commands/chats/:chatId/generation-result`.
- Script and trigger definition editing remains deferred to 9-4b.
- Message history commands remain isolated on the 9-3c endpoints.
- The browser replay path dispatches no command outside Fastify mode.

## Tests

- Added server command coverage for successful updates, delete keys,
  empty-state cleanup, malformed payload rollback/no revision bump, 404,
  and 409.
- Added browser helper coverage for request shape and unavailable
  Fastify mode.
- Updated `/api/v1/generate/chat` tests so server assembly emits
  scriptstate mutations without directly bumping the repository revision.
- Final verification: `pnpm check`, `pnpm test`, `pnpm api:test`, and
  `pnpm build` passed. Build warnings were the existing CSS
  `::highlight`, browser externalization, plugin-timing, and chunk-size
  warnings.

## Follow-Up

- Continue with 9-3f compatibility setters and access adapters.
- 9-5 still owns the residual direct-write sweep and read-only
  `DBState.db` guard.
