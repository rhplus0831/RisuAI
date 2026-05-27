# Phase 9 Client Thinning - 9-3c Messages

Date: 2026-05-25

9-3c is closed. It moves user-visible message history mutations behind
typed Fastify commands in server-backed web mode while leaving legacy local mode
mutation behavior intact.

## Landed

- Added `server/fastify/src/commands/messages.ts` for message validation,
  stable `message.chatId` addressing, per-chat transcript normalization,
  message lookup, truncate validation, and replacement validation.
- Added Fastify message command routes:
  `POST /api/v1/commands/chats/:chatId/messages`,
  `PATCH /api/v1/commands/messages/:messageId`,
  `DELETE /api/v1/commands/messages/:messageId`,
  `POST /api/v1/commands/chats/:chatId/messages/truncate`, and
  `PUT /api/v1/commands/chats/:chatId/messages`.
- Added command events: `message.appended`, `message.updated`,
  `message.deleted`, `message.truncated`, and `messages.replaced`.
- Added typed browser helpers in `src/ts/server/commands.ts` and
  optimistic dispatch/rollback helpers in `src/ts/chatCommands.ts`.
- Routed Fastify-mode visible transcript edits, partial edits, deletes,
  truncates, disable toggles, playground role toggles, bookmark message-id
  setup, send/reroll transcript replacement, and playground blank-message
  append through message commands.
- Preserved existing `message.chatId` as the public message id. Missing or
  duplicate ids are normalized during message command mutations.

## Notes For Later Slices

- `PATCH /api/v1/commands/messages/:messageId` intentionally rejects
  `generationInfo`. Durable generation metadata belongs to 9-3d's
  generation persistence command.
- The server-backed generation `message_patch` and restoration helpers
  still mutate local projection state directly. 9-3d should replace the
  durable portion of those paths with
  `POST /api/v1/commands/chats/:chatId/generation-result` while keeping
  transient streaming display state local.
- Script-trigger, CBS, plugin, MCP, and generic mutable `getDatabase()`
  message bypasses remain assigned to 9-3e and 9-3f.
- 9-5 still owns the residual direct-write sweep before enabling the
  read-only `DBState.db` guard.

## Covered

- Fastify message append/update/delete/truncate/replace success paths.
- Stable `message.chatId` addressing and id normalization during message
  command mutations.
- Validation/no-revision-bump behavior for duplicate replacement ids and
  fields owned by later slices.
- 404 missing message behavior and 409 stale-revision conflict behavior.
- Browser helper request shapes for all message commands.
- Browser helper conflict retry remains covered by the shared
  `runServerCommand` tests.

## Verification

Passed before closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 680 tests passed, 4 skipped.
- `pnpm api:test` - 1090 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-3d - Generation persistence handoff**:

- Add `POST /api/v1/commands/chats/:chatId/generation-result`.
- Persist assistant row writes, reroll data, prompt info, generation info,
  and terminal post-generation metadata after server-backed generation.
- Keep transient streaming display state browser-local.
- Keep generic message history edits on the 9-3c commands and chat
  scriptstate on the later 9-3e command.
