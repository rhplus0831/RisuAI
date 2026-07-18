# Invalid translator-preset number input cancels sibling preset edits

## Summary

Clearing the "Translation response size" field fires its setter with `null`.
The invalid value is applied optimistically and queued, and the queue's
invalid-patch guard then cancels the *entire* per-preset pending entry —
acknowledging its staged durable outbox row and deleting all dirty-field
tracking, including a prompt or name edit still inside its debounce window.
That edit is never dispatched, and the next authoritative refresh silently
reverts the visible prompt to the stale server value.

## Location

- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:1865-1884` —
  the `maxResponse` `NumberInput` setter: marks dirty, applies the patch to the
  projection, and queues the update, all without validating the value.
- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:1459-1468` —
  `queueTranslatorPresetUpdate`'s guard: an invalid patch calls
  `cancelPendingTranslatorPresetUpdates(presetId)`.
- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:347-354` —
  `cancelPendingTranslatorPresetUpdates` clears the timer, acknowledges the
  staged outbox row, and deletes the pending patch plus all dirty-field and
  rollback-baseline maps for the preset.
- `src/ts/translator/presets.ts:109-151` — patch validation that rejects the
  non-finite `maxResponse`.

## Trigger

1. Translator type "Ax. Model"; edit the translator prompt (or rename the
   preset) — the update debounces for ~250 ms.
2. Within that window, click into "Translation response size" and backspace it
   to empty.

## Expected behavior

A transiently empty number is ignored; the pending prompt/name edit still
dispatches.

## Actual behavior

The setter runs with `null`: the field is marked dirty, `null` is applied to
the projection, and the queue call trips the invalid-patch guard, which cancels
the whole pending entry — including the still-debouncing prompt/name edit. The
edit is never sent; the next SSE-applied refresh reverts the visible prompt
with no error. The projection's `maxResponse` is separately normalized to 1000,
so input, projection, and server all disagree until the refresh.

## Underlying cause

Pending state is keyed only by preset id, and the invalid-patch guard nukes the
entire entry instead of rejecting the single offending field. The invalid value
is also applied optimistically before any validation runs.

## Affected data flow

1. Prompt keystrokes → dirty-mark + optimistic projection + debounced queue
   entry (staged outbox row).
2. `NumberInput` clear → setter(`null`) → dirty-mark + optimistic write.
3. `queueTranslatorPresetUpdate` → `isValidTranslatorPresetPatch` fails →
   cancel whole pending row + acknowledge outbox.
4. Prompt PATCH never dispatches; SSE refresh restores the stale prompt.

## Severity and likely user impact

**Medium.** Confidence: high (guard and cancel paths verified directly). Silent
loss of just-typed prompt or rename content from an ordinary retype gesture in
an adjacent field.

## Recommended fix

In the setter, skip mark/apply/queue for non-finite values (mirroring the fix
for the schema number wrapper). In the queue guard, drop only the invalid field
from the pending patch, keeping the other fields' patch, outbox row, and dirty
tracking intact.

## Test gap

A component test that stages a prompt edit, then feeds `null` through the
`maxResponse` setter inside the debounce window, and asserts the prompt PATCH
still dispatches.
