# MCP module chat and character link controls always reject

## Summary

The chat module picker renders its normal per-chat and per-character link control for stored MCP module rows. Both client paths optimistically add the MCP ID to the selected chat or character, but the Fastify validators intentionally permit only non-MCP modules in those fields. The request therefore fails, the optimistic selection reverts, and the picker never explains the failure.

This is distinct from `mcp-module-enable-command-rejects.md`: that issue follows the global-enable globe through `POST /modules/enable`, while this issue follows the chat picker through chat-row and character-row commands.

## Location

- `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:83-134`
- `src/ts/moduleCommands.ts:1918-1977,2039-2083`
- `server/fastify/src/routes/commands.ts:5196-5225,7326-7349`
- `server/fastify/src/commands/modules.ts:163-183`
- `server/fastify/__tests__/commands.test.ts:8964-8974,12843-12850`

## Trigger

1. Import an MCP server so that it appears as an MCP module.
2. Open the module picker from a chat.
3. Left-click the MCP row's check control to link it to the current chat, or right-click the same control to link it to the current character.

## Expected behavior

The picker should expose only operations the server supports. If MCP modules are valid scoped modules, the selection should persist and remain selected after reconciliation and reload. If MCP modules are intentionally never linkable to chats or characters, their scoped link control should be hidden or disabled and the supported MCP activation mechanism should be clear.

## Actual behavior

The MCP row looks selectable just like a normal module. On activation, the check state changes optimistically, then returns to its previous state when the server rejects the ID. No error is displayed, so the interaction appears to be a transient or unreliable selection.

## Underlying cause

`ModuleChatMenu.svelte` uses `getResourceDatabase().modules` without filtering out rows with `rmodule.mcp`. The MCP icon is rendered, but the same generic click and context-menu handlers remain enabled.

The client toggle functions do not validate the module kind. They immediately update the projected `chat.modules` or `character.modules`, then dispatch a durable command. On the server, both request paths call `validateNormalModuleLinks`, which builds its allow-list from `modules.filter((module) => !module.mcp)`. A stored MCP ID is consequently reported as an unknown module even though it is present in the module collection.

The client command dispatch eventually rolls back the matching optimistic attempt, but the picker receives no command result and has no error state to render.

## Affected data flow

### Per-chat link

1. **UI interaction:** `ModuleChatMenu.svelte:111-127` calls `toggleSelectedChatModule(rmodule.id)` for the MCP row.
2. **Client projection:** `moduleCommands.ts:2039-2062` adds the ID to the active chat's `modules` array under a trusted resource write and reloads the UI/runtime projection.
3. **Request:** `moduleCommands.ts:1918-1945` dispatches `PATCH /api/v1/commands/chats/:chatId` with `patch.modules` containing the MCP ID.
4. **Server mutation:** `routes/commands.ts:5196-5225` validates the replacement list before writing the chat row. `commands/modules.ts:167-177` excludes MCP records, so validation throws and the row is not persisted.
5. **Response and UI:** the command layer classifies the `400` as a terminal rejection and runs the scoped rollback. The check state reverts, but the fire-and-forget UI handler has no acknowledgement or error presentation.

### Per-character link

1. **UI interaction:** `ModuleChatMenu.svelte:128-132` calls `toggleSelectedCharacterModule(rmodule.id)` on the row's context-menu action.
2. **Client projection:** `moduleCommands.ts:2065-2083` adds the ID to the selected character's `modules` array.
3. **Request:** `moduleCommands.ts:1948-1977` dispatches `POST /api/v1/commands/characters/:characterId/modules/reorder` with the MCP ID in `moduleIds`.
4. **Server mutation:** `routes/commands.ts:7326-7349` calls `validateCharacterModuleLinks`, which delegates to the same MCP-excluding validation and rejects the request before the character row is written.
5. **Response and UI:** the optimistic character link is rolled back without a visible failure message.

The Fastify integration tests already confirm both server outcomes: an MCP ID in `patch.modules` and an MCP ID in character `moduleIds` each return `400`.

## Severity and user impact

**High.** Every scoped activation control offered for an imported MCP module is guaranteed to fail. Users see an unexplained select-then-revert interaction and may repeatedly retry or assume their chat/character configuration is corrupt. Together with the separately documented global-enable mismatch, this leaves no reliable activation path through the module UI.

## Recommended fix

Choose and enforce one shared MCP activation contract across the collection projection and all three UI actions:

- If MCP modules should be linkable, update the chat and character link validators to accept existing MCP IDs, then verify runtime module/MCP resolution consumes those scoped references.
- If MCP modules are intentionally global-only or otherwise activated separately, filter or disable MCP rows in normal `ModuleChatMenu` mode. Keep them visible only in selection contexts where an MCP ID is actually supported, and explain the supported activation path.

In either case, return or expose a promise/result from the toggle functions and render a localized command error when a scoped mutation is rejected. Add component tests asserting that MCP rows do not expose unsupported scoped controls, plus an end-to-end persistence test for whichever activation path is supported.
