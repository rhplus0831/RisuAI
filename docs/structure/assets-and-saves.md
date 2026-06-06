# Assets And Saves

Fastify owns binary persistence, save import/export, Realm import, and backup
snapshots. Browser code should use server asset URLs and server save routes
instead of writing runtime state directly.

## Assets

| Path                                                    | Role                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `server/fastify/src/routes/assets.ts`                   | `/api/v1/assets`, `/api/v1/assets/bulk`, immutable `GET`/`HEAD`, existence probe.      |
| `server/fastify/src/repository.ts`                      | Asset id validation, sha256 dedupe, SQLite metadata, file paths, missing-asset checks. |
| `server/fastify/src/assetGc.ts`                         | Reference-counted asset garbage collection.                                            |
| `server/fastify/src/risuSave/assetReferences.ts`        | Known-field asset-reference walker for import/export/GC reports.                       |
| `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts` | Browser upload/existence adapters and asset URL normalization.                         |

Asset ids are lowercase sha256 hex strings. Metadata lives in SQLite `assets`;
bytes live at `data/assets/<sha256>.<ext>`. `POST /api/v1/assets` accepts raw
supported asset bytes. `POST /api/v1/assets/bulk` accepts JSON/base64 batches
for import paths. Uploads are authenticated and active-writer guarded; successful
new assets bump the domain revision and emit `asset.created`. Re-uploading
existing bytes is idempotent and can heal a missing file.

`GET` and `HEAD /api/v1/assets/:id` are public immutable reads for ids present in
metadata and on disk. `POST /api/v1/assets/exists` is a public read-only POST
that reports missing ids.

## Asset GC

`runAssetGc()` walks known asset-reference fields across the persisted database,
including hydrated chat messages, then removes unreferenced metadata and stray
files. A grace window based on file mtime protects upload-then-reference races.

`buildApp()` wires periodic GC unless tests pass `assetGc: false`. GC does not
bump the revision or emit command events because it removes only bytes/metadata
that projected state no longer references.

## `.risu` And Bundle Routes

| Path                                                                  | Role                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/fastify/src/routes/save.ts`                                   | Save import/export and device-backup bundle routes.                 |
| `server/fastify/src/risuSave/importSnapshot.ts`                       | Multipart `.risu` decode and import normalization.                  |
| `server/fastify/src/risuSave/exportSnapshot.ts`                       | Repository export into block or legacy envelopes.                   |
| `server/fastify/src/risuSave/bundleExport.ts`                         | Zip bundle export with `.risu` bytes plus present asset files.      |
| `server/fastify/src/risuSave/localBackupImport.ts`                    | Streaming device-backup decode for `.risu.zip` and legacy `.bin`.   |
| `server/fastify/src/risuSave/importLimits.ts`                         | Expanded-payload guard shared by `.risu` and Realm import decoding. |
| `server/fastify/src/risuSave/blockCodec.ts`, `legacyEnvelopeCodec.ts` | Current and legacy `.risu` envelope codecs.                         |

`POST /api/v1/import/risusave` accepts multipart `.risu` uploads or JSON
database bodies. Imports normalize the database, apply it through the repository,
replace legacy Hypa V3 rows where needed, emit `state.imported`, and return
asset/import reports. Plain `.risu` imports report missing asset ids; they do not
fetch remote/cache assets server-side.

`GET /api/v1/export/risusave` exports the current repository as a `.risu`.
`GET /api/v1/export/bundle` returns a zip with `database.risu`,
`manifest.json`, and present referenced asset files.

`POST /api/v1/import/bundle` handles the browser "Load Backup Locally" path. It
streams upload bytes to disk, bounded by `RISU_API_IMPORT_MAX_BYTES` (unlimited
by default), then decodes either a `database.risu.zip` bundle or the original
app's legacy `.bin` local backup. Browser helpers live in
`src/ts/storage/backup.ts`.

## Realm Import

`POST /api/v1/import/realm-character` accepts a Realm id, fetches dynamic Realm
JSON cards plus referenced hub resources server-side, and also handles
`charx`/zip packages with packaged assets. It stores fetched/packaged resources
as content-addressed assets and appends the converted character through the
command mutation path. `server/fastify/src/realmImport/` owns conversion and
asset mapping; `src/ts/server/realmImport.ts` owns browser progress/reconcile
handling.

## Backups

| Path                                   | Role                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `server/fastify/src/routes/backups.ts` | Create/list/restore/delete backup routes.                              |
| `server/fastify/src/repository.ts`     | Snapshot creation, manifest writing, SQLite table restore, file swaps. |
| `src/ts/server/backups.ts`             | Browser adapter for backup routes.                                     |

Backups live under `data/backups/<id>/` and snapshot `risu.db`,
`manifest.json`, `assets/` when present, and optional legacy `save/`. Create,
restore, and delete are authenticated and active-writer guarded; list is
authenticated read-only.

Restore swaps asset/save directories and restores SQLite tables through `ATTACH`,
then emits `state.restored`. Older backups containing `db.json` are restored by
copying the file into the data dir and running `ensureDbJsonImported()`.

Module `.risum` import remains unsupported in Fastify-backed browser mode. If it
returns, implement it as a server import/command route.
