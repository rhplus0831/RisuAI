# Legacy group-chat send persists user message before preflight fails

## Summary

The one-time `db.json` migration preserves legacy group-character rows, and the character resource path exposes them to the current UI. Sending from one of those group chats first appends and durably persists the user's message. Only afterward does prompt assembly reject groups as unsupported, leaving a partial user turn (and optionally a persisted error row) in a chat that can never generate a group response.

## Location

- `server/fastify/src/repository.ts:367-425,1014-1028,1514-1550`
- `server/fastify/src/routes/resourceReads.ts:268-303`
- `src/ts/server/resourceState.svelte.ts:2002-2029`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:882-1005,1056-1107`
- `src/ts/chatCommands.ts:4112-4209`
- `server/fastify/src/routes/commands.ts:5824-5866`
- `src/ts/process/index.svelte.ts:317-330`
- `src/ts/process/request/serverPromptAssembly.ts:280-309`
- `src/ts/process/sendChatErrors.ts:14-65`

## Trigger

1. Start Fastify with a legacy `db.json` containing a group character and at least one group chat.
2. Let the one-time boot migration import it to SQLite.
3. Select the group chat, type a message, and press Send.

## Expected behavior

Either group generation should work as it did before migration, or the unsupported-domain preflight should run before any user-visible or durable mutation. On rejection, the composer and persisted transcript should remain unchanged.

## Actual behavior

The new user message is optimistically appended and acknowledged by `POST /api/v1/commands/chats/:chatId/messages`; the composer is then cleared. `sendChat` subsequently calls `resolveServerPromptAssembly`, which returns `unsupported` for the group, so no generation request or assistant response occurs. The user row remains in SQLite. If `inlayErrorResponse` is enabled, `reportSendChatError` can additionally append and persist an assistant error block, but it still does not roll back the user turn.

## Underlying cause

The migration and runtime disagree about whether group rows can exist:

- `ensureDbJsonImported` writes all legacy character rows to SQLite without applying `normalizeDatabaseDefaults` or filtering groups.
- `loadCharacterRowsForRead` and `/api/v1/characters` return those rows, and `applyCharactersResource` copies them into the frontend projection without type filtering.
- The Send handler calls `appendCurrentChatUserMessageForSend` before invoking `sendChatMain`.
- The group capability check exists only inside `resolveServerPromptAssembly`, which `sendChat` reaches after the append command has completed.

The message append endpoint validates only that the chat exists; group ownership does not prevent it from committing. There is no compensating delete/rollback when later prompt preflight fails.

## Affected data flow

1. **Boot persistence:** `ensureDbJsonImported` splits the legacy group row/chats/messages into SQLite and renames `db.json` as migrated.
2. **Server read:** `/api/v1/characters` returns the group row as a normal message-free character resource.
3. **Client projection:** `applyCharactersResource` clones the row into `getDatabase().characters`, allowing it to appear and be selected.
4. **UI interaction:** `sendMain` constructs a user message and calls `appendCurrentChatUserMessageForSend`.
5. **Message request:** The client optimistically appends, then sends `POST /api/v1/commands/chats/:chatId/messages`.
6. **Server persistence/acknowledgement:** Fastify writes the message row and returns a new revision/message id.
7. **Composer state:** The UI clears the composer after the append succeeds.
8. **Late preflight:** `sendChatMain` invokes `sendChat`; `resolveServerPromptAssembly` rejects `type === 'group'` before generation dispatch.
9. **Displayed state:** The chat shows the persisted user message with no valid group response, plus an error alert or an optional persisted error block.

## Severity and user impact

**High.** Users with preserved legacy groups can enter a UI path that looks supported but creates durable partial turns on every send attempt. Their group conversations are effectively read-only without being labeled as such, and repeated attempts pollute history and memory inputs with messages that never received a response.

## Recommended fix

Run all non-mutating generation capability checks before appending or clearing the composer. Expose one preflight function used by `sendMain`, plugin sends, multisend, and other append-then-generate callers; it should validate character type, provider capability, content support, and required persisted settings against the same captured character/chat target.

If groups remain unsupported, mark legacy group rows explicitly read-only and show a migration notice. Longer term, restore server-owned group prompt assembly and response persistence. As defense in depth, a send operation could use one server transaction/job that conditionally appends the user turn only after assembly accepts the request, instead of separate append and generation phases.

## Test coverage gap

Add a boot fixture with a legacy group row, then exercise the real resource refresh and Send UI. Assert that an unsupported send performs no message command, leaves the composer intact, does not bump the revision, and does not append an error row. If group support is restored, assert the user turn and all group assistant replies are committed atomically and survive hydration.
