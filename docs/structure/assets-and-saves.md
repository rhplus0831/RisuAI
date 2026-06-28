# Assets And Saves

Fastify owns binary persistence, save import/export, Realm import, and backup
snapshots. Browser code should use server asset URLs and server save routes
instead of writing runtime state directly.

Static app assets are a separate source boundary from persisted runtime assets:
`public/` is Vite-served static input, `resources/` contains packaging
icon/splash sources, and `src/etc/` contains bundled media/docs/tokenizer seed
data. Save/import/export and user-upload flows should use server asset ids and
`/api/v1/assets/:id` URLs, not static `/public` paths.

## Assets

| Path                                                    | Role                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/routes/assets.ts`                   | `/api/v1/assets`, `/api/v1/assets/bulk`, immutable `GET`/`HEAD`, existence probe.                                             |
| `server/fastify/src/repository.ts`                      | Asset id validation, sha256 dedupe, SQLite metadata, file paths, missing-asset checks.                                        |
| `server/fastify/src/assetGc.ts`                         | Reference-counted asset garbage collection.                                                                                   |
| `server/fastify/src/risuSave/assetReferences.ts`        | Known-field asset-reference walker for import/export/GC reports.                                                              |
| `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts` | Browser upload/read adapters, asset URL normalization, and private bulk-upload existence probing. |

Asset ids are lowercase sha256 hex strings. Metadata lives in SQLite `assets`;
bytes live at `data/assets/<sha256>.<ext>`. Supported content types are defined
by `CONTENT_TYPE_EXTENSIONS` and mirrored by content type in
`SERVER_ASSET_CONTENT_TYPES`; the client also accepts `jpeg` as an upload alias
for the server's canonical `jpg` extension.
`POST /api/v1/assets` accepts raw supported asset bytes;
`POST /api/v1/assets/bulk` accepts compact binary framing for browser bulk
uploads and keeps JSON/base64 batch compatibility for import paths.
Uploads are authenticated and active-writer guarded;
successful new assets bump the domain revision and emit `asset.created`.
Re-uploading existing bytes is idempotent and can heal a missing file.

`GET` and `HEAD /api/v1/assets/:id` are public immutable reads for ids present
in metadata and on disk. `POST /api/v1/assets/exists` is a public read-only POST
that reports missing ids.

`runAssetGc()` walks known asset-reference fields across a minimal SQLite
projection and scans `messages.data` for inlay references, then removes
unreferenced metadata and stray files. The minimal GC projection currently loads
settings, module assets, persona icons, bot preset images, character/chat
reference fields, and active message inlays rather than a full repository
projection. The broader save-report walker also knows split model/prompt preset
images, so keep `assetGc.ts` in sync when adding reference-bearing split tables.
A grace window protects upload-then-reference races. GC does not bump the
revision or emit command events.

## `.risu` And Bundle Routes

| Path                                                                  | Role                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/fastify/src/routes/save.ts`                                   | Save import/export and device-backup bundle routes.                 |
| `server/fastify/src/risuSave/importSnapshot.ts`                       | Multipart `.risu` decode and import normalization.                  |
| `server/fastify/src/risuSave/exportSnapshot.ts`                       | Repository export into block or legacy envelopes.                   |
| `server/fastify/src/risuSave/bundleExport.ts`                         | Zip bundle export with `.risu` bytes plus present asset files.      |
| `server/fastify/src/risuSave/localBackupExport.ts`                    | Original Risu `.bin` local-backup export with asset records.        |
| `server/fastify/src/risuSave/localBackupImport.ts`                    | Streaming device-backup decode for `.risu.zip` and legacy `.bin`.   |
| `server/fastify/src/risuSave/importLimits.ts`                         | Expanded-payload guard shared by `.risu` and Realm import decoding. |
| `server/fastify/src/risuSave/boundedInflate.ts`                       | Streaming bounded inflate used by block and legacy envelope codecs. |
| `server/fastify/src/risuSave/blockCodec.ts`, `legacyEnvelopeCodec.ts` | Current and legacy `.risu` envelope codecs.                         |

`POST /api/v1/import/risusave` accepts multipart `.risu` uploads or JSON
database bodies. Imports normalize the database, apply it through the
repository, replace legacy Hypa V3 rows where needed, emit `state.imported`,
and return asset reports. Multipart `.risu` and bundle-style imports also
return import reports; JSON body compatibility imports return only the asset
report. Plain `.risu` imports report missing asset ids; they do not fetch
remote/cache assets server-side.

`GET /api/v1/export/risusave` exports the current repository as a `.risu` and
supports envelope/compression query options.
`GET /api/v1/export/bundle` returns a zip with `database.risu`,
`manifest.json`, and present referenced asset files.
`GET /api/v1/export/local-backup` returns an original Risu-style `.bin` local
backup with referenced asset records and a legacy-compressed `database.risudat`
record. Export routes emit `state.exported` notifications without bumping the
domain revision.

`POST /api/v1/import/bundle` handles the browser "Load Backup Locally" path. It
streams upload bytes to disk, bounded by `RISU_API_IMPORT_MAX_BYTES` (unlimited
by default), then sniffs ZIP magic and decodes either a `.risu.zip` bundle or
the original app's legacy `.bin` local backup. Bundle zip import reads
`manifest.json` version `1`, accepts a `.risu` database payload entry, validates
`assets/<sha>.<ext>` entries by extension and content hash, ignores unrelated
zip entries, and still caps inner `.risu` expansion even when the outer upload
limit is unlimited. Legacy `.bin` import keeps image, audio, video, and font
asset records and skips unrelated/cold-storage records.
`src/ts/server/backups.ts` uses the `x-risu-estimated-backup-bytes` progress
header when present; UI-facing wrappers live in `src/ts/storage/backup.ts`.

## Realm Import

`POST /api/v1/import/realm-character` accepts JSON with a Realm id, fetches
dynamic Realm JSON cards plus referenced hub resources server-side, and handles
Realm-provided `charx`/zip packages with packaged assets. It stores resources as
content-addressed assets and appends the converted character through the command
mutation path.

Card conversion helpers live in `server/fastify/src/realmImport/`. Asset
staging/persistence, `charx` extraction, progress SSE, low-level-access
confirmation, import limits, and the command-mutation commit are owned by
`server/fastify/src/routes/realmImport.ts`. Browser request/SSE decoding lives
in `src/ts/server/realmImport.ts`; projection resync, navigation,
low-level-access retry, and older browser fallback handling live in
`src/ts/characterCards.ts`. Server Realm import is primary but not exclusive:
unsupported server Realm responses can fall back to the older browser path, and
local direct `charx` file import still has a browser-native path.
Non-SSE JSON responses include success, low-level-access confirmation tokens,
unsupported-download fallbacks, revision conflicts, and upstream/fetch errors.
The `/api/v1/download/dynamic/` string in the route module is an upstream Realm
path constant, not a local Fastify route.

## Legacy Storage Compatibility

`/api/v1/storage/*` remains live for compatibility and stores bytes under
`data/save/<hex-key>` through `legacyStorage.ts` and
`src/ts/storage/fastifyStorage.ts`. These writes are active-writer guarded but
do not bump the domain revision. Server backup snapshots include `data/save/`;
device `.risu`/bundle/local-backup exports do not include this compatibility
store.

## Backups

| Path                                   | Role                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `server/fastify/src/routes/backups.ts` | Create/list/restore/delete backup routes.                              |
| `server/fastify/src/repository.ts`     | Snapshot creation, manifest writing, SQLite table restore, file swaps. |
| `src/ts/server/backups.ts`             | Browser adapter for backup/import/export routes and progress headers.  |
| `src/ts/storage/backup.ts`, `src/ts/globalApi.svelte.ts`, `src/lib/Setting/Pages/UserSettings.svelte` | UI-facing backup/import/export wrappers and settings flows. |

Backups live under `data/backups/<id>/`. Current backups contain
`manifest.json`, `risu.db`, assets when present, and optional legacy `save/`;
new backups do not write `db.json`. Create, restore, and delete are
authenticated and active-writer guarded; list is authenticated read-only.
Concrete routes are `POST /api/v1/backups`, `GET /api/v1/backups`,
`POST /api/v1/backups/:id/restore`, and `DELETE /api/v1/backups/:id`.

Restore swaps asset/save directories and restores SQLite tables through the
`SQLITE_BACKUP_TABLES` allowlist in `repository.ts`, then emits
`state.restored` and triggers browser projection recovery. Keep that allowlist
in sync when adding durable tables; split model/prompt preset rows are included,
while operational rows and Web Push subscription/key state are currently outside
the restore contract. Older backups containing `db.json` are restored by copying
the file into the data dir and running `ensureDbJsonImported()`.

Ordinary module `.risum` import is supported in Fastify-backed browser mode
through the browser codec in `src/ts/process/modules.ts`: the client decodes the
module envelope, rejects MCP module metadata, asks for low-level-access
confirmation before asset writes, uploads embedded assets through the server
asset adapter, and creates the global module through command-backed module
helpers. Embedded asset filenames are preserved during upload so server content
type detection can use the source extension.
