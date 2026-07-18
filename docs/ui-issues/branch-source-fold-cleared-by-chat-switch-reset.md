# Branch-source fold request is immediately cleared by the chat-switch reset

## Summary

Clicking "Branched from {chat}" on a branch-comment row is supposed to open the
source chat folded to the branch-point message. The fold state is set in the
same synchronous block that switches the chat, but the transcript-window
identity effect added in the Fastify migration unconditionally clears fold
state on every chat switch. The effect flush runs after the block, so the fold
is wiped before it is ever rendered. The fold feature is effectively dead code.

## Location

- `src/lib/ChatScreens/Chat.svelte:581-612` — `openBranchSource` runs
  `changeChatTo(...)` (:607), `foldChatToMessage(...)` (:608), and
  `navigate(...)` (:609-611) in one synchronous block.
- `src/ts/globalApi.svelte.ts:2022-2039` — `foldChatToMessage` sets
  `chatFoldedState.data`; :1988-2019 derive the fold index.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:619-625` —
  `resetTranscriptWindowForChatSwitch` sets `chatFoldedState.data = null`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:651-678` — the
  transcript-window identity `$effect` calls the reset whenever
  `previousIdentity !== null`, with no check of what the fold targets.
- Consumers that never see the fold: `src/lib/ChatScreens/Chats.svelte:62-66`,
  `DefaultChatScreen.loadPages.ts:47-61`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1861-1889`.

## Trigger

In a branched chat, click the "Branched from {chat}" button on the branch
comment row — the only producer of fold state in the codebase.

## Expected behavior

Navigate to the source chat folded to the branch-point message (the original
app's behavior; upstream had no chat-switch fold clearing, only the
mismatch-driven cleanup in `globalApi` that leaves a fold targeting the newly
selected chat alone).

## Actual behavior

Navigation happens, but the source chat opens at its normal tail window. The
fold is silently discarded with no error.

## Underlying cause

`openBranchSource` sets the fold before Svelte flushes effects. The identity
effect then observes the chat-id change, sees `previousIdentity !== null`, and
runs `resetTranscriptWindowForChatSwitch()`, nulling the fold that was just
set. Nothing re-establishes it (`navigate` keeps the same mounted
`DefaultChatScreen`). The reset was introduced by the migration; it does not
distinguish stale folds from a fold that targets the new chat.

## Affected data flow

1. **UI:** branch-comment button → `hydrateChatMessages(sourceChatId, strict)`.
2. **Client state:** `changeChatTo` writes `chatPage`; `foldChatToMessage`
   writes `chatFoldedState.data`.
3. **Effect flush:** identity effect fires → `resetTranscriptWindowForChatSwitch`
   → `chatFoldedState.data = null`.
4. **Displayed state:** `Chats` renders the plain tail window; the branch point
   is never shown.

## Severity and likely user impact

**Medium.** A visible navigation feature silently no-ops every time; the user
lands at the newest messages instead of the branch point and must scroll or
load pages manually to find it.

## Recommended fix

In `resetTranscriptWindowForChatSwitch` (or the identity effect), skip clearing
`chatFoldedState` when `chatFoldedState.data.targetChatId` equals the new
active chat id — the `globalApi` mismatch effects already clean up genuinely
stale folds. Alternatively, set the fold after a `tick()` in
`openBranchSource`.

## Test gap

Add a component test that mounts `DefaultChatScreen`, invokes the branch-source
flow (chat switch plus fold in one task), flushes effects, and asserts
`chatFoldedState.data` still targets the source chat and the rendered window is
folded to the branch-point index.
