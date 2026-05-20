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

- `loadDatabase()` -> `RisuSavedDatabase` (reads `db.json`; returns
  `defaultDatabase()` if absent).
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

- `POST /api/v1/assets` (multipart) writes the blob to
  `data/assets/<sha256>.<ext>`, appends an entry to
  `db.json.assets`, returns `{ assetId, sha256, size, contentType }`.
- `GET /api/v1/assets/:id` serves the file with the right
  `Content-Type` and a long cache header. Public (no auth) - ids are
  SHA-256-derived and unguessable.
- `DELETE /api/v1/assets/:id` removes the `db.json.assets` entry; the
  on-disk file is left in place until GC.
- Reference tracking is a JSON walk: `findReferences(db, assetId)`
  scans the `RisuSavedDatabase` for the id. No `asset_references`
  table.
- Asset GC is **not shipped in Phase 2.** A `POST /api/v1/assets/gc`
  endpoint can be added later when orphan accumulation matters.

### Save import / export

- `POST /api/v1/import/risusave` accepts JSON or multipart. Buffers
  every multipart part, saves uploaded assets first, replaces
  `db.json` with the decoded `RisuSavedDatabase`, bumps revision,
  returns `{ revision, assetReport: { referencedCount, missingCount,
  orphanedCount } }`.
- `GET /api/v1/export/risusave` returns the legacy single `.risu`
  blob (msgpackr-encoded `RisuSavedDatabase`), for compatibility with
  the Risu hub.
- `GET /api/v1/export/bundle` returns a ZIP containing `save.risu`,
  every referenced asset under `assets/<sha256>.<ext>`, and a
  `manifest.json` with revision and asset counts.

### Backups

- `GET /api/v1/backups` lists `backups/*/manifest.json`.
- `POST /api/v1/backups` copies the current `db.json` and writes a
  `manifest.json` listing the revision and referenced assets.
- `POST /api/v1/backups/:id/restore` overwrites `db.json` with the
  snapshot, bumps revision.
- `DELETE /api/v1/backups/:id` removes the backup directory.

### Bootstrap

- `GET /api/v1/bootstrap` returns
  `{ revision, schemaVersion, database, assetBaseUrl }`. `database`
  is the `RisuSavedDatabase` produced by `repository.loadDatabase()`.
  `assetBaseUrl` is the stable string `/api/v1/assets`.

### Container changes

- `Dockerfile` exposes `/app/data` as a volume.
- `docker-compose.yml` mounts `risuai-data:/app/data`.
- Fastify serves `dist/` via `@fastify/static` so a single container
  can run API + SPA.

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
