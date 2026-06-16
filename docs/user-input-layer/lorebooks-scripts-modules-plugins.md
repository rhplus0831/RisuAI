# Lorebooks, Scripts, Modules, And Plugins

These editors are heavily draft-driven. Text fields mutate the bound collection item, and parent callbacks/bridges persist the scoped collection.

## Lorebooks

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/lorepreset.svelte:39` | global lorebook select/name field | Select/rename global lorebook. | Updates selected global lorebook page or lorebook name. | Select `server/fastify/src/routes/commands.ts:4726`; patch `:4601`. |
| `src/lib/Setting/lorepreset.svelte:80` | create/import/export controls | Global lorebook buttons. | Create/import mutate global lorebooks; export is read-only. | Create `server/fastify/src/routes/commands.ts:4559`; entries replace `:4764`. |
| `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:20`, controls from `:112` | `characterLoreSettingsDraft` | Character lore settings check/number fields. | Updates character `loreSettings` and `lorePlus`. | Character patch `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:55` | `replaceCharacterLorebookCollection` | Character lorebook callbacks. | Replaces character lorebook collection. | `server/fastify/src/routes/commands.ts:4926`. |
| `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:67` | `replaceChatLorebookCollection` | Chat local lorebook callbacks. | Replaces active chat local lorebook collection. | `server/fastify/src/routes/commands.ts:5103`. |
| `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:160`, `:174`, `:181`, `:189`, `:201` | lorebook add/folder/import/toggle buttons | Lorebook action buttons. | Adds entries/folders, imports lorebooks, toggles activation, or changes collection. | Global `server/fastify/src/routes/commands.ts:4559` through `:4889`; character `:4926` through `:5063`; chat `:5103` through `:5243`. |
| `src/lib/SideBars/LoreBook/LoreBookData.svelte:202`, `:228`, `:248`, `:277`, `:308`, `:333` and later fields | lorebook entry card | Lorebook entry text fields and remove/toggle buttons. | Updates entry keys, comments, content, activation, folders, and order. | Global entry handlers `server/fastify/src/routes/commands.ts:4803`, `:4847`, `:4889`; scoped equivalents at `:4971`, `:5018`, `:5063`, `:5149`, `:5197`, `:5243`, module equivalents at `:5901`, `:5950`, `:5997`. |

## Scripts And Regex

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/GlobalRegex.svelte:18` | global regex list | Global regex buttons/text fields. | Updates global `globalscript` setting. | `server/fastify/src/routes/commands.ts:1319`. |
| `src/lib/SideBars/Scripts/RegexList.svelte:75` | regex list | Add/remove/reorder regex rows. | Mutates bound regex script collection. | Parent scope decides: character `commands.ts:6039`, module `:6111`, global settings `:1319`, prompt preset `:2063`. |
| `src/lib/SideBars/Scripts/RegexData.svelte:109` | regex data fields | Regex name, find/replace, flags, command text fields/buttons. | Updates one regex row in bound collection. | Same parent scope as above. |
| `src/lib/SideBars/Scripts/TriggerList.svelte:29` | trigger version switch/list | Trigger list buttons. | Mutates bound trigger collection. | Character `server/fastify/src/routes/commands.ts:6075`; module `:6155`. |
| `src/lib/SideBars/Scripts/TriggerV1List.svelte:93` | add trigger v1 button | Adds v1 trigger. | Updates bound trigger collection. | Character `commands.ts:6075`; module `:6155`. |
| `src/lib/SideBars/Scripts/TriggerV1Data.svelte:66`, `:149`, `:157`, `:160`, `:174`, `:350`, `:354`, `:364`, `:369`, `:373`, `:377`, `:380`, `:384`, `:387` | trigger v1 fields | Trigger comment/condition/effect text fields and buttons. | Updates bound trigger rows. | Character `commands.ts:6075`; module `:6155`. |
| `src/lib/SideBars/Scripts/TriggerV2List.svelte:522` | `importTriggers` | Import trigger file button path. | Imports/replaces trigger v2 rows. | Character `commands.ts:6075`; module `:6155`. |
| `src/lib/SideBars/Scripts/TriggerV2List.svelte:2283`, `:2335`, `:2372`, `:2382`, `:2393`, `:2403`, `:2413` | trigger v2 buttons | Add/edit/delete/reorder trigger/effect buttons. | Updates bound trigger rows. | Character `commands.ts:6075`; module `:6155`. |
| `src/lib/SideBars/Scripts/TriggerV2List.svelte:29` | `showDeprecatedTriggerV2Draft` | Deprecated trigger display setting. | Updates settings. | `server/fastify/src/routes/commands.ts:1319`. |

## Modules

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/Module/ModuleSettings.svelte:121` | module enable button | Enable/disable module. | Updates `enabledModules` setting. | `server/fastify/src/routes/commands.ts:5392`. |
| `src/lib/Setting/Pages/Module/ModuleSettings.svelte:175` | `data-risu-module-action="delete"` | Delete module button. | Deletes module row. | `server/fastify/src/routes/commands.ts:5357`. |
| `src/lib/Setting/Pages/Module/ModuleSettings.svelte:219` | `data-risu-module-action="import"` | Import module button. | Creates imported module row. | `server/fastify/src/routes/commands.ts:5284`. |
| `src/lib/Setting/Pages/Module/ModuleSettings.svelte:232` | `data-risu-module-action="submit-create"` | Create module submit button. | Creates module from `tempModule`. | `server/fastify/src/routes/commands.ts:5284`. |
| `src/lib/Setting/Pages/Module/ModuleSettings.svelte:244` | edit submit button | Save module edit. | Patches module row. | `server/fastify/src/routes/commands.ts:5320`. |
| `src/lib/Setting/Pages/Module/ModuleMenu.svelte:354`, `:356`, `:358`, `:363` | `currentModule.name`, `description`, `namespace`, `customModuleToggle` | Module text fields. | Mutate module draft; persisted on module create/edit submit. | `server/fastify/src/routes/commands.ts:5284` or `:5320`. |
| `src/lib/Setting/Pages/Module/ModuleMenu.svelte:129`, `:141`, `:160`, `:178`, `:217`, buttons at `:372`, `:386`, `:393` | module lorebook callbacks/buttons | Adds/imports/replaces module lorebook entries/folders. | Module lorebook collection changes. | `server/fastify/src/routes/commands.ts:5855` through `:5997`. |
| `src/lib/Setting/Pages/Module/ModuleMenu.svelte:147`, `:242`, `:257`, buttons at `:291`, `:305`, `:411`, `:421` | module scripts/triggers | Adds/imports/replaces module regex/trigger definitions. | Module script/trigger collection changes. | Scripts `server/fastify/src/routes/commands.ts:6111`; triggers `:6155`. |
| `src/lib/Setting/Pages/Module/ModuleMenu.svelte:437`, `:494`, `:498` | module asset controls | Upload, rename, remove module additional assets. | Uploads asset bytes and updates module draft/assets. | Assets `server/fastify/src/routes/assets.ts:220`; module persisted at `commands.ts:5320` or create `:5284`. |
| `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:85` | chat module picker | Chat/character module assignment controls. | Updates chat or character module refs/order. | Chat patch `server/fastify/src/routes/commands.ts:3599`; character module reorder `:5473`. |

## Plugins

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/PluginSettings.svelte:116` | plugin update button | Update plugin button. | Patches plugin row from manifest/update data. | `server/fastify/src/routes/commands.ts:5556`. |
| `src/lib/Setting/Pages/PluginSettings.svelte:132` | enable plugin button | Enable/disable plugin. | Updates plugin enabled state. | `server/fastify/src/routes/commands.ts:5638`. |
| `src/lib/Setting/Pages/PluginSettings.svelte:148` | delete plugin button | Delete plugin. | Removes plugin row. | `server/fastify/src/routes/commands.ts:5594`. |
| `src/lib/Setting/Pages/PluginSettings.svelte:188` | plugin arg controls | Plugin argument select/text/textarea/number fields. | Updates `plugin.realArg`. | `server/fastify/src/routes/commands.ts:5556`. |
| `src/lib/Setting/Pages/PluginSettings.svelte:262` | import plugin button | Import plugin. | Creates plugin row. | `server/fastify/src/routes/commands.ts:5517`. |
| `src/lib/Setting/Pages/BotSettings.svelte:965` | plugin provider selector | Provider select/button control. | Updates `currentPluginProvider`. | `server/fastify/src/routes/commands.ts:5676`. |
| `src/ts/pluginCommands.ts:64` and storage helpers | plugin custom storage API | Plugin-defined buttons/fields can call storage helpers. | Writes `plugin_custom_storage`. | `server/fastify/src/routes/commands.ts:5749`, `:5783`, `:5816`. |
