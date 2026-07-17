# Plugin color-scheme changes dispatch the same settings mutation twice

## Summary

Plugin V3's `changeColorScheme()` path persists one user-visible theme change twice. The shared color-scheme helper was migrated to the server-backed settings bridge, but the plugin wrapper still sends the explicit settings patch that was needed before that migration.

## Location

- `src/ts/plugins/apiV3/v3.svelte.ts:77-101,1051-1063`
- `src/ts/gui/colorscheme.ts:187-195`
- `src/ts/server/settingsBridge.svelte.ts:293-344,535-567`
- `src/ts/server/pendingMutationOutbox.ts:554-604`
- `src/ts/server/commands.ts:2043-2061,2112-2184`
- `server/fastify/src/routes/commands.ts:1844-1907`

Reference inventory: plugin-defined UI and the Fastify resource lifecycle; the visible result is part of `SET-04`.

## Trigger

A Plugin V3 script calls `await risuai.changeColorScheme(name)`.

## Expected behavior

The client should optimistically apply the selected scheme and enqueue one durable settings mutation. One Fastify acknowledgement should then settle that optimistic change.

## Actual behavior

The client enqueues two equivalent settings mutations. Fastify accepts both, writes the settings table twice, emits two `settings.updated` events, and advances the database revision twice for a single plugin action.

Besides unnecessary writes and invalidations, the two independently owned attempts make failure handling ambiguous. If only one attempt is accepted or retained, the other attempt's rollback/reconciliation can temporarily move the displayed theme away from the value that the server has already accepted.

## Underlying cause

`v3.svelte.ts` calls the imported `changeColorScheme(name)` helper and then calls `dispatchPluginApiSettingsPatch()` with the resulting `colorScheme` and `colorSchemeName`.

The imported helper is no longer local-only: `colorscheme.ts` calls `applyServerBackedSettingsPatch()`. That function applies the optimistic projection, stages a settings-bridge outbox row, and immediately flushes it. The plugin wrapper then stages a second outbox row without passing the first handle as a replaceable predecessor. The global command queue serializes the requests but does not deduplicate them.

The Fastify settings route always applies an accepted patch and emits a revisioned event; it has no equality/no-op check that would collapse the second request.

## Affected data flow

1. **Plugin interaction:** plugin code invokes `risuai.changeColorScheme(name)` through the iframe RPC bridge.
2. **First client projection and request:** `colorscheme.ts` calls `applyServerBackedSettingsPatch()`, which changes the resource projection and sends `PATCH /api/v1/commands/settings/display`.
3. **Second client request:** the Plugin V3 wrapper snapshots the same projected fields and independently calls `dispatchDurableServerBackedSettingsPatch()`, producing the same PATCH again.
4. **Server persistence:** each request runs `applySettingsPatch()` and `writeSettingsOnly()` and receives its own revision/event.
5. **Acknowledgement and display:** each response is reconciled as a separate optimistic attempt even though both attempts control the same CSS-backed fields. `updateColorScheme()` renders the resource projection into CSS variables.

## Severity and user impact

**Medium.** The normal success case looks correct, but every plugin-driven preset change causes duplicate persistence, revisions, and invalidations. Partial failure or replay can produce theme flicker or temporary client/server disagreement, and the extra event can make other connected clients refresh twice.

## Recommended fix

Make exactly one layer own persistence:

- Prefer changing the Plugin V3 wrapper to call the already server-backed `changeColorScheme()` only, and make that helper return the durable outcome if the API needs awaitable completion.
- Alternatively, split the GUI helper into a local projection-only function and one server-backed public function, then have the plugin wrapper call only one of them.
- Add an integration test that invokes the Plugin V3 API with the real color-scheme helper and asserts one settings request, one server revision, and one event. The current Plugin V3 tests mock `changeColorScheme`, so they cannot detect the duplicate dispatch.

## Test coverage gap

`src/ts/plugins/apiV3/v3.svelte.test.ts` replaces `changeColorScheme` with a mock. It verifies the wrapper in isolation but never composes it with `src/ts/gui/colorscheme.ts` or the settings bridge, which is the seam where the duplicate mutation is introduced.
