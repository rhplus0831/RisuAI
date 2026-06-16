# User Input Persistence Overview

This directory documents client buttons and text fields that can change persisted app data in the Fastify client. It groups controls by UI surface and links each surface to the client mutation helper and server handler that writes the database.

Scope notes:

- "Database" means the Fastify-backed app state and asset store: command events, SQLite/projected rows, `data/assets`, and server-owned import/backup/memory job tables.
- Text fields include native `<input>`/`<textarea>` plus wrapper components such as `TextInput`, `TextAreaInput`, `SettingText`, and `SettingTextarea`.
- Buttons include native `<button>` plus wrapper components such as `Button`, `BaseRoundedButton`, and popup/menu items that directly invoke a persistent action.
- Controls that only search/filter, open/close panels, export/download, mutate local translator cache, or write a remote Realm database are excluded or called out as non-local persistence.
- Some editors persist by changing a bound draft. In those cases the unique id is the draft key or bound field path rather than a DOM selector.

## Common Write Paths

| Client path | Server path | Database effect |
| --- | --- | --- |
| `src/ts/server/commands.ts:2830` `runServerCommand` and `:2875` `requestCommandJson` | `server/fastify/src/routes/commands.ts:1292` and later | Sends revisioned commands under `/api/v1/commands/*`. |
| `src/ts/server/commands.ts:1203` `patchSettingsGroup` | `server/fastify/src/routes/commands.ts:1319` `PATCH /api/v1/commands/settings/:group` | Writes settings groups. |
| `src/ts/server/settingsBridge.svelte.ts:45` `applyServerBackedSetting`, `:49` `createServerBackedSettingDraft`, `:107` `applyServerBackedSettingsPatch` | `server/fastify/src/routes/commands.ts:1319` | Debounced or immediate settings patch. |
| `src/ts/server/characterBridge.svelte.ts:37` `createServerBackedCharacterDraft`, `:148` `watchServerBackedCharacterProfile` | `server/fastify/src/routes/commands.ts:3344` `PATCH /api/v1/commands/characters/:characterId` | Writes character profile fields. |
| `src/ts/chatCommands.ts:490`, `:503`, `:850`, `:861`, `:902`, `:922`, `:934`, `:975`, `:1191`, `:1214`, `:1250`, `:1329`, `:1423` | `server/fastify/src/routes/commands.ts:3520` through `:4499` | Writes chats, folders, chat generation settings, script state, and messages. |
| `src/ts/globalApi.svelte.ts:159` `saveAsset`, `src/ts/server/assets.ts:57` `uploadServerAssetBytes` | `server/fastify/src/routes/assets.ts:220` `POST /api/v1/assets`, `:257` bulk | Stores asset bytes and metadata. |
| `src/ts/server/backups.ts:57`, `src/ts/server/realmImport.ts:31`, import helpers in `src/ts/characters.ts` | `server/fastify/src/routes/save.ts:85`, `:124`; `server/fastify/src/routes/realmImport.ts:157`; `server/fastify/src/routes/backups.ts:19`, `:40`, `:55` | Imports/replaces app state, imports Realm characters, creates/restores/deletes backups. |
| `src/ts/process/request/serverChat.ts:323` | `server/fastify/src/routes/generationChat.ts:2046`, `:2119` | Persists generation-side transcript/script mutations and final assistant messages; cancels active generation jobs. |
| `src/ts/process/request/serverMemory.ts:189` | `server/fastify/src/routes/memoryJobs.ts:81`, `:163` | Creates or cancels server memory jobs. |

## Server Command Families

| Domain | Server handlers |
| --- | --- |
| Settings | `server/fastify/src/routes/commands.ts:1319` |
| Legacy bot presets | `server/fastify/src/routes/commands.ts:1363`, `:1406`, `:1451`, `:1533`, `:1586`, `:1644`, `:1685`, `:2305` |
| Model presets | `server/fastify/src/routes/commands.ts:1739`, `:1778`, `:1829`, `:1891`, `:1933`, `:1972` |
| Prompt presets/settings/items | `server/fastify/src/routes/commands.ts:2024`, `:2063`, `:2112`, `:2173`, `:2214`, `:2253`, `:2349`, `:2381`, `:2419`, `:2460`, `:2496`, `:2541` |
| Personas | `server/fastify/src/routes/commands.ts:2580`, `:2627`, `:2679`, `:2758`, `:2813` |
| Translator presets | `server/fastify/src/routes/commands.ts:2867`, `:2911`, `:2959`, `:3021` |
| Loadouts | `server/fastify/src/routes/commands.ts:3059`, `:3099`, `:3145`, `:3183`, `:3222` |
| Characters and character order | `server/fastify/src/routes/commands.ts:3267`, `:3304`, `:3344`, `:3396`, `:3451`, `:3477` |
| Chats/folders/generation settings | `server/fastify/src/routes/commands.ts:3520`, `:3599`, `:3665`, `:3704`, `:3755`, `:3877`, `:3934`, `:3980`, `:4025`, `:4080`, `:4126` |
| Messages/generation result | `server/fastify/src/routes/commands.ts:4180`, `:4224`, `:4280`, `:4334`, `:4395`, `:4456`, `:4499` |
| Lorebooks | `server/fastify/src/routes/commands.ts:4559` through `:5243`, and module lorebooks `:5855` through `:5997` |
| Modules | `server/fastify/src/routes/commands.ts:5284`, `:5320`, `:5357`, `:5392`, `:5436`, `:5473` |
| Plugins and plugin storage | `server/fastify/src/routes/commands.ts:5517`, `:5556`, `:5594`, `:5638`, `:5676`, `:5711`, `:5749`, `:5783`, `:5816` |
| Scripts/triggers | `server/fastify/src/routes/commands.ts:6039`, `:6075`, `:6111`, `:6155` |

