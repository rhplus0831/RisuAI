# Sidebar And Chat Lists

These controls mutate chat selection, chat/folder rows, character order, or active-chat sidebar settings.

## Chat Lists

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/SideChatList.svelte:424` | `data-risu-chat-action="create"` | New chat button. | Creates a chat under the current character and normally selects it. | `server/fastify/src/routes/commands.ts:3520`. |
| `src/lib/SideBars/SideChatList.svelte:439` | `data-risu-chat-action="toggle-folder"` | Folder header button. | Updates chat folder `folded`. | `server/fastify/src/routes/commands.ts:3980`. |
| `src/lib/SideBars/SideChatList.svelte:461` | folder name `TextInput` | `updateFolderName(folder, value)`. | Updates chat folder `name`. | `server/fastify/src/routes/commands.ts:3980`. |
| `src/lib/SideBars/SideChatList.svelte:470` | `data-risu-chat-action="folder-options"` | Folder color menu button. | Updates chat folder `color`. | `server/fastify/src/routes/commands.ts:3980`. |
| `src/lib/SideBars/SideChatList.svelte:514` | `data-risu-chat-action="folder-delete"` | Delete folder button. | Deletes a chat folder and clears/moves affected chat folder ids. | `server/fastify/src/routes/commands.ts:4025`. |
| `src/lib/SideBars/SideChatList.svelte:558`, `:691` | `data-risu-chat-id`, `data-risu-chat-idx` | Chat row select buttons. | Updates selected chat (`chatPage`) when the route fallback uses commands. | `server/fastify/src/routes/commands.ts:3599` via `dispatchSelectChat`. |
| `src/lib/SideBars/SideChatList.svelte:572`, `:705` | chat row `TextInput` | `updateChatName(chat, value)`. | Updates chat `name`. | `server/fastify/src/routes/commands.ts:3599`. |
| `src/lib/SideBars/SideChatList.svelte:580`, `:713` | `data-risu-chat-action="options"` | Options menu: fork, bind/unbind persona. | Fork creates a chat; persona action updates chat `bindedPersona`. | Fork: `server/fastify/src/routes/commands.ts:3755`; patch: `:3599`. |
| `src/lib/SideBars/SideChatList.svelte:664`, `:798` | `data-risu-chat-action="delete"` | Delete chat button. | Deletes chat and updates selection. | `server/fastify/src/routes/commands.ts:3704`. |
| `src/lib/SideBars/SideChatList.svelte:239` | Sortable `createStb` | Drag/drop chat rows and chat folders. | Reorders chats, updates chat `folderId`, and reorders folders. | `server/fastify/src/routes/commands.ts:3877` and `:4080`. |
| `src/lib/SideBars/SideChatList.svelte:831` | `data-risu-chat-action="import"` | Import chat button. | Imports one or more chats/folders into current character. | Chat creation commands `server/fastify/src/routes/commands.ts:3520`, plus import helpers in `src/ts/characters.ts`. |
| `src/lib/SideBars/SideChatList.svelte:873` | `data-risu-chat-action="create-folder"` | Create chat folder button. | Creates a chat folder under the current character. | `server/fastify/src/routes/commands.ts:3934`. |
| `src/lib/Others/ChatList.svelte:79` | modal `data-risu-chat-id` row | Modal chat row select. | Selects chat. | `server/fastify/src/routes/commands.ts:3599` when command fallback is used. |
| `src/lib/Others/ChatList.svelte:91` | modal chat name `TextInput` | `updateChatName(chat, draft)`. | Updates chat `name`. | `server/fastify/src/routes/commands.ts:3599`. |
| `src/lib/Others/ChatList.svelte:113` | modal `data-risu-chat-action="delete"` | Delete chat button. | Deletes chat. | `server/fastify/src/routes/commands.ts:3704`. |
| `src/lib/Others/ChatList.svelte:152` | modal `data-risu-chat-action="create"` | Create chat button. | Creates chat and selects it. | `server/fastify/src/routes/commands.ts:3520`. |
| `src/lib/Others/ChatList.svelte:183` | modal `data-risu-chat-action="import"` | Import chat button. | Imports chats into current character. | `server/fastify/src/routes/commands.ts:3520` and import helper path. |

## Active Chat Sidebar

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/AuthorNoteEditor.svelte:119` | `data-risu-chat-author-note` | Author note textarea. | Debounced update of active chat `note`. | `server/fastify/src/routes/commands.ts:3599`; client `src/ts/chatCommands.ts:1436`. |
| `src/lib/SideBars/Toggles.svelte:146` | dynamic toggle text/textarea/select controls | Sidebar generation setting controls. | Updates active chat `generationSettings.sidebarToggles`. | `server/fastify/src/routes/commands.ts:3665`; client `src/ts/activeChatGenerationSettings.ts:251`. |
| `src/lib/SideBars/Toggles.svelte:216` | jailbreak toggle controls | Per-chat jailbreak setting. | Updates active chat generation settings. | `server/fastify/src/routes/commands.ts:3665`. |
| `src/lib/SideBars/Toggles.svelte:229`, `:247` | Hypa memory checkboxes | Character Supa/Hypa memory settings for the active character. | Updates character memory flags. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/SideBars/ChatGenerationSettingsControls.svelte:55` | `data-risu-generation-picker-control` | Model/prompt/persona picker buttons. | Writes active chat `generationSettings` ids. | `server/fastify/src/routes/commands.ts:3665`. |
| `src/lib/Setting/listedPersona.svelte:70` | `data-risu-persona-id` | Persona select row in picker. | Selects global persona or chat-scoped persona setting depending on picker mode. | Global persona: `server/fastify/src/routes/commands.ts:2758`; chat generation settings: `:3665`. |
| `src/lib/SideBars/DevTool.svelte:131`, `:133`, `:135` | `commitScriptstateValue` | DevTool variable text/number/check fields. | Updates active chat `scriptstate`. | `server/fastify/src/routes/commands.ts:4126`; client `src/ts/chatCommands.ts:23` import and scriptstate helpers. |
| `src/lib/SideBars/DevTool.svelte:184`, buttons at `:188`, `:197`, `:206`, `:232` | autopilot textareas/buttons | DevTool autopilot text fields and run button. | Add/remove/import autopilot rows locally; Run appends user messages and starts generation for each row. | Message append `server/fastify/src/routes/commands.ts:4180`; generation `server/fastify/src/routes/generationChat.ts:2046`. |
| `src/lib/SideBars/CustomSidebar.svelte:31`, `:40` | custom sidebar model/settings controls | Custom sidebar model picker and delegated `SettingRenderer` rows. | Updates server-backed settings selected in the custom sidebar. | `server/fastify/src/routes/commands.ts:1319`. |

## Character List And Order

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/SideBars/Sidebar.svelte:315`, `:482`; `src/lib/Others/GridCatalog.svelte:169`, `:218`; `src/lib/Mobile/MobileCharacters.svelte:137` | character open/select controls | Character avatar/grid/mobile row buttons. | Persists selected/current character and last interaction when the command-backed path is used. | Character select `server/fastify/src/routes/commands.ts:3451`; route sync can also patch current chat at `commands.ts:3599`. |
| `src/lib/SideBars/Sidebar.svelte:104` | `inserter` | Character drag/drop target. | Reorders character order items and folder membership. | `server/fastify/src/routes/commands.ts:3477`; client `src/ts/characterCommands.ts` order helpers. |
| `src/lib/SideBars/Sidebar.svelte:155` | `createFolder` | Drop character on character/folder. | Creates a character order folder. | `server/fastify/src/routes/commands.ts:3477` through character order command helpers. |
| `src/lib/SideBars/Sidebar.svelte:348` | `SidebarAvatar oncontextmenu` | Folder context menu: rename, color, reset/select image. | Updates character order folder `name`, `color`, `imgFile`, `img`; selected image also uploads asset. | Character order command: `server/fastify/src/routes/commands.ts:3477`; assets: `server/fastify/src/routes/assets.ts:220`. |
| `src/lib/SideBars/Sidebar.svelte:550` | `BaseRoundedButton onClick addCharacter` | Add character button. | Creates and selects/imports a character. | `server/fastify/src/routes/commands.ts:3267` or `:3304`; assets may use `server/fastify/src/routes/assets.ts:220`. |
| `src/lib/Others/GridCatalog.svelte:226` | `data-risu-grid-action="delete"` | Trash character button. | Sets trash state or deletes depending on `removeChar` mode. | `server/fastify/src/routes/commands.ts:3344` or `:3396`. |
| `src/lib/Others/GridCatalog.svelte:267` | `data-risu-grid-action="restore"` | Restore character button. | Clears `trashTime`. | `server/fastify/src/routes/commands.ts:3344`. |
| `src/lib/Others/GridCatalog.svelte:283` | `data-risu-grid-action="delete-permanent"` | Permanent delete button. | Deletes character, its chats, messages, and related state. | `server/fastify/src/routes/commands.ts:3396`. |
| `src/lib/Mobile/MobileCharacters.svelte:165` | `data-risu-mobile-character-action="create"` | Mobile add character button. | Creates/imports a character. | `server/fastify/src/routes/commands.ts:3267` or `:3304`. |
