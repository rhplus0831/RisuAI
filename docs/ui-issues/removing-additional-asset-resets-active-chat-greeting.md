# Removing an additional asset resets the active chat greeting

## Summary

The Character editor's Remove button for an additional asset also sets the active chat's `fmIndex` to `-1`. This unrelated chat mutation immediately switches the displayed first message to the character's primary greeting and is then persisted by the mounted Fastify chat-metadata bridge.

## Location

- `src/lib/SideBars/CharConfig.svelte:148-199,247-260,1543-1587`
- `src/ts/chatCommands.ts:2508-2535`
- `src/ts/server/characterBridge.svelte.ts:137-166,246-330`
- `src/ts/server/chatBridge.svelte.ts:88-189,213-241,289-311`
- `src/ts/server/commands.ts:3297-3335`
- `server/fastify/src/routes/commands.ts:4912-4964,5196-5260`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1755-1796`

## Trigger

1. Open a chat whose selected greeting is an alternate (`fmIndex >= 0`).
2. Open the active character's Character editor.
3. In Additional Assets, remove any asset.
4. Wait for the normal debounced server-backed profile/metadata persistence or reload the chat.

## Expected behavior

Removing an additional asset should change only the character's `additionalAssets` field (and any directly related asset-preview settings). It should not change which greeting an existing chat selected.

## Actual behavior

The active chat immediately changes to `fmIndex = -1`, so its greeting bubble switches from the selected alternate greeting to `firstMessage`. The chat-metadata watcher queues that unrelated change and Fastify persists it. Reloading does not restore the previous greeting.

## Underlying cause

The additional-asset trash handler contains a call to `setCurrentChatGreetingIndex(-1, { dispatch: false })` immediately before splicing the asset list. This appears to be a copy/paste from the alternate-greeting removal handler below it.

`dispatch: false` prevents an immediate explicit chat command, but it does not make the mutation transient. `setCurrentChatGreetingIndex()` still writes `liveChat.fmIndex`. `CharConfig` mounts `watchServerBackedChatMetadata()`, which diffs all allowed chat metadata, detects `fmIndex`, and issues a debounced chat PATCH. In parallel, the character draft/profile bridge persists the intended `additionalAssets` edit as a separate character PATCH. Fastify therefore accepts two independent durable mutations from one asset button click.

## Affected data flow

1. **UI action:** The Additional Assets trash button invokes `setCurrentChatGreetingIndex(-1, { dispatch: false })`, then removes the asset from `characterDraft.value.additionalAssets` (`CharConfig.svelte:1543-1587`).
2. **Client state:** `setCurrentChatGreetingIndex()` mutates the selected chat row even with dispatch disabled (`chatCommands.ts:2508-2535`). The draft mutation separately updates the live character profile.
3. **Requests:** The character profile watcher sends the intended `PATCH /api/v1/commands/characters/:characterId`; the chat metadata watcher notices the unrelated `fmIndex` diff and sends `PATCH /api/v1/commands/chats/:chatId` after its 300 ms debounce (`characterBridge` through `commands.ts:3321-3335`; `chatBridge.svelte.ts:88-189,213-241,289-311`).
4. **Server persistence:** The character route writes the asset list. The chat route merges `{ fmIndex: -1 }` into the chat row and writes it independently (`routes/commands.ts:4912-4964,5196-5250`).
5. **Response:** Both routes return successful revisioned events. Neither response knows that the second patch was unintended, so normal optimistic acknowledgement preserves both changes.
6. **Display:** `DefaultChatScreen` reads `fmIndex === -1` and renders `firstMessage`; otherwise it indexes `alternateGreetings` (`DefaultChatScreen.svelte:1755-1796`). The visible greeting changes as soon as the client mutation occurs and remains changed after reload.

## Severity and user impact

**Medium.** A routine asset-management action silently changes unrelated, per-chat conversation state. The altered greeting can also change prompt construction for a chat with no transcript messages, so later generation may start from different context. The mutation is durable and offers no indication that the asset action caused it.

## Recommended fix

Remove the `setCurrentChatGreetingIndex()` call from the additional-asset removal handler. Keep the asset splice scoped to the character draft. No replacement chat mutation is needed.

Also add a development assertion or component-level mutation test around editor actions that records which top-level resources/fields they change; this would catch future copy/paste mutations that cross from character profile state into chat metadata.

## Test coverage gap

Add a `CharConfig` component test with an active chat at `fmIndex: 1` and two additional assets. Remove one asset, flush both pending bridges, and assert that the character PATCH contains only the intended profile change, no chat PATCH is sent, the resident `fmIndex` remains `1`, and the alternate greeting remains displayed.
