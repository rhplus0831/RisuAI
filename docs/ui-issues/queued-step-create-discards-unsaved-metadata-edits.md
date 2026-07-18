# Queued step create force-closes the drawer, discarding unsaved metadata edits

## Summary

In the agent-preset editor drawer, a step create/duplicate that comes back
`queued` (offline/transient failure) latches the queued projection and closes
the entire drawer directly — bypassing the dirty-state confirmation that the
normal close path performs. Unsaved preset name/description edits are silently
discarded while the step intent itself is durably staged.

## Location

- `src/lib/Setting/Pages/AgentPresetSettings.svelte:162-166` —
  `latchQueuedProjection` calls `closeEditor()` directly.
- `src/lib/Setting/Pages/AgentPresetEditorDrawer.svelte:577-596` — a queued
  step outcome routes to `onQueuedProjection`.
- `src/lib/Setting/Pages/AgentPresetEditorDrawer.svelte:598-602` —
  `requestClose` is the only close path with the `isDirty` confirm; the queued
  path bypasses it.

## Trigger

1. Open a preset in the editor drawer and modify its name or description
   without saving (metadata dirty).
2. Click Save Step (new) or Duplicate step while the server is unavailable.
3. The step mutation returns `queued` with a generated-projection latch.

## Expected behavior

The queued step operation latches, but unsaved metadata edits are preserved,
saved alongside, or the user is asked via the same confirmation `requestClose`
shows.

## Actual behavior

The drawer closes unconditionally; the dirty metadata edits are lost with no
prompt. The step intent is durably staged and will persist at the next
bootstrap replay, so the user loses only the metadata half — silently.

## Underlying cause

`latchQueuedProjection` was wired straight to `closeEditor()`; the dirty-check
lives only in `requestClose`, which this path skips. (The close-on-queued
behavior itself is test-asserted; the gap is the missing dirty check.)

## Affected data flow

1. **UI:** step save → step mutation dispatch.
2. **Client state:** optimistic step + outbox stage; metadata draft still dirty.
3. **Response:** non-terminal failure → outcome `queued`.
4. **Displayed state:** drawer closes; metadata edits vanish without a prompt.

## Severity and likely user impact

**Low.** Narrow window (offline + dirty metadata + step operation) and small
data loss, but it is a silent discard of typed input. Mechanics verified with
high confidence; medium confidence that the discard (rather than the close) is
unintended.

## Recommended fix

In `latchQueuedProjection`, run the same dirty check/confirm as
`requestClose`, or keep the drawer open in a read-only latched state until the
queued projection resolves.

## Test gap

A drawer test that dirties metadata, forces a queued step outcome, and asserts
either a confirmation prompt or preserved metadata edits.
