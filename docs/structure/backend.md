# Backend Map

The backend is a Fastify server under `server/fastify`. It owns SQLite-backed
durable state, auth, provider secrets, prompt assembly, provider dispatch,
Hypa V3 memory, imports/exports/backups, and the `/api/v1/*` route surface.

## Entrypoints

| Path                               | Role                                                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`      | Loads config, calls `buildApp()`, listens on host/port.                                                                                                                                                     |
| `server/fastify/src/app.ts`        | Composition root: Fastify plugins, content parsers, SQLite open/migrations, legacy import, auth, active-writer guard, routes, workers, timers, optional static SPA.                                         |
| `server/fastify/src/config.ts`     | `RISU_API_HOST`, `RISU_API_PORT`, `RISU_API_DATA_DIR`, body/import limits, `TRUST_PROXY`, static root, hub/Realm URLs.                                                                                      |
| `server/fastify/src/db.ts`         | SQLite schema v15, migrations, schema version, domain revision, memory/message/event/finalization retry tables.                                                                                             |
| `server/fastify/src/repository.ts` | Current domain repository over SQLite table families; imports legacy `db.json` into SQLite and renames it to `db.json.migrated`; owns asset metadata, backups/restores, projections, import/export helpers. |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation behavior,
memory worker behavior, command/memory event sinks, and asset-GC behavior.

## App Wiring

`buildApp()` registers:

- Fastify plugins: `@fastify/rate-limit` with `global: false`,
  `@fastify/multipart`, `@fastify/websocket`, and optional `@fastify/static`.
- A global raw buffer parser for supported asset content types. Proxy/binary
  passthrough routes still install their own scoped parser behavior.
- SQLite startup work: `openDatabase()`, legacy Hypa V3 backfill from hydrated
  data, then `ensureDbJsonImported()` for one-time legacy `data/db.json` import.
- Process-local registries: command subscribers, memory event bus, proxy stream
  jobs, durable chat generation jobs.
- Timers: stream/generation job GC, durable generation finalization retry sweep,
  periodic asset GC.
- Runtime bounds: 600s request-receive timeout, bounded SSE/raw write buffers,
  and request-abort helpers for generation/proxy flows.
- The active-writer `preHandler`, registered after bootstrap/auth and before
  server-owned mutation routes.
- `onClose` cleanup for memory worker, timers, job registries, and SQLite.

## Route Surface

Routes are registered directly from `server/fastify/src/app.ts`. Route handlers
call `requireAuth()` manually unless intentionally public. Add or change a route
only after updating `server/fastify/src/routeManifest.ts`; route-protection
tests and the architecture audit read that manifest.

| Family                | Registrar                                                 | Notes                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                    | Health/status/setup/login plus authenticated bootstrap. Writer-intent bootstrap latches the active writer.                                                                                                          |
| Projection/events     | `projection.ts`, `events.ts`                              | Targeted projection, chat/lorebook hydration, bulk hydration, command/memory SSE.                                                                                                                                   |
| Commands              | `commands.ts` plus `commands/`                            | Revision-checked resource mutations for settings, presets, prompts, personas, translators, loadouts, characters/chats/messages, lorebooks, modules, plugins, plugin storage, scripts, triggers, generation results. |
| Assets/saves/backups  | `assets.ts`, `save.ts`, `realmImport.ts`, `backups.ts`    | Content-addressed assets, `.risu` and bundle import/export, Realm import, on-server snapshots.                                                                                                                      |
| Proxy/hub/storage     | `proxy.ts`, `streamJobs.ts`, `hub.ts`, `legacyStorage.ts` | Authenticated proxy/fetch and stream jobs, retained hub passthrough, current `/api/v1/storage/*` compatibility byte store.                                                                                          |
| Generation            | `generation.ts`, `generationChat.ts`                      | Lower-level completion route, server-assembled chat generation, preview-prompt, durable reattach/cancel.                                                                                                            |
| Memory                | `memoryJobs.ts`, `memoryReads.ts`                         | Queue/cancel/list jobs plus read chunks/summaries.                                                                                                                                                                  |

Public exceptions include health, auth status/setup/login, `/api/v1/auth/crypto`,
immutable asset reads, asset existence probes, and hub `GET`/`HEAD`/`OPTIONS`
when no upstream override header is used. Rate-limit presets live in
`server/fastify/src/routeRateLimits.ts`.

## Domain Mutations

The current domain store is SQLite, not live `data/db.json`.

- Settings live in `settings`.
- Characters and chats live in `characters` and `chats`.
- Collections live in `modules`, `plugins`, `bot_presets`, `prompt_templates`,
  `personas`, `loadouts`, `lore_books`, `translator_presets`,
  `hypa_v3_presets`, and `plugin_custom_storage`.
- Asset metadata lives in `assets`; bytes live under `data/assets/`.
- Chat rows live in `messages`; per-chat `hypaV3Data` lives in `chat_hypa_v3`;
  reroll alternates are alternate rows in `messages`.
- Memory jobs/chunks/summaries/embeddings and command-event replay history are
  also SQLite tables.
- Durable-generation finalization retry rows live in SQLite and are swept by
  `generationFinalizationRetry.ts` / `generationChat.ts`.

Command mutations go through helpers in `server/fastify/src/commands/mutations.ts`:

- Read and validate `baseRevision`.
- Load the relevant SQLite-backed database shape.
- Mutate through resource validators in `server/fastify/src/commands/`.
- Write changed SQLite table families inside one transaction.
- Bump the domain revision, persist one command event, commit, then emit the
  live event.

`POST /api/v1/commands/state/initialize` is the first-run exception. It creates
server-owned default state and does not accept a browser-provided database.

## Generation

The live chat path is server-owned:

1. Browser `sendChat` preflights with `resolveServerPromptAssembly()` and the
   shared provider-capability table in `src/ts/process/request/`.
2. Supported sends POST raw inputs to `/api/v1/generate/chat`; unsupported shapes
   hard-fail instead of falling back to browser-local assembly.
3. `server/fastify/src/prompt/assemble.ts` builds the prompt, runs non-interactive
   Lua hooks through `prompt/luaRuntime.ts`, persists assembly-time side effects,
   and selects memory.
4. `prompt/chatDispatch.ts` resolves provider settings/secrets and dispatches
   through adapters in `server/fastify/src/generation/`.
5. `prompt/providerTransport.ts` maps provider frames to chat SSE frames.
6. `runServerPostGeneration()` runs output-trigger/editoutput derivation and the
   server persists the final result for server-dispatch paths.

`/api/v1/generate/completion` is lower-level: the browser sends server intent
with already-shaped messages and no provider-wire credentials; the server resolves
provider/model/options/secrets from persisted settings.

Durable generation (`body.durable === true` for supported send/continue/regenerate)
uses `server/fastify/src/generationJobs.ts`. The request viewer can detach while
the job keeps running; `GET /api/v1/generate/chat/:id/stream` reattaches and
`DELETE /api/v1/generate/chat/:id` cancels. Persist failures queue rows in
`generation_finalization_retries` for retry sweeps.

## Memory

Only Hypa V3 is maintained. Core files:

- `memoryRepository.ts`, `memoryWorker.ts`, `memoryEvents.ts`
- `memoryPlanner.ts`, `memoryChunkPlanner.ts`
- `memorySelectionService.ts`, `memoryBudgetAllocator.ts`,
  `memorySimilarityRanking.ts`
- `memoryEmbedJobHandler.ts`, `memorySummarizeJobHandler.ts`
- `memoryEmbedding*`, `memorySummary*`, `memoryLegacyImport.ts`

Prompt assembly can select existing memory, clean orphaned prompt-memory rows,
plan missing chunks, and enqueue follow-up embed/summarize jobs. Provider-backed
embedding/summarization work runs in the worker, not inline on the chat hot path.

## Static SPA Serving

If `RISU_API_STATIC_ROOT` points to an existing directory, Fastify serves `/`
and non-API GET fallback from that built SPA. Empty string, `none`, or `off`
disable static serving. Vite dev serves the SPA separately but still runs the
same Fastify-backed browser runtime.
