# Reroll and send gates do not re-check after the hydration await

## Summary

The send path and the reroll hotkeys guard against concurrent generations with
`$doingChat`, but the reroll wrappers sample it only *before* awaiting
`hydrateActiveChatFully()` and never consult the `preparingSend` flag that the
send path uses. Rapid send + reroll input can interleave both preflights: a
persisted truncate races a persisted append, scrambling the transcript tail,
and one of the two `sendChat` calls is refused so a requested generation
silently never happens.

## Location

- `src/lib/ChatScreens/DefaultChatScreen.svelte:1160-1198` — the
  reroll/unReroll/newReroll wrappers check `$doingChat` only before
  `await hydrateActiveChatFully()`, and never check `preparingSend`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1019-1029` — `sendMain` checks
  `$doingChat || preparingSend`, so the mutual exclusion is one-directional.
- `src/ts/process/rerollNavigation.svelte.ts:337-343` — the module's contract
  comment: "callers MUST NOT invoke reroll/unReroll while a generation is in
  flight".
- `src/ts/process/rerollNavigation.svelte.ts:191-221` — `applyRerollTruncate`
  dispatches a persisted truncate; :276-327 `regenerateFromCurrentTail`.

## Trigger

Press Enter (send) and Ctrl+M (reroll — a documented hotkey on the same
textarea) in quick succession, in either order. The send is in its preflight
(`preparingSend === true`, `doingChat` still false while it awaits
`hydrateActiveChatFully()`/the append round-trip) when reroll's gate runs, or
vice versa.

## Expected behavior

The second action is rejected while the first is preparing, as the reroll
module's concurrency contract requires.

## Actual behavior

Both proceed: reroll truncates the trailing assistant group (persisted, with
`preserveRemovedAsAlternates`) while the send appends the user message. If the
append lands first, the truncate's `msgs.length = keepLength` (computed
pre-append) removes the just-sent user message locally and persists that
removal. Both then race into `sendChat`; one loses at the `isDoing` guard, so a
generation the user asked for silently doesn't happen on top of the scrambled
tail.

## Underlying cause

The `$doingChat` gate is only sampled before an await; the reroll wrappers do
not participate in the `preparingSend` mutual exclusion that `sendMain` uses,
and neither re-checks after resuming from the hydration await.

## Affected data flow

1. **UI:** two hotkeys → two async preflights interleave.
2. **Requests:** `POST` append and `POST` truncate race.
3. **Server:** both persist; transcript tail scrambled.
4. **Client:** one `sendChat` refused at the `isDoing` guard.
5. **Displayed state:** lost/duplicated tail rows; no generation.

## Severity and likely user impact

**Low-medium** (medium confidence). Requires fast double input, but the result
is a persisted lost/duplicated tail mutation.

## Recommended fix

Share one composer-busy flag: have the reroll wrappers set and check
`preparingSend`, and re-check `$doingChat` + `preparingSend` after
`hydrateActiveChatFully()` resolves, before entering `rerollNav`.

## Test gap

Interleaving test: start `sendMain` (hold its hydration await open), invoke the
reroll wrapper, and assert it refuses to proceed until the send settles.
