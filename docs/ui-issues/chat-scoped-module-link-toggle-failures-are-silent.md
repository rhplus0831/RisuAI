# Chat- and character-scoped module link toggle failures are silent

## Summary

The chat "Modules" modal links a module to the current chat (left-click) or
character (right-click) with an optimistic toggle whose durable batch outcome
is discarded at every layer. On server rejection or a failed offline replay,
the rollback silently flips the toggle back — possibly minutes later or after
the modal is closed — so the user never learns the module is not active and the
next generation runs without it. The global module rows in `ModuleSettings`
were fixed for exactly this in a prior round; the scoped toggles were not.

## Location

- `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:126-134` — left-click →
  `toggleSelectedChatModule`, right-click → `toggleSelectedCharacterModule`;
  return values discarded, no status element in the modal.
- `src/ts/moduleCommands.ts:2091-2136` — optimistic write + fire-and-forget
  dispatch; :238-250 — `rejectScopedModuleOperation` rolls back silently;
  :1817-1825 — `dispatchScopedModuleDurableBatch` discards the batch outcome.
- `src/ts/chatCommands.ts:379-500` — `dispatchOwnedDurableBatch` failure path
  runs `rollback()` only; no user surfacing anywhere in the chain.
- Contrast: `ModuleSettings.svelte` global row toggles (fixed in a prior
  round: pending state, queued toast, per-row error).

## Trigger

Open the chat "Modules" modal, click the check icon to link a module to the
current chat (or right-click for character scope) while the server rejects the
command (conflict, validation, transient 5xx) or while the mutation is
retained offline and later fails on replay.

## Expected behavior

Like the global module row toggles: pending state, queued notice for retained
writes, and an error when the link fails.

## Actual behavior

The toggle flips blue/violet instantly; on failure the rollback restores
`chat.modules`/`character.modules` and the toggle silently flips back —
possibly after the modal is closed, in which case the user never learns the
module is inactive and the next generation runs without it.

## Underlying cause

The scoped toggle chain drops the batch outcome at every layer; the outcome
object is already built (`dispatchScopedModuleDurableBatch` receives it) but
never returned to the UI.

## Affected data flow

1. **UI:** check-icon click → optimistic `chat.modules` write.
2. **Request:** `PATCH /chats/:id` (plus optional generation-settings step) via
   the durable batch.
3. **Server:** rejects or replay fails.
4. **Rollback:** `rejectScopedModuleOperation` reverts the projection.
5. **Displayed state:** toggle flips back with no message; generation runs
   without the module.

## Severity and likely user impact

**Low-medium** (medium-high confidence). State converges correctly (no
divergence), but the outcome is hidden — bug class "UI shows success though
the server rejected".

## Recommended fix

Have `toggleSelectedChatModule`/`toggleSelectedCharacterModule` return the
batch outcome and surface it in `ModuleChatMenu` with the same
`reconcileRowMutation`-style pending/queued/failed handling `ModuleSettings`
already uses.

## Test gap

Component test with a mocked failing batch: assert the modal shows a failure
status when a scoped link toggle is rejected, and a queued indicator when it is
retained.
