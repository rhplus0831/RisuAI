# Phase 2 - Storage, Import, Export, Assets

Date: 2026-05-20

## Goal

Give the Fastify server a place to keep Risuai state so a client can
fully bootstrap from `/api/v1/bootstrap`. Ship import / export and
server-side backups against that store.

Phase 2 deliberately does **not** design a domain SQL schema. The
client today operates on a single in-memory `Database` blob and is
not split into per-resource readers; building 25 SQL tables now would
mirror that current shape, which Phase 9 then tears apart. We avoid
the wasted middle step by persisting the blob as a single JSON file
during the migration window and migrating fields into SQL tables
*per resource* when Phases 5-9 carve out their APIs and learn the
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

## Scope

### Persistence layout

```
data/
  risu.db                  # Phase 1 SQLite. System state only:
                           # schema_version, revision, auth meta.
  db.json                  # The whole `Database` blob, plus a
                           # `_version` integer at the top level.
  assets/<sha256>.<ext>    # Content-addressed asset blobs.
  backups/<id>/
    db.json                # Snapshot of db.json at backup time.
    manifest.json          # Snapshot revision + referenced assets.
```

`risu.db` keeps the Phase 1 `schema_version(id, version, revision)`
table and grows only when system-level metadata is added (auth,
counters). **Domain data does not go into `risu.db` in Phase 2.**

`db.json` shape:

```jsonc
{
  "_version": 1,                 // bumped when the JSON shape changes
  "database": { /* RisuSavedDatabase */ },
  "assets": [                    // metadata for uploaded blobs
    { "id": "<sha256>", "ext": "png", "size": 12345, "contentType": "image/png" }
  ]
}
```

Writes are tempfile + atomic rename. No in-process mutex during
Phase 2; the migration-window assumption above covers concurrency.

### Shared types

`src/ts/shared/databaseTypes.ts` holds the pure `RisuSavedDatabase`
shape (no Svelte / DOM / Tauri imports) so the client and the server
agree on the on-disk JSON. The client re-exports it from its current
location so existing callers do not move.

### Repository

`server/fastify/src/repository.ts` owns:

- `loadDatabase()` -> `RisuSavedDatabase | null` (reads `db.json`;
  returns `null` when the file is absent). The client treats `null`
  as "no save yet" and builds its own default; the server does not
  embed `defaultDatabase()`.
- `writeDatabase(next)` -> bumps `revision` in `risu.db`, writes
  `db.json.tmp`, renames.
- Typed errors that map to HTTP: `RevisionMismatchError` -> 409,
  `EntityNotFoundError` -> 404, `ValidationError` -> 400. Phase 2
  only emits `ValidationError` (no resource handlers yet), but the
  classes ship now so later phases can import them without churn.

When Phase 5+ extracts a resource (say characters) into SQL, the
repository adds:

- A `characters` SQL table with a schema shaped for its API.
- A one-time boot migration that moves `db.json.database.characters`
  into rows and deletes the key from `db.json`.
- A stitching layer in `loadDatabase()` that joins SQL rows back into
  the `RisuSavedDatabase` shape until Phase 9 cuts whole-database
  reads entirely.

### Assets

Uploads are raw-binary, not multipart. The request body is the asset
bytes; `Content-Type` carries the format and must be in a small
allowlist (`image/{png,jpeg,webp,gif,avif}`,
`audio/{mpeg,wav,ogg,webm}`, `video/{mp4,webm}`). Unknown types are
rejected with 415 by Fastify (no parser registered). Multipart
uploads earn their keep only when one
request carries multiple parts, which happens for the `.risu` bundle
import in 2B; single-asset uploads do not need it.

- `POST /api/v1/assets` (auth-gated): reads the raw body, computes
  `sha256`, writes `data/assets/<sha256>.<ext>` if not already
  present, appends to `db.json.assets`, bumps revision. Idempotent
  by content: re-uploading the same bytes is a no-op and does not
  bump revision. Returns `{ assetId, size, contentType }`.
- `GET /api/v1/assets/:id` serves the file with the stored
  `Content-Type` and `Cache-Control: public, max-age=31536000,
  immutable`. Public (no auth) - ids are SHA-256-derived and
  unguessable. Invalid id format (not 64 hex chars) returns 404.
- `HEAD /api/v1/assets/:id` mirrors GET's headers with no body.
  Same public policy as GET; the information overlap is total, so
  auth-gating one without the other buys nothing. Used by the
  client to skip uploading bytes it already knows the server has.
- `POST /api/v1/assets/exists` (public, same trust model) accepts
  `{ ids: string[] }` and returns `{ missing: string[] }`. Lets a
  client pre-flight many ids in one round-trip; rolls into the 2B
  `.risu` import flow without an extra endpoint then.
- Reference tracking and the populated `assetReport` ship in a
  later slice. 2C leaves `assetReport` at zeros, matching 2A.
- No `DELETE /api/v1/assets/:id` in Phase 2. Without GC, delete is
  an accountancy-only op; it lands when GC does.
- Asset GC is **not shipped in Phase 2.** A `POST /api/v1/assets/gc`
  endpoint can be added later when orphan accumulation matters.

### Save import / export

Slice 2A (bootstrap + JSON import):

- `POST /api/v1/import/risusave` accepts a JSON body
  `{ database: <RisuSavedDatabase> }`. Replaces `db.json.database`,
  bumps revision, returns
  `{ revision, assetReport: { referencedCount, missingCount,
  orphanedCount } }`. Asset counts are zero in 2A; they become
  meaningful once asset upload lands.

Slice 2B (binary `.risu` + bundle):

- `POST /api/v1/import/risusave` widens to also accept multipart
  with a binary `.risu` blob. The server decodes the magic-header
  + msgpackr block format (mirroring `src/ts/storage/risuSave.ts`)
  and applies the resulting database the same way 2A does.
- `GET /api/v1/export/risusave` returns the legacy single `.risu`
  blob, for compatibility with the Risu hub.
- `GET /api/v1/export/bundle` returns a ZIP containing `save.risu`,
  every referenced asset under `assets/<sha256>.<ext>`, and a
  `manifest.json` with revision and asset counts.

The endpoint name `/api/v1/import/risusave` is stable across both
slices; 2A supports JSON only, 2B widens to the binary multipart
form.

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
  "label": null,                         // or a string
  "createdAt": "2026-05-20T17:30:42.000Z",
  "revision": 7,
  "assetCount": 12
}
```

Backup ids match `^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$`
(UTC timestamp + 6 random hex). Sortable, readable, and the strict
regex makes path-traversal attempts on `:id` fail at validation
before they touch the filesystem.

`assetCount` is `persisted.assets.length` - the count of *uploaded*
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
  is the `RisuSavedDatabase` produced by `repository.loadDatabase()`.
  `assetBaseUrl` is the stable string `/api/v1/assets`.

### Container changes

The image's runtime stage switches from the Express server
(`pnpm runserver`, port 6001, `save/` volume) to Fastify
(`pnpm api:start`, port 6002, `data/` volume). The Express source
files stay in the tree until Phase 3 retires them; the container
just no longer runs them.

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

Once Phase 3 ports the proxy and hub, the container is again a
single-process image with full functionality. During the gap
between 2E and Phase 3, the image is missing provider proxy / hub
passthrough / `/api/read|write|list` - acceptable under the
no-live-users migration window.

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
  `writeDatabase()` then.
- **No encryption-at-rest.** `RISU_ENCRYPTION_KEY` is a Phase-9
  consideration; we land Phase 2 with cleartext to keep the delta
  reviewable.
- **No asset GC.** Orphaned blobs cost disk only. Defer until a
  caller needs it.
- **No legacy `/api/read` / `/api/write` / `/api/list` ports.** The
  Express server owns those during the migration; Fastify does not
  reimplement file-based saves.
- **No group-chat fields.** Removed in Phase 0.

## Exit criteria

- `pnpm api:test` covers:
  - Bootstrap on a fresh data dir: returns
    `{ revision: 0, schemaVersion: <phase-1 value>, database:
    defaultDatabase(), assetBaseUrl: '/api/v1/assets' }`.
  - Bootstrap round-trip: empty -> import a fixture `.risu` ->
    bootstrap returns the imported database -> export returns a blob
    equal to the import.
  - Asset upload + bootstrap response references the new asset id.
  - Backup create / restore / delete using a fixture database.
  - Revision bumps on every mutation surface added in this phase
    (import, backup restore).
- A user can upload a `.risu` save through `/api/v1/import/risusave`
  and the SPA boots against `/api/v1/bootstrap`. (The browser client
  wiring lands incrementally; by end of Phase 2 it can at least
  display the imported database.)
- The Docker image runs Fastify + serves the SPA, with `data/`
  persisted across restarts.
- `pnpm check`, `pnpm test`, `pnpm build` green.

## Reference

- `move-to-fastify` schema and repository: `0c3de7de` through
  `a1836719` (loadout normalization), `55f421d4` (character order),
  `b6a50d3e` (plugin code/trust). Treat this as a future reference
  for *per-resource* SQL shapes (Phase 5+), not as the Phase 2 plan.
- `MAPPER_AUDIT.md` on `move-to-fastify` is a useful checklist of
  fields the shared `RisuSavedDatabase` type must cover, even though
  no Phase 2 SQL maps them.
