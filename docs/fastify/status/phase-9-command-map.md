# Phase 9 Command Map

Date: 2026-05-26

Status: locked by slice **9-0 - Mutation inventory and command map**.

This is the active design artifact for Phase 9 command implementation.
It records the durable browser mutation surfaces found during 9-0 and
the command contract that later slices must implement. Completed slice
logs stay in [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so Phase 9 may
update the current db shape and import paths directly. Do not add
compatibility migrations for intermediate Fastify command shapes.

## Audit Method

The 9-0 audit used these candidate searches over `src/lib/` and
`src/ts/`, excluding tests:

```bash
rg -n "DBState\.db\s*=|DBState\.db\.[A-Za-z0-9_$?.\[\]'\"\"]+\s*=|DBState\.db[^\n]+\.(push|pop|splice|shift|unshift|sort|reverse)\(|delete DBState\.db|setDatabase\(|setDatabaseLite\(|setCurrentCharacter\(|setCharacterByIndex\(|setCurrentChat\(" src/lib src/ts -g '!**/*.test.*' -g '!src/ts/parser/tests/**'
rg -n "bind:(value|check|group|files)=\{?[^\n}]*DBState\.db|bind:[a-zA-Z]+=\{?[^\n}]*DBState\.db" src/lib src/ts -g '!**/*.test.*' -g '!src/ts/parser/tests/**'
rg -n "getDatabase\([^\n]*\)|const db = getDatabase|let db = getDatabase|db\.[A-Za-z0-9_$?.\[\]'\"\"]+\s*=|db\.[A-Za-z0-9_$?.\[\]'\"\"]+\.(push|splice|unshift|sort|reverse)\(" src/lib src/ts -g '!**/*.test.*' -g '!src/ts/parser/tests/**'
```

Candidate counts from the audit:

| Candidate class                                                  | Count | Notes                                                                                                                             |
| ---------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| Direct `DBState.db` assignment / mutator / database setter lines |   453 | Includes direct writes, array mutators, helper setters, and full-db setters.                                                      |
| Svelte `bind:*` lines targeting `DBState.db`                     |   396 | Includes scalar settings, character fields, chat names, lore/script children, and dynamic wrappers.                               |
| Mutable `getDatabase()` reference lines                          |   914 | Includes reads plus mutable-reference writes; implementation slices must inspect the matching local block before replacing calls. |

These counts are intentionally candidate counts, not unique commands.
The implementation slices own the final line-by-line replacement inside
their resource family.

## Common Command Contract

- Mutating commands live under `/api/v1/commands/*`.
- Every command body includes `baseRevision`.
- The server compares `baseRevision` with the current schema revision
  before mutating persisted state.
- A stale command returns HTTP 409 with
  `{ error: "revision_conflict", currentRevision }`.
- A successful command runs one repository mutation, bumps the revision
  once, emits one server event, and returns
  `{ revision, event }` plus any command-specific ids.
- Validation failures return HTTP 400 and do not bump revision.
- Missing entities return HTTP 404 and do not bump revision.
- Authorization follows the current Fastify auth helper. Command tests
  must prove authenticated success and unauthenticated rejection.
- The browser helper lives in `src/ts/server/commands.ts` and is the only
  server-backed web write path once a family is replaced.
- Command payloads use JSON-safe snapshots. Browser-only transient state,
  open streams, and unsaved editor state are not command payload fields.

## Identity Rules

- Characters are addressed by `characterId`, using existing `chaId`.
- Chats are addressed by `chatId`, using existing `chat.id`.
- Messages, prompt items, lorebook entries, script definitions, trigger
  definitions, loadouts, custom models, custom sidebar items, and any
  other currently index-only durable rows get stable `id` fields in the
  current schema before their command slice lands.
- Server-side import and bootstrap normalization may generate missing ids
  directly. This is not a compatibility migration; it is the Phase 9
  current shape.
- Public commands must not address durable rows by array index except for
  append/truncate-style operations where no existing row is targeted.
- Svelte UI code may keep local indexes for rendering, but command calls
  must convert those indexes to ids before sending.

## Collection Semantics

- Child replacement uses `PUT` and replaces the complete named child
  collection for its parent. The request must include stable child ids
  for every retained row.
- Reorder uses `POST /api/v1/commands/<resource>/reorder` or the
  equivalent parent-scoped reorder endpoint.
- Reorder payloads contain the full ordered id list for the target
  collection. Unknown ids, duplicates, missing existing ids, or ids from
  another parent return HTTP 400.
- Create commands insert at the front only when the current UI already
  treats newest rows as first; otherwise they append. Reorder remains the
  only way to express arbitrary ordering.
- Delete commands remove the row and any parent references in the same
  transaction. Soft-delete behavior remains a field update where the
  current product already uses tombstone fields such as `trashTime`.

## Event Rules

- Command events are durable-state invalidation events for Phase 9
  projection. They are not surgical patch contracts.
- Every event includes `{ type, revision, resource, id?, parentId? }`.
- The browser handles all command events by debouncing a bootstrap
  re-fetch. Per-event patching is explicitly future work.
- Event names use `<resource>.<verb>` and must not be renamed after
  implementation lands. Later events may add fields.

## Inventory

| Surface                                                                                             | Durable writes found                                                                                           | Server-backed web scope                                                                      | Local/Tauri-only scope                                                                | Rollback risk                                               | Owning slice        |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| `src/ts/storage/database.svelte.ts`                                                                 | `setDatabase`, `setDatabaseLite`, `getDatabase`, character/chat helper setters, preset apply/copy/save helpers | Full-db setters are bootstrap/import/projection boundaries; preset helpers become commands   | Local load normalization and Tauri database load remain local until projection/gating | High: one accidental full-db setter can bypass all commands | 9-1, 9-2b, 9-5      |
| `src/ts/bootstrap.ts`                                                                               | Decode local save, mutate format-cleanup fields, set normalized DB                                             | Server-backed web startup must load `/api/v1/bootstrap` instead                              | Tauri/local storage boot and format cleanup remain client-local                       | High: startup can reintroduce local persistence             | 9-5, 9-6            |
| `src/ts/globalApi.svelte.ts`                                                                        | Character order cleanup, chat page selection, backup restore, asset/local storage writes                       | Character order and selected chat/page become commands; asset references use owning commands | Tauri file writes, local backups, and local asset cache remain local                  | High: helper APIs are widely imported                       | 9-3, 9-4d, 9-6, 9-8 |
| `src/lib/Setting/Wrappers/*` and setting data files                                                 | Dynamic Svelte binds to arbitrary top-level DB keys                                                            | Replace with grouped settings commands or local draft state per page                         | None for server-backed web                                                            | Medium: dynamic bind keys hide write families               | 9-2a                |
| `src/lib/Setting/Pages/BotSettings.svelte`, `OobaSettings.svelte`, model helpers                    | Provider keys, model selection, runtime params, fallback models, custom API formats                            | Grouped settings commands; provider secrets later masked in bootstrap                        | Local/Tauri provider key storage remains unchanged                                    | High: provider secrets plus many direct binds               | 9-2a, 9-6           |
| `src/lib/Setting/Pages/PromptSettings.svelte`, `src/lib/UI/PromptDataItem.svelte`                   | Prompt template fields, prompt items, schema fields, fallback model arrays                                     | Prompt settings and prompt-item CRUD/reorder commands                                        | None for server-backed web                                                            | Medium: prompt assembly already server-owned                | 9-2c                |
| `src/lib/Setting/botpreset.svelte`, `saveCurrentPreset`, `copyPreset`, `changeToPreset`             | Preset create/copy/update/delete/reorder/select and apply-to-db side effects                                   | Preset commands plus explicit apply/select behavior                                          | Local mode keeps helper behavior until replaced                                       | High: preset apply touches many settings groups             | 9-2b                |
| `src/ts/persona.ts`, `PersonaSettings.svelte`, persona sidebars                                     | Persona list, selected persona, mirrored user profile fields, persona image refs                               | Persona commands with explicit legacy-profile mirror fields                                  | Local image save remains local until asset gating                                     | Medium: selected persona has mirrored fields                | 9-2d, 9-4d          |
| `TranslatorPresetSettings.svelte`, translator helpers                                               | Translator presets, selected translator preset, translator runtime fields                                      | Translator preset commands and settings group patches                                        | Runtime translation calls stay outside command scope                                  | Medium                                                      | 9-2e                |
| `src/ts/loadout.ts`, `LoadoutModal.svelte`                                                          | Loadout save/delete/favorite/last-used/apply, enabled modules/global vars side effects                         | Loadout commands; apply stays composite/deferred until touched resources have commands       | None for server-backed web                                                            | Medium: apply crosses modules and globals                   | 9-2f                |
| `src/ts/characters.ts`, `characterCards.ts`, `PlaygroundMenu.svelte`, catalog UI                    | Character create/import/update/delete/order, images, chat import, cold-storage hydration                       | Character catalog/profile commands; imports route through server codec later                 | Tauri/local card import remains local until server import lands                       | High: large object replacement and imports                  | 9-3a, 9-8           |
| `src/lib/SideBars/Sidebar.svelte`, `GridCatalog.svelte`                                             | Character order/folders/trash state/selection helpers                                                          | Character reorder, folder, trash/restore commands                                            | UI-only selection state stays client-local if not durable                             | Medium                                                      | 9-3a, 9-3b          |
| `src/lib/ChatScreens/*`, `ChatList.svelte`, `SideChatList.svelte`                                   | Chat create/fork/delete/rename/folder/bookmark/current page, message edit/delete/truncate/bookmark             | Chat, chat-folder, and message commands                                                      | In-flight editor drafts remain client-local                                           | High: high-churn chat workflow                              | 9-3b, 9-3c          |
| `src/ts/process/postGeneration/*`, `src/ts/process/index.svelte.ts`, server message patch consumers | Streaming flags, assistant row append/update, reroll metadata, prompt info, generation info                    | Generation persistence command and message commands                                          | Transient streaming display state stays client-local                                  | High: rollback after partial generation is user-visible     | 9-3d                |
| `src/ts/process/triggers.ts`, `scriptings.ts`, `command.ts`, CBS helpers                            | Script-trigger mutations to character/chat/persona variables and chat state                                    | Scriptstate command plus compatibility setters/adapters                                      | Pure runtime command execution remains browser-side                                   | High: hidden writes through scripting APIs                  | 9-3e, 9-3f, 9-4b    |
| `src/ts/process/lorebook.svelte.ts`, `LoreBookList.svelte`, `lorepreset.svelte`                     | Global, character, chat, and module lore entries/settings                                                      | Lorebook and child replacement commands                                                      | Local import/export waits for server codec                                            | Medium: nested child arrays                                 | 9-4a                |
| `src/ts/process/modules.ts`, `ModuleSettings.svelte`, `ModuleChatMenu.svelte`                       | Module import/create/update/delete, enabled modules, character module links                                    | Module record, enablement, and link commands                                                 | None for server-backed web                                                            | Medium                                                      | 9-4c                |
| `src/lib/SideBars/CharConfig.svelte`, script/trigger components                                     | Character profile fields, assets, scripts, triggers, TTS config, alternate greetings                           | Character scalar patch plus child replacement commands                                       | Asset bytes remain upload/local until 9-4d/9-6                                        | High: many direct binds into selected character             | 9-3a, 9-4b, 9-4d    |
| `src/ts/plugins/plugins.svelte.ts`, `apiV3/v3.svelte.ts`, `PluginSettings.svelte`                   | Plugin install/config/enable/provider/args, pluginCustomStorage, plugin DB setters                             | Plugin record/config commands and plugin-storage bridge                                      | Plugin code execution remains browser sandboxed                                       | High: plugin setters bypass property greps                  | 9-4e, 9-4f          |
| `src/ts/storage/risuSave.ts`, `backup.ts`, `kei/backup.ts`                                          | `.risu` decode/encode, restore, local/remote backup save, asset cache walking                                  | Server `.risu` codec, import/export routes, backup restore event                             | Tauri and local backups remain local                                                  | High: whole-state replacement and assets                    | 9-6, 9-7, 9-8       |
| `src/ts/storage/autoStorage.ts`, `nodeStorage.ts`, `opfsStorage.ts`, localForage users              | Local persistence and asset cache writes                                                                       | Server-backed web must not reach these paths after gating                                    | Tauri/local mode keeps them                                                           | High: persistence bypass                                    | 9-6                 |
| `src/ts/process/promptAssembly/buildMemoryWindow.ts`, Hypa V3 local helpers                         | Legacy `hypaV3Data` cache writes and local memory side effects                                                 | Server-backed memory is Phase 8 repository-backed; remaining local writes must be gated      | Local memory mode remains local                                                       | Medium                                                      | 9-5, 9-6            |
| `src/lib/Others/WelcomeRisu.svelte`, setup and pro-tools panels                                     | First-run profile/provider/default preset settings                                                             | Settings/persona/preset commands in server-backed mode                                       | Local first-run setup stays local until projection loads                              | Medium                                                      | 9-2a, 9-2b, 9-2d    |
| `src/lib/Others/PromptDiffModal.svelte`, NanoGPT dashboard, misc utility panels                     | Preference fields, subscription state, custom sidebar items, advanced arrays                                   | Settings or resource-specific commands by field owner                                        | Runtime-only cache fields may remain client-local if not persisted                    | Low to medium                                               | 9-2a, 9-4d, 9-6     |

## Command Families

### Foundation

| Family          | Endpoints                                 | Payload notes                                                                       | Event names        | Slice |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ | ----- |
| Command harness | `PATCH /api/v1/commands/settings/runtime` | `{ baseRevision, patch }` with a tiny allowlist for the first harness setting group | `settings.updated` | 9-1   |

9-1 also owns the shared repository helper for revision checks,
transactional JSON mutation, event emission, and typed browser fetch
helpers. The harness command proves the contract before larger families
move.

### Settings, Presets, Personas, Loadouts

| Family                | Endpoints                                                                                                                                                                                                                                                                                         | Payload notes                                                                                                                                                                                                                               | Event names                                                                                                                     | Slice |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Settings groups       | `PATCH /api/v1/commands/settings/:group`                                                                                                                                                                                                                                                          | Groups: `providers`, `runtime`, `display`, `language`, `media`, `memory`, `advanced`, `sidebar`, `account`. Server validates an allowlist per group. Provider key placeholder strings mean "leave unchanged" after bootstrap masking lands. | `settings.updated`                                                                                                              | 9-2a  |
| Bot presets           | `POST /api/v1/commands/presets`, `PATCH /api/v1/commands/presets/:presetId`, `DELETE /api/v1/commands/presets/:presetId`, `POST /api/v1/commands/presets/:presetId/copy`, `POST /api/v1/commands/presets/select`, `POST /api/v1/commands/presets/import`, `POST /api/v1/commands/presets/reorder` | Presets get stable ids. Selecting a preset records `botPresetsId` equivalent by id and applies the preset fields in the same transaction when requested.                                                                                    | `preset.created`, `preset.updated`, `preset.deleted`, `preset.copied`, `preset.selected`, `preset.imported`, `preset.reordered` | 9-2b  |
| Prompt settings/items | `PATCH /api/v1/commands/prompt-settings`, `POST /api/v1/commands/prompt-items`, `PATCH /api/v1/commands/prompt-items/:itemId`, `DELETE /api/v1/commands/prompt-items/:itemId`, `POST /api/v1/commands/prompt-items/reorder`                                                                       | Prompt item rows get stable ids. Prompt settings covers template behavior fields such as `promptSettings`, schema fields, prompt-template toggles, and fallback behavior.                                                                   | `prompt.settings.updated`, `prompt.item.created`, `prompt.item.updated`, `prompt.item.deleted`, `prompt.item.reordered`         | 9-2c  |
| Personas              | `POST /api/v1/commands/personas`, `PATCH /api/v1/commands/personas/:personaId`, `DELETE /api/v1/commands/personas/:personaId`, `POST /api/v1/commands/personas/select`, `POST /api/v1/commands/personas/reorder`                                                                                  | Payloads may include `mirrorLegacyProfile: true` to update `username`, `userIcon`, `personaPrompt`, and `userNote` with the selected persona. Delete selection handoff uses `selectPersonaId`.                                                | `persona.created`, `persona.updated`, `persona.deleted`, `persona.selected`, `persona.reordered`                                | 9-2d  |
| Translator presets    | `POST /api/v1/commands/translator-presets`, `PATCH /api/v1/commands/translator-presets/:presetId`, `DELETE /api/v1/commands/translator-presets/:presetId`, `POST /api/v1/commands/translator-presets/select`                                                                                      | Runtime translation requests stay outside this family. Delete selection handoff uses `selectPresetId`.                                                                                                                                      | `translatorPreset.created`, `translatorPreset.updated`, `translatorPreset.deleted`, `translatorPreset.selected`                 | 9-2e  |
| Loadouts              | `POST /api/v1/commands/loadouts`, `PATCH /api/v1/commands/loadouts/:loadoutId`, `DELETE /api/v1/commands/loadouts/:loadoutId`, `POST /api/v1/commands/loadouts/:loadoutId/favorite`, `POST /api/v1/commands/loadouts/:loadoutId/touch`                                                            | Save/delete/favorite/last-used landed first. Apply remains deferred until every touched resource has a command.                                                                                                                             | `loadout.created`, `loadout.updated`, `loadout.deleted`, `loadout.favorited`, `loadout.touched`                                 | 9-2f  |

### Characters, Chats, Messages

| Family                 | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Payload notes                                                                                                                                                                               | Event names                                                                                                                                                               | Slice |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Characters             | `POST /api/v1/commands/characters`, `PATCH /api/v1/commands/characters/:characterId`, `DELETE /api/v1/commands/characters/:characterId`, `POST /api/v1/commands/characters/select`, `POST /api/v1/commands/characters/reorder`                                                                                                                                                                                                                                                           | `characterId` is `chaId`. Scalar profile patches exclude child collections owned by 9-4. Delete performs hard removal; trash/restore is a patch to `trashTime`.                             | `character.created`, `character.updated`, `character.deleted`, `character.selected`, `character.reordered`                                                                | 9-3a  |
| Chat records/folders   | `POST /api/v1/commands/characters/:characterId/chats`, `PATCH /api/v1/commands/chats/:chatId`, `DELETE /api/v1/commands/chats/:chatId`, `POST /api/v1/commands/chats/:chatId/fork`, `POST /api/v1/commands/characters/:characterId/chats/reorder`, `POST /api/v1/commands/characters/:characterId/chat-folders`, `PATCH /api/v1/commands/chat-folders/:folderId`, `DELETE /api/v1/commands/chat-folders/:folderId`, `POST /api/v1/commands/characters/:characterId/chat-folders/reorder` | Chat commands validate parent character ownership. Chat page/current-chat state is persisted by chat id, not index.                                                                         | `chat.created`, `chat.updated`, `chat.deleted`, `chat.forked`, `chat.reordered`, `chatFolder.created`, `chatFolder.updated`, `chatFolder.deleted`, `chatFolder.reordered` | 9-3b  |
| Messages               | `POST /api/v1/commands/chats/:chatId/messages`, `PATCH /api/v1/commands/messages/:messageId`, `DELETE /api/v1/commands/messages/:messageId`, `POST /api/v1/commands/chats/:chatId/messages/truncate`, `PUT /api/v1/commands/chats/:chatId/messages`                                                                                                                                                                                                                                      | Message rows get stable ids. Replacement is reserved for import/fork/regenerate flows and must include the full transcript.                                                                 | `message.appended`, `message.updated`, `message.deleted`, `message.truncated`, `messages.replaced`                                                                        | 9-3c  |
| Generation persistence | `POST /api/v1/commands/chats/:chatId/generation-result`                                                                                                                                                                                                                                                                                                                                                                                                                                  | Persists assistant row writes, reroll data, prompt info, generation info, and terminal post-generation metadata after server-backed generation. Streaming display state stays client-local. | `generation.persisted`                                                                                                                                                    | 9-3d  |
| Chat scriptstate       | `PATCH /api/v1/commands/chats/:chatId/scriptstate`                                                                                                                                                                                                                                                                                                                                                                                                                                       | Payload contains a partial scriptstate patch plus optional delete keys. Trigger definitions are 9-4b.                                                                                       | `chat.scriptstate.updated`                                                                                                                                                | 9-3e  |
| Compatibility adapters | No new endpoint family; replace helpers and plugin/MCP bypasses with existing character/chat/message commands or explicit unsupported errors.                                                                                                                                                                                                                                                                                                                                            | Covers `setCurrentCharacter`, `setCurrentChat`, `getDatabase()` mutable reference adapters, CBS, and MCP character/chat writes.                                                             | Existing resource events                                                                                                                                                  | 9-3f  |

### Lorebooks, Modules, Plugins, Assets

| Family           | Endpoints                                                                                                                                                                                                                                                                                                                                                                                         | Payload notes                                                                                                                                                | Event names                                                                                                               | Slice |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| Lorebooks        | `POST /api/v1/commands/lorebooks`, `PATCH /api/v1/commands/lorebooks/:lorebookId`, `DELETE /api/v1/commands/lorebooks/:lorebookId`, `POST /api/v1/commands/lorebooks/reorder`, `PUT /api/v1/commands/lorebooks/:lorebookId/entries`, `PUT /api/v1/commands/characters/:characterId/lorebooks`, `PUT /api/v1/commands/chats/:chatId/lorebooks`, `PUT /api/v1/commands/modules/:moduleId/lorebooks` | Global, character, chat, and module lore rows get ids. Child replacement is whole-collection.                                                                | `lorebook.created`, `lorebook.updated`, `lorebook.deleted`, `lorebook.reordered`, `lorebook.entries.replaced`             | 9-4a  |
| Scripts/triggers | `PUT /api/v1/commands/characters/:characterId/scripts`, `PUT /api/v1/commands/characters/:characterId/triggers`, `PUT /api/v1/commands/modules/:moduleId/scripts`, `PUT /api/v1/commands/modules/:moduleId/triggers`                                                                                                                                                                              | Definition editing is whole-child replacement. Runtime trigger side effects stay in 9-3e.                                                                    | `scriptDefinitions.replaced`, `triggerDefinitions.replaced`                                                               | 9-4b  |
| Modules          | `POST /api/v1/commands/modules`, `PATCH /api/v1/commands/modules/:moduleId`, `DELETE /api/v1/commands/modules/:moduleId`, `POST /api/v1/commands/modules/enable`, `POST /api/v1/commands/modules/reorder`, `POST /api/v1/commands/characters/:characterId/modules/reorder`                                                                                                                        | Enablement and character-module links use ids.                                                                                                               | `module.created`, `module.updated`, `module.deleted`, `module.enabled`, `module.reordered`, `character.modules.reordered` | 9-4c  |
| Asset references | No generic byte command. Asset bytes stay on `POST /api/v1/assets`; durable references are patched through the owning resource command.                                                                                                                                                                                                                                                           | Owning commands validate that referenced asset ids exist when the field expects a server asset. Bundle walking lands in 9-8.                                 | Owning resource event                                                                                                     | 9-4d  |
| Plugins          | `POST /api/v1/commands/plugins`, `PATCH /api/v1/commands/plugins/:pluginId`, `DELETE /api/v1/commands/plugins/:pluginId`, `POST /api/v1/commands/plugins/:pluginId/enable`, `POST /api/v1/commands/plugins/provider`, `POST /api/v1/commands/plugins/reorder`                                                                                                                                     | Plugin code remains browser sandboxed. Plugin records/config/provider args are durable DB state.                                                             | `plugin.created`, `plugin.updated`, `plugin.deleted`, `plugin.enabled`, `plugin.provider.selected`, `plugin.reordered`    | 9-4e  |
| Plugin storage   | `PUT /api/v1/commands/plugin-storage/:key`, `DELETE /api/v1/commands/plugin-storage/:key`, `POST /api/v1/commands/plugin-storage/bulk`                                                                                                                                                                                                                                                            | Keys are plugin-visible strings. Values must be JSON-serializable. Bulk is for plugin `setDatabase*` bridge translation, not arbitrary whole-db replacement. | `pluginStorage.updated`, `pluginStorage.deleted`, `pluginStorage.bulkUpdated`                                             | 9-4f  |

### Projection, Storage, Imports

| Family               | Endpoint / helper                                                             | Payload notes                                                                                                                                         | Event names                                                                     | Slice            |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| Events               | `GET /api/v1/events`                                                          | Persistent SSE of command events. Client subscription and debounced bootstrap re-fetch landed in 9-5c.                                                | All command events                                                              | 9-5a, 9-5c       |
| Bootstrap projection | `GET /api/v1/bootstrap`, `src/ts/server/bootstrap.ts`                         | Web startup uses server bootstrap in server-backed mode. `DBState.db` guard turns on after replacement sweep through trusted projection writes.       | N/A                                                                             | 9-5b, 9-5e-i-iii |
| Storage gating       | Browser helpers, not a command route                                          | Prevent server-backed web startup/save/backup/asset/cache paths from reaching localForage, OPFS, AutoStorage, or NodeStorage.                         | N/A                                                                             | 9-6a-d           |
| Provider masking     | `GET /api/v1/bootstrap`, settings command placeholders                        | Mask provider secrets only after server-backed provider paths no longer need client-visible keys. Placeholder values still mean "leave unchanged".    | N/A                                                                             | 9-6e             |
| Server `.risu` codec | Server codec modules                                                          | Legacy and RISUSAVE decode/encode move to server-safe code; decoded saves normalize into current import snapshots; route wiring stays in 9-8.         | N/A                                                                             | 9-7a-e           |
| Import/export routes | `/api/v1/import/risusave`, `/api/v1/export/risusave`, `/api/v1/export/bundle` | Multipart import, repository `.risu` export, asset reference walking, and bundle export. Existing JSON import is replaced when the codec route lands. | `state.imported`, `state.exported` for event stream visibility where applicable | 9-8a-d           |
| Backup restore       | Existing `/api/v1/backups/:id/restore`                                        | Keep backup routes administrative. Restore-event emission lands with server backup/restore projection.                                                | `state.restored` (planned)                                                      | 9-6c             |

## Plugin Database Bridge

Keep the plugin-facing API names: `getDatabase`, `setDatabaseLite`, and
`setDatabase`. In server-backed web mode the setters become translation
bridges instead of whole-state writes.

Allowed top-level plugin keys map as follows:

| Plugin key                                                                         | Command target                                                              | Slice    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| `botPresets`, `botPresetsId`                                                       | Preset commands and selection                                               | 9-2b     |
| `promptTemplate`, `promptSettings`, prompt/schema template fields                  | Prompt settings/items                                                       | 9-2c     |
| `personas`, `selectedPersona`, `username`, `userIcon`, `personaPrompt`, `userNote` | Persona commands with mirror option                                         | 9-2d     |
| `translatorPresets`, `translatorPresetId`, translator runtime fields               | Translator preset commands or settings group                                | 9-2e     |
| `loadouts`, `lastLoadedLoadoutName`                                                | Loadout commands                                                            | 9-2f     |
| `characters`, `characterOrder`                                                     | Character, chat, message, lore, script, and asset commands by changed child | 9-3, 9-4 |
| `loreBook`, `loreBookPage`                                                         | Lorebook commands                                                           | 9-4a     |
| `modules`, `enabledModules`                                                        | Module commands                                                             | 9-4c     |
| `plugins`, `currentPluginProvider`                                                 | Plugin commands                                                             | 9-4e     |
| `pluginCustomStorage`                                                              | Plugin-storage commands                                                     | 9-4f     |
| Scalar top-level settings                                                          | Matching settings group command                                             | 9-2a     |
| Unknown top-level key                                                              | `pluginCustomStorage` entry for that key                                    | 9-4f     |

The bridge must diff the plugin-provided subset against the projected
database snapshot, dispatch typed commands for recognized top-level keys,
and store unknown keys in `pluginCustomStorage`. Mixed recognized changes
use either ordered individual commands or the 9-4f composite bridge
command; they must never replace the whole DB blob.

## Test Expectations

- Command foundation tests cover auth rejection, missing/invalid
  `baseRevision`, 409 conflict response, one successful mutation, one
  rollback-on-validation case, one rollback-on-throw case, emitted event
  shape, and bootstrap visibility after success.
- Every resource slice covers representative create/update/delete,
  reorder, child replacement where relevant, 400 for malformed payloads,
  404 for missing ids, 409 for stale revisions, and no revision bump on
  failure.
- Browser helper tests mock `fetch` and verify path, method,
  `baseRevision`, auth headers, typed success, 409 handling, and error
  propagation.
- Server-backed send fixtures stay pinned for generation/message
  replacement slices, especially `message_patch`, rollback restoration,
  and Hypa V3 memory side effects.
- 9-5 must add a negative guard test proving direct `DBState.db`
  mutation fails in server-backed web mode after assigned replacement
  slices are complete.

## Current Implementation Pickup

9-5a, 9-5b, and 9-5c are complete. 9-5d remains active, but it is split
into smaller residual command-replacement sub-slices:

- **9-5d-i - Settings residual command sweep.** Route remaining
  server-backed web writes to existing settings groups through the
  settings command bridge.
- **9-5d-ii - 9-2 resource UI tails.** Prompt templates, personas,
  translator presets, and loadouts.
- **9-5d-iii - 9-3 character/chat UI tails.** Character profile/assets,
  chat folders, selected chat/page state, playground/realm/grid helpers,
  and legacy import helpers.
- **9-5d-iv - 9-4 extension UI/API tails.** Lorebooks, module UI/MCP
  helpers, plugin settings, plugin database translation, and plugin
  storage.
- **9-5d-v - Process/runtime durable-write classification.** Generation,
  scriptstate, memory, and MCP helper writes.

Later Phase 9 slices are pre-split by rollback surface:

- **9-5e-i through 9-5e-iii.** Add the read-only `DBState.db` guard
  foundation, integrate command bridge optimistic/rollback writes, then audit
  guard failures.
- **9-6a through 9-6e.** Gate server-backed persistence, asset bytes,
  backup/restore projection, residual local caches, and finally provider
  secret masking.
- **9-7a through 9-7e.** Build the `.risu` fixture harness, port legacy
  envelopes, port RISUSAVE blocks, normalize/validate decoded saves, and add
  repository-backed export snapshots.
- **9-8a through 9-8d.** Add multipart import, repository `.risu` export, the
  asset reference walker, and bundle export.
- **9-9a through 9-9e.** Close with browser smoke coverage, generation/memory
  fixture reconciliation, storage-write audit, manual mode verification, and
  documentation closeout.
