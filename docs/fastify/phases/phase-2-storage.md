# Phase 2 - Storage, Import, Assets, Backups

Date: 2026-05-20

Historical note: Phase 2 is closed. References below to Express or
the gap before proxy migration describe the state during Phase 2;
Phase 3 later moved the proxy / hub / legacy storage surfaces to
Fastify and deleted `server/node/`.

## Goal

Give the Fastify server a place to keep Risuai state so callers can
bootstrap from `/api/v1/bootstrap`. Ship JSON import,
content-addressed assets, server-side backups, static SPA serving,
and the Docker runtime switch against that store.

Server-side `.risu` export and bundle export are not Phase 2
deliverables. The client still owns `.risu` encode/decode during the
migration window; Phase 9 moves the codec once the browser no longer
owns a complete in-memory Database.

Phase 2 deliberately does **not** design a domain SQL schema. The
client today operates on a single in-memory `Database` blob and is
not split into per-resource readers; building 25 SQL tables now would
mirror that current shape, which Phase 9 then tears apart. We avoid
the wasted middle step by persisting the blob as a single JSON file
during the migration window and migrating fields into SQL tables
_per resource_ when Phases 5-9 carve out their APIs and learn the
shape each one actually needs.

## Migration-window assumption

No real users run the Fastify server until the migration is
complete. Concretely:

- One writer at a time. No concurrent-import races.
- Dev / test data sizes only. `db.json` is not expected to grow into
  hundreds of megabytes during this period.
- Stitching bugs at the SQL <-> JSON boundary surface as developer
  bugs, not silent user data loss.

These assumptions are the reason this phase can be much smaller than
a production-grade storage layer. If the assumption ever breaks
(e.g. we hand a partially-migrated build to early users), revisit
the items under [Boundaries](#boundaries) before exposing it.

## Preconditions

- Phase 1 closed.

## Status

Server-side Phase 2 landed on 2026-05-20:

- Implemented route files:
  `server/fastify/src/routes/{bootstrap,save,assets,backups}.ts`.
- Implemented storage helpers in `server/fastify/src/repository.ts`.
- Implemented static serving in `server/fastify/src/app.ts`.
- Docker is configured to run `pnpm api:start` on port 6002 with
  `/app/data` persisted. The current production-image dependency
  layout still needs a follow-up because the runtime stage installs
  production dependencies only while `api:start` uses `tsx` and the
  server imports `@fastify/websocket`, both currently
  dev dependencies.
- Covered by `server/fastify/__tests__/{bootstrap,assets,backups,static}.test.ts`.

The browser is not yet thinned into a server-backed projection; that
remains Phase 9. Local and Tauri storage paths remain in the client.
The legacy NodeStorage path still exists as a compatibility adapter,
but in Fastify-served mode it now targets the Phase 3D-Broad
`/api/v1/storage/*` routes.

## Scope

### Persistence layout

```
data/
  risu.db                  # Phase 1 SQLite. System state only:
                           # schema_version and revision.
  __password               # Fastify auth password, if configured.
  __known_public_key_hashes.json
                           # Hashes of browser public keys seen at login.
  db.json                  # The whole `Database` blob, plus a
                           # `_version` integer at the top level.
  assets/<sha256>.<ext>    # Content-addressed asset blobs.
  backups/<id>/
    db.json                # Snapshot of db.json at backup time.
    manifest.json          # Snapshot revision + uploaded asset count.
```

`risu.db` keeps the Phase 1 `schema_version(id, version, revision)`
table and grows only when SQLite-backed system metadata is added.
Fastify auth currently uses the sibling files shown above.
**Domain data does not go into `risu.db` in Phase 2.**

`db.json` shape:

```jsonc
{
  "_version": 1, // bumped when the JSON shape changes
  "database": {
    /* Database-shaped JSON */
  },
  "assets": [
    // metadata for uploaded blobs
    { "id": "<sha256>", "ext": "png", "size": 12345, "contentType": "image/png" },
  ],
}
```

Writes are tempfile + atomic rename. No in-process mutex during
Phase 2; the migration-window assumption above covers concurrency.

### Shared types

The server stores the imported database blob as `unknown` in Phase 2.
The authoritative client shape remains `Database` in
`src/ts/storage/database.svelte.ts`; no pure shared
`RisuSavedDatabase` module exists in this codebase yet. Add one only
when client/server helpers need a compile-time contract instead of a
JSON passthrough.

### Repository

`server/fastify/src/repository.ts` owns:

- `loadPersisted(dataDir)` -> `{ _version, database, assets }`;
  returns `{ _version: 1, database: null, assets: [] }` when
  `db.json` is absent.
- `writePersisted(dataDir, next)` -> writes `db.json.tmp` and
  atomically renames it. Revision bumps happen in the caller.
- `applyImport(db, dataDir, database)` -> validates that the
  `database` field is present, replaces `db.json.database`, and
  bumps `schema_version.revision`.
- `addAsset`, `assetById`, `assetPath`, and `missingAssetIds` for
  content-addressed blobs.
- `createBackup`, `listBackups`, `restoreBackup`, and
  `deleteBackup` for `data/backups/<id>/`.
- Typed errors that map to HTTP: `RevisionMismatchError` -> 409
  for later phases, `EntityNotFoundError` -> 404, and
  `ValidationError` -> 400.

When Phase 5+ extracts a resource (say characters) into SQL, the
repository adds:

- A `characters` SQL table with a schema shaped for its API.
- A one-time boot migration that moves `db.json.database.characters`
  into rows and deletes the key from `db.json`.
- A stitching layer around `loadPersisted().database` that joins SQL
  rows back into the browser-facing database shape until Phase 9 cuts
  whole-database reads entirely.

### Assets

Uploads are raw-binary, not multipart. The request body is the asset
bytes; `Content-Type` carries the format and must be in a small
allowlist (`image/{png,jpeg,webp,gif,avif}`,
`audio/{mpeg,wav,ogg,webm}`, `video/{mp4,webm}`). Types without a
registered parser are rejected with 415 by Fastify; parsed bodies
that are not supported raw asset bytes are rejected by the route.
Single-asset uploads do not use multipart.

- `POST /api/v1/assets` (auth-gated): reads the raw body, computes
  `sha256`, writes `data/assets/<sha256>.<ext>` if not already
  present, appends to `db.json.assets`, bumps revision. Idempotent
  by content: re-uploading the same bytes is a no-op and does not
  bump revision. Returns `{ assetId, size, contentType, revision }`.
- `GET /api/v1/assets/:id` serves the file with the stored
  `Content-Type` and an immutable one-year `Cache-Control` header.
  Public (no auth) - ids are SHA-256-derived and unguessable.
  Invalid id format (not 64 hex chars) returns 404.
- `HEAD /api/v1/assets/:id` mirrors GET's headers with no body.
  Same public policy as GET; the information overlap is total, so
  auth-gating one without the other buys nothing. Used by the
  client to skip uploading bytes it already knows the server has.
- `POST /api/v1/assets/exists` (public, same trust model) accepts
  `{ ids: string[] }` and returns `{ missing: string[] }`. Lets a
  client pre-flight many ids in one round-trip - useful when the
  client is about to upload a batch of assets it decoded out of a
  local `.risu` save.
- Reference tracking and the populated `assetReport` ship in a
  later slice. 2C leaves `assetReport` at zeros, matching 2A.
- No `DELETE /api/v1/assets/:id` in Phase 2. Without GC, delete is
  an accountancy-only op; it lands when GC does.
- Asset GC is **not shipped in Phase 2.** A `POST /api/v1/assets/gc`
  endpoint can be added later when orphan accumulation matters.

### Save import and client-side export

Phase 2 ships a JSON-only import. The binary `.risu` codec stays
client-side until Phase 9 thins the client enough that it can no
longer own a Database in memory; only then does the server have a
real reason to learn the format.

- `POST /api/v1/import/risusave` accepts a JSON body
  `{ database: <Database-shaped JSON> }`. Replaces `db.json.database`,
  bumps revision, and returns the new revision plus a zeroed
  `assetReport`. The populated `assetReport` lands when reference
  walking does.

**No `.risu` decode, encode, or bundle in Phase 2.** Rationale and
the consuming flows:

- **Save import.** The client decodes `legacy.risu` locally using
  the existing `src/ts/storage/risuSave.ts`, then POSTs the
  resulting database as JSON to the endpoint above. Asset blobs
  inside the save are uploaded separately via `POST /api/v1/assets`
  (pre-flighted with `POST /api/v1/assets/exists`).
- **Save export.** The client calls `GET /api/v1/bootstrap`, then
  encodes locally with the same `risuSave.ts`, and offers the
  user a `.risu` download.
- **Bundle download.** Same shape - client fetches bootstrap +
  whichever asset blobs it wants, zips locally.
- **Hub passthrough.** Phase 3's `/api/v1/hub/*` proxies bytes
  unchanged; it never parses `.risu`.

This deferral is the same call as deferring SQL schema in Phase 2:
a `.risu` codec written today would mirror the current fat-Database
shape that Phase 9 reshapes. Building the codec once we know the
end-state model is cheaper than building + reworking.

The grep before deferring confirmed no existing client flow points
at `/api/v1/import/risusave` with binary bytes - the endpoint
remains JSON-only without breaking pre-existing behavior.

### Backups

All four routes are auth-gated unconditionally - backups contain the
whole database, so they are not in the same "id-is-bearer" trust
class as assets.

- `POST /api/v1/backups` accepts optional `{ label }`. Snapshots
  `db.json` into `data/backups/<id>/db.json`, writes a
  `manifest.json` next to it, returns the manifest. Does **not**
  bump revision - snapshots are reads, not mutations.
- `GET /api/v1/backups` returns `{ backups: [...] }`, sorted
  newest-first by `createdAt`.
- `POST /api/v1/backups/:id/restore` replaces the live `db.json`
  with the snapshot (tempfile + rename), bumps revision, returns
  `{ revision }`.
- `DELETE /api/v1/backups/:id` removes the backup directory,
  returns `{ id }`. 404 on unknown id (not idempotent 204 -
  explicit signal beats silent success).

Manifest shape:

```jsonc
{
  "_version": 1,
  "id": "2026-05-20-17-30-42-a4f9c2",
  "label": null, // or a string
  "createdAt": "2026-05-20T17:30:42.000Z",
  "revision": 7,
  "assetCount": 12,
}
```

Backup ids match `^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$`
(UTC timestamp + 6 random hex). Sortable, readable, and the strict
regex makes path-traversal attempts on `:id` fail at validation
before they touch the filesystem.

`assetCount` is `persisted.assets.length` - the count of _uploaded_
assets at backup time, **not** assets referenced by the database.
The referenced count requires walking the database for ids, which
needs the encoding to be locked; that comes in a later slice
together with the populated `assetReport`.

Backups copy `db.json` only; the content-addressed asset blobs at
`data/assets/<sha>.<ext>` are shared across backups. Since 2C ships
no delete or GC, those blobs stay reachable. When asset GC lands,
its sweep must walk all backups too - otherwise restoring an old
backup could surface dangling references.

Out of scope for 2D: retention/rotation, label edits, and
snapshotting the asset blobs alongside the database.

### Bootstrap

- `GET /api/v1/bootstrap` returns
  `{ revision, schemaVersion, database, assetBaseUrl }`. `database`
  is `repository.loadPersisted(dataDir).database`.
  `assetBaseUrl` is the stable string `/api/v1/assets`.

### Container changes

The image's runtime stage switched from the Express server
(`pnpm runserver`, port 6001, `save/` volume) to Fastify
(`pnpm api:start`, port 6002, `data/` volume). The Express source
files stayed in the tree until Phase 3 retired them; the container
stopped targeting them in Phase 2.

- `Dockerfile`: `CMD pnpm api:start`, `EXPOSE 6002`,
  `VOLUME /app/data`, env `RISU_API_DATA_DIR=/app/data` and
  `RISU_API_STATIC_ROOT=/app/dist`.
- `docker-compose.yml`: maps `6002:6002`, mounts
  `risuai-data:/app/data`.
- Fastify serves `dist/` via `@fastify/static` (registered with
  `wildcard: false`) so a single container runs API + SPA. The
  not-found handler returns `dist/index.html` for any GET that is
  neither a registered API route nor a static file, giving the SPA
  client-side router its catch-all. Non-GET and `/api/*` 404s are
  passed through.
- `RISU_API_STATIC_ROOT` defaults to `<repoRoot>/dist`. Set to
  empty / `none` / `off` to disable static serving (handy in dev
  and in the test harness when there is no SPA build).

Phase 3 has since ported the proxy, hub, and legacy storage
compatibility routes, so the container target is again a
single-process Fastify server with the migrated server surface.
Before using it as a production image, fix the runtime dependency
layout noted above. During the historical gap between 2E and Phase
3, the image was missing provider proxy / hub passthrough / legacy
storage compatibility - acceptable under the no-live-users migration
window.

## Boundaries

- **No domain SQL tables in Phase 2.** Domain data stays in
  `db.json`. SQL tables for individual resources land per-resource in
  Phases 5-9, at the point a per-resource API needs them.
- **No commands.** Per-resource mutations land later (Phase 5/6 via
  the sendChat flow + Phase 9 client thinning), not here. Users still
  mutate state by uploading a new save.
- **No SSE event stream yet.** That lands when commands do.
- **No write concurrency control.** A single tempfile + rename is
  the entire write protocol. If Phase 3 / 4 introduces a second
  writer before per-resource SQL lands, add an async mutex around
  `writePersisted()` callers then.
- **No encryption-at-rest.** `RISU_ENCRYPTION_KEY` is a Phase-9
  consideration; we land Phase 2 with cleartext to keep the delta
  reviewable.
- **No asset GC.** Orphaned blobs cost disk only. Defer until a
  caller needs it.
- **No legacy unversioned `/api/read` / `/api/write` / `/api/list`
  ports in Phase 2.** Phase 3D-Broad later added the versioned
  Fastify compatibility surface at `/api/v1/storage/*`; the
  unversioned Express paths remain deleted with `server/node/`.
- **No server-side `.risu` codec.** Decode and encode stay
  client-side (`src/ts/storage/risuSave.ts`) until Phase 9 forces
  the move. The server is JSON-native through Phase 2.
- **No bundle export endpoint.** Client assembles bundles locally
  from `/api/v1/bootstrap` + asset GETs.
- **No group-chat fields.** Removed in Phase 0.

## Exit criteria

- `pnpm api:test` covers:
  - Bootstrap on a fresh data dir: returns revision 0,
    schema version 0, `database: null`, and
    `assetBaseUrl: '/api/v1/assets'`.
  - JSON import round-trip: import `{ database }` -> bootstrap
    returns the same database.
  - Asset upload writes the new asset metadata into `db.json.assets`;
    HEAD and `/exists` see it; GET serves bytes.
  - Backup create / restore / delete using a fixture database, with
    a full A -> backup -> B -> restore -> A round-trip.
  - Revision bumps on every mutation surface in this phase (import,
    asset upload, backup restore). Backup _create_ does not bump.
  - Static serving: `dist/index.html`, nested assets, SPA fallback
    for unknown non-API GETs, no fallback for `/api/*` or non-GET
    routes, and API behavior when static serving is disabled.
- A caller can hydrate the server by decoding a local `.risu` file
  client-side and posting the resulting JSON database plus asset
  uploads. The browser is not yet rewired to consume
  `/api/v1/bootstrap`; that belongs to Phase 9 client thinning.
- The Dockerfile/compose target Fastify + SPA serving, with `data/`
  persisted across restarts; the current dependency-layout caveat
  above must be cleared before treating the image as ready.
- `pnpm check`, `pnpm test`, `pnpm build` green.

## Reference

- `move-to-fastify` schema and repository: `0c3de7de` through
  `a1836719` (loadout normalization), `55f421d4` (character order),
  `b6a50d3e` (plugin code/trust). Treat this as a future reference
  for _per-resource_ SQL shapes (Phase 5+), not as the Phase 2 plan.
- `MAPPER_AUDIT.md` on `move-to-fastify` is a useful checklist of
  database fields a future shared type must cover, even though no
  Phase 2 SQL maps them.
