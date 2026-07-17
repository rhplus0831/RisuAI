# Foreign module definition refresh leaves parsed chat text stale

## Summary

When another client changes an active module without changing its ID, this client correctly refreshes the authoritative `modules` collection but does not invalidate already parsed chat text. Module Settings can show the new server data while mounted messages containing module-dependent CBS expressions still display values from the old definition.

## Location

- `src/lib/Setting/Pages/Module/ModuleSettings.svelte:135-159`
- `src/ts/moduleCommands.ts:743-803`
- `src/ts/server/resourceInvalidation.ts:688-699,781-783,1007-1019`
- `src/ts/server/resourceReads.ts:27-29,114-125`
- `src/ts/server/resourceState.svelte.ts:1336-1365`
- `src/ts/stores.svelte.ts:224-228,250-268,298-309`
- `src/ts/process/modules.ts:637-677,1087-1122`
- `src/lib/ChatScreens/Chat.svelte:1065-1077,1137-1157`
- `src/ts/cbs.ts:1962-2002`
- `server/fastify/src/routes/commands.ts:7161-7192,7722-7755`
- `server/fastify/src/routes/resourceReads.ts:215-257`

## Trigger

1. Open the app in two browser clients using the same server data.
2. Keep a chat with an enabled module mounted in client B.
3. In client A, edit a definition field used by parsed chat text, such as the module namespace, assets, or lorebook, and save it.
4. Let client B receive the command event and targeted module-collection refresh.

The same condition can occur after any authoritative module collection replacement that changes an active module's contents without changing its ID.

## Expected behavior

After client B applies the newer `modules` resource, mounted messages that derive text from active modules should be parsed again. For example, `{{moduleenabled::...}}`, `{{moduleassetlist::...}}`, and module-backed lore output should agree with Module Settings.

## Actual behavior

Client B's resource database contains the new module row, so Module Settings and new direct reads can see it. However, neither chat reload pointer advances. `Chat.svelte` keeps the prior `msgDisplay`, so an already mounted message can continue showing the old module-dependent expansion until its text changes or another action happens to force a display reload.

## Underlying cause

Foreign module events map to a targeted `modules` collection read. `applyCollectionsResource()` replaces the collection and advances its projection epoch, so the stores-level effect runs and `getModules()` recomputes against the new array reference.

`moduleUpdate()`, however, uses only `m.map(module => module.id).join('-')` as its invalidation signature. A definition edit retains the same active IDs, so `lastModuleIds === ids` and `reloadGuiAfterDefinitionChange()` is skipped.

That matters specifically to the first parse performed in `Chat.svelte`. `displaya()` wraps `risuChatParser()` in `untrack()`, and its parse key contains the message props and reload pointers but no module projection revision. Module-backed CBS reads are therefore intentionally absent from the component's reactive dependencies. The stores effect does run after the authoritative collection replacement, but the ID-only comparison suppresses the pointer that would make `displaya()` run again.

## Affected data flow

1. **UI/client A:** Module Settings saves a complete editor draft. It optimistically replaces the module and locally calls `reloadGuiAfterDefinitionChange()` (`ModuleSettings.svelte:135-154`; `moduleCommands.ts:749-803`).
2. **Request:** Depending on the changed field, the client sends `PATCH /api/v1/commands/modules/:moduleId` or the module lorebook replacement command.
3. **Server persistence:** Fastify validates and writes the module definition to SQLite and emits a module-scoped resource event (`routes/commands.ts:7161-7192,7722-7755`).
4. **Client B refresh:** Resource invalidation schedules `GET`/cached `POST /api/v1/collections/modules` (`resourceInvalidation.ts:688-699,781-783`; `resourceReads.ts:114-125`). `applyCollectionsResource()` replaces the resident collection (`resourceState.svelte.ts:1336-1365`).
5. **Client B reconciliation:** The root effect calls `moduleUpdate()` (`stores.svelte.ts:298-309`). `getModules()` sees the new collection reference and returns the new rows (`modules.ts:648-677`).
6. **Display update:** Background embedding and hide-icon state are recomputed, but the unchanged ID string prevents `reloadGuiAfterDefinitionChange()` (`modules.ts:1089-1115`). The mounted chat's parse key is unchanged, so `displaya()` is not called and module-dependent CBS output remains stale (`Chat.svelte:1065-1077,1137-1157`).

## Severity and user impact

**Medium.** This is a routine multi-client synchronization path, not a malformed-data edge case. Users can see the new module in settings while module-dependent text in the transcript still reports an older namespace, asset list, or lore value. The inconsistency is difficult to diagnose and may persist until the message or another reload input changes.

## Recommended fix

- Treat the authoritative modules collection projection epoch/revision as a chat-display invalidation input, not only active module IDs.
- On an applied `modules` collection refresh, compare definition revisions or a collision-safe signature of the active module fields used by rendered CBS and call `reloadGuiAfterDefinitionChange()` when any active definition changed.
- Keep the narrow reactive reads for performance if desired, but explicitly signal definition refreshes from `applyCollectionsResource()`/resource invalidation rather than relying on deep Svelte tracking.
- Ensure the invalidation remains fenced by resource revision so an older refresh cannot reset caches after a newer projection.

## Test coverage gap

`src/ts/stores.modulesEffect.svelte.test.ts` explicitly verifies that deep module edits do not wake the effect, while `src/ts/process/modules.test.ts` covers active-module lookup. There is no integration test that renders a module-dependent CBS expression, applies a newer `modules` resource with unchanged IDs, and asserts that the mounted output changes. Add that two-revision resource-refresh test.
