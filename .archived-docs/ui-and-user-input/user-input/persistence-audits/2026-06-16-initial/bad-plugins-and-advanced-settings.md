# Plugins And Advanced Settings Persistence Audit

Date: 2026-06-16

Scope: `PluginSettings`, plugin storage, `CustomGUISettingMenu`, advanced settings custom components (`CustomModelsSettings`, `BanCharacterSetSettings`), hotkeys, server command routes, and client command/bridge helpers where user input modifies persisted settings/config.

## Result

Bad: found one likely persistence issue in the custom GUI builder. The plugin/settings paths I checked otherwise include the typed/selected content in either optimistic projection updates plus server commands, or debounced server-backed setting drafts.

## Likely Issue

### Custom GUI builder edits are local-only and never persisted

- `src/ts/setting/displaySettingsData.svelte.ts:34` opens `CustomGUISettingMenu` when the selected theme is `custom`, but the button only flips `CustomGUISettingMenuStore` at `src/ts/setting/displaySettingsData.svelte.ts:39`.
- `src/App.svelte:251` renders `CustomGUISettingMenu` as a top-level mode.
- `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:9` stores the edited layout in local `$state` (`tree`), not in `DBState.db.customGUI`, `DBState.db.guiHTML`, or a server-backed draft.
- The UI mutates only that local tree: delete at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:102`, root append at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:160`, child append at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:169`, and menu add actions at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:255` and `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:264`.
- Serialization helpers exist but are not wired to persistence: `HTMLtoTree` starts at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:136`, and `treeToHTML` starts at `src/lib/Setting/Pages/CustomGUISettingMenu.svelte:176`. A repo search only found these helpers inside this file.
- The component imports neither `DBState` nor any settings command helper, and does not call `applyServerBackedSetting`, `createServerBackedSettingDraft`, `setSettingValue`, or `patchServerBackedSettings`.
- The server would accept both candidate persisted keys if sent: `customGUI` and `guiHTML` are display settings in the client map at `src/ts/server/commands.ts:74` and `src/ts/server/commands.ts:132`, in the server display group at `server/fastify/src/routes/commands.ts:747` and `server/fastify/src/routes/commands.ts:793`, and both are string-typed at `server/fastify/src/routes/commands.ts:1143` and `server/fastify/src/routes/commands.ts:1161`.

Impact: a user can build or modify a custom GUI layout in this menu, see it in the editor preview, then lose it on route change/reload/resync because no optimistic durable state or command payload includes the layout.

## Verified Paths

### Plugin settings

- `PluginSettings` routes argument edits through `setPluginArgument`: string/textarea/select bindings at `src/lib/Setting/Pages/PluginSettings.svelte:191`, `src/lib/Setting/Pages/PluginSettings.svelte:201`, and `src/lib/Setting/Pages/PluginSettings.svelte:219`; number binding at `src/lib/Setting/Pages/PluginSettings.svelte:249`.
- `setPluginArgument` snapshots previous plugin state, writes an optimistic `realArg`, and dispatches an update command with the full next `realArg` at `src/ts/pluginCommands.ts:122`.
- Enable/delete similarly perform optimistic updates and command dispatches at `src/ts/pluginCommands.ts:145` and `src/ts/pluginCommands.ts:165`.
- Server plugin update validates `realArg` string/number content at `server/fastify/src/commands/plugins.ts:210` and persists the patch to the plugin row at `server/fastify/src/routes/commands.ts:5542`.

### Plugin storage and plugin bridge

- Plugin storage writes update the projected `pluginCustomStorage` before dispatching commands at `src/ts/plugins/plugins.svelte.ts:612`, `src/ts/plugins/plugins.svelte.ts:622`, and `src/ts/plugins/plugins.svelte.ts:632`.
- The plugin DB bridge maps settings-like keys to settings commands, plugin collections to plugin commands, and unknown custom keys to plugin storage at `src/ts/plugins/plugins.svelte.ts:642`.
- The safe database proxy also routes assigned custom keys through `setPluginStorageValue` at `src/ts/plugins/plugins.svelte.ts:1043`.
- Client command helpers send PUT/DELETE/bulk plugin-storage payloads at `src/ts/server/commands.ts:2663`, `src/ts/server/commands.ts:2677`, and `src/ts/server/commands.ts:2690`.
- Server plugin-storage PUT/DELETE/bulk routes persist the supplied key/value data at `server/fastify/src/routes/commands.ts:5735`, `server/fastify/src/routes/commands.ts:5769`, and `server/fastify/src/routes/commands.ts:5802`. JSON-serializability is checked at `server/fastify/src/commands/pluginStorage.ts:32`.

### Generic advanced/settings editors

- Generic text/textarea setting wrappers call `setSettingValue` when local typed values differ from DB state at `src/lib/Setting/Wrappers/SettingText.svelte:23` and `src/lib/Setting/Wrappers/SettingTextarea.svelte:23`.
- `setSettingValue` writes an optimistic local value, runs `onChange`, then sends a settings command when the key is server-backed at `src/ts/setting/utils.ts:65`.
- The server settings route reads, validates, and persists grouped settings patches at `server/fastify/src/routes/commands.ts:1319`, with group/key validation at `server/fastify/src/routes/commands.ts:6193` and type/JSON validation at `server/fastify/src/routes/commands.ts:6213`.

### Custom models

- `CustomModelsSettings` uses `createServerBackedSettingDraft<CustomModel[]>('customModels', [])` at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:17`.
- The editor writes every typed field into the draft: name at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:130`, internal model id at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:136`, URL at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:143`, API key at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:198`, and additional params at `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:205`.
- The draft helper optimistically updates `DBState.db.customModels` and queues a server settings patch at `src/ts/server/settingsBridge.svelte.ts:77`.
- `customModels` is mapped to the providers settings group at `src/ts/server/commands.ts:75` and accepted as an array server-side at `server/fastify/src/routes/commands.ts:683` and `server/fastify/src/routes/commands.ts:1236`.

### Ban character set

- `BanCharacterSetSettings` uses `createServerBackedSettingDraft<string[]>('banCharacterset', [])` at `src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte:7`.
- Button clicks replace the draft array with either a filtered or appended array at `src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte:56`.
- `banCharacterset` is mapped to the advanced settings group at `src/ts/server/commands.ts:45` and accepted as an array server-side at `server/fastify/src/routes/commands.ts:920` and `server/fastify/src/routes/commands.ts:1232`.

### Hotkeys

- `HotkeySettings` avoids direct mutation of the read-only projection by cloning the hotkey array and calling `applyServerBackedSetting('hotkeys', next)` at `src/lib/Setting/Pages/HotkeySettings.svelte:7`.
- Modifier/key edits call `patchHotkey` at `src/lib/Setting/Pages/HotkeySettings.svelte:34`, `src/lib/Setting/Pages/HotkeySettings.svelte:44`, `src/lib/Setting/Pages/HotkeySettings.svelte:54`, and `src/lib/Setting/Pages/HotkeySettings.svelte:65`.
- `applyServerBackedSetting` goes through the settings bridge at `src/ts/server/settingsBridge.svelte.ts:45`, which builds an optimistic settings patch at `src/ts/server/settingsBridge.svelte.ts:107`.
- `hotkeys` is mapped to the sidebar group at `src/ts/server/commands.ts:140` and accepted as an array server-side at `server/fastify/src/routes/commands.ts:947` and `server/fastify/src/routes/commands.ts:1239`.

### Custom sidebar config

- The settings button only opens the modal at `src/lib/Setting/Pages/Advanced/CustomSidebarConfigButton.svelte:7`.
- The modal itself uses `createServerBackedSettingDraft<CustomSideBarItem[]>('customSidebarItems', [])` at `src/lib/Others/CustomSidebarConfig.svelte:12`.
- Add/delete operations replace that draft array at `src/lib/Others/CustomSidebarConfig.svelte:14` and `src/lib/Others/CustomSidebarConfig.svelte:18`, so they are covered by the same optimistic/debounced settings bridge path.
