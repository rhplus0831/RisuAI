# Plugin UI IDs collide across plugin owners

## Summary

Plugin V3 settings and button IDs are matched globally without plugin ownership. Two enabled plugins that choose the same stable ID overwrite one another's UI registration, and either plugin can later unregister the surviving entry. The server-backed plugin list can correctly show both plugins enabled while only one plugin's UI is displayed.

## Location

- `src/ts/stores.svelte.ts:174-185`
- `src/ts/plugins/apiV3/v3.svelte.ts:651-679`
- `src/ts/plugins/apiV3/v3.svelte.ts:1327-1360,1393-1477`
- `src/ts/plugins/apiV3/v3.svelte.ts:1715-1729`
- `src/ts/plugins/apiV3/risuai.d.ts:1470-1556`
- `src/ts/plugins/plugins.svelte.ts:602-667`
- `src/ts/pluginCommands.ts:456-492,528-545`
- `src/lib/Setting/Pages/PluginSettings.svelte:99-124,373-392`
- `src/lib/Setting/Settings.svelte:258-279`
- `src/lib/SideBars/Sidebar.svelte:438-457,669-689`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1884-1897,1997-2010`
- `server/fastify/src/routes/commands.ts:7505-7541`

## Trigger

1. Enable two V3 plugins that both use a common explicit ID such as `settings`, `main-action`, or `translate` in `registerSetting()` or `registerButton()`.
2. Let both plugin scripts register during the same runtime generation.
3. Optionally have the first plugin call `unregisterUIPart()` using the ID it received.

Because V3 plugins are loaded concurrently with `Promise.all`, which registration wins can also depend on permission and script timing.

## Expected behavior

Stable UI IDs should be scoped to the plugin that owns them. Both plugins' entries should coexist, a plugin should only replace its own prior registration, and `unregisterUIPart()` should only remove the caller's entry.

## Actual behavior

The later registration replaces the first plugin's menu/button entry in place. Only one entry is rendered even though both plugin records remain enabled. If the first plugin later calls `unregisterUIPart(sharedId)`, it removes the second plugin's currently visible entry because unregistration checks only the public ID.

Unload owner tokens prevent an old unload callback from deleting a newer same-ID object, but they do not prevent the initial cross-plugin overwrite, restore the displaced entry, or protect explicit `unregisterUIPart()`.

## Underlying cause

The four UI stores contain plain `MenuDef` rows keyed only by `id`; plugin name is not part of the public row identity. `registerSetting()` searches all settings entries by `item.id === menuId`. `registerButton()` searches every button-location store by `item.id === id` and replaces the first match, even retaining the old location. Neither comparison checks the plugin instance or name.

`unregisterUIPart()` repeats the same global ID-only search in all four stores. The private `__v3OwnerToken` is used only by unload callbacks, not registration or explicit unregistration.

## Affected data flow

1. **UI:** Plugin Settings toggles each plugin and optimistically updates its `enabled` field (`PluginSettings.svelte:373-392`; `pluginCommands.ts:528-545`).
2. **Request:** The client sends `POST /api/v1/commands/plugins/:pluginId/enable` (`pluginCommands.ts:456-492`).
3. **Server persistence:** Fastify persists each enabled plugin row and returns a revision/event acknowledgement (`routes/commands.ts:7505-7537`).
4. **Runtime synchronization:** The accepted plugin projection triggers `loadPlugins()`, and all enabled V3 plugins execute concurrently (`plugins.svelte.ts:602-667`; `v3.svelte.ts:1715-1729`).
5. **Client UI registration:** The first plugin adds a global row; the second finds the same bare ID and overwrites it (`v3.svelte.ts:1327-1360,1393-1461`). There is no additional Fastify request because these rows are ephemeral runtime projections of the persisted plugin scripts.
6. **Display:** Settings, hamburger, chat menu, and floating-action surfaces render the shared global arrays, so only the surviving row appears (`Settings.svelte:274-279`; `Sidebar.svelte:447-457,679-689`; `DefaultChatScreen.svelte:1884-1897,1997-2010`).
7. **Unregistration:** Either owner can remove the surviving row with the shared ID (`v3.svelte.ts:1465-1477`), further diverging displayed UI from the two enabled plugin records.

## Severity and user impact

**Medium.** The collision depends on plugin-chosen IDs, but short generic stable IDs are natural and the load-order winner is timing-dependent. A plugin's settings or action can silently disappear, the visible callback can belong to a different plugin than expected, and one plugin can accidentally remove another plugin's UI without IPC permission.

## Recommended fix

- Store an explicit plugin owner/generation on every UI row and key registration by `{ pluginName, id }`.
- Allow replacement only when both the owner and public ID match; let different owners coexist even when their public IDs are equal.
- Make `unregisterUIPart()` remove only rows owned by the calling instance and generation.
- Use a separate internal render key such as `${encodeURIComponent(pluginName)}:${id}` while preserving the plugin-facing stable ID in API responses.
- Keep owner-token unload fencing and add restoration only if global cross-plugin replacement is intentionally retained (namespacing is simpler and safer).

## Test coverage gap

`src/ts/plugins/apiV3/v3.svelte.test.ts:1028-1088` covers stale generations and same-plugin reloads with the same ID, but not two simultaneously active plugin names. Add tests where plugin A and plugin B register the same settings/button IDs, assert both render-store rows coexist, and assert each plugin can unregister only its own row.
