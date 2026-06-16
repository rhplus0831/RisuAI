# Chat And Message Content Audit

Status: bad

## Scope

Audited chat screen and chat/message editing paths where user input changes content:

- Send message composer, input translation composer, sticker/file insertion.
- User/assistant message edit, partial edit, role/disable toggles adjacent to message edits.
- Translation edit cache path.
- Author note.
- Chat metadata/title and chat folder title.
- Chat variables/scriptstate from DevTool, slash commands, and trigger author-note/scriptstate effects.

## Finding

### Likely issue: chat and folder title edits send the new value but do not update the local projection in Fastify mode

In `src/lib/SideBars/SideChatList.svelte`, title editing uses function bindings:

- Folder title input calls `updateFolderName(folder, value)` at `src/lib/SideBars/SideChatList.svelte:427`.
- Chat title input calls `updateChatName(chat, value)` in foldered chats at `src/lib/SideBars/SideChatList.svelte:538`.
- Chat title input calls `updateChatName(chat, value)` in root chats at `src/lib/SideBars/SideChatList.svelte:671`.

Those setters send the edited value in the command payload, but their Fastify branches return before mutating the visible local row:

- `updateChatName` sends `dispatchUpdateChat(chat.id, { name }, ...)` and returns without `chat.name = name` at `src/lib/SideBars/SideChatList.svelte:150`.
- `updateFolderName` sends `dispatchUpdateChatFolder(folder.id, { name }, ...)` and returns without `folder.name = name` at `src/lib/SideBars/SideChatList.svelte:158`.

The command payload itself is not dropped:

- Client chat patch allow-list includes `name` at `src/ts/chatCommands.ts:46`.
- Server chat patch allow-list includes `name` at `server/fastify/src/commands/chats.ts:57`.
- Server folder patch allow-list includes `name` at `server/fastify/src/commands/chats.ts:72`.
- `updateChatCommand` serializes `patch: input.patch` at `src/ts/server/commands.ts:1936`.
- `updateChatFolderCommand` serializes `patch: input.patch` at `src/ts/server/commands.ts:2029`.

The missing part is the optimistic/projection update. This differs from other content-edit paths that write the projection under `withTrustedServerProjectionWrite` before dispatching. Because `TextInput.svelte` is controlled through `bind:value` at `src/lib/UI/GUI/TextInput.svelte:31` and the title input getter reads `chat.name`/`folder.name`, the edited text can remain sourced from the old projection until a server event/projection refresh arrives. This matches the requested bug class: user-edited content is sent, but the local optimistic/projection state does not include the updated value.

## Non-Issues Checked

- Send composer: `DefaultChatScreen.svelte` builds `userMessage.data` from `messageInput` at `src/lib/ChatScreens/DefaultChatScreen.svelte:380`, clears inputs at `src/lib/ChatScreens/DefaultChatScreen.svelte:389`, and calls `appendCurrentChatUserMessageForSend` at `src/lib/ChatScreens/DefaultChatScreen.svelte:392`. The helper pushes the same message into the projection at `src/ts/chatCommands.ts:1081` and sends `toMessageSnapshot(message)` at `src/ts/chatCommands.ts:1118`.
- Message edit: `Chat.svelte` dispatches `{ data: message }` at `src/lib/ChatScreens/Chat.svelte:255`; partial edit dispatches `{ data: e.detail.newData }` at `src/lib/ChatScreens/Chat.svelte:277`. The message command sanitizer keeps allowed fields at `src/ts/chatCommands.ts:1529`, and the server accepts `data` at `server/fastify/src/commands/messages.ts:95` and validates it as a string at `server/fastify/src/commands/messages.ts:243`.
- Translation edit: `Chat.svelte` loads/saves LLM translation cache entries with `getLLMCache`/`setLLMCache` at `src/lib/ChatScreens/Chat.svelte:327` and `src/lib/ChatScreens/Chat.svelte:334`. I did not find a chat/message command payload for translation edits; this appears to be a cache-edit path, not a message persistence command path.
- Author note: `AuthorNoteEditor.svelte` debounces draft changes and calls `setChatNoteValue(chatId, note)` at `src/lib/SideBars/AuthorNoteEditor.svelte:70`. That helper writes `liveLocation.chat.note = note` under the projection guard at `src/ts/chatCommands.ts:1436`, then sends the same `note` at `src/ts/chatCommands.ts:1413`.
- Chat metadata watcher: `watchServerBackedChatMetadata` diffs scalar chat metadata at `src/ts/server/chatBridge.svelte.ts:89`, includes allowed chat fields at `src/ts/server/chatBridge.svelte.ts:254`, and includes folder `name` at `src/ts/server/chatBridge.svelte.ts:264`. This watcher would persist direct local metadata edits, but the title edit helpers above bypass local mutation in Fastify mode.
- Chat variables/scriptstate: DevTool calls `setChatScriptstateValue` at `src/lib/SideBars/DevTool.svelte:118`; slash `/setvar` writes `chat.scriptstate[stateKey] = arg` and dispatches the same value at `src/ts/process/command.ts:182`; `/addvar` dispatches `newValue` at `src/ts/process/command.ts:204`. The shared helper writes the scriptstate patch into projection at `src/ts/chatCommands.ts:1397` and dispatches it at `src/ts/chatCommands.ts:1406`.
- Trigger scriptstate/author-note: trigger `setVar` writes the active chat scriptstate and dispatches the same value at `src/ts/process/triggers.ts:1534`; `v2SetAuthorNote` writes `chatSlot.note = value` and dispatches `value` at `src/ts/process/triggers.ts:3267`.
- Script inject/display message edits: `applyInjectMutation` writes `message.data = data` under the projection guard and dispatches `{ data }` at `src/ts/process/scripts.ts:178`.

## Files Inspected

- `STRUCTURE.md`
- `AGENTS.md`
- `src/docs/svelte-ui.md`
- `src/docs/client-runtime.md`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/Chats.svelte`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/ChatScreens/ChatBody.svelte`
- `src/lib/ChatScreens/PartialEditController.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/SideBars/AuthorNoteEditor.svelte`
- `src/lib/SideBars/DevTool.svelte`
- `src/lib/UI/GUI/TextInput.svelte`
- `src/lib/UI/GUI/TextAreaInput.svelte`
- `src/ts/chatCommands.ts`
- `src/ts/server/commands.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/process/command.ts`
- `src/ts/process/scripts.ts`
- `src/ts/process/triggers.ts`
- `src/ts/process/index.svelte.ts`
- `server/fastify/src/commands/chats.ts`
- `server/fastify/src/commands/messages.ts`
