# Chat button triggers run against the placeholder transcript

## Summary

Manual `risu-trigger`/`risu-btn` button triggers capture the live chat without
hydrating it first. On chats longer than the display tail count, the captured
transcript's head consists of server-unloaded placeholder rows, so trigger
scripts compute against wrong history. Worse, when the trigger's message-list
change cannot be expressed as a narrow diff, the full-replace fallback refuses
to run because placeholders are present and returns `null` silently — after the
change was already installed into the live projection. The UI then shows edits
the server never receives.

## Location

- `src/lib/ChatScreens/Chat.svelte:1289-1310` —
  `captureChatButtonTriggerTarget` clones the live chat, placeholders included.
- `src/lib/ChatScreens/Chat.svelte:1355-1421` — `handleButtonTriggerWithin`
  performs no hydration before running the trigger.
- `src/lib/ChatScreens/Chat.svelte:1321-1353` —
  `applyFreshChatButtonTriggerResult` installs the trigger's whole chat into
  the projection.
- `src/ts/process/triggers.ts:1363-1441` — `runTrigger` operates on `arg.chat`
  as-is.
- `src/ts/chatCommands.ts:3635-3671` — `buildCompatibleMessageListUpdate`:
  narrow diff fails → `if (hasServerChatMessagePlaceholders(nextMessages))
  return null` (:3650) — silent, no rollback, no warning; :3567-3609 simply
  omit the message step from the durable batch.
- Contrast: `src/lib/ChatScreens/DefaultChatScreen.svelte:1042-1043` (`sendMain`
  awaits `hydrateActiveChatFully()`) and :1160-1198 (all reroll wrappers do
  too).
- Window default: `src/ts/chatDisplayTailCount.ts` (tail = 30),
  `src/ts/server/chatMessageHydration.svelte.ts:42`.

## Trigger

Open a chat longer than `chatDisplayTailCount` (default 30; head rows are
`__risuServerUnloadedMessage` placeholder comments). Click any
`risu-trigger`/`risu-btn` button rendered inside a message (common in
script-heavy character cards).

## Expected behavior

The trigger runs against the real transcript (as pre-migration, when the full
history was always resident), and any chat mutation it makes is persisted or
rolled back.

## Actual behavior

1. V2/Lua triggers receive a transcript whose head is empty
   `isComment`/disabled placeholder rows — `getFullChat()`/`{{history}}`-style
   reads compute on wrong history.
2. If the trigger's message-list change is not representable by the narrow
   diffs (touches ≥2 rows, or any row in the placeholder region), the
   full-replace fallback is refused because placeholders are present and
   returns `null` — but the change was **already installed** into the live
   projection. The UI shows the trigger's edits while the server never hears
   about them; the scriptstate/metadata steps of the same batch DO persist, so
   client and server split. The divergence lasts until the next forced
   hydration/reload silently reverts the visible messages.

## Underlying cause

`handleButtonTriggerWithin` skips the "hydrate fully before operating on the
transcript" step every other transcript-mutating entry point performs, and the
placeholder-refusal branch in `buildCompatibleMessageListUpdate` drops the
message step without rolling back the already-applied optimistic install.

## Affected data flow

1. **UI:** button click → capture placeholder-laden chat clone.
2. **Client:** `runTrigger`/`runLuaButtonTrigger` mutate the clone; freshness
   check passes (placeholders unchanged); whole chat installed into projection.
3. **Request:** `dispatchCompatibleChatUpdateScoped` builds the batch; the
   message step is dropped (`null`), other steps dispatch.
4. **Server:** persists scriptstate/metadata only.
5. **Displayed state:** UI shows message edits that were never persisted;
   next hydration reverts them.

## Severity and likely user impact

**Medium.** Wrong script behavior on long chats plus a "shown but never
persisted" divergence (fail-safe for server data, but confusing loss of
visible trigger effects).

## Recommended fix

Mirror the send path: `await hydrateActiveChatFully()` (with a freshness
re-capture) before capturing the trigger target in `handleButtonTriggerWithin`.
Additionally, make the placeholder-refusal branch in
`buildCompatibleMessageListUpdate` roll back the installed messages (it holds
`previous`) or at least surface a warning.

## Test gap

Add a test with a >30-message chat where a button trigger edits two head-region
messages; assert the trigger receives a fully hydrated transcript and that
either a persistence request is dispatched or the projection is rolled back —
never a silent projection/server split.
