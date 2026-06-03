# Chat-Scoped Message Paths

Status: planned. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`.

## Scope

Replace the full-array `currentChatStateSnapshot()` rollback baseline on the
message-edit and send paths with the chat-scoped snapshot, so a per-message action
or a send clones only the affected chat's `message[]`, not every character's
hydrated history.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical `currentChatStateSnapshot` finding and the High `sendMain`,
  per-message edit, and `cloneMessagesWithIds` findings; the Low `command.ts`
  `snapshotChat` finding.
- `src/ts/chatCommands.ts:73` - `currentChatStateSnapshot` (the source) and
  `restoreChatState`; `dispatchReplaceMessages`/`dispatchUpdateMessage`/
  `dispatchDeleteMessage`/`dispatchTruncateMessages`/`dispatchAppendMessage`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:215/275/783` - `sendMain`
  (send/continue) and the empty-slot button.
- `src/lib/ChatScreens/Chat.svelte:144/169/258/284/471/1194/1279/1319/1656` -
  `cloneMessagesWithIds` and the per-message edit/delete/bookmark/partial-edit/
  alt-greeting/fork handlers.
- `src/ts/process/command.ts:326/336` - `mutateCurrentChatMessages` /
  `snapshotChat` (the slash-command message mutation).

## Target Implementation

- Route the message-replace / per-message dispatch helpers and their call sites
  through `currentChatScopedSnapshot()` / `restoreChatScopedState()` (Phase 0):
  capture `{ selectedCharID, charIndex/chaId, chatPage/chatId, chat:
  cloneJsonValue(activeChat) }` and restore only that one chat row inside
  `withTrustedServerProjectionWrite`. Do **not** change the shared
  `currentChatStateSnapshot`/`restoreChatState` globally — narrow only the
  message paths.
- `sendMain`: collapse the double current-chat clone — `:218` already clones into
  `cha`; `:275` can assign by reference (`liveChat.message = cha`) rather than
  re-cloning.
- `cloneMessagesWithIds`: make it fallback-only and lazy — in `toggleBookmark`
  (`:479`) assign a `chatId` to only the single target message and dispatch via
  `messageId`; for the 10 fallback sites ensure a `chatId` on the single needed
  message and dispatch the targeted command rather than cloning the whole
  `chat.message`. Fix the unconditional `currentChatStateSnapshot()` first.
- `command.ts`: remove the redundant full-corpus `currentChatStateSnapshot()` at
  `:336` (use the chat-scoped rollback); `previousChat` is genuinely needed for
  the diff, but `nextChat` does not need a separate clone (the mutated live chat
  is already a fresh object). Prefer routing `/send`-class commands to the scoped
  dispatch helpers to avoid the message-array stringify-diff. The per-chat
  `snapshotChat` used by `prepareCompatibleChatUpdate` is bounded and may stay.

## Behavior / Invariants

- A failed `dispatchReplaceMessages`/`dispatchUpdateMessage`/… restores only the
  affected chat's message list (not the whole array), preserving any unrelated
  concurrent edit.
- `prepareCompatibleChatUpdate`'s per-chat diff (`snapshotChat`, one chat) is
  acceptable and unchanged; only the full-array clone is removed.
- Sent/edited message bytes and chat ids are identical.

## Done When

- `sendMain`, the `Chat.svelte` per-message handlers, the empty-slot button, and
  `command.ts` message mutation capture a chat-scoped snapshot; none clones every
  character (clone-cost harness).
- The double current-chat clone in `sendMain` and the redundant
  `currentChatStateSnapshot()` in `command.ts` are removed.
- Rollback-correctness tests prove a failed message command restores only the
  target chat.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts`
- `pnpm test -- src/lib/ChatScreens` (the chat-screen suites, where present)
- `pnpm test`
- `pnpm client-thinning:audit`
