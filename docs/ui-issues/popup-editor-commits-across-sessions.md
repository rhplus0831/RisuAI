# Popup editor sessions have no owner and can commit across fields

## Summary

The maximize/popup editor is coordinated through a shared store with no
owner/session identity. Every opener polls `popUpEditorStore.open` with
`sleep(100)` loops and infers "my popup closed" from the flag. Two failure
modes follow: a waiter from a previously closed popup can adopt a *different
field's* popup value and commit it into its own field (including persisting
foreign text into a chat message via `saveMessageEdit`), and a waiter that
exits early leaves the popup open as an interactive no-op whose further edits
are silently discarded.

## Location

- `src/ts/stores.svelte.ts:202-207` — `popUpEditorStore` holds only
  `open/value/mode/language`; no session or owner field.
- `src/lib/UI/GUI/TextAreaInput.svelte:75-113` — poll loop; commits
  `popUpEditorStore.value` into its bound value when `open` goes false; exits
  early when `value !== initialValue`.
- `src/lib/UI/GUI/TextAreaResizable.svelte:51-74` — same pattern.
- `src/lib/ChatScreens/Chat.svelte:385-442` — message-edit opener; commit path
  ends in `saveMessageEdit()`, which persists.
- `src/lib/Others/PopupEditor.svelte` — the editor; Monaco edits
  `popUpEditorStore.value` live.

## Trigger

- Cross-field commit: close the popup editor for field A and open it for field
  B within one 100 ms poll interval. Field A's still-sleeping loop observes
  `open === true` again (no session token), keeps waiting, and when popup B
  closes it commits **B's edited text into field A**, running A's
  `onInput`/`onchange`/`saveMessageEdit` persistence.
- Orphaned editor: while the popup is open on a field, the bound value changes
  externally (another device edits the same setting/character field; an SSE
  refresh rewrites it). The waiter exits via its `value !== initialValue`
  fence — but the popup stays open and fully editable; everything typed
  afterwards is discarded on close with no warning.

## Expected behavior

A popup session is bound to exactly one opener; only that session's waiter can
commit its value. If the target diverges underneath, the editor closes or warns
instead of remaining an interactive no-op.

## Actual behavior

Commit attribution is inferred from a shared boolean. The wrong waiter can
adopt another session's value (worst case: persisting one field's content into
an unrelated chat message), and an orphaned session silently swallows all
further typing.

## Underlying cause

`popUpEditorStore` carries no owner/session identity, and commit is inferred
from polling the open flag rather than from an explicit session handle.

## Affected data flow

1. Maximize icon → store seeded with the field's value → waiter loop starts.
2. Monaco edits `store.value` live → close sets `open = false`.
3. Every sleeping waiter re-checks `open`; the wrong one can adopt the value →
   its commit path (`onchange`, `saveMessageEdit`) persists it.
4. Orphan case: waiter returns early → popup remains open, output unbound.

## Severity and likely user impact

**Medium.** Confidence: medium — the store shape and both waiter exits are
verified; the cross-field window is ≤100 ms (or needs an external concurrent
edit), so frequency is low, but the worst case writes foreign text into a
persisted chat message.

## Recommended fix

Add a `sessionId` (symbol or counter) to `popUpEditorStore`, stamped on every
open. Waiters capture it and treat `sessionId !== mine || !open` as "my session
ended"; commit only from the owning session; on target divergence, force-close
the popup or show a "target changed, edits discarded" notice instead of leaving
it open.

## Test gap

A store/waiter test that opens session A, closes it, opens session B within the
poll interval, closes B with edited text, and asserts field A never receives
B's value; plus an orphan test asserting the popup closes (or warns) when the
bound value changes externally.
