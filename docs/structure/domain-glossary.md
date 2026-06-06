# Domain Glossary

`Database` in `src/ts/storage/database.svelte.ts` is the central TypeScript
shape used by browser code and many server helpers. Persisted backing storage is
SQLite; `server/fastify/src/repository.ts` reconstructs and stores that domain
shape across table families.

## Core Records

| Term                | Meaning                                                                                                          | Primary places                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Character           | Bot/persona-like participant with prompts, chats, lorebooks, scripts, modules, emotion images, and settings.     | `database.svelte.ts`, `commands/characters.ts`, `repository.ts`         |
| Chat                | Conversation under a character with metadata, messages, script state, lorebook state, and memory metadata.       | `commands/chats.ts`, `messageStore.ts`                                  |
| Message             | Chat row stored in SQLite `messages`; commands append, update, truncate, replace, or persist generation results. | `messageStore.ts`, `commands/messages.ts`, `routes/commands.ts`         |
| Reroll alternate    | Preserved reroll candidate stored as alternate message rows and hydrated with active chat messages.              | `messageStore.ts`, `routes/projection.ts`, `rerollNavigation.svelte.ts` |
| Chat folder         | Character-level chat grouping metadata; ids are globally normalized/validated for command paths.                 | `commands/chats.ts`, `chatCommands.ts`                                  |
| Settings group      | Command-backed group of scalar runtime/settings fields, including provider settings and `authRefreshes`.         | `routes/commands.ts`, `src/ts/server/commands.ts`, `src/ts/setting/`    |
| Preset / bot preset | Provider and generation settings selected for a conversation.                                                    | `commands/presets.ts`, `src/ts/server/commands.ts`                      |
| Prompt template     | Ordered prompt items such as description, persona, author note, lorebook, memory, history, and custom sections.  | `commands/prompts.ts`, `server/fastify/src/prompt/`                     |
| Persona             | User profile/persona state mirrored into legacy fields where needed.                                             | `commands/personas.ts`, `src/ts/persona.ts`                             |
| Loadout             | Saved selection bundle tying character, preset, persona, and module choices.                                     | `commands/loadouts.ts`, `src/ts/loadout.ts`                             |
| Lorebook            | World-info entries attached globally or to characters, chats, or modules.                                        | `commands/lorebooks.ts`, `prompt/lorebook.ts`                           |
| Module              | Reusable package of lorebooks, scripts, triggers, config, and optional MCP URL.                                  | `commands/modules.ts`, `moduleCommands.ts`, `process/modules.ts`        |
| Plugin              | Browser-executed extension record. Server stores records/storage but does not execute plugin code.               | `src/ts/plugins/`, `commands/plugins.ts`                                |
| Plugin storage      | Plugin key/value JSON storage in SQLite `plugin_custom_storage`.                                                 | `commands/pluginStorage.ts`, `src/ts/pluginCommands.ts`                 |
| Translator preset   | Saved translation provider/settings profile, including `.risutl` import/export helpers.                          | `commands/translatorPresets.ts`, `src/ts/translator/presets.ts`         |
| Hypa V3 preset      | Saved memory preset collection persisted in SQLite and exposed in projections/settings.                          | `repository.ts`, `routes/projection.ts`, `src/lib/Others/HypaV3Modal/`  |
| Asset               | Content-addressed binary with SQLite metadata and bytes under `data/assets/`.                                    | `repository.ts`, `routes/assets.ts`, `risuSave/assetReferences.ts`      |
| `.risu` save        | Portable import/export envelope; bundle export can include assets.                                               | `routes/save.ts`, `server/fastify/src/risuSave/`                        |
| RisuRealm character | Realm-hosted card imported server-side from dynamic JSON or `charx`, with assets stored content-addressed.       | `routes/realmImport.ts`, `realmImport/`, `src/ts/server/realmImport.ts` |

## Runtime Contracts

| Term                                | Meaning                                                                                                       | Primary places                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Command mutation                    | Revision-checked server write that updates SQLite-backed domain state and usually persists one command event. | `commands/mutations.ts`, `routes/commands.ts`, `src/ts/server/commands.ts`  |
| Command event / projection resource | Revisioned event that tells clients which targeted projection slice to refresh.                               | `commands/events.ts`, `routes/projection.ts`, `src/ts/server/events.ts`     |
| Active writer                       | Single-writer mutation lease carried by `risu-writer-session`; stale writers get 423.                         | `routeManifest.ts`, `activeWriter.ts`, `activeWriterSession.ts`             |
| Provider secret                     | API-key/token fields masked in projections and resolved back on writes.                                       | `providerSecrets.ts`, `routes/bootstrap.ts`, `routes/projection.ts`         |
| Model / `LLMModel`                  | Browser model-registry entry with provider, format, tokenizer, flags, and model id metadata.                  | `src/ts/model/`, `providers-and-models.md`                                  |
| Provider capability table           | Shared pure routing table that returns a server provider name or unsupported reason category.                 | `providerCapability.ts`                                                     |
| Server prompt assembly              | Fastify assembles prompts. Live verdicts are `server` or `unsupported`; no user-selectable local fallback.    | `serverPromptAssembly.ts`, `prompt/assemble.ts`                             |
| Server Lua VM                       | wasmoon VM running supported non-interactive Lua hooks during assembly/post-generation.                       | `prompt/luaRuntime.ts`                                                      |
| Post-generation pass                | Server run-var/output trigger/editoutput derivation that persists final text and scriptstate deltas.          | `prompt/assemble.ts`, `routes/generationChat.ts`                            |
| Durable generation                  | Detached server job for send/continue/regenerate that survives browser disconnect and persists the result.    | `durableGeneration.ts`, `generationJobs.ts`                                 |
| `activeGenerationJobs`              | Transient bootstrap projection of running durable jobs for reload/open-chat reattach.                         | `routes/bootstrap.ts`, `generationJobs.ts`, `process/reattach.ts`           |
| Memory                              | Maintained Hypa V3 chunks, summaries, embeddings, and jobs in SQLite.                                         | `server/fastify/src/memory*.ts`, `routes/memory*.ts`                        |
| Hypa V3 data                        | Per-chat legacy-compatible memory metadata stored in `chat_hypa_v3` and hydrated with messages.               | `messageStore.ts`, `routes/projection.ts`, `chatMessageHydration.svelte.ts` |
| MCP module                          | Module-linked tool endpoint using `internal:`, `plugin:`, remote HTTP(S), or URL-wrapped `stdio:` forms.      | `src/ts/process/mcp/`, `PlaygroundMCP.svelte`, `ModuleSettings.svelte`      |

## Identity And No-Port Rules

Public command APIs should use stable ids, not array indexes. Reordering
commands should validate complete id lists for the resource they reorder.

Do not treat these as implementation targets unless a new roadmap explicitly
reopens them: group chat, peer sync, Google Drive sync, Risu Account Sync,
browser-local durable persistence as the primary runtime, native/mobile wrapper
modes, service-worker behavior, SupaMemory, Hypa V2, and Hanurai as standalone
maintained engines. Some legacy names remain in active Hypa V3 fields/classes.
