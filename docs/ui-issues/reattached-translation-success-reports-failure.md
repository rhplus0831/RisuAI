# Reattached translation success can report failure and drop the translation display

## Summary

When a bootstrap-restored raw-translation job reports `succeeded`, the row
effect clears the job and then force-hydrates the entire transcript strictly to
pick up the persisted translation. On a tail-windowed chat, the chat is not in
`hydratedChatIds`, and if the full-transcript response is dropped by a
freshness guard (or the fetch fails), the strict flag throws. The row then
shows a translation *failure* even though the translation succeeded and is
durably persisted, and the already-cleared job leaves no retry path.

## Location

- `src/lib/ChatScreens/Chat.svelte:1183-1198` — succeeded-job effect:
  `hydrateChatMessages(expectedChatId, { force: true, strict: true })` with
  `.catch` → `setStatusMessage(translationRunFailed(...))`; the job is cleared
  before the hydration confirms.
- `src/ts/server/chatMessageHydration.svelte.ts:550-556` — `strict` throws when
  `hydratedChatIds` lacks the chat.
- `src/ts/server/chatMessageHydration.svelte.ts:355-359` — a stale drop skips
  the apply and does not mark the chat hydrated.
- `src/ts/server/chatMessageHydration.svelte.ts:379-381` — only a full-range
  response marks `hydratedChatIds`; a tail-windowed open chat is not in the
  set.

## Trigger

1. Start a server raw translation on a chat longer than the tail window.
2. Refresh the page; the job continues server-side and is restored via
   bootstrap as `succeeded`.
3. Between the forced full-hydration request and its response, the chat state
   or reroll buffer changes (a swipe, an incoming stream frame, any local
   edit) — or the fetch fails transiently.

## Expected behavior

The persisted translation appears (or the fetch is retried). No failure message
for a translation that succeeded.

## Actual behavior

The hydration response is dropped by the freshness guard
(`chat-state-changed` / `reroll-state-changed`); `strict` throws
("Chat hydration incomplete"); the row shows a translation failure while the
translation is durably persisted server-side. The job was already cleared, so
there is no retry path; clicking translate again re-pays the provider for a
fresh translation. Secondary cost: the path downloads the entire transcript to
pick up one message's translation.

## Underlying cause

Success handling conflates "translation succeeded" with "full strict
re-hydration succeeded", and clears the job before the confirmation lands.

## Affected data flow

1. **Bootstrap:** restored job `succeeded` → row `$effect`.
2. **Client:** job cleared → force full hydrate.
3. **Response:** stale-drop (or transient failure) → strict throw.
4. **Displayed state:** failure toast; local `message.translation` never
   updated; server retains the translation.

## Severity and likely user impact

**Low** (medium confidence). Narrow timing window, but the outcome is a
misleading error plus a display state that is only recoverable by paying for a
second provider call.

## Recommended fix

Fetch just the affected row (a targeted message read, or apply the job's
stored translation payload via the existing local-effect path if the server
ships it). Retry the hydration on a stale drop before declaring failure, and
clear the job only after a confirmed apply.

## Test gap

Simulate a succeeded restored job on a tail-hydrated chat whose full hydration
response is marked stale; assert no failure status is shown and the
translation ultimately renders (via retry or targeted apply).
