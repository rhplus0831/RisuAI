# Module enable and delete controls discard server outcomes

- **Severity:** High
- **Affected surface:** `SET-18` (Modules)
- **Primary locations:** `src/lib/Setting/Pages/Module/ModuleSettings.svelte:190-204,254-265`; `src/ts/moduleCommands.ts:623-710,907-932`

## Trigger

- Click the globe button to enable or disable a global module.
- Confirm deletion of a global module.
- The command then conflicts, fails validation, loses transport, or is rejected by Fastify.

## Expected behavior

The row should expose an in-flight state and then show whether the mutation was accepted, durably queued, or failed. A terminal failure should be visible where the action was initiated. Destructive deletion should not look final until the mutation owner has at least classified the server outcome.

## Actual behavior

Both actions update the shared projection immediately, but their public command functions return `void`:

- `setGlobalModuleEnabled` changes `enabledModules` and calls the void `dispatchEnableModule` (`src/ts/moduleCommands.ts:663-710,921-932`).
- `deleteGlobalModule` removes the module and its projected references, then calls the void `dispatchDeleteModule` (`src/ts/moduleCommands.ts:623-661,907-918`).

The Module Settings handlers do not await either action, do not disable the affected row, and do not connect failure to `mutationError` (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:200-204,259-265`). The durable owners can retain a retryable operation or roll back a terminal failure, but the UI receives no acknowledgement. Consequently, a rejected toggle silently flips back and a rejected deletion silently makes the module reappear.

This differs from create/edit in the same component, which await `createGlobalModule`/`saveGlobalModuleDraft`, keep `mutationPending`, and render `mutationError` (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:77-79,105-155`).

## Underlying cause

The module command layer launches `dispatchDurableMutation(...)` with `void` and erases its `ServerCommandResult`/retention classification. The UI's `async` click handlers therefore have nothing to await. Projection rollback is implemented, but rollback is being used as the only user-visible failure signal.

## Affected data flow

1. The globe/delete controls call `setGlobalModuleEnabled` or `deleteGlobalModule`.
2. Those functions mutate `getDatabase().enabledModules`, `getDatabase().modules`, and dependent projections under a trusted resource write. The component renders the same resource through `getResourceDatabase()` (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:82-87,168-204`).
3. The command owner stages a durable intent for `POST /modules/enable` or `DELETE /modules/:moduleId` (`src/ts/moduleCommands.ts:623-692`).
4. Fastify validates the base revision and target. Enable writes the `enabledModules` settings scalar; delete removes the module and all references. Both respond with a revisioned event (`server/fastify/src/routes/commands.ts:7591-7629,7632-7673`).
5. Client request helpers decode those responses as `ServerCommandResult` (`src/ts/server/commands.ts:4682-4711`).
6. The result is consumed only inside the fire-and-forget durable owner. Accepted work stays projected, retryable work may remain queued, and terminal work is conditionally rolled back. No status is returned to the initiating component.

## User impact

The UI can claim a destructive or configuration change that never persisted. Silent reappearance/reversion is likely to be interpreted as random data loss, and rapid repeated clicks are possible while the first row mutation is unresolved. A failed global-enable change also affects module execution, so the visible icon and the runtime behavior can temporarily disagree.

## Recommended fix

- Return `Promise<ModuleMutationOutcome>` from enable/delete dispatchers, with at least `accepted`, `queued`, and `failed` states.
- Await that Promise in Module Settings, track pending state per module ID, and disable only conflicting actions for that row.
- Surface terminal errors in the list view and explicitly notify for retained/queued work.
- Preserve the existing field-scoped rollback and projection fences so a failed older action cannot overwrite a newer edit.
- Add component tests with deferred and rejected outcomes, including a second click before the first result settles.
