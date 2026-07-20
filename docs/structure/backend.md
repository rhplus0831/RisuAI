# Backend Map

Last audited: 2026-07-20.

The backend is the Fastify server under `server/fastify`. It owns SQLite state,
auth, provider secrets, prompt assembly, provider dispatch, Hypa V3 memory,
imports/exports/backups, and the `/api/v1/*` route surface.

## Key Files

| Path                                                                                    | Role                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                           | Process entrypoint: load config, call `buildApp()`, listen, handle shutdown signals.                                                                                                  |
| `server/fastify/src/app.ts`                                                             | Composition root for plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA.                                                                              |
| `server/fastify/src/config.ts`                                                          | Parses `RISU_API_*`, `TRUST_PROXY`, hub/Realm URLs, static root, trace mode, and agent auth bypass.                                                                                   |
| `server/fastify/src/db.ts`, `databaseLineage.ts`, `commandMutationReceipts.ts`          | SQLite schema v26, migrations, `schema_version`, global revision, durable command-mutation receipts, database lineage, receipt acknowledgements, and durable writer ownership/epochs. |
| `server/fastify/src/databaseDefaults.ts`                                                | Canonical first-run and import-normalization defaults; keep persisted setting groups aligned with the browser ownership map and parity test.                                          |
| `server/fastify/src/repository.ts`                                                      | Broad/scoped/exact domain loaders, REST resource/hydration readers, targeted row/table writers, legacy `db.json` import, `applyImport`, assets, backups.                              |
| `server/fastify/src/messageStore.ts`                                                    | Chat `messages`, reroll alternates, and per-chat `chat_hypa_v3` rows.                                                                                                                 |
| `server/fastify/src/chatGenerationSettingsStorage.ts`                                   | Normalizes persisted chat-scoped generation settings on import/load.                                                                                                                  |
| `server/fastify/src/routes/resourceReads.ts`                                            | Authenticated settings/collection/character/inlay-catalog REST resources plus lazy chat, lorebook, legacy-preset, and prompt-template hydration reads.                                |
| `server/fastify/src/commands/mutations.ts`, `commands/events.ts`                        | Revision-checked transaction lanes, durable command-event catalog/history, and live event fanout.                                                                                     |
| `server/fastify/src/auth.ts`, `http.ts`, `activeWriter.ts`, `providerSecrets.ts`        | Single-user auth/session helpers, route auth assertion, active-writer guard, secret masking/resolution.                                                                               |
| `server/fastify/src/routeManifest.ts`                                                   | Source of truth for route auth, active-writer, streaming, and exception classifications.                                                                                              |
| `server/fastify/src/routeRateLimits.ts`                                                 | Per-route rate-limit presets.                                                                                                                                                         |
| `server/fastify/src/protocolMetrics.ts`, `requestTrace.ts`                              | Opt-in protocol metrics, command table-write capture, and API request traces.                                                                                                         |
| `server/fastify/src/generationJobs.ts`, `generationFinalizationRetry.ts`                | Process-local durable chat jobs, replay/reattach state, and SQLite-backed finalization retry rows.                                                                                    |
| `server/fastify/src/messageTranslationJobs.ts`                                          | Process-local running jobs plus bounded terminal raw-message translation recovery rows exposed through runtime bootstrap.                                                             |
| `server/fastify/src/translation/`                                                       | Raw message translation provider dispatch for Google, DeepL, DeepLX, and LLM translation.                                                                                             |
| `server/fastify/src/pushNotifications.ts`                                               | Web Push VAPID key loading/generation, subscription persistence, and best-effort completion pushes.                                                                                   |
| `server/fastify/src/assetGc.ts`                                                         | Periodic reference-counted asset garbage collection.                                                                                                                                  |
| `server/fastify/src/streamJobs.ts`, `streamBackpressure.ts`                             | Process-local proxy stream jobs and bounded stream writes for slow clients.                                                                                                           |
| `server/fastify/src/requestAbort.ts`, `server/fastify/src/requestTimeouts.ts`           | Generation abort propagation and proxy/stream-job timeout constants.                                                                                                                  |
| `server/fastify/src/providerOperations.ts`, `embeddingOperations.ts`, `tts.ts`          | Fixed, validated provider catalog/account/translation, remote embedding, and TTS operation boundaries with server-side credential resolution.                                         |
| `server/fastify/src/imageGeneration.ts`, `openAITranscription.ts`, `mcpOAuthRefresh.ts` | Bounded image generation, stored-key OpenAI transcription, and stored-credential MCP OAuth refresh operations.                                                                        |
| `server/fastify/src/generation/serverTools.ts`, `ollamaCloudToolProxy.ts`               | Bounded server-intent tool protocol translation and credential-safe Ollama Cloud transport for browser-owned tool loops.                                                              |
| `server/fastify/src/risuSave/`                                                          | `.risu`, bundle, local-backup, bounded-inflate, and asset-report codecs wired by save routes.                                                                                         |
| `server/fastify/src/realmImport/`                                                       | Realm dynamic-card/`charx` conversion helpers used by Realm import routes.                                                                                                            |
| `server/fastify/src/prompt/agentPresetExecution.ts`, `src/ts/agentPresetReferences.ts`  | Prepared-input and named-output-CBS Agent Preset prompting, shared reference expansion, provider dispatch, phase execution, failure handling, and diagnostics.                        |
| `server/fastify/src/commands/agentPresets.ts`                                           | Revisioned Agent Preset create/update/duplicate/delete/reorder/default/step commands and delete cleanup.                                                                              |
| `server/fastify/src/prompt/luaPostGenerationProgress.ts`                                | Live post-generation Lua progress frames for long `editOutput` / `onOutput` runs.                                                                                                     |

`buildApp()` is test-friendly. `BuildAppOptions` can inject generation chat
behavior, including provider dispatch, push notification service, viewer
heartbeat cadence, and finalization retry options; MCP OAuth refresh, OpenAI
transcription, provider-operation, embedding, TTS, and image-generation
execution; Realm import limits; memory worker behavior; command/memory event
sinks; and asset-GC behavior. Config parsing also includes streamed
device-backup import limits and generation trace sidecar controls.

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
`423 active_writer_stale`. Ownership and its monotonic epoch live in
`database_metadata`, so a server restart does not make an older tab active.

Rate limits are opt-in per route. Current presets are setup `5/min`, login
`10/min`, auth crypto `60/min`, provider and embedding operations `60/min`,
OpenAI transcription `10/min`, image generation `10/min`, MCP OAuth refresh
`30/min`, TTS synthesis `60/min`, proxy fetch `120/min`, proxy stream-job create
`30/min`, imports `10/min`, asset upload and existence checks `120/min`, bulk
asset upload `30/min`, and generation submit `60/min`.

## Route Families

| Family                | Registrars                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health/auth/bootstrap | `health.ts`, `auth.ts`, `bootstrap.ts`                                                                                            | Health/status/setup/login plus authenticated runtime-only bootstrap; writer intent latches the active writer, while the response carries initialization/revision/schema metadata, active generation jobs, and translation recovery rows.                                                                                                                                                  |
| Resources/events      | `resourceReads.ts`, `events.ts`                                                                                                   | Root and targeted REST resources, the server-owned inlay catalog, lazy/bulk chat/lorebook/preset hydration, replayable command SSE, and live memory SSE.                                                                                                                                                                                                                                  |
| Commands              | `commands.ts` plus `commands/`                                                                                                    | First-run initialization plus revision-checked domain mutations for settings, profiles/presets, personas/loadouts, characters/chats/messages, lorebooks, modules/plugins, definitions, and generation results. Hot paths accept sparse object/row/definition patches and return compact canonical or digest-backed receipts when the browser can acknowledge its optimistic state safely. |
| Assets/saves/backups  | `assets.ts`, `save.ts`, `realmImport.ts`, `backups.ts`                                                                            | Content-addressed assets, `.risu`/bundle/local-backup import/export, Realm import, snapshots.                                                                                                                                                                                                                                                                                             |
| Push notifications    | `pushNotifications.ts`                                                                                                            | Web Push VAPID public-key lookup plus authenticated subscription create/delete routes; durable subscriptions live in SQLite while generated VAPID keys live in `data/__web_push_vapid_keys.json`.                                                                                                                                                                                         |
| Provider/media ops    | `providerOperations.ts`, `embeddingOperations.ts`, `tts.ts`, `imageGeneration.ts`, `openAITranscription.ts`, `mcpOAuthRefresh.ts` | Authenticated, bounded server-owned provider catalogs/translations, remote embeddings, TTS, image generation, OpenAI transcription, and stored-credential MCP OAuth refresh.                                                                                                                                                                                                              |
| Proxy/compatibility   | `proxy.ts`, `streamJobs.ts`, `hub.ts`, `legacyStorage.ts`                                                                         | Generic proxy/stream jobs, retained hub passthrough, `/api/v1/storage/*` compatibility bytes, and the public auth crypto helper.                                                                                                                                                                                                                                                          |
| Generation            | `generation.ts`, `generationChat.ts`                                                                                              | Completion route, server-assembled chat generation, preview prompt, internal chat generation settings/profile/Agent Preset readiness preflight, durable reattach/cancel.                                                                                                                                                                                                                  |
| Memory                | `memoryJobs.ts`, `memoryReads.ts`                                                                                                 | Queue/cancel/list jobs plus chunk/summary reads and active-writer summary edit/delete routes.                                                                                                                                                                                                                                                                                             |

The Commands family includes atomic onboarding at
`POST /api/v1/commands/onboarding`: one transaction patches the selected
model/prompt preset owners, their compatibility projections, applicable prompt
template storage, and allowlisted setup settings ending in
`didFirstSetup: true`. `server/fastify/__tests__/splitPresets.test.ts` guards
commit and rollback.

Owner deletion is also a command transaction, not client cleanup.
`server/fastify/src/commands/generationReferences.ts` rehomes or clears matching
chat-generation/loadout references for persona and model/prompt preset deletes;
alternate-greeting edits in `server/fastify/src/routes/commands.ts` remap
affected chat `fmIndex` values and return a cascade certificate;
`server/fastify/src/commands/modules.ts` removes module references from global
enablement, characters, chats, and loadouts. Guards are
`server/fastify/__tests__/generation.chat.test.ts`,
`server/fastify/__tests__/commands.test.ts`, and
`server/fastify/__tests__/commandMessageFreeCeiling.test.ts`.

`routeManifest.ts` classifies auth, active-writer, and streaming decisions;
it is not a literal endpoint inventory because command and hub routes are
classified by prefixes. Some registrars use plugin-local `instance.*` methods,
so use `app.printRoutes()` for route inventory audits. Manifest streaming types
include `sse`, `sse-optional`, `binary`, `websocket`, and `proxy`.
There is no generated OpenAPI/Swagger artifact or generated browser API client;
request/response contracts live in route handlers, TypeScript types, and the
hand-written browser adapters under `src/ts/server/` and
`src/ts/process/request/`.

### Server-Owned Provider And Media Boundary

These authenticated routes perform upstream work without mutating local durable
application state, so they do not require active-writer ownership. They accept
fixed operation discriminators and bounded, provider-specific inputs rather
than arbitrary upstream URLs, methods, or headers. Stored credentials resolve
inside Fastify, while request/result limits, deadlines, rate limits, sanitized
errors, and disconnect cancellation stay at the route/service boundary.

The family currently covers provider operations, embeddings, TTS, image
generation, OpenAI transcription, and MCP OAuth refresh. It is distinct from
the generic proxy family and does not persist returned media/provider data.
[Providers And Models](providers-and-models.md#server-owned-provider-and-media-operations)
owns the operation/provider/result matrix and browser adapter map.

Handlers call `requireAuth()` unless intentionally public. Public exceptions are
health, auth status/setup/login, `/api/v1/auth/crypto`, immutable asset reads,
asset existence probes, `GET /api/v1/push/vapid-public-key`, and hub
`GET`/`HEAD`/`OPTIONS` when no upstream override header is used.

## Mutations And Events

Normal domain writes go through `server/fastify/src/commands/mutations.ts`:
check `baseRevision`, load the narrowest safe domain shape, validate/mutate
through `server/fastify/src/commands/`, commit its SQLite writes and one event,
then bump the revision once. Scoped snapshots cannot be written back as a whole
database. Sparse commands and compact response proofs keep hot paths narrow;
protocol table-write metrics and command mutation-budget tests guard those write
sets.

[Data And Events](data-and-events.md) owns SQLite, revision, event, and targeted
write contracts. [Server Resources And Bridges](server-resources-and-bridges.md)
owns browser command queuing, durable intents/receipts, optimistic
acknowledgements, invalidation, and hydration.

## Generation And Memory

The live chat path is server-owned. Browser `sendChat` preflights with
`resolveServerPromptAssembly()` and posts raw inputs to
`/api/v1/generate/chat`. `server/fastify/src/prompt/` owns prompt assembly,
non-interactive Lua hooks, chat-scoped settings, Agent Preset phases, memory
integration, provider transport, post-generation work, and progress frames.
`server/fastify/src/routes/generationChat.ts` owns the HTTP/SSE boundary and
final persistence.

`/api/v1/generate/completion` is lower-level: normal browser traffic sends a
server-owned `server-intent` request with shaped messages, and the server
resolves provider/model/options/secrets from persisted settings. A legacy direct
provider envelope remains for compatibility tests/tools, still using the current
provider adapters and each adapter's direct-streaming limits.

`/api/v1/generate/chat` supports durable send/continue/regenerate as the normal
client path and an inline non-durable SSE mode for tools/tests. In-memory jobs
in `generationJobs.ts` detach, reattach, cancel, and preserve replayable terminal
results; SQLite finalization retries protect stale targets and idempotency.
Preview prompt assembles once without dispatching a provider.

Raw-message translation is disconnect-independent. The registry in
`server/fastify/src/messageTranslationJobs.ts` keeps running rows plus succeeded
or failed terminal rows for `TERMINAL_RETENTION_MS` (10 minutes), capped by
`MAX_TERMINAL_JOBS` (128), with bounded/redacted errors so bootstrap polling can
observe completion. Source-safe persistence lives in
`server/fastify/src/translation/rawMessageTranslation.ts`. Guards are
`server/fastify/__tests__/rawMessageTranslation.test.ts` and
`server/fastify/__tests__/messageTranslationJobs.test.ts`.

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

Imported `legacy-hypav3` summaries remain compatible with every selected summary
model and take precedence over an automatically generated summary for the same
chunk through `server/fastify/src/memorySummaryCompatibility.ts`. Deleting one
writes `memory_legacy_summary_tombstones` via the trigger in
`server/fastify/src/db.ts`, preventing startup backfill from resurrecting it;
destructive import clears the tombstones in
`server/fastify/src/memoryLegacyImport.ts`. Guards are
`server/fastify/__tests__/memoryLegacyImport.test.ts`,
`server/fastify/__tests__/memorySelectionService.test.ts`, and
`server/fastify/__tests__/memorySummarizeJobHandler.test.ts`.

[Providers And Models](providers-and-models.md) owns provider selection,
server-prompt support, profile resolution, Agent Preset execution semantics,
and memory provider behavior.

## Static SPA

`RISU_API_STATIC_ROOT` defaults to `<repo>/dist`. If it points to an existing
directory, Fastify serves `/` and non-API GET fallback from that built SPA.
Built `/assets/*` files get immutable cache headers; other static files
revalidate. Empty string, `none`, or `off` disable static serving. Non-API
`GET` misses fall back to `index.html`; `/api/*` and non-GET misses return JSON 404. Vite dev serves the SPA separately while still running the same
Fastify-backed browser runtime.
