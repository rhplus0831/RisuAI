# Assets And Saves

Fastify owns binary persistence and `.risu` import/export. The browser should
reference server asset URLs and use the server save routes instead of writing
runtime state directly.

## Content-Addressed Assets

| Path                                  | Purpose                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `server/fastify/src/routes/assets.ts` | `/api/v1/assets` upload/read/existence routes.                                  |
| `server/fastify/src/repository.ts`    | Asset id validation, sha256 dedupe, metadata, file paths, missing-asset checks. |
| `server/fastify/src/assetGc.ts`       | Reference-counted server-side asset garbage collection.                         |
| `src/ts/server/assets.ts`             | Browser adapter for Fastify asset upload/existence APIs.                        |
| `src/ts/globalApi.svelte.ts`          | Browser-side `saveAsset` / asset URL normalization helpers.                     |

Asset ids are lowercase sha256 hex strings. Asset bytes live at
`data/assets/<sha256>.<ext>` and metadata lives in the `assets` array inside
`data/db.json`. `repository.ts` maps supported content types to stable file
extensions and dedupes by content hash.

`POST /api/v1/assets` accepts raw bytes of supported asset content types. The
asset parser is installed globally from `buildApp()` for the supported asset
content types, while the route still requires auth. A newly-created asset bumps
the repository revision and emits `asset.created` so clients can advance their
revision cursor; uploading bytes that already exist returns the existing id
without creating a duplicate.

`GET` and `HEAD /api/v1/assets/:id` are public immutable reads. They serve only
ids present in metadata and on disk. `POST /api/v1/assets/exists` validates ids
and returns the missing set so import and upload flows can avoid redundant bytes.

## Asset Garbage Collection

`runAssetGc()` walks the persisted database with the same asset-reference report
used by `.risu` export, then removes unreferenced asset metadata and stray asset
files. A grace window based on file mtime protects the upload-then-reference
race where bytes are uploaded in one request and referenced by a later command.

`buildApp()` wires a periodic GC timer unless tests pass `assetGc: false`. Asset
GC does not bump the revision or emit a command event because it only removes
bytes that the projected database no longer references.

## `.risu` Import And Export

| Path                                                 | Purpose                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `server/fastify/src/routes/save.ts`                  | Import/export route surface.                                     |
| `server/fastify/src/risuSave/importSnapshot.ts`      | Multipart `.risu` decode and import normalization.               |
| `server/fastify/src/risuSave/exportSnapshot.ts`      | Repository export into block or legacy envelopes.                |
| `server/fastify/src/risuSave/bundleExport.ts`        | Zip bundle export with the `.risu` bytes plus asset files.       |
| `server/fastify/src/risuSave/assetReferences.ts`     | Asset-reference walker and orphan/unsupported reference reports. |
| `server/fastify/src/risuSave/blockCodec.ts`          | Current block-based `.risu` envelope codec.                      |
| `server/fastify/src/risuSave/legacyEnvelopeCodec.ts` | Legacy raw/compressed/stream envelope compatibility.             |
| `server/fastify/src/routes/realmImport.ts`           | Server-side RisuRealm character import with asset fetching.      |

`POST /api/v1/import/risusave` accepts multipart `.risu` uploads or a JSON
`database` body. Multipart imports decode the file, normalize the imported
database, apply it through `repository.applyImport()`, replace legacy Hypa V3
memory rows, emit `state.imported`, and return an asset report.

`GET /api/v1/export/risusave` exports the current repository as a `.risu`.
`GET /api/v1/export/bundle` wraps that `.risu` plus referenced asset bytes in a
zip. The current default envelope is `risusave-blocks`; legacy raw, compressed,
and stream envelopes remain available for compatibility.

`POST /api/v1/import/realm-character` accepts a Realm id, fetches dynamic Realm
JSON cards plus referenced hub resources server-side, and also handles Realm
`charx`/zip packages by decoding `card.json` plus packaged assets. It persists
those resources as content-addressed assets, then appends the converted
character through the command mutation path. When the browser asks for
`text/event-stream`, the same route streams progress and terminal status frames
for long downloads/imports.

## Backups

| Path                                   | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `server/fastify/src/routes/backups.ts` | Create/list/restore/delete backup routes.                          |
| `server/fastify/src/repository.ts`     | Snapshot creation, manifest writing, and restore file/table swaps. |
| `src/ts/server/backups.ts`             | Browser adapter for backup routes.                                 |

Backups live under `data/backups/<id>/` and snapshot `db.json`, `assets/`,
`risu.db`, `save/`, and `manifest.json`. Restore is a server-owned mutation
guarded by auth and active-writer classification; it swaps the persisted files
and SQLite tables, then emits `state.restored`.
