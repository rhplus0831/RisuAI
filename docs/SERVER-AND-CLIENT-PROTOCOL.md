# Server And Client Protocol Audit

Date: 2026-05-31

This report consolidates a parallel subagent audit of the Fastify server, the
browser adapters, the event/job paths, and the existing architecture notes. It
describes how the server and client communicate today, how reliable that layer
is, the main performance pressure points, and how the protocol is organized.

## Executive Summary

The current protocol is coherent and mostly well-defended:

- The server owns durable state. The browser receives a projected copy, sends
  revision-checked commands, and refreshes projection state from command events.
- The main consistency controls are `baseRevision` optimistic concurrency,
  SQLite `BEGIN IMMEDIATE` command transactions, one revision bump per command,
  command events, explicit route auth, and the active-writer lease.
- Streaming is split by purpose: `/api/v1/events` is a projection invalidation
  stream with command-event replay, `/api/v1/generate/chat` is the
  server-assembled chat generation stream, Realm import can stream progress, and
  proxy stream jobs use WebSockets.
- Durable chat generation is reliable across browser disconnects and reloads,
  but generation jobs are process-memory only and do not survive a server
  restart.
- The largest performance risks are full-bootstrap fallback after replay misses
  or projection gaps, full database hydration/clone work inside command
  mutations, unbounded bulk hydration on the client, and media/base64 payload
  size in generation and import paths.
- The largest protocol maintenance risk is manual coverage: active-writer route
  classification, command event resource projection fields, and client/server
  SSE type mirrors all need to stay synchronized.

## Communication Model

The server/client contract has four layers.

1. Auth and writer ownership.
   Browser requests send `risu-auth`; server routes call `requireAuth()`
   explicitly instead of relying on global auth middleware
   (`server/fastify/src/http.ts:12`). Mutating server-owned routes are also
   gated by `risu-writer-session`; stale writers receive
   `423 active_writer_stale` (`server/fastify/src/activeWriter.ts:20`,
   `src/ts/server/activeWriterSession.ts:17`).

2. Bootstrap, projection, and hydration.
   Startup calls `GET /api/v1/bootstrap`, which returns the current revision,
   schema version, masked projected database, asset base URL, and transient
   `activeGenerationJobs` (`server/fastify/src/routes/bootstrap.ts:22`,
   `src/ts/server/bootstrap.ts:44`). Normal projection payloads use chat message
   stubs, while the open chat hydrates from
   `GET /api/v1/projection/chatMessages?id=...`
   (`server/fastify/src/routes/projection.ts:75`,
   `src/ts/server/projection.ts:111`).

3. Commands and event-driven reconciliation.
   Browser command helpers post JSON under `/api/v1/commands/*` with
   `baseRevision` (`src/ts/server/commands.ts:2202`). The server applies normal
   JSON mutations through `applyJsonCommandMutation()`: open an immediate SQLite
   transaction, compare `baseRevision`, load and mutate the hydrated database,
   sync changed chat messages, bump the revision, persist one command event,
   commit, write `db.json`, and emit the event to live subscribers
   (`server/fastify/src/commands/mutations.ts:54`).

4. Generation and job streams.
   Server chat generation uses SSE frames from `POST /api/v1/generate/chat`.
   Durable jobs add `job_accepted`, reattach at
   `GET /api/v1/generate/chat/:id/stream`, and cancel at
   `DELETE /api/v1/generate/chat/:id`
   (`server/fastify/src/routes/generationChat.ts:1384`). Proxy stream jobs use
   an HTTP create/delete API plus WebSocket attach
   (`server/fastify/src/routes/streamJobs.ts:105`).

## Server Protocol Surfaces

All live Fastify route families are registered centrally in `buildApp()`:
health, auth, bootstrap, active-writer guard, projection, save/import, Realm
import, commands, events, assets, backups, proxy, stream jobs, hub, legacy
storage, generation, chat generation, and memory routes
(`server/fastify/src/app.ts:197`).

Important surfaces:

| Surface               | Shape                                                           | Notes                                                                                                                         |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Auth                  | `/api/v1/auth/status`, `/setup`, `/login`, `/crypto`            | Single-user auth; route-level decisions.                                                                                      |
| Bootstrap             | `GET /api/v1/bootstrap`                                         | Registers writer intent when the browser sends `risu-writer-session`; returns projection and active generation jobs.          |
| Projection            | `GET /api/v1/projection/:resource`                              | Targeted top-level fields, `mode: full` fallback, chat/lorebook hydration modes.                                              |
| Commands              | `/api/v1/commands/*`                                            | Revision-checked domain mutations and command events.                                                                         |
| Events                | `GET /api/v1/events`                                            | SSE fanout for `command` and `memory` events, command-event ids/replay, and heartbeat comments.                               |
| Assets                | `POST /api/v1/assets`, `GET/HEAD /api/v1/assets/:id`, `/exists` | Upload is authenticated and writer-gated; reads/existence are intentionally public.                                           |
| Save/import/backup    | `.risu` import/export, backup create/list/restore/delete        | Import/restore produce state command events.                                                                                  |
| Realm import          | `POST /api/v1/import/realm-character`                           | JSON response or progress SSE depending on `Accept: text/event-stream`.                                                       |
| Proxy                 | `POST /api/v1/proxy/fetch`                                      | Binary passthrough with scoped parser and timeout handling.                                                                   |
| Proxy stream jobs     | `/api/v1/proxy/stream-jobs`, `/:id/ws`                          | Reconnectable local-network stream proxy with bounded job registry.                                                           |
| Generation completion | `POST /api/v1/generate/completion`                              | Browser `server-intent` completion plus legacy direct-provider dispatch; intent requests resolve provider wire on the server. |
| Chat generation       | `POST /api/v1/generate/chat`, `GET /:id/stream`, `DELETE /:id`  | Server prompt assembly, provider stream, durable job lifecycle, result persistence.                                           |
| Memory                | `/api/v1/memory/jobs`, chunks, summaries                        | Jobs are persisted in SQLite and events report progress.                                                                      |

The optional static SPA server injects `globalThis.__FASTIFY__ = true`, which is
the browser-side switch into Fastify-backed mode (`server/fastify/src/app.ts:236`,
`src/ts/platform.ts`).

## Client Protocol Surfaces

Browser adapters are grouped under `src/ts/server/`, `src/ts/storage/`, and
`src/ts/process/request/`. They generally expose `canUseServer*()` gates,
discriminated result unions, and per-endpoint response validation.

Key client modules:

- `src/ts/storage/nodeStorage.ts` handles auth and the still-active
  `/api/v1/storage/*` bridge. Storage writes/removes include active-writer
  headers.
- `src/ts/server/bootstrap.ts` fetches bootstrap, validates shape, caches the
  command revision, and parses `activeGenerationJobs`.
- `src/ts/server/commands.ts` centralizes command transport, cached revision
  management, 409 conflict handling, optimistic rollback hooks, and 423 stale
  writer handling.
- `src/ts/server/events.ts` subscribes to `/api/v1/events`, sends the cached
  command revision as a replay cursor, parses `command` and `memory` SSE frames,
  and discards malformed frames.
- `src/ts/server/projection.ts` reads targeted projection, chat messages, and
  character lorebook hydration payloads.
- `src/ts/server/chatMessageHydration.svelte.ts` caches hydrated chat and
  lorebook ids, deduplicates in-flight fetches, and drops stale hydration
  responses older than the applied revision.
- `src/ts/process/request/serverChat.ts` implements chat generation, durable
  reattach, token streaming, terminal handling, and explicit cancel.
- `src/ts/process/request/serverCompletion.ts` sends provider-wire-free
  completion intent for already-assembled prompts and consumes completion SSE/JSON.
- `src/ts/process/request/serverMemory.ts`, `src/ts/server/backups.ts`, and
  `src/ts/server/realmImport.ts` wrap memory, backup, and Realm import APIs.

The projection write guard is an important client-side reliability mechanism:
after server bootstrap, `DBState.db` is wrapped in a read-only proxy and only
trusted projection application paths can thaw it
(`src/ts/server/projectionWriteGuard.svelte.ts:12`,
`src/ts/server/projectionWriteGuard.svelte.ts:25`).

## Event And Job Protocols

### Projection Events

`GET /api/v1/events` writes:

- `id: <revision>` plus `event: command`, with
  `{ type, revision, resource, id?, parentId? }`
- `event: memory`, with memory job/progress payloads
- SSE comments for `connected` and `heartbeat`

The route can replay retained command events before live fanout. The browser may
send `?sinceRevision=<n>` or `Last-Event-ID: <n>`, meaning it has already applied
all command events through revision `n`. The server checks the SQLite-backed
1000-revision command history (`server/fastify/src/commands/events.ts:20`)
against the current SQLite revision; if the history covers every revision from
`n + 1` through the current revision, those command frames are written first and
the stream then subscribes to live command/memory event buses. If the cursor
cannot be covered (history truncation or client cursor ahead), the route returns
`409 event_replay_unavailable` and does not open SSE
(`server/fastify/src/routes/events.ts:34`, `server/fastify/src/routes/events.ts:46`).
Memory events remain live-only progress signals.

The browser reconciles events serially:

- `event.revision <= cached` means own echo or already applied; skip.
- `event.revision === cached + 1` means contiguous foreign event; fetch targeted
  projection for `event.resource`.
- A revision gap, unknown resource, projection error, or replay-unavailable
  response falls back to full bootstrap (`src/ts/bootstrap.ts:284`,
  `src/ts/bootstrap.ts:351`). A normal reconnect sends the cached revision and
  relies on replay instead of full-bootstrapping.

### Chat Generation SSE

The chat SSE vocabulary is mirrored by server and client types. Event names are
the discriminator, while JSON `data:` carries fields:

- `job_accepted`
- `stage`
- `prompt`
- `message_patch`
- `info`
- `token`
- `side_effect`
- `warning`
- `error`
- `done`

The server writer is in `server/fastify/src/prompt/sseEvents.ts`, and the client
mirror is `src/ts/process/request/serverChatEvents.ts`. The durable path buffers
already formatted SSE frames through `JobRegistry.pushRaw()` so reattach uses the
same parser and frame taxonomy (`server/fastify/src/streamJobs.ts:179`).

### Durable Generation Jobs

Durable chat generation is a strong part of the current protocol:

- A durable send creates an in-memory `GenerationJobRegistry` job.
- The first frame is `job_accepted`, so even a disconnect during assembly has a
  job id.
- A transient `chatId -> jobId` lock enforces one running job per chat and
  returns `409 generation_in_progress` for a second send
  (`server/fastify/src/routes/generationChat.ts:1348`).
- Browser disconnect only detaches the viewer. Explicit cancel is `DELETE` and
  is active-writer gated.
- Bootstrap exposes `activeGenerationJobs`, and the browser auto-reattaches when
  the relevant chat opens (`server/fastify/src/generationJobs.ts:67`,
  `src/ts/process/reattach.ts:33`).
- The server persists final results itself, idempotently keyed by
  `generationId`, and can persist streamed-so-far text on cancel
  (`server/fastify/src/routes/generationChat.ts:900`,
  `server/fastify/src/routes/generationChat.ts:1075`).

The main limit: generation jobs are process-local and in-memory, so they survive
browser disconnects but not server restarts
(`server/fastify/src/generationJobs.ts:17`).

### Memory Jobs

Memory jobs are more durable than generation jobs. The routes create, list, and
cancel jobs in SQLite (`server/fastify/src/routes/memoryJobs.ts:84`). The worker
claims pending jobs, retries or fails them, and recovers abandoned running jobs
on worker start (`server/fastify/src/memoryWorker.ts:79`,
`server/fastify/src/memoryRepository.ts:898`). Memory events are progress
signals, not the durability source.

## Reliability Assessment

### Strong Points

- Auth is explicit and route-level. Tests derive routes from Fastify's route
  table and enforce protection with documented public exceptions.
- Active writer catches stale browser sessions before server-owned mutations.
  The guard is installed after bootstrap and before mutating route registration
  (`server/fastify/src/app.ts:207`).
- Command concurrency uses optimistic revisions and `BEGIN IMMEDIATE`, which
  serializes conflicting writers and returns `409 revision_conflict` instead of
  merging stale client state.
- Command events are durable replay records plus best-effort live invalidators;
  subscriber failures are swallowed after commit so a broken event stream cannot
  roll back a committed command (`server/fastify/src/commands/events.ts:500`).
- Event reconnects replay retained command history by revision cursor when
  possible; replay misses and revision gaps self-heal through full bootstrap.
- Chat projection is protected from accidental browser mutation by the write
  guard.
- Durable generation handles disconnect, reattach, cancel, one-job-per-chat, and
  server-side result persistence.
- Memory jobs are persisted and retryable.

### Gaps And Residual Risks

- `/api/v1/events` replay is bounded to the retained SQLite command-event
  history. Long disconnects beyond that window still fall back to full
  bootstrap.
- Active-writer classification is manual path logic in
  `server/fastify/src/activeWriter.ts`; new server-owned mutations must update
  that file and the architecture audit.
- Command conflicts are surfaced to callers but not automatically retried.
  Optimistic UI is rolled back, and user/application flow must decide what to do
  next.
- Generation jobs and proxy stream jobs are process-memory registries. Durable
  generation does not survive server restart.
- If durable generation result persistence fails, the job emits an `error`; there
  is no persistent retry queue for generation result writes.
- Projection command replay depends on command events remaining one-revision
  contiguous. Any future server-owned revision bump without a command event will
  force reconnecting clients into the full-bootstrap fallback.
- Archive docs contain historical contradictions around auto-reattach and older
  browser-persisted generation notes. The present-tense `docs/structure/*` docs
  and current tests are more reliable sources.

## Performance Assessment

### Existing Mitigations

- Bootstrap and targeted projection ship message-free chat stubs instead of full
  transcripts (`server/fastify/src/repository.ts:329`).
- Open-chat hydration fetches messages, per-chat `hypaV3Data`, and alternates on
  demand (`server/fastify/src/routes/projection.ts:77`).
- Command message persistence uses a surgical diff for changed chat rows instead
  of rewriting every message table row for ordinary message edits
  (`server/fastify/src/repository.ts:258`).
- Proxy stream jobs have active job, pending event, pending byte, body size,
  timeout, heartbeat, and done-grace caps
  (`server/fastify/src/streamJobs.ts:6`).
- Durable generation buffering is bounded to 512 pending events or 2 MiB when no
  client is attached (`server/fastify/src/streamJobs.ts:13`,
  `server/fastify/src/streamJobs.ts:187`).
- Asset serving uses content-addressed ids and immutable cache headers
  (`server/fastify/src/routes/assets.ts:16`).

### Pressure Points

- Every normal JSON command loads the hydrated database, clones it with JSON
  serialization, runs mutation logic, strips messages, writes `db.json`, and emits
  an event (`server/fastify/src/commands/mutations.ts:62`). This is simple and
  safe, but large databases make command latency sensitive to full-object size.
- Full bootstrap is still the fallback for replay misses, revision gaps, unknown
  resources, and projection errors. Normal SSE reconnects and covered server
  restarts use command-event replay, but long disconnects beyond retained
  history can still move the full stub projection over the wire
  (`src/ts/bootstrap.ts:351`).
- Bulk hydration uses unbounded `Promise.all()` across every chat or every
  character lorebook (`src/ts/server/chatMessageHydration.svelte.ts:149`,
  `src/ts/server/chatMessageHydration.svelte.ts:188`).
- Client bridge/watchers use snapshot comparison and JSON serialization in hot
  paths for settings, chat, and lorebook synchronization. Large projected
  structures can make those comparisons expensive.
- Server chat sends browser inlay assets as base64 in the `/generate/chat`
  request, and stored asset prompt resolution reads asset bytes into memory before
  base64 encoding (`server/fastify/src/routes/generationChat.ts:233`).
- Realm `charx` import streams archive handling, but staged asset saves still
  read individual staged files fully into memory for hashing/write.
- The rate-limit plugin is registered with `global: false`, so the configured
  `max: 2000` does not provide a default global throttle
  (`server/fastify/src/app.ts:85`).

## Protocol Organization

The protocol is organized around stable resource families rather than a single
schema definition:

- Server route modules register concrete `/api/v1/*` paths from `buildApp()`.
- Browser modules mirror those route families with small endpoint adapters.
- Mutations are command-shaped: `{ baseRevision, ...payload }` in JSON, plus
  `risu-auth` and usually `risu-writer-session`.
- Reads are split into bootstrap, targeted projection, and lazy hydration.
- Event names are protocol discriminators for SSE streams.
- Active-writer and route-protection tests compensate for the lack of global
  auth and schema middleware.
- `util/client-thinning-audit.ts` enforces some architecture invariants, but it
  is not a complete protocol spec; Vitest tests carry many newer durable
  generation and reattach assertions.

The project would benefit from treating this file plus `docs/structure/*` as the
present-tense protocol reference, and archive docs as historical records unless a
present-tense structure doc points back to them.

## Test Anchors

Important coverage exists in:

- `server/fastify/__tests__/routeProtection.test.ts`: route auth/public
  exception coverage.
- `server/fastify/__tests__/activeWriter.test.ts`: stale writer behavior across
  commands, imports, assets, backups, storage, generation, and memory jobs.
- `server/fastify/__tests__/events.test.ts`: command/memory SSE delivery,
  command-event replay, and cleanup.
- `src/ts/bootstrap.test.ts`: client projection event gap, replay, and reconnect
  behavior.
- `server/fastify/__tests__/projection.test.ts`: targeted projection and asset
  no-op projection behavior.
- `src/ts/server/chatMessageHydration.test.ts`: hydration dedupe/reset behavior.
- `server/fastify/__tests__/durableGeneration.test.ts`: disconnect survival,
  reattach, active job projection, one-job-per-chat lock, cancel, writer handoff,
  result persistence, and continue/regenerate mode correctness.
- `server/fastify/__tests__/memoryJobsRoutes.test.ts`,
  `server/fastify/__tests__/memoryWorker.test.ts`, and
  `server/fastify/__tests__/memoryReadRoutes.test.ts`: memory API and worker
  reliability.
- `server/fastify/__tests__/realmImport.test.ts`: Realm import progress SSE.
- `server/fastify/browser-smoke/*`: end-to-end browser smoke for bootstrap,
  event refresh, and selected generation/reroll persistence flows.

## Follow-Up Opportunities

These are not required fixes for the current protocol, but they are the most
useful next hardening points:

1. Add a bounded-concurrency helper for bulk chat and lorebook hydration.
2. Expand protocol invariant audits to cover the durable-generation classifier,
   `activeGenerationJobs` reattach flow, and client/server chat SSE frame
   taxonomy.
3. Make the active-writer mutation classifier table-driven from route metadata or
   a shared route manifest instead of hand-maintained path checks.
4. Decide whether generation result persistence needs a retryable durable queue,
   similar in spirit to memory jobs.
5. Reconcile stale archive notes that still describe auto-reattach or
   generation persistence as incomplete.
