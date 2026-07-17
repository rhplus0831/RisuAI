# Persona structural actions drop persistence outcomes

## Summary

The persona settings page and global persona picker optimistically create, delete, reorder, and select personas, but the exported helpers do not expose the server command's accepted, queued, or failed outcome. The UI treats a local projection change as completion.

The mutation layer has guarded rollback and durable retention, so data safety is substantially better than the feedback path: a terminal failure can make a created persona disappear, a deleted persona reappear, an order revert, or a selection switch back with no error. The global picker closes before a selection command settles.

## Location

- src/lib/Setting/Pages/PersonaSettings.svelte:84-103,120-176,228-242
- src/lib/Setting/listedPersona.svelte:37-49,100-114
- src/ts/persona.ts:1150-1173,1231-1283,1348-1451,1659-1738,1898-1978
- src/ts/server/commands.ts:3030-3139
- server/fastify/src/routes/commands.ts:4178-4232,4296-4412,4415-4478,4481-4540
- Rollback coverage: src/ts/persona.test.ts:1940-2023,2105-2245

## Trigger

Any of these server-backed actions triggers the issue:

- choose Create from scratch in PersonaSettings;
- confirm deletion of the selected persona;
- drag personas into a new order;
- select a persona in PersonaSettings or the global persona picker.

Allow the corresponding Fastify request to be terminally rejected, or let it fail retryably and remain in the durable outbox.

## Expected behavior

Each action should expose its exact persistence outcome to the initiating control. Accepted actions can complete normally; retained actions should be marked queued; terminal rejection should show an error and the restored state. The global picker should not silently close on an unacknowledged selection.

## Actual behavior

createNewUserPersona returns the locally created Persona. deleteSelectedUserPersona and reorderUserPersonasByIndices return booleans that mean only “the local preconditions/projection were applied.” changeUserPersona returns no outcome. Their structural dispatch functions all invoke dispatchDurableMutation with void and never translate settlement into UI state.

On terminal failure, personaCommandRollback taints the affected resource acknowledgement and safely restores attempted-matching state, but it raises no alert. Existing tests demonstrate a failed create removing the new row and failed selection restoring prior selection/profile data. The user sees that reversion without an explanation.

listedPersona.svelte calls changeUserPersona and close back-to-back, so the modal has already presented selection as complete when rollback happens. On retained failure, the optimistic action remains live for replay but no queued state tells the user that it is provisional.

## Underlying cause

The persona module already defines PersonaPersistenceStatus and uses it for profile saves, imports, and icon persistence. Structural actions bypass that contract. dispatchCreatePersona, dispatchDeletePersona, dispatchReorderPersonas, and the selection block in changeUserPersona discard the durable promise.

The UI-facing return values were inherited from the former frontend-owned Database semantics, where applying the local mutation effectively was the save. After the Fastify migration, they no longer describe persistence.

## Affected data flow

1. **UI interaction:** buttons, Sortable.onEnd, or a picker row invoke a structural persona helper.
2. **Client projection:** the helper updates getDatabase().personas, selectedPersona, and the legacy username/userIcon/personaPrompt/userNote mirror. Delete also optimistically rehomes generation references.
3. **Durable request:** the helper stages a persona-selection/owner mutation and sends POST /personas, DELETE /personas/:id, POST /personas/select, or POST /personas/reorder with stable persona IDs and a base revision.
4. **Server mutation:** Fastify writes the personas collection, co-writes settings when selection/profile mirrors change, and on delete rewrites affected chat/loadout references. It returns a revision, event, and mutation certificate.
5. **Client acknowledgement:** local-effect certificates settle accepted projections; retryable results retain the outbox; terminal results invoke attempted-value-guarded collection/settings/reference rollback.
6. **Displayed state:** PersonaSettings and listedPersona render the shared projection, but neither receives settlement. Rows/selections can revert after the action or after the picker closes, and retained changes have no queued marker.

## Severity and likely user impact

**High.** Persona selection changes the user identity and prompt used for generation; delete additionally cascades through chat and loadout references. Silent rollback can cause generation with the prior persona, while silent retention leaves a future structural mutation live after the user reasonably assumes it failed or completed.

## Recommended fix

Return Promise<PersonaPersistenceStatus> from structural helpers (or add outcome-bearing variants) and settle it from the exact outbox handle. Use accepted | queued | failed consistently with the existing import/profile APIs.

PersonaSettings should expose per-action pending state, show a localized queued message for retained mutations, and show a failure message after terminal rollback. listedPersona should await the selection outcome: close on accepted, acknowledge queued explicitly, and remain open on failed. Disable or serialize conflicting structural controls while the exact operation is unresolved.

Add component tests covering failed/queued create, delete, reorder, and global selection, in addition to the existing low-level rollback tests.
