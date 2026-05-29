# Domain Glossary

The central persisted domain type is `Database` in
`src/ts/storage/database.svelte.ts`. Server command snapshots in
`src/ts/server/commands.ts` are often a cleaner index of the resources that the
API expects to mutate.

## Core Terms

| Term                | Meaning                                                                                                                        | Primary Places                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Character           | A bot/persona-like chat participant with prompts, chats, lorebooks, scripts, modules, emotion images, and settings.            | `src/ts/storage/database.svelte.ts`, `server/fastify/src/commands/characters.ts`                                                    |
| Chat                | A conversation under a character, with messages, script state, lorebook state, and metadata.                                   | `src/ts/storage/database.svelte.ts`, `server/fastify/src/commands/chats.ts`                                                         |
| Message             | A chat row. Server generation commands append, update, truncate, replace, and persist generation results.                      | `server/fastify/src/commands/messages.ts`, `routes/commands.ts`                                                                     |
| Preset / Bot preset | Provider and generation settings selected for a conversation.                                                                  | `server/fastify/src/commands/presets.ts`, `src/ts/server/commands.ts`                                                               |
| Prompt template     | Ordered prompt items such as description, persona, author note, lorebook, memory, history, and custom sections.                | `server/fastify/src/commands/prompts.ts`, `server/fastify/src/prompt/`                                                              |
| Persona             | User profile/persona state mirrored into legacy fields where needed.                                                           | `server/fastify/src/commands/personas.ts`                                                                                           |
| Loadout             | Saved selection bundle, often tying character/preset/persona/module choices together.                                          | `server/fastify/src/commands/loadouts.ts`                                                                                           |
| Lorebook            | World-info/memory-book entries, either global or attached to characters, chats, or modules.                                    | `server/fastify/src/commands/lorebooks.ts`, `server/fastify/src/prompt/lorebook.ts`                                                 |
| Module              | Reusable package of lorebooks, scripts, triggers, and configuration that can be enabled globally or per character.             | `server/fastify/src/commands/modules.ts`                                                                                            |
| Plugin              | Browser-executed extension record. Server stores plugin records and custom storage, but plugin runtime remains browser-side.   | `src/ts/plugins/`, `server/fastify/src/commands/plugins.ts`                                                                         |
| Plugin storage      | Key/value data for plugins, command-backed on the server.                                                                      | `server/fastify/src/commands/pluginStorage.ts`                                                                                      |
| Script definitions  | Custom scripts and triggers attached to characters or modules.                                                                 | `server/fastify/src/commands/scriptDefinitions.ts`, `server/fastify/src/prompt/scripts.ts`, `server/fastify/src/prompt/triggers.ts` |
| Asset               | Content-addressed binary referenced by domain JSON.                                                                            | `server/fastify/src/repository.ts`, `server/fastify/src/routes/assets.ts`                                                           |
| Memory              | Hypa V3 chunks, summaries, embeddings, and jobs in SQLite.                                                                     | `server/fastify/src/memory*.ts`, `server/fastify/src/routes/memory*.ts`                                                             |
| Provider            | Upstream model backend such as OpenAI, Anthropic, Gemini, Ollama, Kobold, Cohere, Bedrock, Horde, Mistral, or compatible APIs. | `server/fastify/src/generation/`, `server/fastify/src/prompt/chatDispatch.ts`                                                       |

## SendChat Runtime Terms

The current Fastify docs split `sendChat` into stages:

| Stage   | Owner         | Summary                                                                           |
| ------- | ------------- | --------------------------------------------------------------------------------- |
| Stage 0 | Browser       | UI lease, spinner, AbortSignal forwarding, SSE application.                       |
| Stage 1 | Server        | Validate ids/mode, check expected revision, persist user row.                     |
| Stage 2 | Server        | Assemble prompt, variables, persona, description, lorebook, memory, triggers.     |
| Stage 3 | Server        | Provider dispatch and token/message streaming.                                    |
| Stage 4 | Server + browser | Server owns durable output-trigger / `editoutput` derivation on the server-dispatch path; browser owns B1 effects, resend/auto-continue recursion, and UI metadata. |

See [`../client-thinning/runtime-stages.md`](../client-thinning/runtime-stages.md)
for the current longer version.

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
