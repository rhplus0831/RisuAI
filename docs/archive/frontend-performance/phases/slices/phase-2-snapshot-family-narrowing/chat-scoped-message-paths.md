# Chat-Scoped Message Paths

Status: implemented. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`.

Implemented: send, empty-slot, per-message edit/delete/bookmark/etc., and
slash-command message mutation now capture `currentChatScopedSnapshot()` and use
scoped chat dispatchers that roll back via `restoreChatScopedState`.
`sendMain` also dropped its extra current-chat clone. Fork/restructure and
lower-frequency callers keep the broad helpers. Proofs live in
`chatCommands.test.ts`.

## Scope

Replace full-array `currentChatStateSnapshot()` rollback on message-edit and send
paths with a chat-scoped snapshot. A per-message action should clone only the
affected chat's `message[]`.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../frontend-performance-audit.md) -
  the Critical `currentChatStateSnapshot` finding and the High `sendMain`,
  per-message edit, and `cloneMessagesWithIds` findings; the Low `command.ts`
  `snapshotChat` finding.
- `src/ts/chatCommands.ts` - `currentChatStateSnapshot` (the source) and
  `restoreChatState`; `dispatchReplaceMessages`/`dispatchUpdateMessage`/
  `dispatchDeleteMessage`/`dispatchTruncateMessages`/`dispatchAppendMessage`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte` - `sendMain`
  (send/continue) and the empty-slot button.
- `src/lib/ChatScreens/Chat.svelte` - `cloneMessagesWithIds` and the per-message
  edit/delete/bookmark/partial-edit/alt-greeting/fork handlers.
- `src/ts/process/command.ts` - `mutateCurrentChatMessages` / `snapshotChat`
  (the slash-command message mutation).

## Implemented Shape

- Message-replace and per-message call sites use
  `currentChatScopedSnapshot()` / `restoreChatScopedState()`.
- Narrow dispatch helpers exist alongside the broad helpers, so create/delete/
  reorder/fork paths can keep full snapshots.
- `sendMain` no longer double-clones the current chat; slash-command message
  mutation reuses its per-chat baseline instead of taking a full-corpus snapshot.
- `cloneMessagesWithIds` is fallback/lazy for targeted edits.

## Behavior / Invariants

- A failed message command restores only the affected chat's message list.
- `prepareCompatibleChatUpdate`'s per-chat diff (`snapshotChat`, one chat) is
  acceptable and unchanged; only the full-array clone is removed.
- Sent/edited message bytes and chat ids are identical.

## Proven

- Send, empty-slot, per-message handlers, and slash-command message mutation
  capture chat-scoped snapshots.
- Clone-cost coverage proves those hot paths avoid cloning every character.
- Rollback-correctness tests prove a failed message command restores only the
  target chat.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
