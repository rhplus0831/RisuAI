# Data And Events

Fastify owns durable state. The browser sees a projected copy and sends
revision-checked commands when it needs persistence.

## Persistence Split

| Store       | Path                                                     | Owner  | Contents                                                                                                                                          |
| ----------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite      | `data/risu.db`                                           | Server | Schema version, global revision, chat messages plus reroll alternates, per-chat `hypaV3Data`, Hypa V3 memory chunks, summaries, embeddings, jobs. |
| Domain JSON | `data/db.json`                                           | Server | The main Risu `Database` blob minus chat message arrays / per-chat `hypaV3Data`, plus the asset manifest.                                         |
| Assets      | `data/assets/<sha256>.<ext>`                             | Server | Content-addressed images, audio, video, fonts, CSS, and other supported asset bytes.                                                              |
| Backups     | `data/backups/<id>/`                                     | Server | Snapshot `db.json`, `assets/`, `risu.db`, `save/`, plus `manifest.json`.                                                                          |
| Auth files  | `data/__password`, `data/__known_public_key_hashes.json` | Server | Single-user stored password value (normally client-digested via `/api/v1/auth/crypto`) and registered browser public key hashes.                  |

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
4. Emit exactly one command event.
5. Return the new revision.

Stale clients receive 409. On the browser side, command helpers cache the latest
revision from bootstrap and command responses.

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

## Auth Contract

Auth is single-user and explicit per route.

- `server/fastify/src/auth.ts` loads and stores the password and known browser
  public keys in the data directory.
- `server/fastify/src/http.ts` exposes `requireAuth()`.
- Route handlers call `requireAuth()` manually unless intentionally public.
- The browser creates short-lived ES256 assertion tokens in
  `src/ts/storage/nodeStorage.ts` and sends them in the `risu-auth` header.

Because there is no global auth hook, check new routes carefully for an explicit
auth decision.

## Active Writer Guard

Fastify also has a global active-writer `preHandler` guard registered from
`server/fastify/src/app.ts`. The browser registers writer ownership through the
writer-intent bootstrap request and sends `risu-writer-session` on server-owned
mutations. Stale writer sessions receive `423 active_writer_stale`.

`server/fastify/src/activeWriter.ts` classifies command routes, asset uploads,
backups, `POST /api/v1/import/risusave`,
`POST /api/v1/import/realm-character`, `POST /api/v1/generate/chat`,
`POST /api/v1/generate/preview-prompt`, `DELETE /api/v1/generate/chat/:id`
(durable-generation cancel — writer handoff lets a new writer stop a prior,
now-disconnected writer's generation), memory job create +
`DELETE /api/v1/memory/jobs/:id`, and legacy storage writes/removes as guarded
server-owned mutations. The durable-generation reattach route
`GET /api/v1/generate/chat/:id/stream` is read-only (observe) and intentionally **not**
gated. When you add a mutating route, classify it here _and_ add its matching entry to
the EC5 rule table in `util/client-thinning-audit.ts` (the audit fails on an
unclassified mutating route).

## Bootstrap And Projection

`/api/v1/bootstrap` returns the current revision, schema version, database
projection, asset base URL, and `activeGenerationJobs`. Browser startup loads this
projection before the app is marked ready.

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
`GET /api/v1/projection/:resource`, and revision gaps or reconnects fall back to a full
bootstrap refresh. `characters` slices are message-free, so the client resets chat
hydration and rehydrates the open chat after a re-stub.

## Binary And Streaming Surfaces

Most routes use Fastify's normal JSON parsing. Asset uploads use the supported
asset content-type buffer parser registered in `buildApp()`. Binary passthrough
routes use a scoped parser setup with `removeAllContentTypeParsers()` and a
buffer parser. Check `routes/assets.ts`, `routes/proxy.ts`, `routes/hub.ts`,
and `routes/legacyStorage.ts` before changing body parser behavior.

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
  (the reusable `JobRegistry` that durable generation wraps).
