# Backend Map

The backend is the Fastify server under `server/fastify`. It owns SQLite state,
auth, provider secrets, prompt assembly, provider dispatch, Hypa V3 memory,
imports/exports/backups, and the `/api/v1/*` route surface.

## Key Files

| Path                                                                          | Role                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                 | Process entrypoint: load config, call `buildApp()`, listen.                                              |
| `server/fastify/src/app.ts`                                                   | Composition root for plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA. |
| `server/fastify/src/config.ts`                                                | Parses `RISU_API_*`, `TRUST_PROXY`, hub/Realm URLs, and static root.                                     |
| `server/fastify/src/db.ts`                                                    | SQLite schema v15, migrations, `schema_version`, global revision.                                        |
| `server/fastify/src/repository.ts`                                            | Domain repository, legacy import, projections, assets, imports/exports/backups.                          |
| `server/fastify/src/messageStore.ts`                                          | Chat `messages`, reroll alternates, and per-chat `chat_hypa_v3` rows.                                    |
| `server/fastify/src/databaseDefaults.ts`                                      | Server-owned first-run defaults and import normalization defaults.                                       |
| `server/fastify/src/routeManifest.ts`                                         | Source of truth for route auth, active-writer, streaming, and exceptions.                                |
| `server/fastify/src/routeRateLimits.ts`                                       | Per-route rate-limit presets.                                                                            |
| `server/fastify/src/protocolMetrics.ts`                                       | Opt-in protocol metrics and command table-write capture.                                                 |
| `server/fastify/src/requestAbort.ts`, `server/fastify/src/requestTimeouts.ts` | Shared abort/deadline helpers for generation and proxy lifetimes.                                        |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation behavior,
memory worker behavior, command/memory event sinks, and asset-GC behavior.

## App Wiring

`buildApp()` registers `@fastify/compress`, `@fastify/rate-limit` with
`global: false`, `@fastify/multipart`, `@fastify/websocket`, and optional
`@fastify/static`. It also installs raw parsers for supported asset content
types.

Startup opens SQLite, runs legacy Hypa V3 backfill, imports legacy
`data/db.json` when present, starts the memory worker, creates command/memory
event buses, creates proxy and durable generation job registries, and starts
GC/finalization retry timers. `onClose` stops workers/timers/jobs and settles
generation runners before closing SQLite.

The active-writer guard is registered after health/auth/bootstrap and before
guarded routes. New routes should be registered from `app.ts` and mirrored in
`routeManifest.ts`.

## Route Families

| Family                | Registrars                                                | Notes                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                    | Health/status/setup/login plus authenticated bootstrap; writer-intent bootstrap latches active writer.                                                                               |
| Projection/events     | `projection.ts`, `events.ts`                              | Targeted projection, chat/lorebook hydration, bulk hydration, command/memory SSE.                                                                                                    |
| Commands              | `commands.ts` plus `commands/`                            | Revision-checked domain mutations for settings, presets, prompts, personas, loadouts, characters/chats/messages, lorebooks, modules, plugins, scripts, triggers, generation results. |
| Assets/saves/backups  | `assets.ts`, `save.ts`, `realmImport.ts`, `backups.ts`    | Content-addressed assets, `.risu` and bundle import/export, Realm import, snapshots.                                                                                                 |
| Proxy/hub/storage     | `proxy.ts`, `streamJobs.ts`, `hub.ts`, `legacyStorage.ts` | Authenticated proxy/fetch and stream jobs, retained hub passthrough, `/api/v1/storage/*` compatibility byte store.                                                                   |
| Generation            | `generation.ts`, `generationChat.ts`                      | Completion route, server-assembled chat generation, preview prompt, durable reattach/cancel.                                                                                         |
| Memory                | `memoryJobs.ts`, `memoryReads.ts`                         | Queue/cancel/list jobs plus read chunks/summaries.                                                                                                                                   |

Handlers call `requireAuth()` unless intentionally public. Public exceptions are
health, auth status/setup/login, `/api/v1/auth/crypto`, immutable asset reads,
asset existence probes, and hub `GET`/`HEAD`/`OPTIONS` when no upstream override
header is used.

## Mutations And Events

Normal domain writes go through `server/fastify/src/commands/mutations.ts`:
check `baseRevision`, load the needed domain shape, validate/mutate through
`server/fastify/src/commands/`, write changed SQLite table families in one
transaction, bump the revision once, persist one command event, then emit it.

Server-owned exceptions still need explicit auth/active-writer decisions but are
not browser `/commands/*` resource endpoints. Some still reuse command mutation
helpers: server generation finalization writes through targeted command mutation
and emits `generation.persisted`. The detailed persistence contract lives in
`data-and-events.md`.

## Generation And Memory

The live chat path is server-owned. Browser `sendChat` preflights with
`resolveServerPromptAssembly()` and provider capabilities, then posts raw inputs
to `/api/v1/generate/chat`. Server prompt assembly runs supported
non-interactive Lua hooks, selects memory, dispatches through `generation/`,
maps provider frames to chat SSE frames, and persists post-generation results.

`/api/v1/generate/completion` is lower-level: the browser sends shaped messages
and server intent; the server resolves provider/model/options/secrets from
persisted settings. Durable chat jobs live in `generationJobs.ts`, reattach at
`GET /api/v1/generate/chat/:id/stream`, and cancel with
`DELETE /api/v1/generate/chat/:id`.

Only Hypa V3 is maintained. Core memory files are `memoryRepository.ts`,
`memoryWorker.ts`, `memoryEvents.ts`, `memoryPlanner.ts`,
`memoryChunkPlanner.ts`, `memorySelectionService.ts`,
`memoryBudgetAllocator.ts`, `memorySimilarityRanking.ts`,
`memoryEmbedJobHandler.ts`, `memorySummarizeJobHandler.ts`, and the
embedding/summary helpers. Provider-backed embedding/summarization work runs in
the worker, not inline on the chat hot path.

## Static SPA

If `RISU_API_STATIC_ROOT` points to an existing directory, Fastify serves `/`
and non-API GET fallback from that built SPA. Empty string, `none`, or `off`
disable static serving. Vite dev serves the SPA separately while still running
the same Fastify-backed browser runtime.
