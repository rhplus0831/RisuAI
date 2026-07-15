# Backend Map

Last audited: 2026-07-14.

The backend is the Fastify server under `server/fastify`. It owns SQLite state,
auth, provider secrets, prompt assembly, provider dispatch, Hypa V3 memory,
imports/exports/backups, and the `/api/v1/*` route surface.

## Key Files

| Path                                                                          | Role                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                 | Process entrypoint: load config, call `buildApp()`, listen, handle shutdown signals.                     |
| `server/fastify/src/app.ts`                                                   | Composition root for plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA. |
| `server/fastify/src/config.ts`                                                | Parses `RISU_API_*`, `TRUST_PROXY`, hub/Realm URLs, static root, trace mode, and agent auth bypass.      |
| `server/fastify/src/db.ts`                                                    | SQLite schema v22, migrations, `schema_version`, global revision; v22 removes the retired projection body-cache tables. |
| `server/fastify/src/repository.ts`                                            | Broad/scoped/exact domain loaders, REST resource/hydration readers, targeted row/table writers, legacy `db.json` import, `applyImport`, assets, backups. |
| `server/fastify/src/messageStore.ts`                                          | Chat `messages`, reroll alternates, and per-chat `chat_hypa_v3` rows.                                    |
| `server/fastify/src/chatGenerationSettingsStorage.ts`                         | Normalizes persisted chat-scoped generation settings on import/load.                                      |
| `server/fastify/src/databaseDefaults.ts`                                      | Server-owned first-run defaults and import normalization defaults.                                       |
| `server/fastify/src/routes/resourceReads.ts`                                  | Authenticated settings/collection/character REST resources plus lazy chat, lorebook, legacy-preset, and prompt-template hydration reads. |
| `server/fastify/src/commands/mutations.ts`, `commands/events.ts`               | Revision-checked transaction lanes, durable command-event catalog/history, and live event fanout.        |
| `server/fastify/src/auth.ts`, `http.ts`, `activeWriter.ts`, `providerSecrets.ts` | Single-user auth/session helpers, route auth assertion, active-writer guard, secret masking/resolution. |
| `server/fastify/src/routeManifest.ts`                                         | Source of truth for route auth, active-writer, streaming, and exception classifications.                  |
| `server/fastify/src/routeRateLimits.ts`                                       | Per-route rate-limit presets.                                                                            |
| `server/fastify/src/protocolMetrics.ts`, `requestTrace.ts`                    | Opt-in protocol metrics, command table-write capture, and API request traces.                            |
| `server/fastify/src/generationJobs.ts`, `generationFinalizationRetry.ts`      | Process-local durable chat jobs, replay/reattach state, and SQLite-backed finalization retry rows.        |
| `server/fastify/src/messageTranslationJobs.ts`                                | Process-local active raw-message translation registry exposed through runtime bootstrap.                  |
| `server/fastify/src/translation/`                                             | Raw message translation provider dispatch for Google, DeepL, DeepLX, and LLM translation.                 |
| `server/fastify/src/pushNotifications.ts`                                     | Web Push VAPID key loading/generation, subscription persistence, and best-effort completion pushes.       |
| `server/fastify/src/assetGc.ts`                                               | Periodic reference-counted asset garbage collection.                                                     |
| `server/fastify/src/streamJobs.ts`, `streamBackpressure.ts`                   | Process-local proxy stream jobs and bounded stream writes for slow clients.                              |
| `server/fastify/src/requestAbort.ts`, `server/fastify/src/requestTimeouts.ts` | Generation abort propagation and proxy/stream-job timeout constants.                                      |
| `server/fastify/src/risuSave/`                                                | `.risu`, bundle, local-backup, bounded-inflate, and asset-report codecs wired by save routes.            |
| `server/fastify/src/realmImport/`                                             | Realm dynamic-card/`charx` conversion helpers used by Realm import routes.                               |
| `server/fastify/src/prompt/agentPresetExecution.ts`, `src/ts/agentPresetReferences.ts` | Prepared-input and named-output-CBS Agent Preset prompting, shared reference expansion, provider dispatch, phase execution, failure handling, and diagnostics. |
| `server/fastify/src/commands/agentPresets.ts`                                 | Revisioned Agent Preset create/update/duplicate/delete/reorder/default/step commands and delete cleanup. |
| `server/fastify/src/prompt/luaPostGenerationProgress.ts`                      | Live post-generation Lua progress frames for long `editOutput` / `onOutput` runs.                        |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation chat
behavior, including provider dispatch, push notification service, viewer
heartbeat cadence, and finalization retry options; Realm import limits; memory
worker behavior; command/memory event sinks; and asset-GC behavior. Config
parsing also includes streamed device-backup import limits and generation trace
sidecar controls.

## App Wiring

`buildApp()` registers `@fastify/compress`, `@fastify/rate-limit` with
`global: false`, `@fastify/multipart`, `@fastify/websocket`, and optional
`@fastify/static`. It also installs raw parsers for supported asset content
types, uses a 600s request-receive timeout, and honors `LOG_LEVEL=silent` for
quiet logs.

Startup opens SQLite, runs legacy Hypa V3 backfill, imports legacy
`data/db.json` when present, starts the memory worker, creates command/memory
event buses, creates proxy, durable generation, and message-translation
registries, and starts GC/finalization retry timers. The proxy stream and
durable-generation registries share a GC tick, asset GC is optional, and the
generation finalization retry sweep runs once on startup then on a default 5s
interval while also pruning retained terminal retry rows. Startup also calls
`bootPromptVariables()` so server-side CBS/chat-var parsing is wired before
prompt assembly. When `RISU_API_TRACE_MODE` is `agent` or `human`, request
tracing adds `X-Request-UID` and writes API traces under
`data/trace/<mode>.jsonl` while keeping the newest 5,000 entries per mode. The
startup push service loads or generates VAPID keys before push routes accept
subscriptions.
Optional generation trace sidecars write redacted prompt payloads under
`data/trace/generation/` only when protocol metrics and
`RISU_GENERATION_TRACE_FULL_PROMPT=1` are enabled. Post-generation Lua flow
diagnostics also use protocol metrics: `generation_lua_post_generation_trace`
records metadata for `editOutput`/`onOutput` runs and links a compressed
`bodySidecar` with chat/completion before-after bodies under
`data/trace/generation/`. `onClose` stops
workers/timers/jobs and settles generation runners before closing SQLite.

The active-writer guard is registered after health/auth/bootstrap and before
guarded routes, with route decisions driven by `routeManifest.ts`. Asset upload
routes also perform early auth/writer checks before body parsing. New routes
should be registered from `app.ts` and mirrored in `routeManifest.ts`.
Route protection is test-backed by
`server/fastify/__tests__/routeProtection.test.ts`, which derives live routes
from `app.printRoutes()` and checks every `/api/v1/*` route has a manifest
decision. Runtime active-writer enforcement uses `activeWriter.ts`: before any
writer is latched, guarded mutations are allowed; after a writer-intent
bootstrap latches ownership, stale or missing writer sessions receive
`423 active_writer_stale`.

Rate limits are opt-in per route. Current presets are setup `5/min`, login
`10/min`, auth crypto `60/min`, proxy fetch `120/min`, proxy stream-job create
`30/min`, imports `10/min`, asset upload `120/min`, bulk asset upload `30/min`,
and generation submit `60/min`.

## Route Families

| Family                | Registrars                                                | Notes                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                    | Health/status/setup/login plus authenticated runtime-only bootstrap; writer intent latches the active writer, while the response carries initialization/revision/schema metadata and active generation/translation jobs. |
| Resources/events      | `resourceReads.ts`, `events.ts`                            | Root and targeted REST resources, lazy/bulk chat/lorebook/preset hydration, replayable command SSE, and live memory SSE.                                                             |
| Commands              | `commands.ts` plus `commands/`                            | First-run initialization plus revision-checked domain mutations for settings, profiles/presets, personas/loadouts, characters/chats/messages, lorebooks, modules/plugins, definitions, and generation results. Hot paths accept sparse object/row/definition patches and return compact canonical or digest-backed receipts when the browser can acknowledge its optimistic state safely. |
| Assets/saves/backups  | `assets.ts`, `save.ts`, `realmImport.ts`, `backups.ts`    | Content-addressed assets, `.risu`/bundle/local-backup import/export, Realm import, snapshots.                                                                                        |
| Push notifications    | `pushNotifications.ts`                                    | Web Push VAPID public-key lookup plus authenticated subscription create/delete routes; durable subscriptions live in SQLite while generated VAPID keys live in `data/__web_push_vapid_keys.json`. |
| Provider/runtime ops  | `providerOperations.ts`, `tts.ts`, `proxy.ts`, `streamJobs.ts`, `hub.ts`, `legacyStorage.ts` | Fixed authenticated provider metadata and bounded TTS synthesis, generic proxy/stream jobs, retained hub passthrough, `/api/v1/storage/*` compatibility bytes, and the public auth crypto helper. |
| Generation            | `generation.ts`, `generationChat.ts`                      | Completion route, server-assembled chat generation, preview prompt, internal chat generation settings/profile/Agent Preset readiness preflight, durable reattach/cancel.             |
| Memory                | `memoryJobs.ts`, `memoryReads.ts`                         | Queue/cancel/list jobs plus chunk/summary reads and active-writer summary edit/delete routes.                                                                                         |

`routeManifest.ts` classifies auth, active-writer, and streaming decisions;
it is not a literal endpoint inventory because command and hub routes are
classified by prefixes. Some registrars use plugin-local `instance.*` methods,
so use `app.printRoutes()` for route inventory audits. Manifest streaming types
include `sse`, `sse-optional`, `binary`, `websocket`, and `proxy`.
There is no generated OpenAPI/Swagger artifact or generated browser API client;
request/response contracts live in route handlers, TypeScript types, and the
hand-written browser adapters under `src/ts/server/` and
`src/ts/process/request/`.

Handlers call `requireAuth()` unless intentionally public. Public exceptions are
health, auth status/setup/login, `/api/v1/auth/crypto`, immutable asset reads,
asset existence probes, `GET /api/v1/push/vapid-public-key`, and hub
`GET`/`HEAD`/`OPTIONS` when no upstream override header is used.

## Mutations And Events

Normal domain writes go through `server/fastify/src/commands/mutations.ts`:
check `baseRevision`, load the needed domain shape, validate/mutate through
`server/fastify/src/commands/`, write changed SQLite table families in one
transaction, bump the revision once, persist one command event, then emit it.
Mutation helpers include broad, targeted, settings-scoped,
collection-scoped, chat/character-scoped, single-row, skip-load, and
message-aware SQLite paths. New commands should use the narrowest path that
matches their write set. Protocol metrics can capture table-write summaries for
command mutation budget tests and debugging.

Scoped loaders read only the settings row, named collections, or one
character/chat owner needed by a command and fall back to the broad loader for
legacy or pre-extraction shapes. Scoped snapshots cannot be written back as a
whole database. The repository writer kit updates the owning settings,
collection, character, chat, or plugin-storage rows, while the message-store
writers update transcript rows inside the same transaction. Exact
character/chat variants preserve every unrelated persisted field, and row-level
updates keep unrelated rowids stable.

High-frequency commands can send changed fields plus explicit delete keys, or a
single create/update/delete/reorder definition mutation, instead of resending a
whole object or collection. Responses name accepted keys and include only
canonical overrides/deletions, or return a digest/certificate proving that the
server applied the same sparse transition. The browser uses those receipts only
for a matching next-revision event and fenced optimistic snapshot; otherwise it
falls back to the event's authoritative REST-resource read.

Server-owned exceptions still need explicit auth/active-writer decisions but are
not browser `/commands/*` resource endpoints. Some still reuse command mutation
helpers: server generation finalization writes through targeted command mutation
and emits `generation.persisted`. The detailed persistence contract lives in
`data-and-events.md`.

## Generation And Memory

The live chat path is server-owned. Browser `sendChat` preflights with
`resolveServerPromptAssembly()` and resolved model-profile provider capability,
then posts raw inputs to `/api/v1/generate/chat`. Server prompt assembly runs
supported non-interactive Lua hooks, resolves the chat-scoped Agent Preset when
one is selected, runs before-main Agent Preset steps after submit transforms,
then plans and selects memory, dispatches through `generation/`, and maps
provider frames to chat SSE frames through `prompt/providerTransport.ts`.
Selected prepared-input scopes are collected only when a step instruction uses
the matching placeholder, such as `{{currentUserMessage}}`; `mainDraft` is
after-main-only. A single last enabled before-main `userInput` destination can
replace and persist the latest user message before the main prompt is assembled,
parallel to the single last enabled after-main `finalOutput` modifier. Successful
outputs can feed eligible later step instructions through
`{{agent::outputKey}}`, while before-main `promptOutput` destinations also expand
in the main prompt template. A before-main consumer can use only an earlier
before-main dependency level; an after-main consumer can use completed
before-main outputs and earlier after-main levels. Missing, disabled, self,
same-level, or future output references classify the preset as `incomplete` and
block generation. Successful streams run server post-generation before terminal
`done`; after-main Agent Preset steps run after `editOutput` and before
assistant-row persistence/run-vars/`onOutput`. Hidden Agent Preset diagnostics
are stored under `generationInfo.agentPreset`, and required after-main failures
surface as structured
`done.postGeneration.agentPresetError`. Live before-main and after-main helper
status is streamed through `agent_preset_progress` snapshots with phase-local
completed/total counts and active step names; durable replay keeps only the
newest snapshot. `done.postGeneration` carries the final text,
`messagePatch`, `resendChat`, and revision that the browser applies in
`applyServerBackedTerminal()`. Post-generation `editOutput`/`onOutput` Lua
progress emits `post_generation_progress` SSE frames through
`prompt/luaPostGenerationProgress.ts`; diagnostics are collected by
`prompt/luaPostGenerationTrace.ts`, `prompt/luaRuntime.ts`, and
`routes/generationChat.ts` when `RISU_PROTOCOL_METRICS=1`. Chat-scoped
generation settings are preflighted and applied through
`prompt/effectiveGenerationConfig.ts`, covering model/prompt/persona selection,
Agent Preset readiness, prompt-preset module integration, jailbreak state,
sidebar-toggle materialization, and profile-bound runtime overlays.

`/api/v1/generate/completion` is lower-level: normal browser traffic sends a
server-owned `server-intent` request with shaped messages, and the server
resolves provider/model/options/secrets from persisted settings. A legacy direct
provider envelope remains for compatibility tests/tools, still using the current
provider adapters and each adapter's direct-streaming limits.

`/api/v1/generate/chat` supports durable send/continue/regenerate as the normal
client path and an inline non-durable SSE mode for tools/tests. Durable chat jobs
are in-memory in `generationJobs.ts`, emit `job_accepted`, detach on browser
disconnect, reattach at `GET /api/v1/generate/chat/:id/stream`, and cancel with
`DELETE /api/v1/generate/chat/:id`. Finalization retry attempts are queued in
SQLite with pending/terminal status, include target snapshots for stale-target
protection and idempotency, and are swept by the generation finalization retry
timer. Preview-prompt is a one-shot JSON
assembly route and does not dispatch a provider.
Negotiated client capabilities can reduce persisted-mode prompt events to
metadata and let an inline, non-replayable stream omit `done.result` when prior
token frames already delivered the same non-empty completion. Durable jobs keep
the terminal result so replay and reattach remain self-contained.

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
chunk/summary read routes return full text for a chat. Authenticated active
writers can edit summary text/Important/category/tag metadata or delete a
summary through `PATCH`/`DELETE /api/v1/memory/summaries/:summaryId`; the Hypa
V3 manager reads and mutates these server-owned rows directly.

## Static SPA

`RISU_API_STATIC_ROOT` defaults to `<repo>/dist`. If it points to an existing
directory, Fastify serves `/` and non-API GET fallback from that built SPA.
Built `/assets/*` files get immutable cache headers; other static files
revalidate. Empty string, `none`, or `off` disable static serving. Non-API
`GET` misses fall back to `index.html`; `/api/*` and non-GET misses return JSON
404. Vite dev serves the SPA separately while still running the same
Fastify-backed browser runtime.
