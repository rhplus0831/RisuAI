# Memory-limit indicator never maps the chat cutoff to a message row

## Summary

The “Show Memory Limit” setting persists successfully and can reveal its thickness control, but the live transcript never uses it to mark a message. `Chats.svelte` passes `isLastMemory={false}` to every ordinary message, so `Chat.svelte` cannot render the cutoff even when the chat already contains a valid `lastMemory` message ID.

## Location

- Setting definition: `src/ts/setting/displaySettingsData.svelte.ts:252-259,272-287`
- Generic setting projection and dispatch: `src/lib/Setting/Wrappers/SettingCheck.svelte:13-29`; `src/ts/setting/utils.ts:158-189`
- Settings group ownership and client command: `src/ts/server/settingsGroups.ts:287`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify settings persistence and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907`
- Live transcript row construction: `src/lib/ChatScreens/Chats.svelte:52-91,151-179`
- Conditional marker style: `src/lib/ChatScreens/Chat.svelte:137-194,2472-2482`
- Chat cutoff field: `src/ts/storage/database.svelte.ts:4468`
- Stable message ID used as the cutoff memo: `src/ts/process/promptAssembly/formatHistoryMessage.ts:178-185`; `server/fastify/src/prompt/history.ts:290-325`

## Trigger

1. Open Display Settings and enable **Show Memory Limit**.
2. Optionally set a clearly visible memory-limit thickness.
3. Open a chat whose `lastMemory` contains the ID of a displayed message. This can come from imported/legacy data or from a compatible targeted chat update.
4. View or reload the transcript.

## Expected behavior

When the setting is enabled, the row whose `message.chatId` equals the active chat's `lastMemory` should render the configured boundary line. Disabling the setting should remove the line without deleting the stored cutoff metadata.

## Actual behavior

The checkbox optimistically updates the browser setting, dispatches a revisioned `display` settings patch, and Fastify persists and acknowledges it. The setting remains enabled after refresh, and enabling it makes the `memoryLimitThickness` slider visible.

The transcript does not change. `Chats.svelte` hard-codes `isLastMemory={false}` for every normal message. `Chat.svelte` renders the boundary only when that prop is true and otherwise reads only `memoryLimitThickness`; it never reads `showMemoryLimit` or the active chat's `lastMemory`. A valid stored cutoff is therefore ignored, and the setting's successful persistence cannot affect its advertised output.

## Underlying cause

The data-to-row projection was never connected. The chat model stores the cutoff as a stable message ID, but the row builder does not compare that ID with each message and does not combine the result with `showMemoryLimit`. The leaf renderer retained a generic `isLastMemory` prop, while every reachable transcript caller supplies `false`.

## Affected data flow

1. **UI interaction:** The user toggles `display.showMemoryLimit` in schema-driven Display Settings.
2. **Client projection:** `SettingCheck` writes `getDatabase().showMemoryLimit` optimistically and the generic setting utility queues `{ showMemoryLimit: true }`.
3. **Server request:** The client sends `PATCH /api/v1/commands/settings/display` with the current base revision.
4. **Server persistence:** Fastify validates the display-group key, writes it through `writeSettingsOnly()`, emits `settings.updated`, and returns the revision plus `acknowledgedKeys`.
5. **Client acknowledgement:** The settings command/local-effect path retains the accepted value, and the conditional thickness row becomes visible.
6. **Chat resource:** The active chat can contain `lastMemory`, whose value identifies a message through that message's `chatId`.
7. **Displayed state:** `Chats.svelte` does not read the chat cutoff or the setting and passes `false` for every row. `Chat.svelte` consequently emits no boundary style.

## Severity and user impact

**Medium.** The failure does not corrupt messages, but it makes a persisted control entirely ineffective and hides important context-window state in long chats. Users may believe old messages are still being sent to the model, or may manually summarize/delete content based on an incorrect understanding of the active context. The visible thickness sub-setting reinforces the false impression that the feature is working.

## Recommended fix

- Derive the active chat once in `Chats.svelte` and pass `isLastMemory={getDatabase().showMemoryLimit && row.message.chatId === activeChat.lastMemory}` for each row.
- Keep the cutoff comparison in the owner-aware row builder rather than making `Chat.svelte` look up mutable global selection state.
- Treat missing, orphaned, or currently unhydrated cutoff IDs as “no visible marker”; do not mutate the persisted cutoff merely because its row is outside the current transcript window.
- Ensure loading more transcript pages causes the matching row to acquire the marker reactively.
- Add component coverage for enabled/disabled settings, a matching cutoff, an orphan cutoff, and a cutoff that becomes visible after transcript hydration.

