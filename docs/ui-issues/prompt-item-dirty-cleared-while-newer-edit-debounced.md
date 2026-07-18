# Prompt item dirty fields are cleared while a newer edit is still debounced

## Summary

The prompt-template bridge infers "persisted" from draft-vs-projection
equality. Because every keystroke also writes the optimistic projection, an
older PATCH's success acknowledges *newer, still-debounced* edits: it clears
the field's dirty flag while edit 2 has not been sent. A concurrent
other-session write can then trigger an owner refetch whose reconcile sees zero
dirty fields and adopts the pre-edit-2 server state wholesale — remounting the
row with older text mid-typing. The queued PATCH 2 later restores it, so the
value flips back on the next revision advance.

## Location

- `src/ts/server/promptTemplateBridge.svelte.ts:948-957` — PATCH success
  clears dirty fields.
- `src/ts/server/promptTemplateBridge.svelte.ts:1467-1498` —
  `clearDirtyPromptItemFieldsMatchingProjection` compares the draft against the
  optimistic projection; both hold the newest (unsent) value, so the compare
  passes for fields the succeeding PATCH did not carry.
- `src/ts/server/promptTemplateBridge.svelte.ts:1294-1323` —
  `reconcilePromptTemplateDraft` adopts the server value wholesale when the
  dirty count is zero.
- `src/lib/Setting/Pages/PromptSettings.svelte:1159-1180` — adoption remounts
  rows (cursor loss).

## Trigger

1. Type in a prompt item; PATCH 1 dispatches after the 250 ms debounce.
2. Keep typing (edit 2 still queued) while PATCH 1 resolves — its success
   clears the `text` dirty flag.
3. A concurrent write from another session triggers an SSE owner refetch that
   overwrites the projection with pre-edit-2 state; the reconcile effect
   (dirty = 0) adopts it.

## Expected behavior

Fields with unsent local edits stay dirty, so foreign refreshes preserve them
through the merge.

## Actual behavior

The row remounts showing pre-edit-2 text mid-typing (visible revert plus cursor
loss). PATCH 2 later fires and restores the text server-side, flipping the
visible value again. No durable loss, but the editor fights the user.

## Underlying cause

Dirty tracking uses draft-vs-optimistic-projection equality as evidence of
persistence, but the projection is optimistic — an older attempt's success can
therefore acknowledge newer pending edits it never carried.

## Affected data flow

1. Keystrokes → optimistic projection + debounced queue.
2. PATCH 1 ok → dirty cleared (equality against optimistic projection).
3. Foreign SSE refetch → projection overwritten with older server state.
4. Reconcile (dirty = 0) adopts → row remount with old text → PATCH 2 →
   restore.

## Severity and likely user impact

**Low-medium.** Confidence: medium — the fence gap is verified in code; the
trigger needs multi-writer activity inside a sub-second window and was not
runtime-reproduced. Transient, self-healing, but causes visible text/cursor
loss while editing shared presets.

## Recommended fix

In the PATCH success handler, do not clear a dirty field while a later pending
update or attempt for the same owner/item still changes it — or clear only
fields whose current value equals the succeeding PATCH's *attempted* value.

## Test gap

A bridge test: dispatch PATCH 1, stage edit 2 in the debounce queue, settle
PATCH 1, apply a foreign owner refetch with pre-edit-2 content, and assert the
draft retains edit 2.
