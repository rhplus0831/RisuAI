# Phase 2 - Storage, Import, Export, Assets

Date: 2026-05-20

## Goal

Move Risuai's persisted state into SQLite + content-addressed
assets on disk, owned by the Fastify server. Provide Risu save
import / export and server-side backups so a client can fully
bootstrap from `/api/v1/bootstrap`.

## Preconditions

- Phase 1 closed.

## Scope

### Schema

SQLite tables extend the Phase 1 database at `data/risu.db`:

- `settings(group_name, key, value_json)` - top-level config,
  classified into groups (auth, network, translation, generation,
  ui, account, ...). The classifier is a server-side allowlist;
  unrecognized keys go into `group_name = 'other'`.
- `characters`, `chats`, `messages`, `lorebooks`,
  `lorebook_entries`, `scripts`, `triggers`, `assets`,
  `asset_references`, `presets`, `modules`, `personas`,
  `loadouts`, `loadout_characters`, `loadout_modules`,
  `loadout_variables`, `character_order_entries`,
  `character_order_folder_members`, `plugins`,
  `plugin_storage`, `extension_fields`.
- `backups(id, label, storage_path, created_at)` -
  backup metadata; the actual blob lives at
  `data/backups/<id>.risu`.
- `revision(value)` - the single integer the server bumps on every
  mutation; used as the cursor for `expected_revision` checks.
- `schema_version(id, version, revision)` - already created by
  Phase 1; Phase 2 increments `version` as domain migrations land
  and `revision` as user-visible mutations commit.

Pure shared types (no Svelte / DOM / Tauri) live under
`src/ts/shared/databaseTypes.ts` so both the client and the
server reference the same shape. The server's `repository.ts`
adapts SQL rows into these types.

### Repository

`server/fastify/src/repository.ts` owns SQL <-> domain mapping.
Each mutation runs inside a single transaction; failures throw
typed errors:

- `RevisionMismatchError` -> HTTP 409 with `currentRevision`.
- `EntityNotFoundError` -> HTTP 404.
- `ValidationError` -> HTTP 400.

Reads return domain objects; writes return the new revision.

### Assets

- `POST /api/v1/assets` (multipart) accepts a single asset, stores
  it at `data/assets/<sha256>.<ext>`, inserts an `assets` row,
  returns `{ assetId, sha256, size, contentType }`.
- `GET /api/v1/assets/:id` serves the file with the right
  `Content-Type` and a long cache header. Public (no auth) - asset
  ids are SHA-256-derived and unguessable.
- `DELETE /api/v1/assets/:id` removes the row; the on-disk file is
  garbage-collected when no reference remains.
- `asset_references` rows are written by every repository write
  that mentions an asset id. Imports return an `assetReport`
  with `referencedCount`, `missingCount`, `orphanedCount`.

### Save import / export

- `POST /api/v1/import/risusave` accepts JSON or multipart. Buffers
  every multipart part, saves uploaded assets first, then applies
  the database, then returns the asset report.
- `GET /api/v1/export/risusave` returns the legacy single `.risu`
  blob (msgpackr-encoded), for backward compatibility with the
  Risu hub.
- `GET /api/v1/export/bundle` returns a ZIP with `save.risu`,
  every referenced asset under `assets/<sha256>.<ext>`, and a
  `manifest.json` listing the revision and asset counts.

### Backups

- `GET /api/v1/backups` lists rows.
- `POST /api/v1/backups` snapshots current state, writes a `.risu`
  blob to `data/backups/<id>.risu`, returns the row.
- `POST /api/v1/backups/:id/restore` rolls the DB back to the
  snapshot.
- `DELETE /api/v1/backups/:id` removes both row and blob.

### Bootstrap

- `GET /api/v1/bootstrap` returns
  `{ revision, schemaVersion, database, assetBaseUrl }` where
  `database` is the shared `RisuSavedDatabase` shape.

### Container changes

- `Dockerfile` exposes `/app/data` as a volume.
- `docker-compose.yml` mounts `risuai-data:/app/data`.
- Fastify serves `dist/` via `@fastify/static` so a single container
  can run API + SPA.

## Boundaries

- **No commands yet.** This phase ships bootstrap, import, export,
  assets, and backups. Per-resource mutations land later (Phase 5/6
  via the sendChat flow + Phase 9 client thinning), not here. Users
  still mutate state by uploading a new save.
- **No SSE event stream yet.** That lands when commands do.
- **No encryption-at-rest.** `RISU_ENCRYPTION_KEY` is a Phase-9
  consideration; we land Phase 2 with cleartext to keep the
  delta reviewable.
- **No legacy `/api/read` / `/api/write` / `/api/list` ports.**
  The Express server owns those during the migration; Fastify
  does not reimplement file-based saves.
- **No group chat schema.** Removed in Phase 0.

## Exit criteria

- `pnpm api:test` covers:
  - Bootstrap round-trip: empty DB -> import -> export -> assert
    equal.
  - Asset upload + reference tracking; missing-asset report.
  - Backup create / restore / delete.
  - Revision bumps on every mutation surface added in this phase.
- A user can upload a `.risu` save through `/api/v1/import/risusave`
  and the SPA boots against `/api/v1/bootstrap`. (The browser
  client wiring lands incrementally; by end of Phase 2 it can at
  least display the imported database.)
- The Docker image runs Fastify + serves the SPA, with `data/`
  persisted across restarts.
- `pnpm check`, `pnpm test`, `pnpm build` green.

## Reference

- `move-to-fastify` schema and repository: see `0c3de7de` through
  `a1836719` (loadout normalization), `55f421d4` (character order),
  `b6a50d3e` (plugin code/trust). The shape here matches that work,
  with the exceptions that we drop group-chat and Risu-Account
  rows entirely (Phase 0).
- `MAPPER_AUDIT.md` on `move-to-fastify` is a useful checklist for
  fields that the SQL schema must cover.
