# Suggestion reroll clobbers the in-flight generation ownership flag

## Summary

The suggestion reroll button pulses the global `doingChat` store
(`set(true)` then `set(false)`) as a signal hack to re-run the suggestion
request. `doingChat` is the generation-ownership lease that `sendChat` owns and
every composer control derives from. If a generation is running when the pulse
fires, its ownership is force-released: the cancel button and spinner
disappear mid-stream, the Send button re-enables, and a second send reaches the
server only to be rejected with `generation_in_progress` — a spurious error.

## Location

- `src/lib/ChatScreens/Suggestion.svelte:319-329` — `rerollFreshSuggestions`
  does `doingChat.set(true); doingChat.set(false)` after an async
  `alertConfirm`; :331-339 shows the toggle exists only to re-trigger
  `handleDoingChatChange`.
- `src/ts/process/index.svelte.ts:58,171-208,560-565` — `doingChat` is the
  generation-ownership lease; `sendChat` owns it via `iOwnDoingChat` and its
  entry guard reads it.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:230-242,1680-1699` — the
  cancel/send button and `currentChatOwnsGeneration` derive from `$doingChat`.
- Original for comparison:
  `/home/codex/Risuai/src/lib/ChatScreens/Suggestion.svelte:183-189` called
  `requestSuggestions()` directly — no store toggle.

## Trigger

With auto-suggestions on and zero suggestions currently listed, click the
suggestion reroll button; while the confirm dialog is open, a generation starts
without composer interaction (most realistically: the tab returns to
visibility and `maybeReattachOpenChatGeneration` reattaches a running durable
job); then click OK. `isFreshSuggestionTarget` passes because both the captured
and live `suggestMessages` are `[]`.

## Expected behavior

Confirming only clears/regenerates suggestions; the running generation's UI
state is untouched.

## Actual behavior

`doingChat.set(false)` force-releases the lease `sendChat` still owns: the
cancel button and streaming spinner disappear, Send re-enables mid-stream, a
second send can enter `sendChat` (its `isDoing` guard now reads `false`) and is
rejected server-side with `generation_in_progress`, surfaced as an error
alert. `handleDoingChatChange(false)` also fires a suggestion request built
from the half-generated transcript.

## Underlying cause

The migration replaced the original direct `requestSuggestions()` call with a
pulse of the global generation-ownership store, without checking whether
another owner currently holds it.

## Affected data flow

1. **UI:** reroll click → confirm dialog → store pulse.
2. **Client state:** every `$doingChat` consumer (composer buttons, `sendChat`
   entry guard, reattach idle-waiter) observes a false release.
3. **Request:** a second send may dispatch.
4. **Server:** rejects with `generation_in_progress`.
5. **Displayed state:** spurious error; missing cancel/progress UI for the
   still-running generation.

## Severity and likely user impact

**Low-medium** (medium confidence on trigger frequency; mechanism certain).
The window is narrow, but the flag is the single most load-bearing UI
ownership signal, and the fix is trivial.

## Recommended fix

Extract the request body of `handleDoingChatChange(false)` into a
`requestSuggestions()` function and call it directly from
`rerollFreshSuggestions`, guarded by `get(doingChat) === false`. Never write
`doingChat` from Suggestion.

## Test gap

Store-level test: hold `doingChat` true (simulated generation), invoke the
suggestion reroll flow, and assert `doingChat` remains true throughout.
