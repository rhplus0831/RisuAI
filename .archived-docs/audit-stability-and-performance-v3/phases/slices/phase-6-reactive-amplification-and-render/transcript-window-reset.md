# Slice: Transcript Window Reset

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Findings:
v4-H1 and v4-L20. Client transcript window stability/performance change.

## Scope

Make transcript-window state follow the active chat identity so a deep jump or
screenshot in one chat cannot make later chats mount and parse whole
transcripts.

This slice owns `loadPages` and its jump/screenshot consumers in
`DefaultChatScreen.svelte`, plus the minimum key/reset wiring in
`Chats.svelte` or `ChatScreen.svelte` if that is the cleaner fix. It does not
change message ordering, bookmark target selection, scroll restoration,
streaming persistence, parser output, or screenshot image contents.

## Anchors

- [`../../../../audit-stability-and-performance-v4/audit-stability-and-performance-v4.md`](../../../../audit-stability-and-performance-v4/audit-stability-and-performance-v4.md)
  v4-H1, v4-L20, and the suggested Phase 6 remediation order.
- [`../../../v4-integration-brief.md`](../../../v4-integration-brief.md)
  Phase 6 amendments.
- `src/lib/ChatScreens/DefaultChatScreen.svelte`: `loadPages`,
  `scrollToMessage`, `screenShot`, scroll-up load-more, and fold load-more.
- `src/lib/ChatScreens/Chats.svelte`: `loadEnd` and current window consumer.
- `src/lib/ChatScreens/ChatScreen.svelte`: `DefaultChatScreen` mount/key
  boundary.
- `src/lib/Others/BookmarkList.svelte`: deep-jump driver.
- Focused tests should cover the active-chat switch, bookmark/deep-jump
  window, and screenshot cleanup paths.

## Target Shape

- Reset `loadPages` to the normal initial window, or key equivalent window
  state, when the active chat identity changes. Use an identity such as
  selected character id plus active chat id/chat page; a projection proxy
  identity is not a sufficient key.
- Keep the reset local to active-chat identity changes. Ordinary scroll-up
  load-more and fold load-more should still expand the current chat's window
  as they do now.
- A bookmark or explicit jump may expand the current chat enough to reveal the
  target, but that expansion must not survive switching to another chat.
- `screenShot()` must not leave `loadPages = Infinity` or any whole-transcript
  window state behind after capture. If a full mount is still required to
  preserve screenshot output, make it temporary and restore the previous
  bounded window in a `finally`/cleanup path.
- Avoid holding every rasterized canvas longer than the merge requires. If the
  screenshot implementation is already touched, release intermediate canvas
  references as soon as they are merged.
- Preserve the existing user-visible screenshot output and jump target
  behavior for the active chat.

## Invariants

- A chat switch always starts from that chat's own bounded window state or the
  default initial window.
- Deep-jump state from chat A must not mass-mount chat B.
- Screenshot cleanup runs on success and failure/cancel paths.
- Streaming, send, and hydration behavior remain unchanged.
- This slice does not try to reduce parser cost directly; it bounds the number
  of mounted messages that parser slices can see.

## Done Criteria

- A focused chat identity switch test proves a deep jump in chat A does not
  carry a raised `loadPages` value into chat B.
- A jump test proves the target message still becomes visible in the current
  chat without permanently changing other chats' windows.
- A screenshot/window test proves screenshot expansion is bounded or restored
  after completion, including an error/cleanup path.
- A render/count or mount-count probe proves opening another long chat after a
  deep jump mounts only the bounded initial window.
- v4-H1/v4-L20 proof is recorded in Phase 6 verification. No v3 risk row is
  marked `DONE` for these v4-only findings.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
