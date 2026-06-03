# Chat-Scoped Message Paths

Status: planned. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`.

## Scope

Replace full-array `currentChatStateSnapshot()` rollback on message-edit and send
paths with a chat-scoped snapshot. A per-message action should clone only the
affected chat's `message[]`.

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

- Route message-replace and per-message dispatch call sites through
  `currentChatScopedSnapshot()` / `restoreChatScopedState()`. Do not change the
  shared `currentChatStateSnapshot` / `restoreChatState` globally.
- Before switching call sites, update the message dispatch surface
  (`dispatchAppendMessage`, `dispatchUpdateMessage`, `dispatchDeleteMessage`,
  `dispatchTruncateMessages`, `dispatchReplaceMessages`, and compatible chat
  update paths) to accept a narrow snapshot+rollback pair or add parallel narrow
  dispatch helpers. The current helpers still require `ChatStateSnapshot` and
  call `restoreChatState()`.
- `sendMain`: collapse the double current-chat clone. `:218` already clones into
  `cha`; `:275` can assign `liveChat.message = cha`.
- `cloneMessagesWithIds`: make it fallback-only and lazy. For targeted edits,
  assign `chatId` only on the needed message and dispatch by `messageId`.
- `command.ts`: remove the redundant full-corpus `currentChatStateSnapshot()` at
  `:336`. `previousChat` is needed for the diff; `nextChat` does not need a
  separate clone. The per-chat `snapshotChat` may stay.

## Behavior / Invariants

- A failed message command restores only the affected chat's message list.
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
