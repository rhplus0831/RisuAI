# Saving-icon setting is a persisted no-op

## Summary

The **Show Saving Icon** display setting is persisted and `SavePopupIcon` is mounted, but the only runtime gate for the icon, `saving.state`, is initialized to `false` and has no production writer. `saveDb()`, which formerly drove that state around database persistence, is now an empty function after persistence moved to Fastify commands.

The icon therefore never appears during pending, in-flight, retrying, or acknowledged server mutations even when the option is enabled.

## Location

- Setting definition: `src/ts/setting/displaySettingsData.svelte.ts:363-369`
- Setting group and client command: `src/ts/server/settingsGroups.ts:291`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence and response: `server/fastify/src/routes/commands.ts:1844-1907`
- Mounted display component: `src/App.svelte:40,324`; `src/lib/Others/SavePopupIcon.svelte:1-12`
- Inert runtime state and save function: `src/ts/globalApi.svelte.ts:358-373`
- Former persistence indicator lifecycle: `/home/codex/Risuai/src/ts/globalApi.svelte.ts:279-305,406-485`

## Trigger

1. Enable **Show Saving Icon**.
2. Perform any durable mutation, such as changing a setting, editing a character, or sending a chat mutation, while delaying the Fastify response.
3. Observe the top-right icon before and after acknowledgement or during a retry.

The icon never renders. Reloading confirms the option itself was saved, but later mutations behave identically.

## Expected behavior

When enabled, the icon should be visible while user-visible data has an outstanding durable mutation and disappear only after that mutation is acknowledged or reaches a clearly reported terminal failure. When disabled, it should remain hidden.

## Actual behavior

`SavePopupIcon` evaluates `getDatabase().showSavingIcon && saving.state`. The first operand updates correctly from the server, but `saving.state` remains false for the process lifetime. No command queue, pending-mutation outbox, resource reconciler, or Fastify request changes it, and calling `saveDb()` immediately returns.

## Underlying cause

The original frontend-owned database saver accumulated changes, set `saving.state = true`, encoded/wrote the database, and cleared the state after completion. The migration replaced that monolithic save loop with resource-specific Fastify commands and a durable outbox. `saveDb` was intentionally reduced to a compatibility no-op, but its UI state and option were left attached to the old lifecycle.

A single boolean would also be unsafe if naively toggled around the new requests: concurrent mutations could let the first acknowledgement clear the icon while later work remains pending.

## Affected data flow

1. **Settings UI:** the checkbox writes `database.showSavingIcon` and dispatches a display-group patch.
2. **Server persistence:** Fastify writes and acknowledges the option; resource projection makes `SavePopupIcon` observe `true` for the preference.
3. **Subsequent mutation:** the relevant client adapter stages an outbox intent and sends a targeted command to Fastify.
4. **Missing client projection:** neither staging, command execution, retry, nor acknowledgement updates the exported `saving.state` object.
5. **Display:** the globally mounted icon's condition remains false, even while data is not yet durable.

## Severity and user impact

**Low-medium.** Persistence itself still works, but a setting that promises save progress provides none. On slow or unreliable connections users receive no feedback that edits are pending and may close/reload the page or repeat actions. The false-negative is most harmful precisely when durable-outbox retries make saving take longer than usual.

## Recommended fix

Replace the legacy boolean with a derived pending-mutation status from the actual persistence owners. Track outstanding user-visible intents by mutation ID across debounced, staged, executing, retry-retained, and acknowledged states. Render while the count is nonzero, and distinguish terminal failures instead of spinning forever. Exclude background reads and non-durable UI state.

If no global save-status contract is desired, remove the setting and component. Do not revive the empty `saveDb()` loop alongside Fastify persistence.

Add a mounted test with a deferred targeted command: enable the option, stage a mutation, assert the icon appears, acknowledge it, and assert it disappears. Add overlapping commands, retained retry, terminal failure, and foreign-only mutation cases so one completion cannot clear another owner's pending status.
