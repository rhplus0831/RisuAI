# Inlay completion overwrites a newer message edit

## Summary

Image-inlay finalization is asynchronous, but its completion handler checks only that the original character, chat, and assistant message still exist. If the user edits and successfully persists that assistant message while image generation is pending, the late inlay promise unconditionally overwrites the newer text in the local projection. The UI then disagrees with Fastify until an authoritative refresh restores the saved edit.

## Location

- `src/ts/process/serverBackedSendChat.ts:545-598`
- `src/ts/process/inlayScreen.ts:7-46`
- `src/ts/process/postGeneration/streamResponse.ts:221-233`
- `src/lib/ChatScreens/Chats.svelte:151-177`
- `src/lib/ChatScreens/Chat.svelte:322-358,963-992,1657-1694,2078-2099`
- `server/fastify/src/routes/commands.ts:5868-5922`

## Trigger

1. Send a message for an image-inlay-enabled character and let the server finish the text generation.
2. While the assistant row displays `[Generating...]` and image generation/upload is still pending, open the row editor, replace its text, and save.
3. Let the pending inlay promise resolve.

## Expected behavior

The later user edit is the newest intent and must win. Inlay completion should apply only if the target message still contains the exact value/state from which that inlay operation started. If the user edited, deleted, replaced, or regenerated the target, the old completion should be discarded or offered separately.

## Actual behavior

The message edit is sent to Fastify and can be acknowledged successfully. When the older image operation finishes, `applyServerBackedTerminal` finds the same message id and assigns its resolved inlay text without checking the live text or a mutation epoch. The displayed edit is replaced by the image result even though the server still stores the edit. A later resource refresh makes the message change again, back to the authoritative edited value.

## Underlying cause

`runInlayScreen` returns an immediate placeholder plus a long-lived promise. The completion path captures stable owner ids, but its freshness check is identity-only:

- It reacquires the character/chat and locates the assistant by generation/message id.
- It does not capture or compare the placeholder text, the server message revision, a per-message projection epoch, or an operation token.
- It unconditionally executes `assistant.data = resolved` whenever the row still exists.

The UI allows the race. Streaming cleanup clears `chat.isStreaming` before terminal inlay completion, and `Chats.svelte` marks a row as generation-loading only while the last assistant data is exactly empty. As soon as `[Generating...]` is assigned, `Chat.svelte` renders its edit controls even though `applyServerBackedTerminal` is still awaiting the image promise.

## Affected data flow

1. **Server generation:** Fastify persists the assistant output and returns a terminal frame.
2. **Client inlay operation:** The terminal handler assigns `[Generating...]` and awaits the image-generation/upload promise.
3. **UI interaction:** The edit button becomes available; the user saves new assistant text.
4. **Edit request/persistence:** `dispatchUpdateMessageScoped` sends `PATCH /api/v1/commands/messages/:messageId`; Fastify applies the patch and acknowledges a new revision.
5. **Late local completion:** The earlier inlay promise resolves, reacquires the same message id, and directly assigns `{{inlay::<assetId>}}`.
6. **Displayed/authoritative split:** The browser shows the stale inlay completion while SQLite contains the newer edit.
7. **Later synchronization:** Hydration or resource invalidation restores the server edit, producing another visible reversion.

## Severity and user impact

**High.** A confirmed user edit appears to save and is then visibly overwritten by older asynchronous work. This is the migration's stale-response race pattern in a local callback rather than an HTTP response. It creates cross-tab inconsistency and makes users unsure which version was actually retained.

## Recommended fix

Make inlay finalization conditional and durable:

1. Capture the target message id, generation id, expected authoritative text, and a per-message mutation/projection epoch when starting the inlay.
2. On completion, apply only if all owner identities still match and the message remains at that expected state. A simple text comparison is useful, but an operation token/epoch is needed for edit-away-then-edit-back cases.
3. Persist the final inlay through a compare-and-set server command. Have Fastify reject it if the message revision/text changed after the generation result.
4. Invalidate the pending operation when the target is edited, deleted, replaced, truncated, or regenerated. Optionally display a row-specific pending state, but do not rely on disabling controls as the correctness mechanism.

## Test coverage gap

Add a deferred-promise test for `applyServerBackedTerminal`: start an inlay, persist an edit to the same message, resolve the old promise, and assert that neither the projection nor SQLite is overwritten. Add variants for deletion, target replacement/regeneration, chat switching, and an unchanged message where conditional finalization succeeds exactly once.
