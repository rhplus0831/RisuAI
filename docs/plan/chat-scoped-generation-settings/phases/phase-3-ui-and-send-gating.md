# Phase 3: UI & Send Gating

Status: planned.

Goal: make the visible chat controls edit the active chat and block generation
early enough that the user's draft text and chat history are untouched.

## Scope

- Add a frontend resolver for active-chat generation settings, missing reasons,
  display labels, and update patches.
- Make sidebar persona and preset controls show the active chat's selection or
  an unconfigured state.
- Make picker selection update chat metadata instead of global selection state.
- Make jailbreak and all displayed prompt/module toggles read/write the active
  chat settings with optimistic patch and rollback.
- Block sends in the UI before clearing the composer or appending a user
  message.
- Add a lower-level `sendChat` guard before lifecycle work so hotkeys, direct
  callers, slash commands, continue, regenerate, and preview cannot bypass the
  check.

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

## Target Shape

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

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts \
  src/ts/process/__tests__/sendChatContext.test.ts \
  src/ts/process/__tests__/sendChat.*.test.ts
pnpm exec vitest run src/lib/SideBars/*.test.ts \
  src/lib/ChatScreens/*.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Adjust the component-test list to the tests that exist when this phase starts.

## Risks

- The current preset/persona modals mix "select for current use" with library
  management. Chat-selection mode must avoid accidental global apply while
  preserving edit/reorder/export actions.
- Guarding after input clearing or after `doingChat` changes would create a
  visible failed-send artifact even though the server blocks correctly.
