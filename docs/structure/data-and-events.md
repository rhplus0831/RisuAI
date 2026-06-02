# Data And Events

Fastify owns durable state. The browser sees a projected copy and sends
revision-checked commands when it needs persistence.

## Persistence Split

| Store          | Path                                                     | Owner  | Contents                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite         | `data/risu.db`                                           | Server | Schema version, global revision, command-event replay history, chat messages plus reroll alternates, per-chat `hypaV3Data`, Hypa V3 memory chunks/summaries/embeddings/jobs, durable generation finalization retries. |
| Domain JSON    | `data/db.json`                                           | Server | The main Risu `Database` blob minus chat message arrays / per-chat `hypaV3Data`, plus the asset manifest.                                                                                                             |
| Assets         | `data/assets/<sha256>.<ext>`                             | Server | Content-addressed images, audio, video, fonts, CSS, and other supported asset bytes.                                                                                                                                  |
| Backups        | `data/backups/<id>/`                                     | Server | Snapshot `db.json`, `assets/`, `risu.db`, `save/`, plus `manifest.json`.                                                                                                                                              |
| Legacy storage | `data/save/<hex-key>`                                    | Server | Compatibility byte store used by active `/api/v1/storage/*` routes; read/list are authenticated, write/remove are active-writer guarded, and these writes do not bump the domain revision.                            |
| Auth files     | `data/__password`, `data/__known_public_key_hashes.json` | Server | Single-user stored password value (normally client-digested via `/api/v1/auth/crypto`) and registered browser public key hashes.                                                                                      |

`server/fastify/src/repository.ts` is the main file for `db.json`, assets, backups,
the message-table join/split boundary, and the stub projection. `server/fastify/src/db.ts`
owns SQLite schema setup and revision bumps. `server/fastify/src/messageStore.ts`
is the CRUD layer for chat messages, per-chat `hypaV3Data`, and persisted
reroll alternates.

## Revision Contract

The normal command mutation contract is revision-checked optimistic concurrency.
The SQLite `schema_version` row contains both schema version and current domain
revision. Normal revision-tracked command mutations should:

1. Read `baseRevision` from the request body.
2. Load and mutate the domain JSON.
3. Bump the SQLite revision exactly once.
4. Persist exactly one command event for that revision.
5. Emit the command event to live subscribers.
6. Return the new revision.

Stale clients receive 409. On the browser side, command helpers cache the latest
revision from bootstrap and command responses.

The split-store write path hydrates messages from SQLite, mutates a cloned
database, synchronizes changed chat messages / `hypaV3Data` / reroll alternates
back into SQLite, bumps the revision, persists the command event, commits, and
then writes message-free `db.json`. Crash ordering can leave SQLite ahead of
`db.json`, but `db.json` must not land ahead of message rows plus the revision
bump.

There are command-adjacent server-owned exceptions:

- `/api/v1/commands/state/initialize` creates the server-owned default database
  for a never-initialized server and does not take `baseRevision` or accept a
  browser-provided database payload.
- Asset upload writes asset metadata and bumps revision directly, then emits
  `asset.created`; asset GC can remove unreferenced asset metadata without a
  revision/event because no projected database field references it.
- `.risu` import, Realm character import, backup restore, and server-owned
  generation persistence write through repository/server-owned paths rather than
  ordinary resource commands. They still need explicit auth and active-writer
  decisions. Realm import validates `baseRevision` before upstream downloads;
  asset writes during import may bump revision before the final
  `character.created` event.
- Active-writer guarded does not always mean revision-tracked. Memory job
  create/cancel mutate durable SQLite memory-job state and emit memory events
  without bumping the domain revision. Backup create/delete mutate backup
  storage without a domain revision; backup restore replaces repository state
  and emits `state.restored`. Durable generation finalization retries are
  queued in SQLite before a result persist attempt and retried by a server timer
  if a non-terminal persist failure occurs.

## Auth Contract

Auth is single-user and explicit per route.

- `server/fastify/src/auth.ts` loads and stores the password and known browser
  public keys in the data directory. Known public-key hashes are LRU-capped at
  4096 entries.
- `server/fastify/src/http.ts` exposes `requireAuth()`.
- Route handlers call `requireAuth()` manually unless intentionally public.
- The browser creates short-lived ES256 assertion tokens in
  `src/ts/storage/fastifyStorage.ts` and sends them in the `risu-auth` header.
- `/api/v1/auth/crypto` is a public compatibility hashing helper registered
  from `routes/legacyStorage.ts`, not from `routes/auth.ts`.

Because there is no global auth hook, check new routes carefully for an explicit
auth decision.

## Active Writer Guard

Fastify also has a global active-writer `preHandler` guard registered from
`server/fastify/src/app.ts`. The browser registers writer ownership through the
writer-intent bootstrap request and sends `risu-writer-session` on server-owned
mutations. Read-only bootstrap intentionally omits the writer header for passive
resync. If no writer has been latched yet, guarded mutations pass; after a newer
session claims ownership, stale writer sessions receive `423 active_writer_stale`
and the browser schedules an alert plus reload.

`server/fastify/src/routeManifest.ts` is the route/protocol inventory for auth,
active-writer decisions, streaming shape, and public exceptions. The active-writer
guard in `server/fastify/src/activeWriter.ts`, route-protection tests, and the
EC5 architecture audit all read from that manifest. It classifies command
routes, asset uploads, backups, imports, chat generation, prompt preview,
durable-generation cancel, memory job create/cancel, and legacy storage
writes/removes as guarded server-owned mutations. The durable-generation
reattach route `GET /api/v1/generate/chat/:id/stream` is read-only (observe) and
intentionally **not** gated. When you add an API route, add the manifest decision;
the tests/audit fail on unclassified routes. Rate-limited routes also choose a
preset from `server/fastify/src/routeRateLimits.ts`.

## Bootstrap And Projection

`/api/v1/bootstrap` returns the current revision, schema version, database
projection, asset base URL, and `activeGenerationJobs`. Browser startup loads this
projection before the app is marked ready.

On a never-initialized server, bootstrap can return `database: null`; the
browser seeds the default database through `commands/state/initialize` and then
refetches bootstrap with the read-only helper.

`activeGenerationJobs` is a **transient, server-memory-only** projection (shape
`{ chatId, jobId, mode?, regenerateMessageId? }[]`, empty when none) sourced from
`GenerationJobRegistry.activeJobs()`. It is not a persisted `Database` field — it lets a
returning client, even after a full reload, discover and reattach to an in-flight
durable generation.

The projected database is lean: chat `message[]` arrays are stubs in bootstrap /
targeted projection responses, and the browser hydrates the active chat through
`GET /api/v1/projection/chatMessages?id=...`.

That chat hydration response also returns per-chat `hypaV3Data` and persisted
reroll `alternates`. When `enableLorebookStubs` is enabled, character
`globalLore` is stubbed too and hydrated through
`GET /api/v1/projection/characterLorebook?id=...`; this remains an experimental
lazy-projection path.

Read-many flows use bulk read-only POST endpoints:
`/api/v1/projection/chatMessages/bulk` and
`/api/v1/projection/characterLorebooks/bulk`. Browser wrappers live in
`src/ts/server/projection.ts` and bulk hydration helpers in
`src/ts/server/chatMessageHydration.svelte.ts`.

Projection writes are intentionally guarded in Fastify mode:

- Trusted server refresh paths can apply a new projection.
- Ordinary UI code should use server commands rather than mutating `DBState.db`.
- If a projection guard error appears, it usually means a browser feature still
  needs a command-backed write path.

## SSE Events

`GET /api/v1/events` is the long-lived event stream.

Event kinds:

- `command`: domain command event with revision, resource, and optional ids.
- `memory`: memory job event, optionally carrying Hypa V3 progress side effects.

The browser keeps a cached revision cursor. Own echoes / already-applied events are
skipped, contiguous foreign events fetch a targeted projection slice through
`GET /api/v1/projection/:resource`, and revision gaps fall back to a full bootstrap
refresh. Command events are sent with SSE `id: <revision>`; reconnects send
`sinceRevision` / `Last-Event-ID` so the server can replay retained command events
from SQLite-backed history before resuming live fanout. If replay is unavailable
(history truncated or cursor is ahead), the server returns `409 event_replay_unavailable`
and the browser full-bootstraps before subscribing again. Memory events are live
progress signals only and are not replayed.
`characters` slices are message-free, so the client resets chat hydration and
rehydrates the open chat after a re-stub.

Replay covers persisted command events only. Live-only command-shaped events such
as `state.exported` are emitted to current subscribers without revision bumps or
SQLite event-history persistence; they are no-op projection notifications.

## Binary And Streaming Surfaces

Most routes use Fastify's normal JSON parsing. Single asset uploads use the
supported asset content-type buffer parser registered in `buildApp()`, while
bulk asset upload is JSON/base64. Multipart `.risu` import uses
`@fastify/multipart`. Device-backup bundle imports stream to disk and are capped
separately by `RISU_API_IMPORT_MAX_BYTES` instead of the normal body limit.
Binary passthrough routes use a scoped parser setup with
`removeAllContentTypeParsers()` and a buffer parser. Check `routes/assets.ts`,
`routes/save.ts`, `routes/proxy.ts`, `routes/hub.ts`, and
`routes/legacyStorage.ts` before changing body parser behavior.

Streaming surfaces write directly to raw replies or WebSockets:

- `routes/generation.ts` resolves browser `server-intent` completion requests
  into server-owned provider dispatch and writes completion SSE (`chunk`,
  `error`, `done`) for streaming `/api/v1/generate/completion` requests.
- `routes/generationChat.ts` writes chat SSE frames. On the **non-durable** (inline)
  path it aborts the provider call on client close. On the **durable** path a client
  close only _detaches_ the viewer — the detached `GenerationJobRegistry` job keeps
  running and buffers its frames for a 30s reattach grace; cancel is the explicit
  `DELETE .../:id`, not a disconnect. See backend.md "Durable Generation".
- `routes/realmImport.ts` can write Realm import progress SSE (`progress`,
  `done`, `conflict`, `low_level_access`, `unsupported`, `error`) when the
  browser requests `text/event-stream`.
- `routes/events.ts` hijacks the response for command/memory SSE.
- `routes/streamJobs.ts` creates proxy stream jobs and attaches WebSockets
  (the reusable `JobRegistry` that durable generation wraps); it also exposes an
  authenticated cancel route. Fastify auto-`HEAD` read companions in the route
  manifest are not separate SSE/WebSocket client surfaces.

SSE/raw writers use `server/fastify/src/streamBackpressure.ts` to cap buffered
bytes for slow clients before they can accumulate unbounded memory.
