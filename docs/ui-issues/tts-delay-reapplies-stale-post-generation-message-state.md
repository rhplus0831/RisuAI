# TTS delay lets an old terminal patch overwrite a newer saved message edit

- **Severity:** High
- **Affected surfaces:** `CHAT-10` (message edit), `CHAT-12`/`CHAT-14` (generation ownership and terminal progress)
- **Primary locations:** `src/ts/process/serverBackedSendChat.ts:482-602`; `src/lib/ChatScreens/Chat.svelte:323-359,980-1005,2121-2133`

## Trigger

1. Enable automatic TTS for a character and generate a response whose server post-generation pass returns `finalText` and/or a `messagePatch`.
2. Let Fastify finish and persist post-generation. Make client-side TTS synthesis slow so `sayTTS` remains pending.
3. While TTS is pending, edit the generated assistant row and save it successfully.
4. Let TTS finish so `applyServerBackedTerminal` resumes.

## Expected behavior

The persisted user edit is newer than the generation terminal snapshot and must win. TTS is a side effect and must not delay authoritative projection reconciliation. If any terminal data is applied asynchronously, it must be conditional on the target message/projection having remained unchanged since the terminal was received.

## Actual behavior

Fastify accepts and persists the user edit, and the message briefly shows it. When TTS resolves, the older terminal handler applies its captured `messagePatch` and then assigns `postGeneration.finalText` to the assistant row without any expected-value, message-intent, or projection-epoch check. The browser reverts to the old generated text while SQLite still contains the newer edit. A later event-driven hydration or reload changes the row back to the saved edit.

## Underlying cause

The server emits the TTS side-effect frame before it awaits post-generation and emits `done`, but the final `done.postGeneration` frame is built only after the derived message has already been persisted (`server/fastify/src/prompt/providerTransport.ts:77-105`; `server/fastify/src/routes/generationChat.ts:1767-1864,2710-2830`).

The client parses the complete terminal and advances its command revision before resolving it (`src/ts/process/request/serverChat.ts:610-631`). `applyServerBackedTerminal` then awaits every TTS side effect first (`serverBackedSendChat.ts:529-546`) and does not mirror the already-persisted terminal patch until lines 552-602.

Message editing remains enabled during this wait. `beginMessageEdit` and `saveMessageEdit` check only translation activity, not `$doingChat`, generation ownership, or a pending terminal application (`Chat.svelte:323-359`); the edit button has the same limited guard (`Chat.svelte:2121-2133`). The terminal application reacquires stable character/chat ids, but identity alone cannot establish freshness. The later inlay-finalization block does use message-mutation and projection epochs (`serverBackedSendChat.ts:604-674`), while the pre-inlay terminal patch does not.

## Affected data flow

1. Fastify runs post-generation, writes the generated/continued/regenerated message and any script-state changes inside a targeted SQLite mutation, and emits an event/revision (`generationChat.ts:1820-1864`; persistence core at `generationChat.ts:2456-2559`).
2. The server sends a terminal `done` frame containing the persisted revision, final text, and mutation patch (`providerTransport.ts:82-105`).
3. The browser parser caches `postGeneration.revision` and resolves a terminal containing the earlier TTS side effect and post-generation payload (`request/serverChat.ts:610-631`).
4. `applyServerBackedTerminal` awaits `sayTTS`, which can perform provider requests, preprocessing/postprocessing hooks, decoding, and audio setup (`serverBackedSendChat.ts:529-546`; `src/ts/process/tts.ts:274-352`).
5. During that await, the row editor calls `dispatchUpdateMessageScoped`; it paints the edit, stages durable `PATCH /messages/:messageId`, and marks the chat message-mutation intent (`Chat.svelte:980-1005`; `src/ts/chatCommands.ts:4582-4673`).
6. Fastify persists the newer patch and acknowledges `message.updated` (`server/fastify/src/routes/commands.ts:6235-6303`). The client reconciliation keeps the saved edit visible.
7. TTS finishes. The terminal handler unconditionally applies the older `messagePatch` and `finalText` to the same live row (`serverBackedSendChat.ts:565-602`). This is a projection-only write; no matching server mutation follows it.

## User impact

**High:** a confirmed, durable message edit is visibly overwritten by older generation work. The UI and SQLite disagree until another synchronization pass, and the later snap back makes it unclear which text is actually saved. Slow remote TTS providers and plugin hooks make the race window substantial.

## Recommended fix

- Apply the persisted terminal `messagePatch`/`finalText` before starting or awaiting best-effort TTS. TTS playback should not serialize projection reconciliation; schedule it after the authoritative state is committed locally.
- As defense in depth, capture the chat message-mutation intent epoch, chat-body projection epoch, target message id, and expected pre-terminal data before any awaited side effect. Skip/re-read the terminal projection if any fence changes.
- Reuse the freshness strategy already used by delayed inlay finalization, but capture the token before TTS rather than after the stale terminal patch has been applied. Stable owner ids alone are insufficient.
- Add a regression test with deferred `sayTTS`: start terminal application, mark/save a newer message edit, release TTS, and assert the edit remains in both the live projection and persisted resource. Cover `finalText`, `replace_all` message patches, deletion, and chat switching.
