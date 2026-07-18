# Reroll swipe buffer adopts the newly opened chat after a cross-chat generation

## Summary

When a regenerate/reroll finishes, its completion effects resolve "which chat
owns the swipe buffer" from the live selection instead of from the generation's
target chat. Durable generation explicitly supports navigating away while a
generation streams, so the buffer can be filled with one chat's candidates and
stamped with another chat's ownership scope. A later swipe in the wrongly
stamped chat replaces that chat's tail messages with the other chat's rows and
persists the replacement to the server.

## Location

- `src/ts/process/rerollNavigation.svelte.ts:323` — `regenerateFromCurrentTail`
  calls `deps.sendChatMain(false, regenerateMessageId)` with **no**
  `expectedTarget`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1214,1235` — `sendChatMain`'s
  freshness fence runs only when `expectedTarget !== undefined`, so the reroll
  path is unfenced.
- `src/ts/process/sendChatCompletion.ts:14-30` —
  `applySuccessfulSendChatEffects` invokes the reroll effects with no notion of
  the generation's target.
- `src/ts/process/rerollNavigation.svelte.ts:119-129` — `recordGeneratedReroll`
  reads `activeChatRecord()` (the *currently selected* chat) and pushes its
  tail slice, using the origin chat's `previousLength`.
- `src/ts/process/rerollNavigation.svelte.ts:93-97,131-134` — `markRerollChar`
  stamps the buffer's owner scope from the live selection.
- `src/ts/process/serverBackedSendChat.ts:789-816` — terminal `alternates`
  seeding resolves the chat content correctly by `terminalTarget.chatId`, but
  `seedRerollBufferFromAlternates` (`rerollNavigation.svelte.ts:441-475`) ends
  with `markRerollScope()` on the live selection, with no
  `activeChatId() === terminalTarget.chatId` gate (contrast the gated hydration
  path at `src/ts/server/chatMessageHydration.svelte.ts:384-386`).
- `src/ts/process/rerollNavigation.svelte.ts:159-181` — `applyTailSlice`
  overwrites the active chat's tail and persists it via
  `dispatchReplaceTailMessagesScoped`.

## Trigger

1. In chat A, press regenerate/reroll (or any send whose provider returns
   alternates).
2. While the generation streams, navigate to chat B (supported by durable
   generation).
3. Let the generation finish.
4. In chat B, swipe left (`unReroll`) or select a reroll candidate on the tail.

## Expected behavior

The swipe buffer belongs to chat A only. Chat B's swipe gestures must never see
or apply chat A's candidates.

## Actual behavior

On completion, `recordGeneratedReroll(previousLength)` pushes a slice of **chat
B's** transcript (computed with chat A's `previousLength`) into the buffer, and
`markRerollChar()` stamps the buffer's scope as **chat B**. Independently, the
terminal-alternates path seeds the buffer with chat A's tail content and also
stamps scope B. `resetRerollOnCharChange()` therefore believes the buffer
belongs to B, and a swipe in B runs `applyTailSlice` with chat A's messages —
overwriting B's tail and persisting the replacement server-side.

## Underlying cause

The completion effects and alternates seeding derive buffer ownership from the
live selection instead of the generation's `targetChatId`, and the reroll entry
point never passes `expectedTarget` into `sendChatMain`, so the one existing
fence is skipped.

## Affected data flow

1. **UI:** reroll button → `regenerateFromCurrentTail` truncates chat A and
   persists the truncate.
2. **Client:** `sendChat` streams into chat A by stable ids (correctly fenced
   internally).
3. **Completion:** `sendChatMain` post-await effects read the *current* chat
   (B); module-level `rerolls`/`lastChatKey` are corrupted.
4. **Next swipe in B:** `applyTailSlice` installs A-content into B's projection.
5. **Persistence:** `dispatchReplaceTailMessagesScoped(B.id, …, A-tail)` writes
   A's rows into B's SQLite transcript.
6. **Displayed state:** B shows A's messages; no error is surfaced.

## Severity and likely user impact

**High.** Persisted wrong-chat message content with no error. The user
discovers chat B's recent messages replaced by chat A's generation output.

## Recommended fix

- In `sendChatMain`, default `expectedTarget` to `captureActiveChatTarget()`
  at entry (the reroll path currently passes none) and skip
  `applySuccessfulSendChatEffects` when the target is stale.
- Make `recordGeneratedReroll`/`markRerollChar` accept the generation's
  `characterId`/`chatId` and resolve the chat by id.
- Gate the terminal `seedRerollBufferFromAlternates` call on
  `activeChatId() === terminalTarget.chatId`, exactly like the hydration path.

## Test gap

Add a reroll-navigation test that starts a regenerate for chat A, switches the
selection to chat B before the send resolves, completes the send, and asserts
that the buffer remains scoped to A (or is cleared) and that a subsequent
`unReroll` in B dispatches nothing.
