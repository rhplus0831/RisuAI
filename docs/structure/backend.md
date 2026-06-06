# Backend Map

The backend is the Fastify server under `server/fastify`. It owns SQLite state,
auth, provider secrets, prompt assembly, provider dispatch, Hypa V3 memory,
imports/exports/backups, and the `/api/v1/*` route surface.

## Entrypoints

| Path                                                                          | Role                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                 | Loads config, calls `buildApp()`, listens on host/port.                                                  |
| `server/fastify/src/app.ts`                                                   | Composition root for plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA. |
| `server/fastify/src/config.ts`                                                | Parses `RISU_API_*`, `TRUST_PROXY`, hub/Realm URLs, and static root.                                     |
| `server/fastify/src/db.ts`                                                    | SQLite schema v15, migrations, schema version, global revision.                                          |
| `server/fastify/src/repository.ts`                                            | SQLite-backed domain repository, legacy import, asset metadata, projections, imports/exports/backups.    |
| `server/fastify/src/messageStore.ts`                                          | `messages`, reroll alternates, and per-chat `chat_hypa_v3` storage.                                      |
| `server/fastify/src/databaseDefaults.ts`                                      | Server-owned first-run defaults and import normalization defaults.                                       |
| `server/fastify/src/routeManifest.ts`                                         | Source of truth for route auth, active-writer, streaming, and public/read-only exceptions.               |
| `server/fastify/src/routeRateLimits.ts`                                       | Per-route rate-limit presets.                                                                            |
| `server/fastify/src/protocolMetrics.ts`                                       | Opt-in protocol metrics and command mutation table-write capture.                                        |
| `server/fastify/src/requestAbort.ts`, `server/fastify/src/requestTimeouts.ts` | Shared request abort/deadline helpers for generation and proxy lifetimes.                                |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation behavior,
memory worker behavior, command/memory event sinks, and asset-GC behavior.

## App Wiring

`buildApp()` registers `@fastify/rate-limit` with `global: false`,
`@fastify/multipart`, `@fastify/websocket`, and optional `@fastify/static`.
It also installs raw parsers for supported asset content types.

Startup opens SQLite, runs legacy Hypa V3 backfill, imports legacy `data/db.json`
when present, starts the memory worker, creates command/memory event buses,
creates proxy and durable generation job registries, and starts GC/finalization
retry timers. The active-writer guard is registered after bootstrap/auth and
before guarded mutation routes. `onClose` stops workers/timers/jobs before
closing SQLite.

## Route Surface

Routes are registered directly from `app.ts`. Handlers call `requireAuth()`
unless intentionally public. Add or change a route only after updating
`routeManifest.ts`; route-protection tests and the architecture audit read it.

| Family                | Registrar                                                 | Notes                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                    | Health/status/setup/login plus authenticated bootstrap. Writer-intent bootstrap latches the active writer.                                                                                             |
| Projection/events     | `projection.ts`, `events.ts`                              | Targeted projection, chat/lorebook hydration, bulk hydration, command/memory SSE.                                                                                                                      |
| Commands              | `commands.ts` plus `commands/`                            | Revision-checked resource mutations for settings, presets, prompts, personas, loadouts, characters/chats/messages, lorebooks, modules, plugins, plugin storage, scripts, triggers, generation results. |
| Assets/saves/backups  | `assets.ts`, `save.ts`, `realmImport.ts`, `backups.ts`    | Content-addressed assets, `.risu` and bundle import/export, Realm import, snapshots.                                                                                                                   |
| Proxy/hub/storage     | `proxy.ts`, `streamJobs.ts`, `hub.ts`, `legacyStorage.ts` | Authenticated proxy/fetch and stream jobs, retained hub passthrough, `/api/v1/storage/*` compatibility byte store.                                                                                     |
| Generation            | `generation.ts`, `generationChat.ts`                      | Lower-level completion route, server-assembled chat generation, preview prompt, durable reattach/cancel.                                                                                               |
| Memory                | `memoryJobs.ts`, `memoryReads.ts`                         | Queue/cancel/list jobs plus read chunks/summaries.                                                                                                                                                     |

Public exceptions include health, auth status/setup/login, `/api/v1/auth/crypto`,
immutable asset reads, asset existence probes, and hub `GET`/`HEAD`/`OPTIONS`
when no upstream override header is used.

## Mutation Path

Normal domain writes go through `server/fastify/src/commands/mutations.ts`:
read `baseRevision`, compare with the SQLite revision, load the needed domain
shape, validate/mutate through `server/fastify/src/commands/`, write changed
SQLite table families in one transaction, bump the revision, persist one command
event, commit, then emit the live event.

Keep the detailed SQLite/revision contract in `data-and-events.md`. Server-owned
exceptions include first-run initialize, import/restore, asset upload, Realm
import, generation result persistence, backup mutations, and memory job
create/cancel.

## Generation

The live chat path is server-owned:

1. Browser `sendChat` preflights with `resolveServerPromptAssembly()` and the
   shared provider capability table.
2. Supported sends POST raw inputs to `/api/v1/generate/chat`; unsupported shapes
   hard-fail.
3. `prompt/assemble.ts` builds prompts, runs supported non-interactive Lua hooks,
   persists assembly-time side effects, and selects memory.
4. `prompt/chatDispatch.ts` resolves provider settings/secrets and dispatches
   through adapters in `generation/`.
5. `prompt/providerTransport.ts` maps provider frames to chat SSE frames.
6. Post-generation derivation runs server-side and persists the final result for
   server-dispatch paths.

`/api/v1/generate/completion` is lower-level: the browser sends shaped messages
and server intent; the server resolves provider/model/options/secrets from
persisted settings. Durable chat generation uses `generationJobs.ts`, reattaches
through `GET /api/v1/generate/chat/:id/stream`, and cancels with
`DELETE /api/v1/generate/chat/:id`.

## Memory

Only Hypa V3 is maintained. Core files are `memoryRepository.ts`,
`memoryWorker.ts`, `memoryEvents.ts`, `memoryPlanner.ts`,
`memoryChunkPlanner.ts`, `memorySelectionService.ts`,
`memoryBudgetAllocator.ts`, `memorySimilarityRanking.ts`,
`memoryEmbedJobHandler.ts`, `memorySummarizeJobHandler.ts`, and the
`memoryEmbedding*` / `memorySummary*` helpers.

Prompt assembly can select existing memory, clean orphaned prompt-memory rows,
plan missing chunks, and enqueue follow-up embed/summarize jobs. Provider-backed
embedding/summarization work runs in the worker, not inline on the chat hot path.

## Static SPA

If `RISU_API_STATIC_ROOT` points to an existing directory, Fastify serves `/` and
non-API GET fallback from that built SPA. Empty string, `none`, or `off` disable
static serving. Vite dev serves the SPA separately while still running the same
Fastify-backed browser runtime.
