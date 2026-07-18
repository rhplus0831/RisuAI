# Queued input dialog inherits the previous dialog's typed text

## Summary

When one `alertInput` dialog resolves and another is queued, the queue
advances synchronously inside the store notification, so the `{#if
$alertStore.type === 'input'}` branch never unmounts and the same `TextInput`
instance survives. Its DOM value only updates when the `defaultValue` prop
*changes*; with equal defaults (typically both empty) the previous dialog's
typed answer remains in the field, and a plain OK/Enter submits it as the
second dialog's answer.

## Location

- `src/ts/alert.ts:261-278` — `handleResultDialogStoreValue`: resolving sets
  `{type:'none'}` and `showNextResultDialog()` runs synchronously inside the
  same store notification (`:275`), immediately re-setting the store to the
  next input dialog.
- `src/lib/Others/AlertComp.svelte:543-566` — the input branch is not keyed
  per request; `value={$alertStore.defaultValue}` is one-way.
- `src/lib/Others/AlertComp.svelte:304-305` — `submitInputAlert` reads
  `alertInputElement?.value` from the DOM.
- `src/lib/Others/AlertComp.svelte:207-209` — the focus effect re-runs and
  `.select()`s the stale text (mitigation: typing replaces it; plain OK/Enter
  does not).

## Trigger

Two `alertInput` dialogs queued concurrently (e.g. two plugin/script prompts)
with equal `defaultValue`. Answer the first with text; the second appears
instantly; press OK or Enter.

## Expected behavior

The second dialog starts from its own `defaultValue`.

## Actual behavior

The first dialog's typed answer is still in the field and is submitted as the
second dialog's answer.

## Underlying cause

Dialog identity (`dialogOwner`) is used for result routing but not for view
identity — the input branch isn't keyed per request, and the queue advance
happens without an intervening unmount.

## Affected data flow

1. Input dialog 1 resolve → store `none` → synchronous dequeue → store input
   dialog 2.
2. No unmount → stale DOM value → submit reads DOM → wrong answer routed to
   dialog 2's caller.

## Severity and likely user impact

**Low.** Residue of the fixed "concurrent input dialogs share one result"
class: routing is now correct, but content leaks across queued dialogs;
requires overlapping input prompts (medium confidence in practice, mostly via
plugins/scripts).

## Recommended fix

Wrap the dialog body in `{#key $alertStore.dialogOwner}` (or reset
`alertInputElement.value = $alertStore.defaultValue ?? ''` in the focus
effect).

## Test gap

A component test queuing two input dialogs with empty defaults, typing into
the first, and asserting the second submits its own (empty) default on OK.
