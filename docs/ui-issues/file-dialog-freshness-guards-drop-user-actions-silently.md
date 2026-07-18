# File-dialog freshness guards drop user actions silently

## Summary

Several upload/import flows snapshot state before opening a file dialog and
verify freshness after the user picks a file. When the underlying setting
changed while the dialog was open (a second tab's write arriving over SSE, or a
queued patch settling), the guards bail out with a bare `return`: the chosen
file is never applied and the user gets no feedback. For custom backgrounds the
image may already be uploaded server-side, leaving an orphaned asset; for color
schemes the stale path even suppresses the "invalid color scheme" parse error.

## Location

- `src/ts/gui/colorscheme.ts:258-306` — color-scheme import: freshness guard
  returns `null` silently after the file dialog.
- `src/ts/server/colorSchemeImport.ts:80-99` — stale check that also swallows
  the parse-error path.
- `src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte:32-53` —
  `isCurrentUpload()` failure after the upload already happened → silent
  return, orphaned server asset.
- `src/ts/persona.ts:1836-1881` — persona icon upload follows the same
  pattern.

## Trigger

1. Open the color-scheme import or custom-background (or persona icon) file
   dialog.
2. While it is open, the corresponding setting changes — another tab writes it
   (arrives via SSE), or a queued patch settles.
3. Pick a file.

## Expected behavior

The file applies, or the user is told why it did not ("settings changed while
choosing a file — retry to overwrite").

## Actual behavior

The freshness guard fails and the flow silently returns. The chosen file is
never applied anywhere; for backgrounds the bytes may already be persisted as
an orphan asset. No alert, no retry affordance. In the color-scheme flow, an
invalid file picked in the stale state also loses its parse-error message.

## Underlying cause

Staleness guards treat "state moved underneath the dialog" as a silent no-op
instead of a surfaced outcome. That is correct for background refreshes racing
each other, but here the dropped operation is an explicit user action.

## Affected data flow

1. Button → snapshot of target state → async file dialog (unbounded time).
2. Concurrent apply changes the snapshot fields.
3. File chosen → (background: upload to `PUT /assets` happens first) →
   freshness guard fails → bare return.
4. No UI outcome; possible orphaned server asset.

## Severity and likely user impact

**Low.** Confidence: high on the behavior, medium on frequency (requires a
concurrent write while a dialog is open — most likely with two tabs). A
deliberate user action disappears without explanation.

## Recommended fix

When a file was actually chosen, surface the freshness failure via an alert
with a retry option instead of returning silently. For backgrounds, check
freshness before uploading, or delete the just-uploaded asset when the apply is
abandoned.

## Test gap

A unit test for each guard: simulate a state change between dialog-open
snapshot and file resolution, and assert a user-visible outcome (alert or
status) is produced rather than a silent return.
