# Phase 3: UI & Send Gating

Status: complete.

Goal: make the visible chat controls edit the active chat and block generation
early enough that the user's draft text and chat history are untouched.

## Completed Scope

- Added the active-chat frontend helper for generation settings, missing
  reasons, display labels, and update patches.
- Added chat-scoped picker mode so preset/persona selection writes active-chat
  metadata instead of global selection state.
- Made sidebar preset, persona, jailbreak, and displayed sidebar toggle controls
  read/write the active chat's `generationSettings`.
- Added the client pre-append guard, the lower-level `sendChat` guard, and the
  direct append guard so incomplete chats block before draft clearing,
  optimistic user-message append, or send lifecycle work.
- Kept server-backed sends from letting `presetChain` or `promptInfo` override
  the chat-scoped preset/toggle values.

## Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/chatCommands.ts`
- `src/ts/util.ts`
- `src/lib/SideBars/CustomSidebar.svelte`
- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/ts/process/index.svelte.ts`
- `src/ts/process/sendChatContext.ts`
- `src/ts/process/serverBackedSendChat.ts`
- `src/lang`

## Landed Shape

- Two chats can show different persona, preset, jailbreak, and toggle values
  while switching between them.
- Selecting a chat preset does not call the global `changeToPreset()` flow.
- Selecting a chat persona does not call the global `changeUserPersona()` flow
  or mutate legacy persona mirrors.
- `appendCurrentChatUserMessageForSend` or its caller checks readiness before
  optimistic append.
- `sendChat` checks readiness after the reentry guard and before
  `doingChat.set(true)` or `setupSendChatContext()`.
- `assembleServerBackedSendChat()` sends only fields consistent with chat
  config; `presetChain` cannot override chat-specific preset selection.

## Invariants

- Client blocking preserves the typed draft.
- Blocked sends do not briefly lock the composer.
- All new user-facing text uses keys under `src/lang`.
- UI management actions for presets/personas can remain global where they edit
  libraries, but choosing the active chat's send setup must be chat-specific.
- Server blocking remains authoritative.

## Exit Criteria

- Incomplete chats display clear incomplete state and a configure action.
- Chat-specific picker selection, toggle writes, rollback, and chat switching
  are covered by focused tests.
- Send, hotkey, slash-command, continue, regenerate, and preview paths are
  covered by guard tests or documented focused equivalents.
- No blocked path appends a user message or clears the composer.

## Validation

Focused Phase 3 validation passed:

```bash
pnpm exec vitest run src/ts/activeChatGenerationSettings.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts src/ts/chatCommands.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts src/ts/process/__tests__/sendChatContext.test.ts
```

Result: `6` test files passed, `87` tests passed.

The broader regression and TypeScript proof remains planned for Phase 5.

## Remaining Work

- Import, delete, fork, copy, and new-chat lifecycle behavior remains Phase 4.
- Full planned verification remains Phase 5.
