# Chat generation controls hide persistence outcomes

## Summary

Sidebar controls for active-chat generation settings optimistically update the
chat row but expose only a boolean meaning “the local write was applied.” The
dedicated queue later sends and classifies the Fastify mutation, yet its result
is not returned to the controls. Dynamic prompt toggles, jailbreak, agent-preset
selection, reset-to-defaults, and applying a saved toggle preset can therefore
silently revert or remain queued without status.

The generation-settings queue correctly rebases rapid edits and restores only
failed intent. The regression is the missing acknowledgement contract between
that queue and the UI.

## Location

- `src/lib/SideBars/Toggles.svelte:53-100,190-266,269-346` renders dynamic
  generation and jailbreak controls and invokes void handlers.
- `src/lib/SideBars/ChatGenerationSettingsControls.svelte:46-64,103-130`
  saves direct agent-preset selection.
- `src/lib/SideBars/ChatGenerationResetDefaultsButton.svelte:19-30` confirms a
  reset and then discards its save result.
- `src/lib/SideBars/ChatGenerationTogglePresets.svelte:88-101` applies a saved
  toggle preset and discards the chat-row result. Preset collection CRUD is a
  separate settings-owned flow.
- `src/ts/activeChatGenerationSettings.ts:261-356` returns local booleans from
  all active-chat save helpers.
- `src/ts/chatCommands.ts:2677-3047` owns optimistic projection, durable queue,
  rollback, retained projection, and acknowledgement.
- `src/ts/chatCommands.test.ts:2501-2555,2824-2925` demonstrates guarded
  terminal rollback and rapid-edit rebasing.
- `src/ts/server/commands.ts:3517-3558` sends full/sparse generation-settings
  writes and validates local effects.
- `server/fastify/src/routes/commands.ts:5629-5687` persists the settings in the
  exact chat row.

## Trigger

Change any active-chat generation setting from the sidebar:

- toggle jailbreak or a prompt-defined checkbox;
- edit/select a prompt-defined sidebar toggle;
- choose an agent preset in the direct select;
- confirm reset to defaults;
- apply a saved toggle preset.

Then let the Fastify command be retained after a retryable failure or rejected
terminally, including reference/toggle validation failure.

## Expected behavior

The initiating control should know whether its exact change was accepted,
queued, or failed. Pending fields should remain identifiable during rapid
changes. A terminal failure should show an error after the queue restores the
accepted base; a retained write should be explicitly provisional.

## Actual behavior

Every save helper returns the boolean from
`dispatchSaveChatGenerationSettings`. That function returns `true` immediately
after it updates `chat.generationSettings`, registers a pending token, stages an
outbox row, and enqueues asynchronous execution. It does not return the queue
Promise or settlement.

The Svelte handlers are void and render directly from the optimistic chat
resource. On terminal failure, the queue removes the failed intent and projects
the confirmed base plus any newer jobs, so the relevant control later flips
back without an error. On retained failure, it keeps the optimistic settings
as the queue's confirmed projection for replay; no UI says queued. The boolean
also returns `true` for a no-op, so it cannot be repurposed as persistence
status.

## Underlying cause

The dedicated generation-settings queue was designed as an internal fire-and-
forget replacement for frontend-owned chat mutation. It tracks exact durable
handles and already knows retained versus completed settlement, but its public
entry point intentionally collapses all locally applicable cases to a boolean.
The sidebar was never connected to that asynchronous owner.

## Affected data flow

1. **UI interaction:** a toggle/select/reset/apply handler captures the active
   chat (some flows also use `expectedTarget`) and constructs a sparse logical
   settings patch.
2. **Client projection:** `dispatchSaveChatGenerationSettings` merges and writes
   a full `chat.generationSettings` projection, registers a per-chat pending
   save, and queues the logical intent behind earlier jobs.
3. **Request:** the queue sends
   `PUT /api/v1/commands/chats/:chatId/generation-settings` with a base revision
   and either a full value or sparse patch plus its validation base.
4. **Server persistence:** Fastify validates persona/model/prompt/agent/module
   references and sidebar toggle requirements, canonicalizes the settings, and
   writes the exact chat row with `writeSingleChatRow()`.
5. **Response/acknowledgement:** success returns `chat.updated`, IDs, revision,
   and either the authoritative full settings or a sparse mutation certificate.
   The client advances its confirmed base. Retryable results retain the outbox;
   terminal results remove the failed job and reproject confirmed plus newer
   intents.
6. **Displayed state:** `resolveActiveChatGenerationSettings()` reads the shared
   resource and the sidebar derives every control from it. The controls observe
   the eventual value but receive no settlement or error.

## Severity and likely user impact

**High.** These values determine the persona, models, prompts, jailbreak state,
and custom inputs used for generation; incomplete settings can also block
sending. An unexplained rollback can change subsequent generation behavior,
while a silent queued change can replay later. Reset and preset application are
explicit actions for which the UI strongly implies completion.

## Recommended fix

- Return an exact per-job Promise or operation handle from
  `dispatchSaveChatGenerationSettings`; distinguish
  `accepted | queued | failed` from the separate local-applied/no-op result.
- Propagate it through all `saveActiveChatGenerationSettings*` helpers and
  `applyChatGenerationTogglePreset`.
- Track pending/error state by `(chatId, logical field)` so rapid disjoint edits
  remain usable and a newer value is not marked failed with an older job.
- Show localized queued and failed status in the sidebar. Keep optimistic
  controls if queued, but do not present them as accepted.
- Preserve the existing per-chat queue, sparse/full fallback, accepted-base
  reseeding, and later-intent rebasing.
- Add component tests with deferred first and second saves, terminal rejection,
  retained replay, reset, and agent-preset selection.
