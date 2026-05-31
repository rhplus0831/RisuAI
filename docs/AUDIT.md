# Fastify Migration Side-Effect Audit

Date: 2026-06-01

This audit investigates the current Fastify-backed server/client protocol for
side effects introduced by moving durable state out of the browser and behind
HTTP routes. It builds on `docs/SERVER-AND-CLIENT.md` and
`docs/SERVER-AND-CLIENT-PROTOCOL.md`, then checks the current code directly.

## Executive Summary

- Fastify is now the durable owner of the main database projection, SQLite
  message/memory tables, assets, backups, imports, generation persistence, and
  legacy server storage. The browser is mostly a projected client that mutates
  server-owned state through commands, asset/import/generation/memory routes,
  and authenticated legacy storage.
- The example commit `ff26c63cc54b9832c9dc208aca89c8b4d077887a`
  (`feat: add bulk asset registration`) addressed a real write-side request
  fanout: imports no longer register every asset through a separate REST write.
  The fix remains present in the current bulk asset route, repository helper,
  and client batching path.
- There are still separate REST read patterns. They are concentrated in
  per-chat message hydration, optional per-character lorebook hydration, per
  asset byte reads, event-driven targeted projection fetches, and the server
  memory jobs modal. Most are bounded, cached, user-triggered, or scoped to an
  open view, but they still matter for large saves.
- The largest confirmed performance regression is not request fanout. It is the
  server command mutation path: even small JSON commands load the full persisted
  database, hydrate all chat messages, clone the whole database, scan all chats
  for diffs, write `db.json`, persist a command event, and emit to SSE clients.
- The previously confirmed P1 correctness risks are closed: event
  subscribe/replay, backup restore resync, durable generation frame replay, and
  direct guarded projection writes in Hypa V3/bookmark UI now have regression
  coverage.
- Client-side direct writes to server-backed projection state are blocked by the
  projection write guard and the audited Hypa V3/bookmark paths now avoid raw
  guarded writes. There are still command-backed watcher paths that can echo
  server projection refreshes or emit many settings commands.

## Severity Key

- P1: correctness or data-consistency bug likely to produce stale state, missed
  updates, broken user flow, or direct mutation failure.
- P2: significant performance, memory, or request-cycle risk on realistic large
  saves or active sessions.
- P3: bounded, contextual, or lower-frequency performance risk that still
  deserves instrumentation or cleanup.

## Connection And Interaction Model

The current architecture matches the high-level ownership model in
`docs/SERVER-AND-CLIENT.md`: Fastify owns durable state and the browser renders
and edits a projection.

- `buildApp()` creates the Fastify instance, sets the body limit, registers a
  non-global rate limiter, multipart parsing, raw asset body parsing, websocket
  support, SQLite, memory worker, stream/generation registries, asset GC, route
  families, and static SPA fallback (`server/fastify/src/app.ts:77`,
  `server/fastify/src/app.ts:85`, `server/fastify/src/app.ts:91`,
  `server/fastify/src/app.ts:108`, `server/fastify/src/app.ts:139`,
  `server/fastify/src/app.ts:157`, `server/fastify/src/app.ts:197`).
- Startup is not purely lazy: it hydrates persisted messages for legacy Hypa V3
  backfill and then extracts embedded messages into SQLite
  (`server/fastify/src/app.ts:108`, `server/fastify/src/app.ts:112`,
  `server/fastify/src/app.ts:116`).
- Auth is per route. Browser requests carry `risu-auth`; mutating server-owned
  routes also carry the active-writer session header. Bootstrap registers the
  active writer (`server/fastify/src/routes/bootstrap.ts:23`,
  `server/fastify/src/activeWriter.ts:14`), and a Fastify `preHandler` rejects
  stale writers with `423 active_writer_stale`
  (`server/fastify/src/activeWriter.ts:21`,
  `server/fastify/src/activeWriter.ts:43`).
- Bootstrap returns a projection envelope with revision, schema version,
  database, asset base URL, and active generation jobs, using chat stubs and
  masked provider secrets
  (`server/fastify/src/routes/bootstrap.ts:28`,
  `server/fastify/src/routes/bootstrap.ts:31`). Client startup applies that
  projection, seeds the command revision, enables the projection write guard,
  starts generation reattach, starts chat hydration, and subscribes to events
  (`src/ts/bootstrap.ts:150`, `src/ts/bootstrap.ts:162`,
  `src/ts/bootstrap.ts:169`, `src/ts/bootstrap.ts:170`,
  `src/ts/bootstrap.ts:173`, `src/ts/bootstrap.ts:177`,
  `src/ts/bootstrap.ts:179`).
- Commands are optimistic, revision-checked JSON mutations from the browser.
  The client reads a base revision, sends command JSON with auth and
  active-writer headers, handles revision conflicts, and rolls back on command
  failure (`src/ts/server/commands.ts:2198`,
  `src/ts/server/commands.ts:2229`, `src/ts/server/commands.ts:2238`,
  `src/ts/server/commands.ts:2260`).
- Events are authenticated SSE. The client subscribes with the cached revision,
  processes command events serially, fetches targeted projection for contiguous
  foreign events, and full-bootstraps on gaps or replay misses
  (`src/ts/bootstrap.ts:244`, `src/ts/bootstrap.ts:318`,
  `src/ts/bootstrap.ts:329`, `src/ts/bootstrap.ts:368`).
- The browser's old full database save path is disabled in Fastify mode:
  `saveDb()` returns immediately (`src/ts/globalApi.svelte.ts:385`).

## Route And State Ownership Inventory

| Route family                              | Durable touch                                                 | Notes                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/v1/health`                          | SQLite schema/revision                                        | Read-only health/revision check.                                                                  |
| `/api/v1/auth/*`                          | Auth files and key metadata                                   | Public setup/login plus protected auth status/crypto compatibility paths.                         |
| `/api/v1/bootstrap`                       | `db.json` projection plus SQLite revision                     | Registers active writer and ships message-free chat stubs.                                        |
| `/api/v1/projection/:resource`            | `db.json`, SQLite messages, `chat_hypa_v3`                    | Targeted projection, chat message hydration, and optional lorebook hydration.                     |
| `/api/v1/commands/*`                      | `db.json`, SQLite message/hypa tables, command events         | Main server-owned mutation surface.                                                               |
| `/api/v1/events`                          | SQLite command event history, live command/memory buses       | SSE replay plus live fanout.                                                                      |
| `/api/v1/assets*`                         | Asset files, `db.json` asset metadata, SQLite revision/events | Bulk upload exists; reads are public immutable asset bytes.                                       |
| `/api/v1/import/*` and `/api/v1/export/*` | `db.json`, SQLite messages, assets                            | Import/export routes buffer and materialize large payloads.                                       |
| `/api/v1/backups*`                        | `db.json`, `risu.db`, assets, legacy storage                  | Restore emits a state-restored command event.                                                     |
| `/api/v1/generate/chat*`                  | `db.json`, SQLite messages/memory, assets, stream registries  | Prompt assembly, durable stream jobs, optional result persistence.                                |
| `/api/v1/generate/completion`             | Provider dispatch, settings reads                             | Runtime generation path; server-intent reads settings.                                            |
| `/api/v1/memory/*`                        | SQLite memory tables and memory event bus                     | Jobs/chunks/summaries; no `db.json` projection writes except legacy `hypaV3Data` hydration paths. |
| `/api/v1/storage/*`                       | Legacy `dataDir/save` files                                   | Compatibility storage, active-writer protected writes, not main `db.json`.                        |
| `/api/v1/proxy/*`, `/api/v1/hub/*`        | Network proxy/runtime only                                    | No main database writes, but raw bodies are buffered.                                             |

## Confirmed Findings

### Resolved P1: Event Replay/Subscribe Race

`/api/v1/events` previously read the current revision and persisted command
event history, selected replay, sent replay, and only then subscribed the live
listener. A command emitted between the replay snapshot and subscription was not
in the replay set and was not delivered live. The client would only notice
after a later event created a revision gap (`src/ts/bootstrap.ts:318`); if no
later event arrived, the client could remain permanently stale.

Resolution: the route now subscribes to command events before reading replay
state (`server/fastify/src/routes/events.ts:48`,
`server/fastify/src/routes/events.ts:71`), queues command events observed
during stream setup, replays retained history through the covered revision, and
drains setup-time command events that were not already covered by replay
(`server/fastify/src/routes/events.ts:126`). A regression test opens an event
stream while a command lands during setup.

### Resolved P1: Backup Restore Active Projection Resync

The restore route still restores server state, creates a `stateRestored` event,
and returns `{ revision, event }` (`server/fastify/src/routes/backups.ts:53`,
`server/fastify/src/routes/backups.ts:56`). The stale-projection risk was that
the client cached that restore revision before applying or refetching the
restored projection, so the SSE echo could be skipped as already handled.

Resolution: `restoreServerBackup()` now waits for a trusted read-only bootstrap
resync after a successful restore response and no longer caches the restore
revision from the restore body alone (`src/ts/server/backups.ts:65`,
`src/ts/server/backups.ts:82`). The shared resync helper fetches bootstrap with
revision caching disabled, applies the restored projection, and only then
advances the cached command revision (`src/ts/server/projectionResync.ts:52`,
`src/ts/server/projectionResync.ts:60`, `src/ts/server/projectionResync.ts:61`).
If the follow-up resync fails, the helper reports an explicit partial-success
error instead of showing a loaded-backup success over stale client state. Tests
assert both the active projection update and the no-cache-on-resync-failure
case (`src/ts/server/backups.test.ts:170`,
`src/ts/server/backups.test.ts:220`), and the event path still full-bootstrap
resyncs `state.restored` echoes (`src/ts/bootstrap.test.ts:377`).

### Resolved P1: Durable Generation Reattach Preserves Required Frames

Previously, `JobRegistry.pushRaw()` only buffered stream frames while no clients
were attached; if any client was attached, it sent live and did not append to
the replay buffer
(`server/fastify/src/streamJobs.ts:187`,
`server/fastify/src/streamJobs.ts:202`). `attach()` sends whatever is pending
and then clears the shared pending buffer (`server/fastify/src/streamJobs.ts:211`,
`server/fastify/src/streamJobs.ts:218`). If the first viewer receives `prompt`
and `info`, disconnects mid-stream, and later reattaches, the reattached stream
may only contain later tokens or `done`.

The client does not consider a server chat stream ready until both `prompt` and
`info` are seen (`src/ts/process/request/serverChat.ts:364`), and it reports an
error on `done` without a prompt (`src/ts/process/request/serverChat.ts:451`).

Resolution: durable chat generation jobs now enable a per-job replay log that is
independent of viewer count. Reattach reconstructs `job_accepted`, then replays
retained chat SSE frames including `prompt`, latest `info`, state frames, token
tail/result, and terminal frames through the same client parser. Proxy stream
jobs keep the prior pending-buffer semantics. A regression test drops the first
viewer after `prompt`/`info`, reattaches while the provider is still gated, and
asserts that the reattached stream reaches `done` with the required lifecycle
frames.

### P1: Direct Client Writes To Server-Backed Projection State Are Closed

The projection write guard freezes `DBState.db` after bootstrap and throws on
raw writes outside trusted projection updates
(`src/ts/server/projectionWriteGuard.svelte.ts:12`,
`src/ts/server/projectionWriteGuard.svelte.ts:88`). The audited UI paths now
avoid direct guarded projection writes:

- `HypaV3Modal.svelte` uses a local default Hypa V3 data view in server-backed
  memory mode when a legacy `hypaV3Data` blob is absent, and only initializes
  `chat.hypaV3Data` outside server-backed memory mode
  (`src/lib/Others/HypaV3Modal.svelte:45`,
  `src/lib/Others/HypaV3Modal.svelte:113`).
- `BookmarkList.svelte` builds cloned bookmark patch objects and dispatches the
  intended chat update command in Fastify mode without first mutating
  `chat.bookmarks` or `chat.bookmarkNames`
  (`src/lib/Others/BookmarkList.svelte:111`,
  `src/lib/Others/BookmarkList.svelte:140`).

Regression coverage lives in `src/lib/Others/projectionGuard.test.ts`.

### P2: Every JSON Command Performs Whole-Corpus Work

The main command mutation helper starts `BEGIN IMMEDIATE`, checks revision,
loads the full persisted database with all SQLite messages, JSON-clones it,
runs the mutation, scans all chats for message and `hypaV3Data` diffs, bumps the
revision, persists a command event, commits, writes `db.json`, and then emits
the live event (`server/fastify/src/commands/mutations.ts:65`,
`server/fastify/src/commands/mutations.ts:76`,
`server/fastify/src/commands/mutations.ts:79`,
`server/fastify/src/commands/mutations.ts:87`,
`server/fastify/src/commands/mutations.ts:93`,
`server/fastify/src/commands/mutations.ts:104`,
`server/fastify/src/commands/mutations.ts:107`).

The repository load joins every chat's messages and Hypa V3 data
(`server/fastify/src/repository.ts:188`,
`server/fastify/src/repository.ts:190`,
`server/fastify/src/repository.ts:191`), and `syncChatMessages()` visits every
chat and stringifies `hypaV3Data` for comparison
(`server/fastify/src/repository.ts:268`,
`server/fastify/src/repository.ts:282`,
`server/fastify/src/repository.ts:288`). Even settings patches and other small
non-message changes pay this cost.

This is the most important confirmed performance regression. Browser-side
local edits became server commands, but the server command path is still
whole-corpus shaped.

Recommendation: split hot commands into narrower persistence paths where
possible: settings-only patch, chat-metadata patch, message append/edit, and
asset metadata changes should avoid full message hydration. Keep the existing
`command_mutation` protocol metric and add CI or benchmark thresholds for
`loadMs`, `cloneMutateMs`, `sqliteSyncMs`, and `dbJsonWriteMs`.

### P2: Generation And Prompt Assembly Can Trigger Multiple Whole-Corpus Passes

A server-backed chat generation request can load the full hydrated database for
prompt assembly, then call the command mutation path for assembly side effects,
then call it again for post-generation persistence. Durable generation has the
same shape inside the background job. Hypa V3 prompt assembly can also create
chunks, enqueue jobs, delete orphaned rows, select memory, and enqueue follow-up
jobs during prompt assembly.

Representative paths are `/api/v1/generate/chat`, durable job assembly, and
preview prompt (`server/fastify/src/routes/generationChat.ts:681`,
`server/fastify/src/routes/generationChat.ts:1217`,
`server/fastify/src/routes/generationChat.ts:1517`). Memory planning and
selection touch SQLite memory tables during assembly
(`server/fastify/src/prompt/assemble.ts:1047`,
`server/fastify/src/prompt/assemble.ts:1083`,
`server/fastify/src/prompt/assemble.ts:1107`,
`server/fastify/src/prompt/assemble.ts:1134`).

Recommendation: measure generation persistence passes separately from provider
latency, and consider a narrow append/result persistence path for durable
generation instead of routing every persistence step through the generic
whole-database command helper.

### P2: Targeted Projection Reduces Wire Size But Still Reads The Full Projection

`/api/v1/projection/:resource` maps many resources to top-level fields, but
known field resources still call `loadStubProjection()` and
`maskProviderSecrets()` before selecting fields
(`server/fastify/src/routes/projection.ts:122`,
`server/fastify/src/routes/projection.ts:133`,
`server/fastify/src/routes/projection.ts:134`). Even the `asset` resource maps
to an empty field list because assets do not live in projected `database`, yet
the route still pays the full projection load before returning `{ fields: {} }`
(`server/fastify/src/routes/projection.ts:51`,
`server/fastify/src/routes/projection.ts:146`).

Recommendation: short-circuit empty field resources before loading projection,
and consider field-specific projection loaders for high-frequency resources.

### P2: Asset Reads Are Per-Asset Requests And Each Metadata Lookup Parses `db.json`

The write-side asset fanout from `ff26c63cc54b9832c9dc208aca89c8b4d077887a`
is fixed by `saveAssets()`, `/api/v1/assets/bulk`, and `addAssets()`
(`src/ts/globalApi.svelte.ts:229`,
`src/ts/globalApi.svelte.ts:300`,
`server/fastify/src/routes/assets.ts:132`,
`server/fastify/src/repository.ts:533`). Current regression tests cover ordered
bulk upload behavior.

Read-side fanout remains. Fastify asset sources resolve to `/api/v1/assets/:id`
URLs (`src/ts/globalApi.svelte.ts:146`), explicit asset reads call server asset
bytes one id at a time (`src/ts/globalApi.svelte.ts:190`), and every server
asset `GET`/`HEAD` calls `assetById()`. `assetById()` validates the id, loads
and parses the full persisted repository, then linearly searches asset metadata
(`server/fastify/src/repository.ts:512`,
`server/fastify/src/repository.ts:514`,
`server/fastify/src/repository.ts:515`).

Browser HTTP caching helps repeated identical URLs, but cold asset-heavy chats,
exports, prompt assembly asset resolution, and `/assets/exists` probes can still
turn into many full `db.json` parses.

Recommendation: keep an asset metadata index in SQLite or an in-process cache
invalidated on asset revision bumps. Consider a bulk asset metadata/read
endpoint for export flows that need many assets.

### P2: Asset Mutation Durability Is Not As Transactionally Clean As Commands

`addAssets()` loads persisted metadata, writes asset bytes, writes `db.json`,
then bumps the SQLite revision (`server/fastify/src/repository.ts:544`,
`server/fastify/src/repository.ts:565`,
`server/fastify/src/repository.ts:585`,
`server/fastify/src/repository.ts:586`). The route emits the command event
afterward. Unlike `applyJsonCommandMutation()`, there is no single command-style
flow where SQLite revision/event and `db.json` write are ordered with the same
care.

Recommendation: move asset metadata to SQLite, or introduce a command-like
asset transaction protocol with explicit recovery behavior for failures between
file write, `db.json` metadata write, revision bump, and event persistence.

### P2: Import, Export, And Bundle Paths Materialize Large Payloads

Fastify's multipart import caps compressed upload bytes, but the route reads the
entire file with `toBuffer()` and decoders can decompress into much larger
payloads without a post-inflate cap (`server/fastify/src/app.ts:91`,
`server/fastify/src/routes/save.ts:177`,
`server/fastify/src/routes/save.ts:182`). Import then parses/clones the full
database and applies it to repository state.

Bundle export hydrates the full save once to build `.risu` bytes and then loads
the repository again to build the bundle. It also synchronously reads every
referenced asset and creates the zip in memory. The route is not currently used
by production client callers found in this audit, but it is still a server
surface for large saves.

Recommendation: enforce expanded-size limits, stream or chunk import/export
work where possible, and avoid double hydration in bundle export.

### P2: Server Memory Jobs Polling Is Repeated And Can Overlap

The server memory jobs UI refreshes on `chatId` changes and every five seconds
while mounted (`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:61`,
`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:104`,
`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:109`). It increments a
serial to ignore stale responses but does not abort or skip an in-flight request
before starting the next one (`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:69`,
`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:71`). The server job list
route reads SQLite `memory_jobs`; listings are unpaginated.

This is not per-item N+1, but it is a repeated database-backed client read
cycle. It is notable because memory progress also arrives over SSE.

Recommendation: drive refresh from memory SSE events, pause polling when no
pending/running jobs exist, prevent overlapping requests, and add pagination or
counts for large job histories.

### P2: SSE And Stream Fanout Ignore Backpressure

Command and memory SSE handlers write directly to every client without checking
the return value of `write()` (`server/fastify/src/routes/events.ts:101`,
`server/fastify/src/routes/events.ts:108`,
`server/fastify/src/routes/events.ts:113`). Generation/proxy job fanout has the
same shape: pending caps apply when no client is attached, but attached slow
clients are written to directly (`server/fastify/src/streamJobs.ts:187`,
`server/fastify/src/streamJobs.ts:202`).

Recommendation: add per-client queues/caps or disconnect slow consumers after
bounded buffering. Include generation SSE and `/api/v1/events` in this policy.

### P2: Server-Origin Projection Refreshes Can Echo Back As Command Writes

Several component watchers monitor `DBState.db` and dispatch server commands
when tracked values change. Server projection merges are trusted writes into
`DBState.db` (`src/ts/storage/database.svelte.ts:807`), but ordinary watchers
can interpret those changes as local edits. The settings bridge snapshots
tracked keys and queues a settings patch after initialization
(`src/ts/server/settingsBridge.svelte.ts:124`,
`src/ts/server/settingsBridge.svelte.ts:138`). Similar watcher shapes exist for
chat metadata, lore/script/module views.

This risk is command-backed rather than direct browser persistence, but a
passive client with a mounted settings/sidebar view can potentially re-submit a
foreign projection update as a new command revision.

Recommendation: introduce a global "applying server projection" suppression
token that all server-backed watchers honor, or make watchers compare against a
server-applied baseline before dispatching.

### P3: Bulk Hydration Is Bounded But Still N Requests

Per-chat message hydration is the clearest N+1 read shape. `ensureAllChatsHydrated()`
walks every character/chat and runs one fetch per unhydrated chat, bounded by
`BULK_HYDRATION_CONCURRENCY = 4`
(`src/ts/server/chatMessageHydration.svelte.ts:21`,
`src/ts/server/chatMessageHydration.svelte.ts:206`,
`src/ts/server/chatMessageHydration.svelte.ts:217`,
`src/ts/server/chatMessageHydration.svelte.ts:220`). Active chat hydration is
deduped by chat id and cached for the session
(`src/ts/server/chatMessageHydration.svelte.ts:49`,
`src/ts/server/chatMessageHydration.svelte.ts:51`,
`src/ts/server/chatMessageHydration.svelte.ts:52`).

Bulk hydration is triggered by export-all, dataset export, branch-tree open, and
other workflows that need non-open chat histories. Character lorebook hydration
has the same one-request-per-character pattern when `enableLorebookStubs` is
enabled (`src/ts/server/chatMessageHydration.svelte.ts:110`,
`src/ts/server/chatMessageHydration.svelte.ts:164`).

This means the older protocol doc's "unbounded Promise.all" risk is stale:
current code bounds fanout. The remaining issue is request count and server
per-request cost, especially because chat hydration often falls back to reading
`db.json` when optional `hypaV3Data` is absent.

Recommendation: add bulk chat-message and bulk lorebook hydration endpoints, or
move export/branch-tree data assembly server-side.

### P3: Full Bootstrap Fallbacks Are Expensive And Can Hide Missed Events

The client full-bootstraps when replay is unavailable, targeted projection
returns `full`, targeted projection errors, or a revision gap is detected
(`src/ts/bootstrap.ts:264`, `src/ts/bootstrap.ts:357`,
`src/ts/bootstrap.ts:365`, `src/ts/bootstrap.ts:368`). A full resync applies the
entire projection, resets chat/lorebook hydration, and immediately rehydrates
the open chat/lorebook (`src/ts/bootstrap.ts:385`,
`src/ts/bootstrap.ts:390`, `src/ts/bootstrap.ts:397`).

This self-heals some missed events, but it also magnifies the cost of gaps and
does not help if the event subscribe race misses an event and no later event
arrives.

Recommendation: keep the full-bootstrap fallback, but instrument and assert how
often it happens. Treat unexpected full resyncs as a protocol health signal.

### P3: Active Generation Reattach Is Not Triggered For All State Changes

Reattach looks up the open chat through the selected character's `chatPage`, but
the reattach wiring subscribes only to character selection. Same-character chat
switches and full projection refreshes that update `activeGenerationJobs` can
leave a matching running job unreattached until a character selection changes.
The full bootstrap resync sets active generation jobs but does not call the
reattach probe (`src/ts/bootstrap.ts:385`, `src/ts/bootstrap.ts:387`).

Recommendation: trigger reattach when active chat id changes and after
`setActiveGenerationJobs()` in full resync.

### P3: Server-Owned `resendChat` Can Create An Unbounded Request Cycle

The server can surface `postGeneration.resendChat`, and the browser responds by
calling `sendChat()` again. If an output trigger repeatedly requests resend,
this can become a repeated generation/request cycle without a clear circuit
breaker.

Recommendation: cap consecutive server-owned resends per root user action and
surface an error once the cap is exceeded.

### P3: Settings UI Can Emit Many Command Writes

Most bridge writes are debounced, but some UI paths call immediate settings
patch helpers. Color inputs call `onchange` for every value change after
initialization, and editor components route that into an immediate server-backed
settings patch. The NanoGPT dashboard fetches subscription state and persists it
after reads without a visible equality check.

Recommendation: debounce high-frequency input controls, add equality checks
before settings writes, and prefer the queued settings watcher path for
interactive controls.

### P3: Fastify-Specific Route Overheads And Coverage Gaps

- The rate limiter is registered with `global: false`; this is intentional for
  some routes, but it means there is no default throttle for large buffered
  routes (`server/fastify/src/app.ts:85`).
- Raw asset bodies are parsed as buffers before handler-level auth and
  active-writer checks (`server/fastify/src/app.ts:98`,
  `server/fastify/src/routes/assets.ts:99`). Multipart imports also buffer in
  the route.
- Fastify creates implicit `HEAD` handlers for many `GET` routes. Assets
  deliberately disable auto-HEAD and provide a cheap HEAD path, but routes such
  as exports/events/projection/bootstrap should be reviewed so HEAD requests do
  not perform full work accidentally.
- The active-writer hook performs route-manifest matching on each mutating
  request (`server/fastify/src/activeWriter.ts:50`). This is small compared with
  full-database reads, but it is Fastify hook overhead.
- Route schemas are largely absent, so hot route envelopes do not benefit from
  Fastify compiled validation/serialization.
- The hub wildcard route can appear as a bare `*` in live route printing, while
  route protection tests filter paths by `/api/v1/`. That can hide manifest
  coverage issues for wildcard routes.

## Direct Answers To The Requested Questions

### How Do Server And Client Connect And Interact?

The client bootstraps an authenticated, server-owned projection from
`/api/v1/bootstrap`, registers itself as the active writer if it sends a writer
session, enables a read-only projection guard, lazily hydrates heavy entities,
and subscribes to authenticated SSE events. Mutations go through revision-checked
commands or specialized server routes. The server persists commands, emits
command events, and the client reconciles events through targeted projection or
full bootstrap.

### Are There Frequent Separate REST Reads For Database-Backed Data?

Yes, but not as a constant render-loop pattern in the main happy path. Confirmed
separate-read patterns are:

- one chat-message hydration request per unhydrated chat, bounded at four
  concurrent requests;
- one lorebook hydration request per character when lorebook stubs are enabled;
- one asset byte request per unique asset URL, with each server lookup parsing
  `db.json` metadata;
- one targeted projection fetch per contiguous foreign command event;
- one memory jobs list request on modal mount/chat change and every five seconds
  while the modal is open.

The write-side asset fanout referenced by commit
`ff26c63cc54b9832c9dc208aca89c8b4d077887a` appears fixed. Remaining fanout is
mostly read-side, export-side, or modal-side.

### Did The Fastify Migration Introduce Performance Regressions?

Likely yes. The strongest evidence is whole-corpus command mutation work on
every JSON command. Other likely regressions are full-projection work for
targeted projection, repeated `db.json` parses for asset metadata, import/export
buffering and decompression, and multiple full persistence passes during
generation.

### Did The Migration Introduce Repeated Loops Or Excessive Request Cycles?

Confirmed repeated or potentially excessive cycles:

- server memory jobs polling every five seconds while mounted, with possible
  overlap;
- bounded but still N-request bulk hydration for all chats/lorebooks;
- per-event targeted projection fetches, with full bootstrap fallback on gaps;
- possible unbounded `resendChat` generation recursion;
- high-frequency settings/color controls that can emit command-per-drag writes.

No broad uncontrolled client loop was found that repeatedly reads every
database-backed entity during ordinary rendering.

### Are There Client-Side Behaviors That Attempt To Write DB-Backed State?

Yes. `saveDb()` is disabled in Fastify mode, and most writes go through commands
or server routes. However, `HypaV3Modal.svelte` and `BookmarkList.svelte`
appear to mutate `DBState.db` directly in server mode, which should trip the
projection write guard. There are also command-backed watcher writes that may
echo server projection refreshes unless all watchers share a projection-apply
suppression mechanism.

## Prior Documentation Drift

- `docs/SERVER-AND-CLIENT-PROTOCOL.md` still describes unbounded bulk hydration.
  Current code has `BULK_HYDRATION_CONCURRENCY = 4` and a `runBounded()` worker
  pool.
- The protocol doc mentions browser inlay assets sent as base64 on
  `/generate/chat`; current code primarily sends server asset aliases while the
  server retains compatibility handling for legacy `inlayAssets`.
- The older docs correctly identify full bootstrap fallback, command mutation
  costs, large payload risks, and non-global rate limiting as protocol pressure
  points.

## Recommended Priority Order

1. Reduce the command mutation hot path by adding narrow persistence paths for
   settings, metadata, and message operations.
2. Make targeted projection and asset metadata lookup avoid full `db.json`
   reads for small or no-op resources.
3. Replace memory job polling with SSE-driven refresh and overlap prevention.
4. Add bulk read endpoints or server-side assembly for all-chat/lorebook export
   flows.
5. Add backpressure/caps for all SSE/stream fanout.
6. Add expanded-size limits and streaming/chunking for import/export/bundle
   routes.
7. Add instrumentation tests for request counts, query counts, payload sizes,
   full-bootstrap fallback counts, and command mutation timing metrics.

## Existing Test Coverage And Gaps

Current coverage is stronger around route manifest/auth, active-writer behavior,
server prompt assembly, generation protocol frames, client chat SSE parsing,
memory jobs protocol, projection guard regression, SQLite message extraction,
and bounded hydration concurrency.

Important gaps for this audit:

- no query-count or request-count assertions for projection, hydration, asset
  reads, or memory jobs polling;
- no payload budget tests for bootstrap/projection/import/export/bundle routes;
- no direct client projection adapter test suite for all error modes.

## Suggested Instrumentation

- Track command mutation metrics already emitted by `applyJsonCommandMutation()`
  and alert on high `loadMs`, `cloneMutateMs`, `sqliteSyncMs`,
  `dbJsonWriteMs`, and `totalMs`.
- Count client hydration requests by type and expose counts in protocol
  diagnostics for active chat, bulk chat, and lorebook hydration.
- Count full bootstrap resync reasons and make unexpected resyncs visible during
  development.
- Log asset metadata lookup counts and `db.json` parse time for asset-heavy
  screens.
- Add memory job list counts, polling overlap counts, and SSE-driven progress
  counts.
- Add stream backpressure metrics for `/api/v1/events`, durable generation, and
  proxy stream jobs.
