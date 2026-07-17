# Auto-suggestions do not start after chat hydration

## Summary

Opening an existing server-backed chat with no saved suggestions can leave auto-suggestions empty indefinitely. The suggestion component evaluates the initial empty chat shell before transcript hydration completes, then never reevaluates whether it should generate suggestions when the messages arrive.

## Location

- `src/lib/ChatScreens/DefaultChatScreen.svelte:1411-1421,1679-1692`
- `src/lib/ChatScreens/Suggestion.svelte:241-290,329-456,494-499`
- `src/ts/server/chatMessageHydration.svelte.ts:42-60,306-403,481-510`
- `src/ts/storage/database.svelte.ts:3317-3356`
- `src/ts/chatCommands.ts:2340-2375`
- `server/fastify/src/routes/commands.ts:5196-5255`

## Trigger

1. Enable `useAutoSuggestions`.
2. Open an existing Fastify-backed chat whose `suggestMessages` is empty.
3. Let the initially empty transcript shell hydrate with one or more persisted messages.

## Expected behavior

Once hydration establishes that the current chat has messages and still has no suggestions, the client should start one owner-scoped suggestion request and display or persist its result.

## Actual behavior

The initial suggestion callback returns because the shell contains no messages. Hydration later updates the transcript, but no suggestion request starts. The UI remains in the empty suggestion state until another action toggles `doingChat` or explicitly rerolls suggestions.

## Underlying cause

Fastify bootstrap supplies chats as empty message stubs (`chatMessageHydration.svelte.ts:42-60`). `DefaultChatScreen` mounts `Suggestion` even while its hydration overlay is visible (`DefaultChatScreen.svelte:1411-1421,1679-1692`).

Suggestion generation is initiated only by the `doingChat` subscription (`Suggestion.svelte:329-456`). Its initial false-state callback copies `requestChat.message` and returns when the resulting tail is empty (`Suggestion.svelte:339-357`). Hydration later assigns `chat.message` (`database.svelte.ts:3317-3356`), but the component's chat effect only copies persisted `suggestMessages` through `updateSuggestions`; it does not retry generation (`Suggestion.svelte:241-251,494-499`).

## Affected data flow

1. **UI:** `DefaultChatScreen` opens the chat and mounts `Suggestion` under the loading overlay.
2. **Client state:** The chat projection initially has `message: []`; the initial `doingChat` callback exits without setting `progress`.
3. **Hydration request:** `hydrateActiveChat` fetches the active transcript through the chat-message hydration bridge (`chatMessageHydration.svelte.ts:306-403,481-510`).
4. **Server response/client projection:** `hydrateServerChatMessages` applies the returned messages to the existing chat row (`database.svelte.ts:3317-3356`).
5. **Missing follow-up:** No reactive path calls `requestChatData` after that transition.
6. **Persistence/display:** Consequently, `persistSuggestions` is never reached (`Suggestion.svelte:253-290`), so no durable chat patch is dispatched through `dispatchUpdateChatRow` to `PATCH /api/v1/commands/chats/:chatId` (`chatCommands.ts:2340-2375`; `commands.ts:5196-5255`), and the displayed suggestion list stays empty.

## Severity and user impact

**Medium.** Auto-suggestions silently fail for a common existing-chat open path. Users may assume the feature or provider is broken, while later generation activity can make it appear intermittently functional.

## Recommended fix

Expose a reactive hydration-ready state for the current chat and route both `doingChat` completion and hydration completion through one guarded `requestSuggestions` function. Start only when the owner is still current, hydration succeeded, the transcript is non-empty, no request is in flight, and no suggestions are stored. Keep the existing character/chat ownership and abort checks for the asynchronous result.

## Test coverage gap

`src/lib/ChatScreens/Suggestion.svelte.test.ts:333-631` covers persistence, rejection, rerolls, and stale owners, but seeds resident messages before mounting. Add a component test that mounts against `message: []`, applies hydrated messages without toggling `doingChat`, and asserts that exactly one request starts and its accepted result is persisted to the same chat.
