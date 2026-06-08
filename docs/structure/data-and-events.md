# Data And Events

Fastify owns durable state. The browser receives a projected copy and sends
revision-checked commands or explicit server-owned mutation requests.

## Stores

| Store            | Path                                                                                               | Contents                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                                                                     | `schema_version` with current domain revision; settings; characters/chats; collections; plugin storage; asset metadata; messages/rerolls; memory tables/jobs; command-event replay; generation finalization retries. |
| Asset bytes      | `data/assets/<sha256>.<ext>`                                                                       | Content-addressed images, audio, video, fonts, CSS, ONNX, inlay signatures, and other supported asset types. Metadata is in SQLite `assets`.                                                                         |
| Backups          | `data/backups/<id>/`                                                                               | Snapshot `risu.db`, `manifest.json`, assets when present, and legacy `save/` when present. Creation copies `risu.db` after a WAL checkpoint; restore uses `ATTACH` and restores repository tables.                   |
| Legacy `db.json` | `data/db.json`                                                                                     | Import-only compatibility input. Boot imports it into SQLite and renames it to `db.json.migrated`.                                                                                                                   |
| Legacy storage   | `data/save/<hex-key>`                                                                              | Compatibility byte store for `/api/v1/storage/*`; active-writer guarded writes do not bump the domain revision.                                                                                                      |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json`, `data/__known_session_token_hashes.json` | Single-user password data, registered browser public-key hashes, and optional session-token hashes.                                                                                                                  |

Primary boundaries: `db.ts` owns schema/migrations/revision, `repository.ts`
owns domain load/write/projection/import/export/assets/backups, `messageStore.ts`
owns message tables, and `commands/mutations.ts` owns command transactions.

## Revision Contract

Normal command mutations use optimistic concurrency:

1. Read `baseRevision`.
2. Compare it with `schema_version.revision`.
3. Load the needed SQLite-backed domain shape.
4. Mutate through server validators/helpers.
5. Write changed table families in one transaction.
6. Bump the revision exactly once.
7. Persist one command event for that revision.
8. Commit, then emit the live event.

Stale clients receive 409. Browser command helpers cache the latest revision
from bootstrap, command responses, and event reconciliation.

Command-event resources should be narrow. Examples include `characterSelection`
for selected-character fields, `characterRow` for one-character metadata, and
`generation` for `generation.persisted` events keyed by `parentId` = chat id.
That generation event may return projection mode `generation-chat`.

## Server-Owned Exceptions

These paths still need explicit auth and active-writer decisions, but they are
not ordinary browser `/commands/*` resource endpoints:

- First-run `POST /api/v1/commands/state/initialize` creates default server
  state and does not accept a browser database payload.
- Asset upload writes asset metadata/bytes and emits `asset.created`; duplicate
  uploads can be idempotent without a new revision.
- `.risu` import, bundle import, Realm import, and backup restore use
  repository/server-owned paths.
- Server generation finalization writes through targeted command mutation and
  emits `generation.persisted`.
- Memory job create/cancel writes durable memory-job state and emits memory
  events without a domain revision.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces repository state and emits `state.restored`.

## Auth And Active Writer

Auth is single-user and route-local. `server/fastify/src/auth.ts` stores
password/public-key state, `server/fastify/src/http.ts` exposes `requireAuth()`,
and route handlers call it manually unless intentionally public. Browser auth
assertions are sent in `risu-auth`; `/api/v1/auth/crypto` is a public
compatibility hashing helper.

The active-writer guard is separate. Writer-intent bootstrap latches the latest
`risu-writer-session`; guarded mutations from stale sessions receive
`423 active_writer_stale`. Read-only bootstrap/projection/event routes do not
need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions.

## Projection And Hydration

`GET /api/v1/bootstrap` returns revision, schema version, asset base URL,
`activeGenerationJobs`, and a lean database projection. If no database exists,
the browser calls `commands/state/initialize` and refetches bootstrap read-only.

Bootstrap and broad targeted projections ship chat metadata with empty
`message[]`. Heavy fields hydrate on demand:

| Data                                                | Endpoint                                          |
| --------------------------------------------------- | ------------------------------------------------- |
| Active chat messages                                | `GET /api/v1/projection/chatMessages?id=...`      |
| Many chat histories                                 | `POST /api/v1/projection/chatMessages/bulk`       |
| Character lorebook when `enableLorebookStubs` is on | `GET /api/v1/projection/characterLorebook?id=...` |
| Many character lorebooks                            | `POST /api/v1/projection/characterLorebooks/bulk` |

Browser wrappers live in `src/ts/server/projection.ts`; hydration/cache logic
lives in `src/ts/server/chatMessageHydration.svelte.ts`.

## SSE And Streaming

`GET /api/v1/events` replays SQLite `command_events` for cursor reconnects,
then streams live command-sink events plus live memory events. Clients subscribe
with `sinceRevision` or `Last-Event-ID`; replay gaps return
`409 event_replay_unavailable`, after which the browser performs a read-only
full bootstrap before resubscribing. Memory events are not replayed.

Browser reconcile rules: skip own echoes and already-applied revisions, fetch a
targeted projection for contiguous foreign events, and fall back to full
bootstrap for gaps, unknown resources, replay misses, or projection errors.
Memory events update Hypa V3 job/progress UI directly.

Other streaming/binary surfaces include chat generation SSE, optional completion
SSE, optional Realm progress SSE, proxy stream WebSocket attachment, asset
bytes, `.risu`/bundle export, and proxy/hub/storage binary passthrough. SSE/raw
writers use `server/fastify/src/streamBackpressure.ts` to cap buffered bytes.
