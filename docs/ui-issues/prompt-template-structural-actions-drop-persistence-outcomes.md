# Prompt template structural actions drop persistence outcomes

## Summary

Prompt-template Add, Remove, Reorder, and Enable controls update local draft/resource projections and then fire durable Fastify commands without exposing their settlement. The rollback code can restore a rejected operation, but the initiating UI has no pending, queued, or failed state.

Users can therefore see a prompt row disappear and reappear, a new row vanish, an order revert, or the template-enabled toggle switch back without any explanation. Retained mutations remain live for replay but look fully accepted.

## Location

- src/lib/Setting/Pages/PromptSettings.svelte:405-567,699-713,1265-1362
- src/lib/Setting/Pages/BotSettings.svelte:865-951,2140-2150
- src/ts/server/commands.ts:2906-3005
- server/fastify/src/routes/commands.ts:3877-3924,3980-4061,4064-4123,4126-4165

## Trigger

After prompt-template hydration succeeds, perform one of the following while the corresponding command is terminally rejected or retryably unavailable:

- add a prompt item;
- remove a prompt item;
- move/drag an item to reorder the template;
- enable or disable the selected prompt preset's custom template in legacy Bot Settings.

## Expected behavior

The editor should connect each optimistic structural transition to the exact command receipt. It should show pending state, identify retained operations as queued, and show a failure when terminal rollback restores the prior template. Conflicting actions should be serialized or clearly associated with their own outcome.

## Actual behavior

PromptSettings mutates promptTemplateDraft, mirrors the selected prompt-preset projection, stages a durable mutation, and invokes dispatchDurableMutation with void for create, delete, and reorder. BotSettings does the same for enable/disable.

runServerCommand suppresses rollback for a retained durable row and invokes the supplied guarded rollback for a terminal rejection, so the data projection is intentionally allowed either to stay optimistic or to revert. Neither branch sets an error/status visible to the editor. The hydration area has loading/error/retry UI, but mutation settlement is absent.

## Underlying cause

The structural dispatch helpers return void and discard ServerCommandResult. Their rollback callbacks are projection-only functions such as rollbackFailedPromptTemplateItemCreate/Delete/Reorder or restoreSelectedPromptPresetTemplateProjection. No shared persistence-status abstraction translates durable accepted/retained/discarded settlement for the component.

This leaves the former frontend-owned behavior—local array mutation as apparent completion—on top of a server-owned persistence model.

## Affected data flow

1. **UI interaction:** PromptDataItem removal/move, the Add button, Sortable drop, or the custom-template enable check invokes a structural helper.
2. **Client projection:** promptTemplateDraft and the selected prompt preset/resource projection are changed immediately. The enable path also updates selectedPromptTemplateEnabledControl.
3. **Durable request:** the owner-scoped outbox sends POST /prompt-items, DELETE /prompt-items/:itemId, POST /prompt-items/reorder, or POST /prompt-items/enable with optional promptPresetId and base revision.
4. **Server mutation:** Fastify validates the owner and stable item IDs, writes either prompt_templates or the selected prompt preset row, and returns a revision/event/local-effect certificate.
5. **Client acknowledgement:** accepted effects fence the optimistic structure; retained results keep the outbox/projection; terminal results run owner/epoch-guarded rollback.
6. **Displayed state:** the editor rerenders from the changed or restored projection, but no settlement reaches a status element or alert.

## Severity and likely user impact

**High.** Prompt-template structure directly controls generation ordering and message roles. A silent rollback can make the next request use a different template than the editor appeared to save. A silently queued delete/reorder may execute later after the user has continued editing the template.

## Recommended fix

Make structural helpers return a shared accepted | queued | failed outcome tied to the staged outbox handle. Track per-owner structural operations in PromptSettings/BotSettings, with pending disabling where order matters.

- accepted: clear pending state after the local effect/resource fence is applied;
- queued: keep/reassert the projection and show a localized queued notice;
- failed: allow the existing guarded rollback, then show an actionable error and focus the restored item/control.

Add component tests for terminal and retained create/delete/reorder/enable outcomes, not only low-level rollback and hydration behavior.
