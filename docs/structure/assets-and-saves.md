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
extensions and dedupes by content hash. Fastify-mode inlay media and signature
payloads use this same store; new inlay tokens carry the asset id directly, and
legacy browser-local inlay ids are mapped to asset ids without sending base64
bytes in `/generate/chat`.

`POST /api/v1/assets` accepts raw bytes of supported asset content types. The
asset parser is installed globally from `buildApp()` for the supported asset
content types, while the route still requires auth. `POST /api/v1/assets/bulk`
accepts JSON base64 asset batches so import paths can register many assets
without rapidly dispatching one HTTP request per file. A newly-created asset (or
bulk batch) bumps the repository revision and emits `asset.created` so clients
can advance their revision cursor; uploading bytes that already exist returns
the existing id without creating a duplicate.

Upload and bulk upload stage content-addressed files before updating `db.json`
metadata and committing the revisioned `asset.created` event. Newly staged files
are removed if a later file write, metadata write, or command-event persistence
step fails before commit, so failed uploads do not leave metadata or bytes that
were never paired with a replayable revision. Re-uploading an id already present
in metadata remains idempotent and may heal a missing immutable file without a
new revision.

`GET` and `HEAD /api/v1/assets/:id` are public immutable reads. They serve only
ids present in metadata and on disk. `POST /api/v1/assets/exists` validates ids
and returns the missing set so import and upload flows can avoid redundant bytes.

## Asset Garbage Collection

`runAssetGc()` walks the persisted database with the same known-field
asset-reference report used by bundle export and import asset reports, then
removes unreferenced asset metadata and stray asset files. A grace window based
on file mtime protects the upload-then-reference race where bytes are uploaded
in one request and referenced by a later command.

`buildApp()` wires a periodic GC timer unless tests pass `assetGc: false`. The
GC pass hydrates SQLite chat messages before walking references so inlay tokens
inside chat history protect their server assets. Asset GC does not bump the
revision or emit a command event because it only removes bytes that the
projected database no longer references.

## `.risu` Import And Export

| Path                                                 | Purpose                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `server/fastify/src/routes/save.ts`                  | Import/export route surface.                                                      |
| `server/fastify/src/risuSave/importSnapshot.ts`      | Multipart `.risu` decode and import normalization.                                |
| `server/fastify/src/risuSave/exportSnapshot.ts`      | Repository export into block or legacy envelopes.                                 |
| `server/fastify/src/risuSave/bundleExport.ts`        | Zip bundle export with the `.risu` bytes plus asset files.                        |
| `server/fastify/src/risuSave/localBackupImport.ts`   | Streaming device-backup decode: zip bundle + legacy `.bin`, bounded-memory.       |
| `server/fastify/src/risuSave/assetReferences.ts`     | Known-field asset-reference walker for referenced, missing, and orphaned reports. |
| `server/fastify/src/risuSave/blockCodec.ts`          | Current block-based `.risu` envelope codec.                                       |
| `server/fastify/src/risuSave/legacyEnvelopeCodec.ts` | Legacy raw/compressed/stream envelope compatibility.                              |
| `server/fastify/src/routes/realmImport.ts`           | Server-side RisuRealm character import with asset fetching.                       |

`POST /api/v1/import/risusave` accepts multipart `.risu` uploads or a JSON
`database` body. Multipart imports decode the file, normalize the imported
database, apply it through `repository.applyImport()`, replace legacy Hypa V3
memory rows, emit `state.imported`, and return the envelope, an asset report,
and an `importReport` for unsupported remote/cache-only block references. JSON
imports return revision/event/assetReport only.

`GET /api/v1/export/risusave` exports the current repository as a `.risu`.
`GET /api/v1/export/bundle` creates a zip containing `database.risu`,
`manifest.json`, and present asset files referenced by the known-field walker.
The manifest reports missing references, missing files, and orphaned assets.
The current default envelope is `risusave-blocks`; legacy raw, compressed, and
stream envelopes remain available for compatibility.

Block imports support root, character, preset, modules, plugins, loadouts,
plugin storage, config, and non-reserved root components. Standalone `CHAT`
blocks are rejected.

`POST /api/v1/import/bundle` ingests an uploaded device backup and is the
round-trip behind the browser's "Save/Load Backup Locally". It streams the
upload to a temp file (size capped by `RISU_API_IMPORT_MAX_BYTES`, default
unlimited so multi-GB backups import without tuning — set a positive byte count
to impose a ceiling, or `0`/`unlimited` to opt out explicitly; decoupled from
`bodyLimit`), sniffs the format, and stream-decodes it with bounded memory,
registering assets in batches as they are read and then applying the embedded
database through the shared import path. Two formats are accepted:

- a `database.risu.zip` bundle produced by `GET /api/v1/export/bundle` (zip
  entries are verified against their content-addressed ids), and
- the original app's legacy `.bin` local backup (`LocalWriter` record blob):
  its `database.risudat` is a legacy compressed `.risu`, and its media records
  are content-addressed by the same sha256 scheme, so they register without any
  reference remapping. Cold-storage `.json` records are skipped.

A plain `.risu` import (no bundle) still requires referenced asset bytes to
already exist or to be uploaded separately; missing ids are reported by
`assetReport`.

Remote/cache-only `.risu` blocks are not resolved server-side. The Fastify
browser decoder also avoids local cache/remote fallback in server-backed mode;
unsupported references are skipped and reported.

The browser settings UI exposes server backups (on-server snapshots) plus a
device backup: "Save Backup Locally" downloads the `.risu.zip` bundle through
`src/ts/storage/backup.ts` (`saveBackupToDevice` → `exportServerBundle`, streamed
to disk as a `Blob`), and "Load Backup Locally" uploads a picked backup file —
either a `.risu.zip` bundle or a legacy `.bin` — to the import route
(`loadBackupFromDevice` → `importServerBundle`) and then refreshes the
projection. The remaining `.risu` import/export/legacy-envelope controls are
still API/test surfaces, not browser UI.

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
`risu.db`, `save/`, and `manifest.json`. Create, restore, and delete are
authenticated and active-writer guarded; list is authenticated read-only. Restore
swaps the persisted files and SQLite tables, then emits `state.restored`.

Module `.risum` import remains unsupported in Fastify-backed browser mode. If it
returns, it should be implemented as a server import/command route.
