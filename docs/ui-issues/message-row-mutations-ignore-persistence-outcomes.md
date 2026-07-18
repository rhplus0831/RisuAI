# Message-row mutations ignore persistence outcomes

## Summary

Transcript row actions — delete, edit, truncate, disable/disable-above, role
switch, bookmark toggle — call the scoped dispatch helpers and discard their
rich `{accepted|queued|failed}` results. On server rejection the optimistic
change silently reverts with no toast or status; on retained/offline queues no
pending indicator appears. Sibling surfaces (BookmarkList, ChatList,
SideChatList) were explicitly fixed to surface these same outcomes in prior
rounds, leaving the message rows conspicuously silent.

## Location

- `src/lib/ChatScreens/Chat.svelte:681-704` — `deleteMessageAtTarget` discards
  the `DeleteMessageScopedResult`.
- `src/lib/ChatScreens/Chat.svelte:977-999` — `rm` (row delete confirm).
- `src/lib/ChatScreens/Chat.svelte:639-679` — truncate; result dropped.
- `src/lib/ChatScreens/Chat.svelte:1016-1031` — `edit`;
  `dispatchUpdateMessageScoped` fire-and-forget.
- `src/lib/ChatScreens/Chat.svelte:2276-2350` — disable / disable-above.
- `src/lib/ChatScreens/Chat.svelte:2637-2667` — playground role switch.
- `src/lib/ChatScreens/Chat.svelte:1432-1540` — `toggleBookmark`; on a stale
  optimistic-metadata baseline (`applyOptimisticBookmarkMetadata`,
  :706-730) the typed bookmark name is discarded with zero feedback.
- `src/ts/chatCommands.ts:5437-5570` — `dispatchDeleteMessageScoped` builds
  settlement surfacing specifically so callers can report queued/failed.
- `src/ts/chatCommands.ts:2758-2816` — `dispatchUpdateChatScopedWithOutcome`
  exists but is unused here.
- Contrast: commits `d14ff7bf2` ("surface bookmark persistence outcomes") and
  `528d4b58b` ("surface chat structure persistence outcomes") fixed only the
  sibling list surfaces.

## Trigger

With the server rejecting a mutation (revision conflict from another tab,
server error, lost ownership after refresh), delete/edit/disable a message,
switch its role, or toggle its bookmark from the transcript row. For the
bookmark special case: keep the `alertInput` name dialog open while another
client changes the chat's bookmarks, then confirm.

## Expected behavior

Failures surface (toast/status), queued mutations show a pending indicator —
the pattern the same codebase now follows in BookmarkList/ChatList/
SideChatList.

## Actual behavior

The optimistic change appears, then silently reverts when the rollback fires.
The stale-bookmark case silently never applies after the user typed a name. No
error, no queued indicator.

## Underlying cause

Row handlers call fire-and-forget dispatch variants and drop results; the
outcome-carrying variants and settlement plumbing already exist and are used on
sibling surfaces.

## Affected data flow

1. **UI:** row button → optimistic scoped apply.
2. **Request:** durable dispatch → server rejects.
3. **Rollback:** `rollbackScopedTranscriptAttempt`/row-metadata rollback
   restores the old value.
4. **Displayed state:** value flips back with no notification.

## Severity and likely user impact

**Low-medium.** Data stays consistent (rollback works), but the user sees
success followed by an unexplained revert — the maintainer's symptom classes 2
and 4. Behavior is certain; whether every action warrants surfacing is a
product judgment, but the sibling fixes establish the expectation.

## Recommended fix

Await the existing outcome results (`DeleteMessageScopedResult`, the
`dispatchUpdateMessageScoped` promise, `dispatchUpdateChatScopedWithOutcome`)
in `Chat.svelte` and route failures through the row's `setStatusMessage` /
`alertError`, mirroring BookmarkList. Surface the stale-bookmark no-op as a
retryable message.

## Test gap

Component test: mock the scoped dispatch to return `failed`, perform a row
delete, and assert a visible failure status; repeat for `queued` asserting a
pending indicator.
