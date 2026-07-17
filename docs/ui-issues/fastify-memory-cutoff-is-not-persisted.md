# Fastify prompt assembly does not persist the memory cutoff

## Summary

Fastify prompt assembly calculates the oldest message that survived context-budget trimming and writes its message ID to a cloned `currentChat.lastMemory`. The generation persistence contract has no chat-metadata field for that value, however, so the calculation is discarded. The authoritative chat, subsequent resource reads, and every browser projection retain an older cutoff or no cutoff at all.

## Location

- Mandatory server-backed send selection: `src/ts/process/index.svelte.ts:274-358`
- Fastify chat request: `src/ts/process/request/serverChat.ts:47,232-270`
- Fastify generation endpoint: `server/fastify/src/routes/generationChat.ts:3208-3273`
- Per-message cutoff identity: `server/fastify/src/prompt/history.ts:290-325`
- Cloned chat used by prompt assembly: `server/fastify/src/prompt/assemble.ts:552-600`
- Cutoff calculation: `server/fastify/src/prompt/memory.ts:43-68`
- Assembly mutation contract: `server/fastify/src/prompt/assemble.ts:328-337`
- Assembly persistence: `server/fastify/src/routes/generationChat.ts:1206-1377,1898-1913`
- Browser compatibility path that does persist the field: `src/ts/process/promptAssembly/buildMemoryWindow.ts:60-137`
- Allowed targeted chat patch: `src/ts/chatCommands.ts:116-129`; `server/fastify/src/commands/chats.ts:64-77`

## Trigger

1. Open a sufficiently long chat for prompt assembly to trim one or more old messages to fit `maxContext`.
2. Send, continue, or regenerate a message through the normal Fastify-backed text-generation path.
3. Inspect the authoritative chat after the generation completes, refresh the browser, or load the same chat in another client.

The same failure also occurs when the oldest surviving row changes without a visible generation failure.

## Expected behavior

The server should persist the surviving boundary's stable message ID as `chat.lastMemory` in the same revisioned generation transaction, return or emit an acknowledgement for that chat metadata, and update browser projections. A refresh or another client should observe the new cutoff.

## Actual behavior

`buildHistoryWindow()` assigns each history row's `memo` from its stable message `chatId`. `buildMemoryWindow()` then removes over-budget rows and assigns the first surviving memo to `currentChat.lastMemory`.

That `currentChat` is a structured clone. `AssembleMutationPayload` carries message mutations, chat-variable mutations, and additional prompt rows, but no ordinary chat-field patch. `persistAssemblyMutations()` consequently writes only `scriptstate` changes and an optional transcript replacement. It never copies `lastMemory` into the authoritative chat row, never emits a chat-metadata event for it, and never includes it in the response projection.

The successful generation therefore leaves SQLite and the browser resource state with the previous cutoff or `undefined`. The older browser-owned assembly path explicitly calls `dispatchUpdateChat(currentChat.id, { lastMemory }, previous)`, but normal supported text sends are server-mandatory and do not use that path.

## Underlying cause

The prompt migration ported the cutoff calculation but not its persistence side effect. Fastify deliberately isolates assembly on a cloned chat, while the later persistence layer accepts only a narrower mutation contract. Since `lastMemory` is absent from that contract, the value dies with the assembly state even though targeted chat commands already allow the field.

## Affected data flow

1. **UI interaction:** `DefaultChatScreen` starts a send, continuation, or regeneration.
2. **Client state/request:** `process/index.svelte.ts` selects mandatory server assembly and `requestServerChat()` posts the character ID, chat ID, mode, and generation intent to `POST /api/v1/generate/chat`.
3. **Server projection:** Fastify loads the authoritative database, resolves the selected chat, and clones it for assembly.
4. **Cutoff calculation:** History rows use message IDs as `memo`; context trimming sets the clone's `currentChat.lastMemory` to the first surviving memo.
5. **Server persistence:** `persistAssemblyMutations()` persists chat variables and, when needed, transcript mutations. It has no `lastMemory` mutation and does not write that field to the chat row.
6. **Response/acknowledgement:** The SSE `info` revision and resource events cover only mutations that were actually persisted. No cutoff value or invalidation is sent.
7. **Displayed state:** The browser continues to project the old or missing `lastMemory`; refresh and cross-client reads reproduce the stale authoritative value.

## Severity and user impact

**Medium.** Generation itself succeeds, but the app silently loses metadata intended to explain which part of a long transcript remains in context. Any current or future UI that consumes `lastMemory` receives stale data, and users cannot reliably reason about the model's memory boundary after trimming. The silent success also makes the defect difficult to distinguish from a display-only failure.

## Recommended fix

- Add a typed chat-metadata mutation to `AssembleMutationPayload`, or explicitly carry the calculated `lastMemory` alongside the existing assembly mutation payload.
- In `persistAssemblyMutations()`, compare it with the authoritative chat value and write it with `writeSingleChatRow()` in the same targeted command transaction as other assembly mutations.
- Emit an event/local effect that updates or invalidates the affected chat projection, and include the resulting revision in the existing SSE acknowledgement.
- Do not persist a synthetic non-message memo such as `NewChat`; represent a missing boundary explicitly and validate that any stored cutoff is a stable message ID owned by the target chat.
- Add an integration test that forces context trimming, completes a server-backed generation, reloads the chat resource, and asserts that `lastMemory` matches the first surviving message ID.

