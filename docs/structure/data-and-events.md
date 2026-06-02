# Data And Events

Fastify owns durable state. The browser receives a projected copy and sends
revision-checked commands or explicit server-owned mutation requests when it
needs persistence.

## Persistence Split

| Store            | Path                                                     | Contents                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                           | `schema_version` with current domain revision; settings; characters/chats; collection tables; plugin storage; asset metadata; chat messages and reroll alternates; per-chat `hypaV3Data`; Hypa V3 memory tables/jobs; command-event replay history; durable generation finalization retries. |
| Asset bytes      | `data/assets/<sha256>.<ext>`                             | Content-addressed bytes for images, audio, video, fonts, CSS, ONNX, inlay signatures, and other supported asset types. Metadata is in SQLite `assets`.                                                                                                                                       |
| Backups          | `data/backups/<id>/`                                     | Snapshot `risu.db`, `assets/`, `save/`, and `manifest.json`. Older backups may carry `db.json`; restore imports it for compatibility.                                                                                                                                                        |
| Legacy `db.json` | `data/db.json`                                           | Not current storage. On boot, `ensureDbJsonImported()` imports a legacy file into SQLite and renames it to `db.json.migrated`.                                                                                                                                                               |
| Legacy storage   | `data/save/<hex-key>`                                    | Compatibility byte store for active `/api/v1/storage/*` routes. Writes/removes are active-writer guarded but do not bump the domain revision.                                                                                                                                                |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json` | Single-user password data and registered browser public-key hashes.                                                                                                                                                                                                                          |

Primary boundaries:

- `server/fastify/src/db.ts` owns schema setup, migrations, `schema_version`,
  and revision bumps.
- `server/fastify/src/repository.ts` loads/writes SQLite-backed domain state,
  handles legacy `db.json` import, asset metadata, projections, import/export,
  and backup/restore.
- `server/fastify/src/messageStore.ts` owns `messages`, `chat_hypa_v3`, and
  reroll alternates.
- `server/fastify/src/commands/mutations.ts` owns revision-checked command
  transactions.

## Revision Contract

Normal command mutations use optimistic concurrency:

1. Read `baseRevision` from the request.
2. Compare it with `schema_version.revision`.
3. Load the needed SQLite-backed database shape.
4. Mutate through server validators/helpers.
5. Write changed SQLite table families in one transaction.
6. Bump the revision exactly once.
7. Persist one command event for that revision.
8. Commit, then emit the live event.

Stale clients receive 409. Browser command helpers cache the latest revision
from bootstrap, command responses, and event reconciliation.

Command-event resources should be narrow. For example, `character.selected`
emits `resource: "characterSelection"` so the client refreshes only selected
character fields instead of replacing the full character array.

Server-owned exceptions still need explicit auth and active-writer decisions:

- First-run `POST /api/v1/commands/state/initialize` creates default server
  state and does not accept a browser database payload.
- Asset upload writes asset metadata/bytes and emits `asset.created`; duplicate
  uploads can be idempotent without a new revision.
- `.risu` import, bundle import, Realm import, backup restore, and generation
  result persistence use repository/server-owned paths rather than ordinary
  resource commands.
- Memory job create/cancel writes durable SQLite memory-job state and emits
  memory events without a domain revision.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces repository state and emits `state.restored`.

## Auth And Active Writer

Auth is single-user and route-local:

- `server/fastify/src/auth.ts` stores password/public-key state.
- `server/fastify/src/http.ts` exposes `requireAuth()`.
- Route handlers call `requireAuth()` manually unless intentionally public.
- Browser auth assertions are sent in `risu-auth`.
- `/api/v1/auth/crypto` is a public compatibility hashing helper registered
  from `routes/legacyStorage.ts`.

The active-writer guard is separate. Writer-intent bootstrap latches the latest
`risu-writer-session`; guarded mutations from stale sessions receive
`423 active_writer_stale`. Read-only bootstrap/projection/event routes do not
need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions. Add
a manifest entry when adding any route.

## Bootstrap And Projection

`GET /api/v1/bootstrap` returns revision, schema version, asset base URL,
`activeGenerationJobs`, and a lean database projection. If no database exists,
the browser calls `commands/state/initialize` and refetches bootstrap read-only.

Projection is intentionally lean:

- Bootstrap and broad targeted projections ship chat metadata with empty
  `message[]`; the active chat hydrates through
  `GET /api/v1/projection/chatMessages?id=...`.
- That hydration response includes messages, per-chat `hypaV3Data`, and reroll
  alternates.
- If `enableLorebookStubs` is on, character `globalLore` hydrates through
  `GET /api/v1/projection/characterLorebook?id=...`.
- Read-many flows use bulk POST endpoints:
  `/api/v1/projection/chatMessages/bulk` and
  `/api/v1/projection/characterLorebooks/bulk`.

Browser wrappers live in `src/ts/server/projection.ts`; hydration/cache logic
lives in `src/ts/server/chatMessageHydration.svelte.ts`.

## SSE Events

`GET /api/v1/events` streams:

- `command` events with revision, resource, and optional ids.
- `memory` events for live Hypa V3 job/progress updates.

Command events are persisted in SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. Clients subscribe with `sinceRevision`
or `Last-Event-ID`; replay gaps return `409 event_replay_unavailable`, after
which the browser performs a read-only full bootstrap before resubscribing.

Browser reconcile rules:

- Own echoes and already-applied revisions are skipped.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- Gaps, unknown/sprawling resources, replay-unavailable responses, or projection
  errors fall back to full bootstrap.
- Memory events bypass projection refresh and update memory-job UI state.

Live-only command-shaped events such as `state.exported` are no-op projection
notifications and are not replayed.

## Binary And Streaming

Most routes use normal JSON parsing. Special cases:

- Raw asset uploads use the supported asset content-type parser registered in
  `buildApp()`.
- Multipart `.risu` import uses `@fastify/multipart`.
- Device-backup bundle import streams to disk and is capped by
  `RISU_API_IMPORT_MAX_BYTES`, separate from normal body limit.
- Proxy/hub/storage binary routes use scoped parser behavior.

Streaming surfaces:

- `/api/v1/events` command/memory SSE.
- `/api/v1/generate/chat` chat SSE, including durable detach/reattach behavior.
- `/api/v1/generate/completion` completion SSE when requested.
- `/api/v1/import/realm-character` optional progress SSE.
- `/api/v1/proxy/stream-jobs/:id/ws` WebSocket proxy stream attachment.

SSE/raw writers use `server/fastify/src/streamBackpressure.ts` to cap buffered
bytes for slow clients.
