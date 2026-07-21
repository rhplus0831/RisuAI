# Assets And Saves

Last audited: 2026-07-20.

Fastify owns binary persistence, save import/export, Realm import, and backup
snapshots. Browser code should use server asset URLs and server save routes
instead of writing runtime state directly.

Static app assets are a separate source boundary from persisted runtime assets:
`public/` is Vite-served static input, `resources/` contains packaging
icon/splash sources, and `src/etc/` contains bundled media/docs/tokenizer seed
data. Save/import/export and user-upload flows should use server asset ids and
`/api/v1/assets/:id` URLs, not static `/public` paths.

## Assets

| Path                                                                        | Role                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/fastify/src/routes/assets.ts`                                       | `/api/v1/assets`, `/api/v1/assets/bulk`, immutable `GET`/`HEAD`, existence probe.                 |
| `server/fastify/src/repository.ts`                                          | Asset id validation, sha256 dedupe, SQLite metadata, file paths, missing-asset checks.            |
| `server/fastify/src/assetGc.ts`                                             | Reference-counted asset garbage collection over a minimal SQLite reference shape.                 |
| `server/fastify/src/risuSave/assetReferences.ts`                            | Known-field asset-reference walker for import/export/GC reports.                                  |
| `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts`                     | Browser upload/read adapters, asset URL normalization, and private bulk-upload existence probing. |
| `src/ts/server/inlayCatalog.ts`                                             | Browser catalog projection plus revisioned metadata upsert/delete helpers.                        |
| `src/ts/server/settingsMediaAssetUpload.ts`, `src/ts/process/stableDiff.ts` | Durable image-setting asset references and lazy provider-request base64 materialization.          |

Asset ids are lowercase sha256 hex strings. Metadata lives in SQLite `assets`;
bytes live at `data/assets/<sha256>.<ext>`. Supported content types are defined
by `CONTENT_TYPE_EXTENSIONS` and mirrored by content type in
`SERVER_ASSET_CONTENT_TYPES`; the client also accepts `jpeg` as an upload alias
for the server's canonical `jpg` extension.
`POST /api/v1/assets` accepts raw supported asset bytes;
`POST /api/v1/assets/bulk` accepts compact binary framing for browser bulk
uploads and keeps JSON/base64 batch compatibility for import paths.
Uploads are authenticated and active-writer guarded. Asset metadata is outside
the revisioned application-resource domain: uploads return the current domain
revision but do not bump it or emit a command event. Re-uploading existing
bytes is idempotent and can heal a missing file. Browser upload helpers request
`Prefer: return=minimal`; compact single and bulk acknowledgements return
`{ assetId, revision }` and `{ assetIds, revision }` respectively, while callers
that omit the preference retain the fuller compatibility response. A dedup hit
also refreshes the existing file's mtime on a best-effort basis, restarting the
GC grace window before the upload's later reference mutation commits.

`GET` and `HEAD /api/v1/assets/:id` are public immutable reads for ids present
in metadata and on disk. `POST /api/v1/assets/exists` is a public read-only POST
that reports missing ids.

New NovelAI I2I/character-reference and WaveSpeed reference-image uploads store
only the durable server asset id and remove the duplicated legacy inline-base64
field. `stableDiff.ts` reads and encodes the asset only while constructing the
provider request. Imported base64-only settings and inline fallbacks for an
unreadable imported asset reference remain supported.

`runAssetGc()` walks known asset-reference fields through the shared save-report
walker, using a minimal SQLite reference shape rather than a full repository
load. That shape covers root and nested image settings (including NovelAI I2I,
NovelAI character reference, and WaveSpeed reference image), module assets,
persona icons, bot/model/prompt preset images, character/chat reference fields,
and inlay tokens in character-rendered text. Column-only scans add active and
durable alternate `messages.data` inlays, pending generation-finalization
message/alternate payloads, and `inlay_catalog` membership. Plugin custom
storage is the deliberate arbitrary-JSON exception: GC loads only its
`value_json` columns and deeply scans strings, while the shared walker applies
the same sha256-id/`assets/<id>.<ext>` validation used everywhere else.

The shared walker is authoritative for known database fields, so save/bundle
reports and GC must gain those fields together. Operational-only references
(pending finalization rows and catalog membership) are appended only in the GC
report because they are not part of an exported database; message-table scans
are shared by repository export reports and GC. A grace window protects
upload-then-reference races. GC remains revision-free and emits no command
events.

### Inlay Catalog

`inlay_catalog` is revisioned metadata over authoritative `assets` rows. Each
entry is keyed by `asset_id` and stores a display name, optional dimensions,
and aliases; the read joins in extension, size, and the derived
image/audio/video/signature type. `GET /api/v1/inlay-assets` returns the complete
authenticated catalog. `PUT /api/v1/commands/inlay-assets/:assetId` and
`DELETE /api/v1/commands/inlay-assets/:assetId` emit `inlayCatalog.upserted` or
`inlayCatalog.deleted` and update only this targeted table. The browser keeps
the catalog outside the aggregate compatibility database and refreshes it as a
fourth root resource. See
[Server Resources And Bridges](server-resources-and-bridges.md#bootstrap-and-initial-resources)
for reconciliation behavior. Persistence and client projection behavior are
guarded by `server/fastify/__tests__/inlayCatalog.test.ts` and
`src/ts/server/inlayCatalog.test.ts`.

## `.risu` And Bundle Routes

| Path                                                                  | Role                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/fastify/src/routes/save.ts`                                   | Save import/export and device-backup bundle routes.                 |
| `server/fastify/src/risuSave/importSnapshot.ts`                       | Multipart `.risu` decode and import normalization.                  |
| `server/fastify/src/risuSave/exportSnapshot.ts`                       | Repository export into block or legacy envelopes.                   |
| `server/fastify/src/risuSave/bundleExport.ts`                         | Zip bundle export with `.risu` bytes plus present asset files.      |
| `server/fastify/src/risuSave/localBackupExport.ts`                    | Original Risu `.bin` local-backup export with asset records.        |
| `server/fastify/src/risuSave/localBackupImport.ts`                    | Streaming device-backup decode for `.risu.zip` and legacy `.bin`.   |
| `server/fastify/src/risuSave/localBackupDatabase.ts`                  | Legacy `.bin` account redaction and asset-reference conversion.     |
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
record. The embedded database omits the obsolete legacy `account` object and
rewrites known Fastify asset ids to original-Risu `assets/<sha>.<ext>` paths so
the original loader resolves the matching records. Export routes emit
`state.exported` notifications without bumping the domain revision.

`POST /api/v1/import/bundle` handles the browser "Load Backup Locally" path. It
streams upload bytes to disk, bounded by `RISU_API_IMPORT_MAX_BYTES` (unlimited
by default), then sniffs ZIP magic and decodes either a `.risu.zip` bundle or
the original app's legacy `.bin` local backup. Bundle zip import reads
`manifest.json` version `1`, accepts a `.risu` database payload entry, validates
`assets/<sha>.<ext>` entries by extension and content hash, ignores unrelated
zip entries, and still caps inner `.risu` expansion even when the outer upload
limit is unlimited. Legacy `.bin` import keeps recognized media records plus
all hash-named supported asset records, including ONNX, CSS, and inlay-signature
JSON, while skipping unrelated non-media/cold-storage records. Original-Risu
asset paths in the embedded database are canonicalized back to server asset ids
before persistence, including custom or fallback non-sha256 media filenames.
`src/ts/server/backups.ts` uses the `x-risu-estimated-backup-bytes` progress
header when present; UI-facing wrappers live in `src/ts/storage/backup.ts`.

## Client Content Exchange

Portable client formats outside whole-database saves remain browser workflows:

| Owner                                                                                            | Exchange contract                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ts/storage/exportAsDataset.ts`                                                              | Dataset JSON export strictly hydrates every chat and character lorebook before serialization; any incomplete hydration fails the export. |
| `src/ts/characters.ts`                                                                           | Chat import/export.                                                                                                                      |
| `src/ts/characterCards.ts`                                                                       | Character-card import/export, including packaged card assets.                                                                            |
| `src/ts/persona.ts`                                                                              | Persona PNG import/export.                                                                                                               |
| `src/ts/storage/database.svelte.ts`                                                              | Legacy and split preset exchange, including `.risup`.                                                                                    |
| `src/ts/process/lorebook.svelte.ts`, `src/ts/process/scripts.ts`, `src/ts/translator/presets.ts` | Lorebook, regex-script, and `.risutl` translator-preset exchange.                                                                        |

Module and MCP-bearing `.risum` exchange is owned by
[Plugins And MCP](plugins-and-mcp.md#fastify-mode-limits). Dataset/chat guards
are `src/ts/storage/exportAsDataset.test.ts`,
`src/ts/characters.exportChat.test.ts`, and
`src/ts/characters.importChat.test.ts`.

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
in `src/ts/server/realmImport.ts`; response-event reconciliation and resource
refresh live in `src/ts/server/resourceRefresh.ts`, while navigation,
low-level-access retry, and older browser fallback handling live in
`src/ts/characterCards.ts`. A successful response carries the revision,
`character.created` event, and character id. When that event is contiguous the
browser refreshes only the character list and preserves resident hydrated
bodies; a missing cursor, mismatched event, or revision gap falls back to a
complete resource refresh. Server Realm import is primary but not exclusive:
unsupported server Realm responses can fall back to the older browser path, and
local direct `charx` file import still has a browser-native path.
Operational guards include a request deadline and client-disconnect abort,
dynamic JSON size caps, per-asset and cumulative fetched-asset caps, pending
low-level-access confirmation tokens, and staged/created asset cleanup on
failure. Non-SSE JSON responses include success, low-level-access confirmation
tokens, HTTP `415` `unsupported_realm_download` fallbacks, revision conflicts,
and upstream/fetch errors.
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

| Path                                                                                                  | Role                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `server/fastify/src/routes/backups.ts`                                                                | Create/list/restore/delete backup routes.                              |
| `server/fastify/src/repository.ts`                                                                    | Snapshot creation, manifest writing, SQLite table restore, file swaps. |
| `src/ts/server/backups.ts`                                                                            | Browser adapter for backup/import/export routes and progress headers.  |
| `src/ts/server/replacementDatabaseOwnership.ts`                                                       | Adopts replacement lineage/writer ownership before refreshing state.   |
| `src/ts/storage/backup.ts`, `src/ts/globalApi.svelte.ts`, `src/lib/Setting/Pages/UserSettings.svelte` | UI-facing backup/import/export wrappers and settings flows.            |

Backups live under `data/backups/<id>/`. Current backups contain
`manifest.json`, a file copy of the whole `risu.db`, assets when present, and
optional legacy `save/`; new backups do not write `db.json`. Create, restore,
and delete are authenticated and active-writer guarded; list is authenticated
read-only. Concrete routes are `POST /api/v1/backups`, `GET /api/v1/backups`,
`POST /api/v1/backups/:id/restore`, and `DELETE /api/v1/backups/:id`.

Before an initialized database is replaced by a `.risu`, bundle, legacy local
backup, or server-backup restore, the repository creates a fail-closed automatic
safety snapshot. These manifests use `kind: "automatic"` and the stable
`Automatic safety snapshot` label, so they remain visible and restorable through
the ordinary backup API and UI. Automatic snapshots retain the newest three by
default (`RISU_API_AUTOMATIC_BACKUP_RETENTION`); retention never counts or
deletes manual backups. First-run imports skip the snapshot only when no
`settings` row exists. Restore validates its source database payload before
creating the safety snapshot or touching restore staging directories.

Restore swaps asset/save directories and restores SQLite tables through the
`SQLITE_BACKUP_TABLES` allowlist in `repository.ts`, then emits
`state.restored` and triggers a complete browser resource refresh. Because
restore swaps tables from the copied backup DB with `ATTACH`, operational tables
can be present in the backup file but ignored on restore if they are not allowlisted.
Keep that allowlist in sync when adding durable tables; split model/prompt
preset rows and `inlay_catalog` are included. `database_metadata`, `command_mutation_receipts`,
`generation_finalization_retries`, `push_subscriptions`, and
`memory_legacy_summary_tombstones` may be present in the physical copy but are
not restored, and Web Push key files are outside the snapshot contract.
Destructive import and restore rotate the live database lineage and clear server
mutation receipts, so a browser outbox scoped to the previous lineage cannot
replay across that boundary. Older backups containing `db.json` are restored by
copying the file into the data dir and running `ensureDbJsonImported()`.

Restore and bundle import call `adoptReplacementDatabaseOwnership()` before a
complete refresh. A changed lineage/writer epoch retires the old projection,
pending bridge ownership, and registered mutation settlements before the outbox
admits writes against the replacement database.

Module `.risum` import, embedded module assets, and MCP stored-row rules are
owned by [Plugins And MCP](plugins-and-mcp.md).
