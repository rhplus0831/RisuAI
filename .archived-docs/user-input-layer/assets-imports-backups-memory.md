# Assets, Imports, Backups, Memory, And External Entrypoints

These controls are not always ordinary `/api/v1/commands` mutations. They can upload asset blobs, replace/import large parts of app state, restore backups, or change server memory jobs.

## Assets And File Inputs

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/ts/globalApi.svelte.ts:159` | `saveAsset` | Shared asset save helper used by many buttons. | Uploads asset bytes and stores asset metadata. | `server/fastify/src/routes/assets.ts:220`; repository `server/fastify/src/repository.ts:2383`. |
| `src/ts/globalApi.svelte.ts:181` | `saveAssets` | Bulk asset save helper. | Uploads multiple asset blobs/metadata. | `server/fastify/src/routes/assets.ts:257`. |
| `src/ts/process/files/inlays.ts:173`, `:227` | `postInlayAsset`, `writeInlayImage` | Chat paste/file inlay helper. | Stores inlay image/file asset metadata and may write chat message references. | Assets `server/fastify/src/routes/assets.ts:220`; messages `server/fastify/src/routes/commands.ts:4180`. |
| `src/ts/process/files/multisend.ts:175` | `postChatFile` | Chat composer/menu file-post action. | Uploads assets and may append messages/generate from file content. | Assets `server/fastify/src/routes/assets.ts:220`; messages `commands.ts:4180`; generation `server/fastify/src/routes/generationChat.ts:2046`. |
| `src/lib/ChatScreens/DefaultChatScreen.svelte:792`, `:831`, `:1208` | composer paste/menu file actions | UI file input/paste path. | Calls `postChatFile`. | Same as above. |
| `src/lib/SideBars/CharConfig.svelte:612`, `:763`, `:1139` | avatar/additional asset/reference audio buttons | Character asset upload buttons. | Uploads assets, then patches character references. | Assets `server/fastify/src/routes/assets.ts:220`; character `commands.ts:3344`. |
| `src/lib/Setting/Pages/OtherBotSettings.svelte:587`, `:663`, `:954` | media settings asset buttons | Image/reference asset upload controls. | Uploads assets and patches media settings. | Assets `server/fastify/src/routes/assets.ts:220`; settings `commands.ts:1319`. |
| `src/lib/Setting/Pages/Module/ModuleMenu.svelte:437` | module asset upload button | Module asset controls. | Uploads assets and updates module asset list. | Assets `server/fastify/src/routes/assets.ts:220`; module create/update `commands.ts:5284`/`:5320`. |

## Imports, Realm, And Backups

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/UI/Realm/RealmMain.svelte:227` | Realm import/chat button | Realm character import. | Imports character, chats, messages, assets, memory state, and settings needed by Realm import. | `server/fastify/src/routes/realmImport.ts:157`; commit around `:811`. |
| `src/lib/UI/Realm/RealmPopUp.svelte:152` | Realm popup import button | Realm import from popup. | Same local import path as Realm main. | `server/fastify/src/routes/realmImport.ts:157`. |
| `src/lib/UI/Realm/RealmPopUp.svelte:102`, `:124` | Realm report/remove buttons | Remote Realm moderation/removal. | Writes remote Realm service only, not local app DB. | Remote `authenticatedHubFetch`; no local server handler. |
| `src/lib/Setting/Pages/UserSettings.svelte:82` | save server backup button | Creates a server-side backup snapshot. | Snapshots DB/assets and writes backup files. | Client `src/ts/storage/backup.ts:19`; server `server/fastify/src/routes/backups.ts:19`. |
| `src/lib/Setting/Pages/UserSettings.svelte:93` | load server backup button | Lists internal backups, asks which one to restore, then restores it. | Restores DB/assets and refreshes the projection. | Client `src/ts/globalApi.svelte.ts:1488` and `src/ts/server/backups.ts:103`; server `server/fastify/src/routes/backups.ts:40`. |
| `src/lib/Setting/Pages/UserSettings.svelte:106`, `:117` | save local backup / save zip backup buttons | Downloads a server-built backup bundle to the user's device. | Read-only with respect to DB contents. | Client `src/ts/storage/backup.ts:40`, `:58`; export routes, not database writers. |
| `src/lib/Setting/Pages/UserSettings.svelte:130` | load local backup button | Uploads a selected backup bundle/bin and restores it on the server. | Replaces DB and registers bundled assets. | Client `src/ts/storage/backup.ts:78` and `src/ts/server/backups.ts:250`; server `server/fastify/src/routes/save.ts:124`. |
| `src/lib/Setting/Pages/UserSettings.svelte:143` | clean cold storage button | Cleans cold-storage data. | Mutates cold-storage-backed persisted data, not normal command rows. | Client `src/ts/process/coldstorage.svelte.ts`; storage-specific persistence. |
| `src/ts/server/backups.ts:57`, `:103`, `:154`, `:250` | backup helpers | Client helpers behind backup UI. | Creates/restores/deletes/imports backup files and revision events. | `server/fastify/src/routes/backups.ts:19`, `:40`, `:55`; bundle import `server/fastify/src/routes/save.ts:124`. |
| `src/ts/server/realmImport.ts:31` | Realm import helper | Client helper behind Realm buttons. | Starts/finishes server Realm import. | `server/fastify/src/routes/realmImport.ts:157`. |
| `src/ts/characters.ts` import helpers | `importChat`, character import paths | Import buttons in chat/character lists. | Creates chats/characters and may upload/import assets. | Chat commands `server/fastify/src/routes/commands.ts:3520`; character commands `:3267`/`:3304`; assets `assets.ts:220`; save import routes if bundle/risusave. |

## Memory Jobs

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:191` | cancel server memory job button | Cancel job button. | Marks/cancels a server memory job. | `server/fastify/src/routes/memoryJobs.ts:163`; repository `server/fastify/src/memoryRepository.ts:1098`. |
| `src/ts/process/request/serverMemory.ts` | memory job request helpers | Memory modal or generation-triggered job creation. | Enqueues memory jobs. | `server/fastify/src/routes/memoryJobs.ts:81`; repository `server/fastify/src/memoryRepository.ts:874`. |
| `src/lib/Others/HypaV3Modal.svelte:261`, `:352`, `:382`, `:393` | local Hypa bulk buttons | Apply bulk resummary, reset data, bulk category, bulk important. | In non-server memory mode, mutates active chat `hypaV3Data`; in server-backed mode these paths return early/read-only. | Legacy/local chat memory blob persistence; server-backed memory jobs use `server/fastify/src/routes/memoryJobs.ts:81` instead. |
| `src/lib/Others/HypaV3Modal/category-manager-modal.svelte:121`, `:156`, `:161`, `:177` | category add/edit/delete buttons and input | Category manager controls. | In non-server memory mode, mutates `currentChat.hypaV3Data.categories` and summary category ids. | Legacy/local chat memory blob persistence. |
| `src/lib/Others/HypaV3Modal/tag-manager-modal.svelte:102`, `:108`, `:122`, `:127`, `:140` | tag add/edit/delete inputs/buttons | Tag manager controls. | In non-server memory mode, mutates summary tags in active chat `hypaV3Data`. | Legacy/local chat memory blob persistence. |
| `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:417`, `:436`, `:444`, `:456`, `:511`, `:520` | summary important/delete/edit/apply fields/buttons | Per-summary controls and textareas. | In non-server memory mode, mutates summary text, important flag, rerolled text, and summary list. | Legacy/local chat memory blob persistence. |
