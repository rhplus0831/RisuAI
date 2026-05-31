# Domain Glossary

The central persisted domain type is `Database` in
`src/ts/storage/database.svelte.ts`. Server command snapshots in
`src/ts/server/commands.ts` plus the route registrar in
`server/fastify/src/routes/commands.ts` are often a cleaner index of the
resources that the API expects to mutate.

## Core Terms

| Term                                | Meaning                                                                                                                                                   | Primary Places                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Character                           | A bot/persona-like chat participant with prompts, chats, lorebooks, scripts, modules, emotion images, and settings.                                       | `src/ts/storage/database.svelte.ts`, `server/fastify/src/commands/characters.ts`                                                                       |
| Chat                                | A conversation under a character, with messages, script state, lorebook state, and metadata.                                                              | `src/ts/storage/database.svelte.ts`, `server/fastify/src/commands/chats.ts`                                                                            |
| Message                             | A chat row. Server generation commands append, update, truncate, replace, and persist generation results.                                                 | `server/fastify/src/commands/messages.ts`, `server/fastify/src/routes/commands.ts`                                                                     |
| Reroll alternate                    | Preserved reroll candidate stored outside the active transcript with `messages.alternate = 1`, hydrated with the active chat.                             | `server/fastify/src/messageStore.ts`, `server/fastify/src/routes/projection.ts`, `src/ts/process/rerollNavigation.svelte.ts`                           |
| Chat folder                         | Character-level folder metadata for grouping chats; folder ids are globally normalized/validated for command paths.                                       | `server/fastify/src/commands/chats.ts`, `server/fastify/src/routes/commands.ts`, `src/ts/chatCommands.ts`                                              |
| Preset / Bot preset                 | Provider and generation settings selected for a conversation.                                                                                             | `server/fastify/src/commands/presets.ts`, `src/ts/server/commands.ts`                                                                                  |
| Settings group                      | Command-backed group of runtime/settings fields such as bot, display, prompt, memory, and provider settings.                                              | `server/fastify/src/routes/commands.ts`, `src/ts/server/commands.ts`, `src/ts/setting/`                                                                |
| Repository state                    | Whole-repository server-owned state transitions such as initialize, import, restore, and generation persistence.                                          | `server/fastify/src/repository.ts`, `server/fastify/src/routes/save.ts`, `server/fastify/src/routes/backups.ts`                                        |
| Translator preset                   | Saved translation-provider settings and import/export state.                                                                                              | `server/fastify/src/commands/translatorPresets.ts`, `src/ts/translator/presets.ts`                                                                     |
| Prompt template                     | Ordered prompt items such as description, persona, author note, lorebook, memory, history, and custom sections.                                           | `server/fastify/src/commands/prompts.ts`, `server/fastify/src/prompt/`                                                                                 |
| Persona                             | User profile/persona state mirrored into legacy fields where needed.                                                                                      | `server/fastify/src/commands/personas.ts`, `src/ts/persona.ts`                                                                                         |
| Loadout                             | Saved selection bundle, often tying character/preset/persona/module choices together.                                                                     | `server/fastify/src/commands/loadouts.ts`, `src/ts/loadout.ts`                                                                                         |
| Lorebook                            | World-info/memory-book entries, either global or attached to characters, chats, or modules.                                                               | `server/fastify/src/commands/lorebooks.ts`, `server/fastify/src/prompt/lorebook.ts`                                                                    |
| Module                              | Reusable package of lorebooks, scripts, triggers, and configuration that can be enabled globally or per character.                                        | `server/fastify/src/commands/modules.ts`, `src/ts/moduleCommands.ts`, `src/ts/process/modules.ts`                                                      |
| Plugin                              | Browser-executed extension record. Server stores plugin records and custom storage, but plugin runtime remains browser-side.                              | `src/ts/plugins/`, `server/fastify/src/commands/plugins.ts`                                                                                            |
| Plugin storage                      | Key/value data for plugins, command-backed on the server.                                                                                                 | `server/fastify/src/commands/pluginStorage.ts`                                                                                                         |
| Regex script                        | Regex-driven script definition attached to characters or modules; server prompt assembly processes non-interactive request/input/output/process variants. | `server/fastify/src/commands/scriptDefinitions.ts`, `server/fastify/src/prompt/scripts.ts`, `src/lib/SideBars/Scripts/`                                |
| Trigger script                      | Trigger definition attached to characters or modules; server assembly/post-generation can run non-interactive input/output trigger paths.                 | `server/fastify/src/commands/scriptDefinitions.ts`, `server/fastify/src/prompt/triggers.ts`, `src/lib/SideBars/Scripts/`                               |
| Asset                               | Content-addressed binary referenced by domain JSON and hydrated chat-message inlay tokens.                                                                | `server/fastify/src/repository.ts`, `server/fastify/src/routes/assets.ts`, `server/fastify/src/risuSave/assetReferences.ts`                            |
| `.risu` save                        | Portable export/import envelope for the repository, including block and legacy formats; bundle export can include assets.                                 | `server/fastify/src/routes/save.ts`, `server/fastify/src/risuSave/`                                                                                    |
| RisuRealm character                 | Realm-hosted character card imported server-side from dynamic JSON or `charx` packages, with fetched/packaged assets stored as content-addressed assets.  | `server/fastify/src/routes/realmImport.ts`, `server/fastify/src/realmImport/`, `src/ts/server/realmImport.ts`, `src/ts/realm.ts`                       |
| Provider secret                     | API-key/token fields masked in projections and resolved back from persisted state on writes.                                                              | `server/fastify/src/providerSecrets.ts`, `server/fastify/src/routes/bootstrap.ts`, `server/fastify/src/routes/projection.ts`                           |
| Model / `LLMModel`                  | Browser model-registry entry with provider, format, tokenizer, flags, and model id metadata.                                                              | `src/ts/model/types.ts`, `src/ts/model/modellist.ts`, `docs/structure/providers-and-models.md`                                                         |
| Custom / auxiliary / fallback model | User-defined or secondary model selection used by main chat, fallback, memory, translation, and tool flows.                                               | `src/ts/storage/database.svelte.ts`, `src/ts/model/`, `src/lib/Setting/Pages/Model/`                                                                   |
| Memory                              | Maintained Hypa V3 chunks, summaries, embeddings, and jobs in SQLite.                                                                                     | `server/fastify/src/memory*.ts`, `server/fastify/src/routes/memory*.ts`                                                                                |
| Hypa V3 data                        | Per-chat legacy-compatible memory metadata split from chat JSON into SQLite and hydrated with active chat messages.                                       | `server/fastify/src/messageStore.ts`, `server/fastify/src/routes/projection.ts`, `src/ts/server/chatMessageHydration.svelte.ts`                        |
| Memory job                          | Durable SQLite job for Hypa V3 chunk/embed/summarize work; worker claims, retries, cancels, and emits memory events.                                      | `server/fastify/src/memoryRepository.ts`, `server/fastify/src/memoryWorker.ts`, `server/fastify/src/routes/memoryJobs.ts`                              |
| Command mutation                    | Revision-checked server write that applies a command, bumps the domain revision when appropriate, and usually persists a command event.                   | `server/fastify/src/commands/mutations.ts`, `server/fastify/src/routes/commands.ts`, `src/ts/server/commands.ts`                                       |
| Command event / projection resource | Revisioned mutation event that tells clients which targeted projection slice to refresh; gaps or sprawling resources fall back to full bootstrap.         | `server/fastify/src/commands/events.ts`, `server/fastify/src/routes/projection.ts`, `src/ts/server/events.ts`                                          |
| Provider                            | Known model backend/format family. The browser registry includes more providers than the server-routable Fastify adapter set.                             | `server/fastify/src/generation/`, `server/fastify/src/prompt/chatDispatch.ts`, `src/ts/model/types.ts`, `src/ts/process/request/providerCapability.ts` |
| MCP module                          | Module-linked tool endpoint using `internal:`, `plugin:`, remote HTTP(S), or URL-wrapped `stdio:` forms; import is blocked in Fastify-backed mode today.  | `src/ts/process/mcp/`, `src/lib/Playground/PlaygroundMCP.svelte`, `src/lib/Setting/Pages/Module/ModuleSettings.svelte`                                 |

## SendChat Runtime Terms

The current Fastify docs split `sendChat` into stages:

| Stage   | Owner            | Summary                                                                                                                                                              |
| ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 0 | Browser          | UI lease, spinner, AbortSignal forwarding, SSE application.                                                                                                          |
| Stage 1 | Server           | Validate ids/mode, check expected revision, persist user row.                                                                                                        |
| Stage 2 | Server           | Assemble prompt, variables, persona, description, lorebook, memory, triggers.                                                                                        |
| Stage 3 | Server           | Provider dispatch and token/message streaming.                                                                                                                       |
| Stage 4 | Server + browser | Server owns durable output-trigger / `editoutput` derivation on the server-dispatch path; browser owns B1 effects, output-trigger resend recursion, and UI metadata. |

See [`backend.md`](backend.md) and [`frontend.md`](frontend.md) for current
generation flow details. Archived stage docs are historical design records, not
present-tense runtime guidance.

## Server Generation Terms

These name the server-owned generation machinery (most of it landed via the
client-thinning and durable-generation workstreams; design records under
[`../archive/`](../archive/README.md)).

| Term                      | Meaning                                                                                                                                                         | Primary Places                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Server prompt assembly    | Fastify path where the server assembles the prompt. A send is classified `local`, `server`, or `unsupported`; `local` is non-Fastify only.                      | `src/ts/process/request/serverPromptAssembly.ts`, `server/fastify/src/prompt/assemble.ts`                      |
| Provider capability table | Single shared classifier deciding which provider shapes the server `/chat` path can route; consumed by browser + server.                                        | `src/ts/process/request/providerCapability.ts`                                                                 |
| Server Lua VM             | wasmoon VM running non-interactive Lua hooks (`editRequest`/`editprocess`/`editinput`/input-trigger) during assembly.                                           | `server/fastify/src/prompt/luaRuntime.ts`                                                                      |
| Post-generation pass      | `runServerPostGeneration`: run-var pass + `'output'` trigger + `editoutput`, persisting the derived text + scriptstate.                                         | `server/fastify/src/prompt/assemble.ts`, `server/fastify/src/routes/generationChat.ts`                         |
| Durable generation        | Detached server job for `send`, `continue`, and `regenerate` that survives client disconnect; the server persists append/extend/replace results by mode.        | `src/ts/process/request/durableGeneration.ts`, `server/fastify/src/generationJobs.ts`                          |
| Generation job            | A detached, reattachable chat generation in `GenerationJobRegistry` (one running job per chat; reattach/cancel routes).                                         | `server/fastify/src/generationJobs.ts`, `server/fastify/src/routes/generationChat.ts`                          |
| `activeGenerationJobs`    | Transient, server-memory-only bootstrap projection (`{ chatId, jobId, mode?, regenerateMessageId? }[]`) of running durable jobs for reload-resume.              | `server/fastify/src/routes/bootstrap.ts`, `server/fastify/src/generationJobs.ts`, `src/ts/process/reattach.ts` |
| Active writer             | Single-writer submission gate (`risu-writer-session` header) enforced by a global preHandler; route ownership comes from the manifest; stale writers get `423`. | `server/fastify/src/routeManifest.ts`, `server/fastify/src/activeWriter.ts`                                    |

## Identity Rules

Public command APIs should use stable ids. Avoid array-index addressing in new
command routes or browser command helpers. Reordering commands should validate
complete id lists for the resource they reorder.

## Removed Or No-Port Concepts

Do not treat these as implementation targets unless a new roadmap explicitly
reopens them:

- Group chat.
- Peer sync and Google Drive sync.
- Risu Account Sync.
- Browser-side durable persistence as the primary runtime.
- Native/mobile wrapper modes and service worker behavior.
- SupaMemory, Hypa V2, and Hanurai as standalone maintained engines. Some legacy
  names remain in fields/classes used by the maintained Hypa V3 path.

Hypa V3 is the maintained memory engine.
