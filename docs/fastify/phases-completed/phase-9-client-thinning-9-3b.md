# Phase 9 Client Thinning - 9-3b Chats

Date: 2026-05-25

9-3b is closed. It moves chat record lifecycle, chat-folder lifecycle,
chat selection, folder assignment/order, notes, persona binding, and
bookmark metadata behind typed Fastify commands in server-backed web mode
while leaving legacy local mode mutation behavior intact.

## Landed

- Added `server/fastify/src/commands/chats.ts` for chat/folder
  normalization, stable `chat.id` lookup, parent-character validation,
  chat/folder order validation, and metadata patch allowlists.
- Added Fastify chat command routes:
  `POST /api/v1/commands/characters/:characterId/chats`,
  `PATCH /api/v1/commands/chats/:chatId`,
  `DELETE /api/v1/commands/chats/:chatId`,
  `POST /api/v1/commands/chats/:chatId/fork`, and
  `POST /api/v1/commands/characters/:characterId/chats/reorder`.
- Added Fastify chat-folder command routes:
  `POST /api/v1/commands/characters/:characterId/chat-folders`,
  `PATCH /api/v1/commands/chat-folders/:folderId`,
  `DELETE /api/v1/commands/chat-folders/:folderId`, and
  `POST /api/v1/commands/characters/:characterId/chat-folders/reorder`.
- Added command events: `chat.created`, `chat.updated`, `chat.deleted`,
  `chat.forked`, `chat.reordered`, `chatFolder.created`,
  `chatFolder.updated`, `chatFolder.deleted`, and
  `chatFolder.reordered`.
- Added typed browser helpers in `src/ts/server/commands.ts` and
  optimistic dispatch/rollback helpers in `src/ts/chatCommands.ts`.
- Added `src/ts/server/chatBridge.svelte.ts` for debounced Fastify-mode
  chat and folder metadata patches from direct Svelte bindings.
- Routed server-backed chat selection, chat create/delete/fork/reorder,
  chat-folder create/update/delete/reorder, import insertion, author-note
  edits, persona binding, and bookmark metadata through commands.

## Notes For Later Slices

- Chat metadata patches intentionally reject fields owned by later
  slices, especially `message`, `localLore`, `scriptstate`, generation
  persistence fields, and later child collections.
- Message rows still use the existing local mutation path. 9-3c should
  decide whether `message.chatId` remains the public stable message id or
  whether message rows get a normalized `id` field in the current schema.
- Chat import still decodes files in the browser and dispatches per-chat
  or per-folder commands. Server-side `.risu` and bundle import/export
  remain in 9-7 and 9-8.
- The debounced metadata bridge is a transition helper until 9-5
  projection/enforcement. 9-5 should still sweep chat surfaces before
  turning on the read-only `DBState.db` guard.
- 9-3f still owns compatibility setters and hidden mutation bypasses such
  as plugin/MCP chat writes and generic mutable `getDatabase()` adapters.

## Covered

- Fastify chat create/update/delete/fork/reorder success paths.
- Fastify chat-folder create/update/delete/reorder success paths.
- Parent character ownership and stable `chat.id` / folder-id addressing.
- Validation/no-revision-bump behavior for malformed chat patches,
  duplicate chat reorder payloads, and unknown folder assignments.
- 404 missing chat behavior and 409 stale-revision conflict behavior.
- Browser helper request shapes for all chat and chat-folder commands.
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
- `pnpm test` - 679 tests passed, 4 skipped.
- `pnpm api:test` - 1087 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-3c - Message history commands**:

- Add message append/update/delete/truncate/replace commands from the
  locked command map.
- Normalize or preserve stable message ids before public commands address
  individual rows.
- Route server-backed transcript append, edit, delete, truncate, disable,
  role/name, prompt-info, and whole-transcript replacement paths through
  typed commands.
- Keep generation persistence, chat scriptstate, compatibility setters,
  lorebook/script/trigger child collections, projection enforcement,
  plugin bridge work, and server `.risu` codec work in their later slices.
