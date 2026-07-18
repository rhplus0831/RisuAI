# Chat-generation picker selections drop their persistence outcome

## Summary

Picking a model preset, prompt preset, or persona for the active chat from the
picker modals — and switching model presets via the Ctrl+number hotkey — uses
the fire-and-forget boolean wrapper around the chat-generation-settings save.
The boolean means "the local write was applied", so the modal closes (and the
hotkey shows a success toast) while the settlement is discarded. On rejection
the rollback silently snaps the sidebar back to the old preset/persona. The
sibling agent-preset selector in the same panel was already converted to the
outcome-carrying variant; these callers were not.

## Location

- `src/lib/Setting/botpreset.svelte:151-158` — `selectPreset` in
  chat-generation mode: `saveActiveChatGenerationSettingsSelection(...)` and
  `close()` on truthy return; the settlement is never consumed. A `null`
  return (stale `expectedTarget`) leaves the picker open with zero feedback.
- `src/lib/Setting/listedPersona.svelte:40-48` — `selectPersona` in
  chat-generation mode: same pattern.
- `src/ts/hotkey.ts:525-540` — `changeToPreset` uses the boolean wrapper and
  shows a success toast on mere dispatch.
- `src/ts/activeChatGenerationSettings.ts:296-348` — the boolean wrapper and
  the `WithOutcome` variant with its settlement.
- `src/ts/chatCommands.ts:2971-3038` — settlement creation and
  `restoreChatGenerationSettings` rollback.
- `src/lib/SideBars/ChatGenerationSettingsControls.svelte:65-93` — the sibling
  agent-preset selector that consumes the outcome (the prior
  "surface chat generation settings persistence outcomes" fix).

## Trigger

In the chat sidebar, open the model-preset / prompt-preset / persona picker
(active-chat-generation-settings mode) and pick an entry — or press the
Ctrl+number preset hotkey — while the server rejects the save (revision
conflict, poisoned outbox after offline, server error).

## Expected behavior

Like the agent-preset selector: pending state, then a queued notice on retained
outcomes or an error alert on failure. A stale-target `null` should also
produce feedback.

## Actual behavior

The modal closes immediately (implicit success), or the hotkey toasts success.
On rejection the rollback restores the previous generation settings and the
sidebar label silently reverts; queued outcomes and replay discards are equally
invisible.

## Underlying cause

The 580727a7a fix converted only the direct agent-preset selector to
`saveActiveChatGenerationSettingsSelectionWithOutcome` + settlement handling;
the two picker modals and the hotkey still call the fire-and-forget boolean
variant.

## Affected data flow

1. Picker row click / hotkey → optimistic `chat.generationSettings` write +
   staged durable intent.
2. Modal closes / toast shows → save command dispatches.
3. Server rejects → rollback restores old settings → sidebar reverts with no
   status.

## Severity and likely user impact

**Medium.** Confidence: high (call sites verified directly). The user believes
the chat now uses preset/persona X; the next generation runs with the old one
after a silent revert.

## Recommended fix

Use `saveActiveChatGenerationSettingsSelectionWithOutcome` in `selectPreset`,
`selectPersona`, and `changeToPreset`; keep a pending state in the picker (or
close and surface the settlement via `alertNormal`/`alertError`), mirroring
botpreset's existing global-mode `selectionPendingKey`/`selectionError`
handling. Surface the stale-target `null` case too.

## Test gap

Component tests that reject the save at the transport and assert an error is
shown after the picker closes (and that the hotkey path reports failure instead
of toasting success).
