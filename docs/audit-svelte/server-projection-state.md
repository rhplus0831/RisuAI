# Server Projection And State Findings

## Author Note Binding Bypasses Commands

- Source:
  `src/lib/SideBars/CharConfig.svelte:588-598`
- Symptom:
  Editing the author note can throw a read-only projection mutation error in
  Fastify mode, or appear to work locally but fail to persist durably.
- Why likely:
  `TextAreaInput bind:value` writes directly into
  `DBState.db.characters[$selectedCharID].chats[...].note`. This bypasses the
  chat command path and the active writer/revision flow.
- Remediation:
  Bind to a local draft, debounce if needed, and commit through
  `dispatchUpdateChat(chat.id, { note }, previous)`.

## Chat Submit Uses Projected Objects As Mutable Drafts

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:190-263`
- Symptom:
  User-message insertion can trip the projection guard or produce stale command
  payloads when server projection refreshes during send.
- Why likely:
  The send path uses the live chat record as the editing draft. Server-backed UI
  paths should treat projected `DBState.db` records as snapshots and construct
  command payloads separately.
- Remediation:
  Introduce an explicit `buildNextMessagesForSend()` helper that returns a new
  array plus command metadata, then dispatches through the chat command layer.

## Suggestion Persistence Is Not Server-Owned

- Source:
  `src/lib/ChatScreens/Suggestion.svelte:123-126`
- Symptom:
  Auto-suggestion text can vanish after refresh or land on the wrong chat.
- Why likely:
  The async completion writes `suggestMessages` into `DBState.db` directly
  rather than using a server command.
- Remediation:
  Model suggestions as chat metadata and update with `dispatchUpdateChat()`.

## Hydration In-Flight Calls Resolve Too Early

- Source:
  `src/ts/server/chatMessageHydration.svelte.ts:39-58`,
  `src/ts/server/chatMessageHydration.svelte.ts:79-98`,
  `src/ts/server/chatMessageHydration.svelte.ts:112-154`
- Symptom:
  Bulk readers that await `ensureAllChatsHydrated()` or
  `ensureAllCharacterLorebooksHydrated()` can still observe stub messages or
  stub lorebooks.
- Why likely:
  Hydration uses `Set` values for in-flight ids. A second caller for the same id
  returns immediately instead of awaiting the existing request.
- Remediation:
  Track `Map<id, Promise<void>>`, return the existing promise for duplicate
  callers, and only mark hydrated once the entity was actually applied.

## Hydration Can Apply Stale Responses After Reset

- Source:
  `src/ts/server/chatMessageHydration.svelte.ts:45-48`,
  `src/ts/server/chatMessageHydration.svelte.ts:88-93`,
  `src/ts/server/chatMessageHydration.svelte.ts:131-138`
- Symptom:
  After a full projection refresh/resync, an older messages/lore response can
  overwrite newer projected data and cause the UI to re-render stale state.
- Why likely:
  Fetch results are applied without checking `result.revision`, and
  `resetChatHydration()` clears in-flight sets without aborting or invalidating
  already-running requests.
- Remediation:
  Add per-id generation tokens or abort controllers and reject responses older
  than the current applied projection revision.

## Single Chat Export Keeps A Pre-Hydration Alias

- Source:
  `src/ts/characters.ts:285-332`
- Symptom:
  Exporting a non-open chat can still export an empty/stub message array even
  after awaiting hydration.
- Why likely:
  `db`, `chat`, and `char` are captured before
  `await hydrateChatMessages(chat.id)`. Hydration updates/refreezes projection
  state, but the local `chat` alias still points at the old object.
- Remediation:
  Re-read the character and chat from `DBState.db` after hydration before
  serializing or iterating messages.

## Playground Character Creation Pushes Into Projection

- Source:
  `src/lib/Playground/PlaygroundMenu.svelte:49-58`
- Symptom:
  Opening the playground chat can fail under the projection guard or can create
  duplicate UI state if command echo/projection arrives later.
- Why likely:
  The code pushes a new character into `DBState.db.characters` inside a trusted
  projection write and then dispatches `dispatchCreateCharacter()`. This is an
  optimistic mutation, but the path recursively re-enters `playgroundChat()`
  immediately and selects by searching live projected state.
- Remediation:
  Prefer a command-first flow that creates/selects by returned character id, or
  make the optimistic insertion idempotent and guarded against duplicate command
  echoes.

## Debounced Character Profile Bridge Is Global

- Source:
  `src/ts/server/characterBridge.svelte.ts:155-170`
- Symptom:
  Quickly editing character A and then character B can drop character A's server
  command. The UI shows both edits locally, but A can revert after projection
  refresh/reload.
- Why likely:
  A module-level `pendingPatch` clears any existing timer before checking
  whether the new patch is for the same character.
- Remediation:
  Key pending profile patches by `characterId`, with one timer per character.

## Debounced Chat/Folder Bridge Is Global

- Source:
  `src/ts/server/chatBridge.svelte.ts:120-147`,
  `src/ts/server/chatBridge.svelte.ts:150-162`
- Symptom:
  Rapid edits across two chats or folders can persist only the last entity.
- Why likely:
  `pendingChatPatch` and `pendingFolderPatch` are each single module-level
  pending slots. Queueing a different id clears the previous id's timer.
- Remediation:
  Use `Map<chatId, pending>` and `Map<folderId, pending>` so debouncing is
  scoped by entity.

## Chat Format Settings Lack Client Command Mapping

- Source:
  `src/ts/setting/chatFormatSettingsData.ts:9-37`,
  `src/ts/setting/utils.ts:56-70`,
  `src/ts/server/commands.ts:22-70`,
  `server/fastify/src/routes/commands.ts:885-886`
- Symptom:
  Changing chat format/Jinja settings can look saved in the UI, then revert on
  projection refresh or reload.
- Why likely:
  `SettingRenderer` writes `instructChatTemplate` and `JinjaTemplate` locally,
  but the client `SERVER_SETTINGS_GROUP_BY_KEY` does not include those keys, so
  command patch creation returns `null`. The server allowlist does include both
  keys.
- Remediation:
  Add both keys to the client settings group map and add an audit test comparing
  SettingRenderer bind keys with the client command map.

## Plugin Argument Updates Are Guarded But Index-Based

- Source:
  `src/lib/Setting/Pages/PluginSettings.svelte:39-53`,
  `src/lib/Setting/Pages/PluginSettings.svelte:65-80`
- Symptom:
  Updating a plugin argument after delete/reorder/import can target the wrong
  row if the UI index shifted while a control remained mounted.
- Why likely:
  `setPluginArg(index, ...)` writes by array index, and the surrounding
  `{#each DBState.db.plugins as plugin, i}` is unkeyed.
- Remediation:
  Key the each block by `plugin.name`, store expansion by plugin name, and pass
  plugin identity into mutation helpers.

## Asset Preview Caches Are Indexed, Not Identified

- Source:
  `src/lib/SideBars/CharConfig.svelte:271-285`,
  `src/lib/Setting/Pages/Module/ModuleMenu.svelte:48-58`,
  `src/lib/ChatScreens/AssetInput.svelte:16-30`
- Symptom:
  After switching characters/modules or reordering/deleting assets, preview
  thumbnails can show stale or mismatched media.
- Why likely:
  `getFileSrc()` resolves asynchronously and writes into persistent
  `assetFilePath[i]` / `assetFileExtensions[i]` arrays by numeric index without
  clearing old entries or checking whether the source asset is still current.
- Remediation:
  Reset preview state when the source asset list identity changes, key cached
  previews by stable asset path/id, and guard async writes with a run token.
