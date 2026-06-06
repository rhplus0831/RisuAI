# Data And Events

Fastify owns durable state. The browser receives a projected copy and sends
revision-checked commands or explicit server-owned mutation requests when it
needs persistence.

## Persistence Split

| Store            | Path                                                     | Contents                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                           | `schema_version` with current domain revision; settings; characters/chats; collections; plugin storage; asset metadata; messages/rerolls; memory tables/jobs; command-event replay; durable generation finalization retries. |
| Asset bytes      | `data/assets/<sha256>.<ext>`                             | Content-addressed bytes for images, audio, video, fonts, CSS, ONNX, inlay signatures, and other supported asset types. Metadata is in SQLite `assets`.                                                                       |
| Backups          | `data/backups/<id>/`                                     | Snapshot `risu.db`, `manifest.json`, `assets/` when present, and legacy `save/` when present. Older backups may carry `db.json`.                                                                                             |
| Legacy `db.json` | `data/db.json`                                           | Import-only compatibility input. On boot, `ensureDbJsonImported()` imports it into SQLite and renames it to `db.json.migrated`.                                                                                              |
| Legacy storage   | `data/save/<hex-key>`                                    | Compatibility byte store for `/api/v1/storage/*`. Writes/removes are active-writer guarded but do not bump the domain revision.                                                                                              |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json` | Single-user password data and registered browser public-key hashes.                                                                                                                                                          |

Primary boundaries:

- `server/fastify/src/db.ts` owns schema setup, migrations, `schema_version`,
  and revision bumps. SQLite runs in WAL mode with `synchronous = NORMAL`.
- `server/fastify/src/repository.ts` loads/writes SQLite-backed domain state,
  handles legacy import, projections, imports/exports, assets, and backups.
- `server/fastify/src/messageStore.ts` owns `messages`, `chat_hypa_v3`, and
  reroll alternates.
- `server/fastify/src/commands/mutations.ts` owns revision-checked command
  transactions.

## Revision Contract

Normal command mutations use optimistic concurrency:

1. Read `baseRevision`.
2. Compare it with `schema_version.revision`.
3. Load the needed SQLite-backed domain shape.
4. Mutate through server validators/helpers.
5. Write changed SQLite table families in one transaction.
6. Bump the revision exactly once.
7. Persist one command event for that revision.
8. Commit, then emit the live event.

Stale clients receive 409. Browser command helpers cache the latest revision
from bootstrap, command responses, and event reconciliation.

Command-event resources should be narrow. Examples include `characterSelection`
for selected-character fields, `characterRow` for one-character metadata refresh,
and `generation-chat` for `generation.persisted` events keyed by `parentId`.

## Server-Owned Exceptions

These paths still need explicit auth and active-writer decisions, but do not use
the normal resource command flow:

- First-run `POST /api/v1/commands/state/initialize` creates default server
  state and does not accept a browser database payload.
- Asset upload writes asset metadata/bytes and emits `asset.created`; duplicate
  uploads can be idempotent without a new revision.
- `.risu` import, bundle import, Realm import, backup restore, and generation
  result persistence use repository/server-owned paths.
- Memory job create/cancel writes durable SQLite memory-job state and emits
  memory events without a domain revision.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces repository state and emits `state.restored`.

## Auth And Active Writer

Auth is single-user and route-local. `server/fastify/src/auth.ts` stores
password/public-key state, `server/fastify/src/http.ts` exposes `requireAuth()`,
and route handlers call it manually unless intentionally public. Browser auth
assertions are sent in `risu-auth`. `/api/v1/auth/crypto` is a public
compatibility hashing helper.

The active-writer guard is separate. Writer-intent bootstrap latches the latest
`risu-writer-session`; guarded mutations from stale sessions receive
`423 active_writer_stale`. Read-only bootstrap/projection/event routes do not
need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions.

## Bootstrap And Projection

`GET /api/v1/bootstrap` returns revision, schema version, asset base URL,
`activeGenerationJobs`, and a lean database projection. If no database exists,
the browser calls `commands/state/initialize` and refetches bootstrap read-only.

Projection is intentionally lean:

- Bootstrap and broad targeted projections ship chat metadata with empty
  `message[]`.
- Active chat messages, per-chat `hypaV3Data`, and reroll alternates hydrate via
  `GET /api/v1/projection/chatMessages?id=...`.
- Bulk chat histories use `POST /api/v1/projection/chatMessages/bulk`.
- Experimental character-lorebook stubs hydrate via
  `GET /api/v1/projection/characterLorebook?id=...` and
  `POST /api/v1/projection/characterLorebooks/bulk`.
- Narrow projection resources include selected character, one character row, and
  generation-chat refreshes.

Browser wrappers live in `src/ts/server/projection.ts`; hydration/cache logic
lives in `src/ts/server/chatMessageHydration.svelte.ts`.

## SSE And Streaming

`GET /api/v1/events` streams persisted command events and live memory events.
Clients subscribe with `sinceRevision` or `Last-Event-ID`; replay gaps return
`409 event_replay_unavailable`, after which the browser performs a read-only
full bootstrap before resubscribing.

Browser reconcile rules: skip own echoes and already-applied revisions, fetch a
targeted projection for contiguous foreign events, and fall back to full
bootstrap for gaps, unknown/sprawling resources, replay misses, or projection
errors. Memory events update Hypa V3 job/progress UI directly.

Other streaming/binary surfaces: chat generation SSE, optional completion SSE,
optional Realm progress SSE, proxy stream WebSocket attachment, asset bytes,
`.risu`/bundle export, and proxy/hub/storage binary passthrough. SSE/raw writers
use `server/fastify/src/streamBackpressure.ts` to cap buffered bytes.
