# Backend Map

The backend is the Fastify server under `server/fastify`. It owns SQLite state,
auth, provider secrets, prompt assembly, provider dispatch, Hypa V3 memory,
imports/exports/backups, and the `/api/v1/*` route surface.

## Key Files

| Path                                                                          | Role                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                 | Process entrypoint: load config, call `buildApp()`, listen.                                              |
| `server/fastify/src/app.ts`                                                   | Composition root for plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA. |
| `server/fastify/src/config.ts`                                                | Parses `RISU_API_*`, `TRUST_PROXY`, hub/Realm URLs, static root, trace mode, and agent auth bypass.      |
| `server/fastify/src/db.ts`                                                    | SQLite schema v18, migrations, `schema_version`, global revision.                                        |
| `server/fastify/src/repository.ts`                                            | Domain repository, legacy import, projections, assets, imports/exports/backups.                          |
| `server/fastify/src/messageStore.ts`                                          | Chat `messages`, reroll alternates, and per-chat `chat_hypa_v3` rows.                                    |
| `server/fastify/src/chatGenerationSettingsStorage.ts`                         | Normalizes persisted chat-scoped generation settings on import/load.                                      |
| `server/fastify/src/databaseDefaults.ts`                                      | Server-owned first-run defaults and import normalization defaults.                                       |
| `server/fastify/src/routeManifest.ts`                                         | Source of truth for route auth, active-writer, streaming, and exceptions.                                |
| `server/fastify/src/routeRateLimits.ts`                                       | Per-route rate-limit presets.                                                                            |
| `server/fastify/src/protocolMetrics.ts`, `requestTrace.ts`                    | Opt-in protocol metrics, command table-write capture, and API request traces.                            |
| `server/fastify/src/requestAbort.ts`, `server/fastify/src/requestTimeouts.ts` | Shared abort/deadline helpers for generation and proxy lifetimes.                                        |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation behavior,
memory worker behavior, command/memory event sinks, and asset-GC behavior.

## App Wiring

`buildApp()` registers `@fastify/compress`, `@fastify/rate-limit` with
`global: false`, `@fastify/multipart`, `@fastify/websocket`, and optional
`@fastify/static`. It also installs raw parsers for supported asset content
types, uses a 600s request-receive timeout, and honors `LOG_LEVEL=silent` for
quiet logs.

Startup opens SQLite, runs legacy Hypa V3 backfill, imports legacy
`data/db.json` when present, starts the memory worker, creates command/memory
event buses, creates proxy and durable generation job registries, and starts
GC/finalization retry timers. It also calls `bootPromptVariables()` so
server-side CBS/chat-var parsing is wired before prompt assembly. When
`RISU_API_TRACE_MODE` is `agent` or `human`, request tracing adds
`X-Request-UID` and writes API traces under `data/trace/<mode>.jsonl`. `onClose`
stops workers/timers/jobs and settles generation runners before closing SQLite.

The active-writer guard is registered after health/auth/bootstrap and before
guarded routes, with route decisions driven by `routeManifest.ts`. Asset upload
routes also perform early auth/writer checks before body parsing. New routes
should be registered from `app.ts` and mirrored in `routeManifest.ts`.
Route protection is test-backed by `routeProtection.test.ts`, and runtime
active-writer enforcement uses `activeWriter.ts`.

Rate limits are opt-in per route. Current presets are setup `5/min`, login
`10/min`, auth crypto `60/min`, proxy fetch `120/min`, proxy stream-job create
`30/min`, imports `10/min`, asset upload `120/min`, bulk asset upload `30/min`,
and generation submit `60/min`.

## Route Families

| Family                | Registrars                                                | Notes                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                    | Health/status/setup/login plus authenticated bootstrap; writer-intent bootstrap latches active writer.                                                                               |
| Projection/events     | `projection.ts`, `events.ts`                              | Targeted projection, chat/lorebook hydration, bulk hydration, command/memory SSE.                                                                                                    |
| Commands              | `commands.ts` plus `commands/`                            | Revision-checked domain mutations for settings, bot/model/prompt/translator presets, prompts, personas, loadouts, characters/chats/messages, chat folders, chat generation settings, lorebooks, modules, plugins/plugin storage, scripts, triggers, generation results, compact lorebook entries, and message tails. |
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
Mutation helpers include broad, targeted, collection-scoped, single-row, and
message-aware SQLite paths; new commands should use the narrowest path that
matches their write set.

Server-owned exceptions still need explicit auth/active-writer decisions but are
not browser `/commands/*` resource endpoints. Some still reuse command mutation
helpers: server generation finalization writes through targeted command mutation
and emits `generation.persisted`. The detailed persistence contract lives in
`data-and-events.md`.

## Generation And Memory

The live chat path is server-owned. Browser `sendChat` preflights with
`resolveServerPromptAssembly()` and provider capabilities, then posts raw inputs
to `/api/v1/generate/chat`. Server prompt assembly runs supported
non-interactive Lua hooks, plans and selects memory, dispatches through
`generation/`, maps provider frames to chat SSE frames, and persists
post-generation results. Chat-scoped generation settings are preflighted and
applied through `prompt/effectiveGenerationConfig.ts`, covering model/prompt/
persona/sidebar-toggle overlays.

`/api/v1/generate/completion` is lower-level: normal browser traffic sends a
server-owned `server-intent` request with shaped messages, and the server
resolves provider/model/options/secrets from persisted settings. A legacy direct
provider envelope remains for compatibility tests/tools.

`/api/v1/generate/chat` supports durable send/continue/regenerate as the normal
client path and an inline non-durable SSE mode for tools/tests. Durable chat jobs
are in-memory in `generationJobs.ts`, emit `job_accepted`, detach on browser
disconnect, reattach at `GET /api/v1/generate/chat/:id/stream`, and cancel with
`DELETE /api/v1/generate/chat/:id`. Finalization retry attempts are queued in
SQLite, include target snapshots for stale-target protection, and are swept by
the generation finalization retry timer. Preview-prompt is a one-shot JSON
assembly route and does not dispatch a provider.

Only Hypa V3 is maintained. Legacy backfill lives in `memoryLegacyImport.ts`.
Memory storage and queueing live in `memoryRepository.ts`; planning/selection
live in `memoryPlanner.ts`, `memoryChunkPlanner.ts`,
`memorySelectionService.ts`, `memoryBudgetAllocator.ts`, and
`memorySimilarityRanking.ts`; prompt integration lives in `prompt/memory.ts`,
`prompt/memoryAdapter.ts`, and `prompt/memoryFollowups.ts`; worker fairness,
batching, and execution live in `memoryWorker.ts`, `memoryEmbedJobHandler.ts`,
and `memorySummarizeJobHandler.ts`; provider models/deadlines live in
`memoryEmbeddingModel.ts`, `memorySummaryModel.ts`, `memoryProviderDeadline.ts`,
`memoryEmbeddingAdapter.ts`, `memorySummaryAdapter.ts`, and
`memorySummaryPrompt.ts`; events/routes live in `memoryEvents.ts`,
`memoryJobs.ts`, and `memoryReads.ts`.

Prompt assembly snapshots summaries, plans new chunks/jobs, selects existing
summaries without provider calls, and enqueues follow-up summarize/embed jobs for
the worker. Provider-backed embedding/summarization work runs in the worker, not
inline on the chat hot path. `GET /api/v1/memory/jobs` is compact and ETag-backed;
chunk/summary read routes currently return full text for a chat.

## Static SPA

If `RISU_API_STATIC_ROOT` points to an existing directory, Fastify serves `/`
and non-API GET fallback from that built SPA. Built `/assets/*` files get
immutable cache headers; other static files revalidate. Empty string, `none`, or
`off` disable static serving. Non-API `GET` misses fall back to `index.html`;
`/api/*` and non-GET misses return JSON 404. Vite dev serves the SPA separately
while still running the same Fastify-backed browser runtime.
