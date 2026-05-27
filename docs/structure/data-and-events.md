# Data And Events

Fastify owns durable state. The browser sees a projected copy and sends
revision-checked commands when it needs persistence.

## Persistence Split

| Store       | Path                                                     | Owner  | Contents                                                                             |
| ----------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| SQLite      | `data/risu.db`                                           | Server | Schema version, global revision, Hypa V3 memory chunks, summaries, embeddings, jobs. |
| Domain JSON | `data/db.json`                                           | Server | The main Risu `Database` blob and asset manifest.                                    |
| Assets      | `data/assets/<sha256>.<ext>`                             | Server | Content-addressed images, audio, video, fonts, CSS, and other supported asset bytes. |
| Backups     | `data/backups/<id>/`                                     | Server | Snapshot `db.json` plus `manifest.json`.                                             |
| Auth files  | `data/__password`, `data/__known_public_key_hashes.json` | Server | Single-user password hash string and registered browser public key hashes.           |

`server/fastify/src/repository.ts` is the main file for `db.json`, assets, and
backups. `server/fastify/src/db.ts` owns SQLite schema setup and revision bumps.

## Revision Contract

The SQLite `schema_version` row contains both schema version and current domain
revision. Revision-tracked command mutations should:

1. Read `baseRevision` from the request body.
2. Load and mutate the domain JSON.
3. Bump the SQLite revision exactly once.
4. Emit exactly one command event.
5. Return the new revision.

Stale clients receive 409. On the browser side, command helpers cache the latest
revision from bootstrap and command responses.

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

## Bootstrap And Projection

`/api/v1/bootstrap` returns the current revision, schema version, database
projection, and asset base URL. Browser startup loads this projection before the
app is marked ready.

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

The current browser behavior is conservative: command events schedule a debounced
bootstrap refresh instead of patching the local projection resource-by-resource.
That makes command event correctness important, but it also means UI state often
updates after the refresh debounce rather than instantly in the original command
call stack.

## Binary And Streaming Surfaces

Most routes use Fastify's normal JSON parsing. Binary passthrough routes use a
scoped parser setup with `removeAllContentTypeParsers()` and a buffer parser.
Check `routes/proxy.ts`, `routes/hub.ts`, and `routes/legacyStorage.ts` before
changing body parser behavior.

Streaming surfaces write directly to raw replies or WebSockets:

- `routes/generationChat.ts` writes chat SSE frames and aborts on client close.
- `routes/events.ts` hijacks the response for command/memory SSE.
- `routes/streamJobs.ts` creates proxy stream jobs and attaches WebSockets.
