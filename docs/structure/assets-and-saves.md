# Assets And Saves

Last audited: 2026-08-09.

Fastify owns binary persistence, save import/export, Realm import, and backup
snapshots. Browser code should use server asset URLs and server save routes
instead of writing runtime state directly.

Static app assets are a separate source boundary from persisted runtime assets:
`public/` is Vite-served static input, `resources/` retains currently
unconsumed packaging artwork, and `src/etc/` mixes live bundled media/tokenizer
data with unreferenced legacy payloads. Save/import/export and user-upload flows
should use server asset ids and `/api/v1/assets/:id` URLs, not static `/public`
paths.

## Assets

| Path                                                                        | Role                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/fastify/src/routes/assets.ts`                                       | `/api/v1/assets`, `/api/v1/assets/bulk`, immutable `GET`/`HEAD`, existence probe.                 |
| `server/fastify/src/repository.ts`                                          | Asset id validation, sha256 dedupe, SQLite metadata, file paths, missing-asset checks.            |
| `server/fastify/src/assetGc.ts`                                             | Reference-counted asset garbage collection over a minimal SQLite reference shape.                 |
| `server/fastify/src/risuSave/assetReferences.ts`                            | Known-field asset-reference walker for import/export/GC reports.                                  |
| `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts`                     | Browser upload/read adapters, asset URL normalization, and bulk-upload existence probing.         |
| `src/ts/server/inlayCatalog.ts`                                             | Browser catalog projection validation and revision-aware acknowledgement application.             |
| `src/ts/server/commands.ts`, `src/ts/process/files/inlays.ts`               | Catalog commands plus the upload/register/migrate/read/delete inlay workflow.                      |
| `src/ts/server/settingsMediaAssetUpload.ts`, `src/ts/process/stableDiff.ts` | Durable image-setting asset references and lazy provider-request base64 materialization.          |

Asset ids are lowercase sha256 hex strings. Metadata lives in SQLite `assets`;
bytes live at `data/assets/<sha256>.<ext>`. Supported content types are defined
by `CONTENT_TYPE_EXTENSIONS` and mirrored by content type in
`SERVER_ASSET_CONTENT_TYPES`; the client also accepts `jpeg` as an upload alias
for the server's canonical `jpg` extension.
`POST /api/v1/assets` accepts raw supported asset bytes;
`POST /api/v1/assets/bulk` accepts compact binary framing for browser bulk
uploads and keeps JSON/base64 batch compatibility for legacy callers.
`saveAssets()` limits browser hashing to four concurrent assets, deduplicates
ids within the call, fills the existence endpoint's 1,024-id capacity, and
packs missing bytes toward 32-asset/32 MiB upload targets. A single asset larger
than the byte target remains a single-item batch instead of being split. Asset
requests time out after five minutes; transient rate-limit responses honor
`Retry-After` and retry the affected request up to three times. These contracts
are named by the `SERVER_ASSET_*` constants in `src/ts/globalApi.svelte.ts` and
guarded by `src/ts/globalApi.saveAssets.test.ts`.
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
that checks metadata only; it does not prove the corresponding file remains on
disk. A direct re-upload can heal missing bytes, but a browser bulk helper can
skip that repair when metadata already exists.

NovelAI I2I/character-reference and WaveSpeed reference-image uploads store
only the durable server asset id and remove the duplicated legacy inline-base64
field. `src/ts/process/stableDiff.ts` reads and encodes the asset only while
constructing the provider request. Imported base64-only settings and inline
fallbacks for an unreadable imported asset reference remain supported.

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

The shared walker is authoritative for current portable-save and GC database
fields. Legacy `.bin` rewriting uses a separate field list in
`server/fastify/src/risuSave/localBackupDatabase.ts`; keep it synchronized or
raw asset IDs can survive that conversion. Operational-only references
(pending finalization rows and catalog membership) are appended only in the GC
report because they are not part of an exported database; message-table scans
are shared by repository export reports and GC. A grace window protects
upload-then-reference races. If any valid asset file is newer than that grace
window, GC treats upload/import staging as active and defers every orphan and
stray-file reclamation for the sweep; ordinary aging makes later sweeps
converge. GC remains revision-free and emits no command events.

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
| `server/fastify/src/risuSave/importSnapshot.ts`                       | Envelope decode, validation, and import normalization.              |
| `server/fastify/src/risuSave/exportSnapshot.ts`                       | Repository export into block or legacy envelopes.                   |
| `server/fastify/src/risuSave/portableMetadata.ts`                     | Validated versioned `__risuServerData` metadata.                     |
| `server/fastify/src/translation/greetingTranslationStore.ts`          | Portable normalized greeting-translation extraction/replacement.    |
| `server/fastify/src/risuSave/bundleExport.ts`                         | Zip bundle export with `.risu` bytes plus present asset files.      |
| `server/fastify/src/risuSave/localBackupExport.ts`                    | Original Risu `.bin` local-backup export with asset records.        |
| `server/fastify/src/risuSave/localBackupImport.ts`                    | Streaming device-backup decode for `.risu.zip` and legacy `.bin`.   |
| `server/fastify/src/risuSave/localBackupDatabase.ts`                  | Legacy `.bin` account redaction and asset-reference conversion.     |
| `server/fastify/src/risuSave/importLimits.ts`                         | Expanded-payload guard shared by `.risu` and Realm import decoding. |
| `server/fastify/src/risuSave/boundedInflate.ts`                       | Streaming bounded inflate used by block and legacy envelope codecs. |
| `server/fastify/src/risuSave/blockCodec.ts`                           | Current `.risu` envelope codec.                                    |
| `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`                  | Legacy `.risu` envelope codec.                                     |

`POST /api/v1/import/risusave` accepts multipart `.risu` uploads or JSON
database bodies. Imports normalize the database, apply it through the
repository, replace legacy Hypa V3 rows where needed, emit `state.imported`,
and return asset reports. Multipart `.risu` and bundle-style imports also
return import reports; JSON body compatibility imports return only the asset
report. Plain `.risu` responses expose aggregate referenced/missing/orphaned
counts, where missing means absent asset metadata rather than missing disk
bytes. They do not fetch remote/cache assets server-side.

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

Whole-database `.risu`, bundle, and legacy `.bin` imports reject group
characters atomically with `422 unsupported-group-characters`. Block-envelope
saves that contain standalone `CHAT` blocks import all supported blocks, skip
each standalone chat block, and return its exact name and type in
`importReport.skippedBlocks`. The browser includes every skipped block in the
localized completion report. Exported whole-database saves contain raw
credential-bearing settings, including shared
provider API keys and Vertex private keys; treat these files as secrets. The
Settings UI requires the localized secret-warning confirmation before requesting
the ZIP-style local-backup export; this is guarded by
`src/lib/Setting/Pages/UserSettings.svelte.test.ts`. The separate bug-report
export masks registered secrets.

## Client Content Exchange

Portable client formats outside whole-database saves remain browser workflows:

| Owner                                                                                            | Exchange contract                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `src/ts/storage/exportAsDataset.ts`                                                              | Dataset JSON export.                                              |
| `src/ts/characters.ts`                                                                           | Single-chat and all-chat import/export.                           |
| `src/ts/characterCards.ts`, `src/ts/process/processzip.ts`                                       | Character-card import/export, including packaged CharX assets.    |
| `src/ts/persona.ts`                                                                              | Persona PNG import/export.                                        |
| `src/ts/storage/database.svelte.ts`                                                              | Legacy and split preset exchange, including `.risup`.             |
| `src/ts/process/lorebook.svelte.ts`, `src/ts/process/scripts.ts`, `src/ts/translator/presets.ts` | Lorebook, regex-script, and `.risutl` translator-preset exchange. |

Prompt Settings imports inspect the unmerged legacy payload. Pure prompt files
remain prompt-only without interruption. When a file carries standalone
provider/model-routing fields, a localized dialog names its primary and
auxiliary models and lets the user import both model and prompt halves, keep
only the prompt half, or cancel without writing either half.

### Character Cards

`CharXImporter` incrementally decodes `.charx` and JPEG-embedded CharX ZIPs.
Entries that expand beyond 50 MiB and oversized inline data-URI assets are
dropped while readable card content is imported. The completion alert names
every dropped archive path and every inline `data.assets[index]` item; missing
assets that were not named by that size report remain hard errors. Internally,
completed assets flush at 32 items or the 8 MiB batch
target, and ZIP input pauses while retained decoded asset bytes exceed the
32 MiB queue target. Because thresholds are checked after accepting an entry,
one otherwise valid entry can exceed a batch or queue target up to the 50 MiB
per-entry cap. The shared asset helper then applies its four-worker hashing,
existence probing, deduplication, timeout, retry, and upload-chunk rules described
above. `src/ts/process/processzip.test.ts` guards the entry cap,
high-asset-count batching, queue backpressure, and representative valid output;
`src/ts/characterCards.pngImport.test.ts` guards salvage and exact reporting.

CharX asset writes finish before the imported character is dispatched through
the command path. They are content-addressed and deduplicated, but are not
rolled back when later card validation, low-level-access confirmation, or the
character mutation fails; assets left without a durable reference become
eligible for normal grace-window GC.

Every browser card path passes through
`normalizeImportedCharacterIdentities()` before the optimistic character
append. In addition to rekeying identities, it fills a missing starter-chat
`fmIndex` from the character's `firstMsgIndex` or `-1`, so the imported greeting
is available immediately after selection. This is guarded for spec and off-spec
imports by `src/ts/characterCards.pngImport.test.ts` and
`src/ts/characters.changeChar.test.ts`.

Packaged-card export rewrites prebuilt-asset exclusion references together with
their asset references. Import keeps only exclusions that resolve to imported
additional assets and converts them to server asset ids; stale legacy paths are
dropped because they cannot match a character asset or satisfy Fastify's asset
reference validation.

Character-card import preserves author-supplied activation configuration on
Agent-only lore entries: Always Active, primary and secondary keys, selective
activation, and regex mode survive instead of being normalized away. Persisted
state repair accepts these imported compatibility values, while new Agent-only
command payloads keep the stricter no-activation validation. The SQLite command
side links back here from
[Data And Events](data-and-events.md#revision-contract).
Card and standalone lorebook export project Agent-only entries as inert for
Original Risu by clearing both activation-key sets and disabling Always Active.
That projection is export-only and never mutates the stored entry.

### Chats And Datasets

Dataset export strictly hydrates every chat and character lorebook before
serialization; any incomplete hydration fails the export. All-chat export
similarly hydrates the target character's chats and writes unchanged
`risuAllChats` version-2 JSON. Its download passes
`revokeObjectUrlAfterMs: null`, deliberately keeping the blob URL alive instead
of applying the helper's normal revocation timeout.

Only the sidebar's **Export all chats** action offers destructive follow-up:
after the download succeeds, two confirmations are required before a durable
command replaces that character's chats with one empty `Chat 1` and selects page
`0`. After both confirmations, the client compares the live chat IDs, counts,
and last-message identities/content hashes with the exact exported-state fence;
any mismatch aborts reset and requires a new export. Chat folders remain.
Export failure, a fence mismatch, either cancellation, or terminal command
failure leaves or restores the chats. This does not change the export bytes or
affect single-chat, dataset, character-card, `.risu`, bundle, or local-backup
exports. The client contract is guarded by
`src/ts/characters.exportChat.test.ts`,
`src/lib/SideBars/SideChatList.svelte.test.ts`, and
`src/ts/chatCommands.test.ts`. The server-side transaction, revision, and event
contract belongs to
[Data And Events](data-and-events.md#revision-contract).

Module and MCP-bearing `.risum` exchange is owned by
[Plugins And MCP](plugins-and-mcp.md#fastify-mode-limits). The remaining
dataset/chat import guards are `src/ts/storage/exportAsDataset.test.ts` and
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
local direct `charx` file import still has a browser-native path. Negotiating
`realmProgressDelta` makes the first progress frame complete and later frames
carry `percent` plus only changed fields.
Operational guards include a request deadline and client-disconnect abort,
dynamic JSON size caps, per-asset and cumulative fetched-asset caps, pending
low-level-access confirmation tokens, and temporary staging cleanup. Rollback
of newly created asset rows/files is guaranteed for the JSON-card path but not
after the charx asset commit. Non-SSE JSON responses include success,
low-level-access confirmation tokens, HTTP `415`
`unsupported_realm_download` fallbacks, revision conflicts, and upstream/fetch
errors.
The `/api/v1/download/dynamic/` string in the route module is an upstream Realm
path constant, not a local Fastify route.

## Legacy Storage Compatibility

`/api/v1/storage/*` remains live for compatibility and stores bytes under
`data/save/<hex-key>` through `server/fastify/src/routes/legacyStorage.ts` and
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
`manifest.json`, an online `node:sqlite` backup of the whole `risu.db`, assets
when present, and optional legacy `save/`; new backups do not write `db.json`.
Creation first reads the `wal_checkpoint(TRUNCATE)` result row and requires
`busy = 0` with every logged frame checkpointed after bounded retries. A busy
manual checkpoint returns `backup_wal_checkpoint_failed`; the same failure in a
safety snapshot is wrapped as `automatic_backup_failed`. Create, restore, and
delete are authenticated and active-writer guarded; list is authenticated
read-only. The durable route-policy owners are the `backup-mutations` and
`backup-list` entries in `server/fastify/src/routeManifest.ts`; behavior is
guarded by `server/fastify/__tests__/backups.test.ts`.

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
`SQLITE_BACKUP_TABLES` allowlist in `server/fastify/src/repository.ts`, then emits
`state.restored` and triggers a complete browser resource refresh. Because
restore swaps tables from the copied backup DB with `ATTACH`, operational tables
can be present in the backup file but ignored on restore if they are not
allowlisted. `SQLITE_BACKUP_EXCLUDED_TABLES` names every deliberately live or
device-local table and records why it is not restored. The backup policy test in
`server/fastify/__tests__/backups.test.ts` requires every production table to
appear in exactly one of those sets, rejects stale entries and overlaps, and
requires a rationale for every exclusion. Split model/prompt preset rows and
`inlay_catalog` are included in the restore set. The SQLite-only durability
policy is explicit:

| State | Portable `.risu`, bundle, and local backup | Server backup/restore |
| ----- | ------------------------------------------ | --------------------- |
| Generation finalization retries | Excluded: portable content transfer never resumes old operational work. | Snapshot-owned and restored. Historical queue tables use an explicit column projection; missing target snapshots default to `NULL` and missing alternates to `[]`. |
| Legacy-summary tombstones | Encoded under the validated, versioned `__risuServerData` root key and stripped before repository normalization. | Snapshot-owned and restored after `memory_summaries`, so delete-trigger side effects cannot change the selected snapshot. |
| Greeting translations | Source-valid rows are embedded per character; import validates, deduplicates, and drops stale-source rows. | `greeting_translations` is restore-allowlisted and replaced with the snapshot. |
| LLM request history | Excluded: device-local diagnostic telemetry. | The physical SQLite copy contains it, but restore does not import it and clears the live table during lineage rotation; this telemetry does not survive the replacement boundary. |
| Inlay catalog and asset store | Catalog metadata/catalog-only assets are excluded. Bundle/local formats can add portable database references and present asset files without replacing the target catalog/store. | `inlay_catalog` is restored and the asset directory is replaced. |
| Provider credentials | Included unmasked in whole-database settings; portable save files must be handled as secrets. | Restored with settings. |
| Push subscriptions | Excluded: endpoint and auth material is origin/device state. | Deliberately remains live across restore. The VAPID key file is outside every backup, so losing the live subscription table or moving origins requires users to re-enable notifications. |

Portable greeting-translation rows are extracted after character identity
normalization/remint, so their final character ownership is preserved. Broad
character-table rewrites use a tolerant cache snapshot: invalid stored rows are
dropped without aborting the rewrite, and their character/index/settings keys
are collected and logged while valid rows for surviving characters are
rewritten.

`database_metadata` also remains live because restore rotates lineage/writer
ownership, while lineage-scoped `command_mutation_receipts` are cleared rather
than copied across the replacement boundary.
Destructive import and restore rotate the live database lineage and clear server
mutation receipts, so a browser outbox scoped to the previous lineage cannot
replay across that boundary. Older backups containing `db.json` are restored by
importing the backup file directly inside the restore transaction; it is never
staged as a live `data/db.json`.

Each directory swap is protected by
`data/.restore-journal-<backup-id>.json`. The journal records the exact live,
staged, parked, and backup paths plus each phase before canonical directories
move. Immediately before SQLite COMMIT it also records the replacement lineage;
boot compares that marker with `database_metadata.lineage` to resolve the crash
window before the post-COMMIT phase write. `buildApp()` recovers every journal
before backfills, legacy import, routes, or workers start: a committed database
finishes forward, while an uncommitted database restores both old directories.
Recovery attempts both directory components even if one operation fails and
keeps the journal and parked copies for the next boot. Old/staged directories
are deleted only after both canonical directories are verified. A new restore
recovers a valid prior journal first and refuses unjournaled `.old`/`.tmp`
scratch paths rather than overwriting a possible sole surviving copy.

Restore and bundle import call `adoptReplacementDatabaseOwnership()` before a
complete refresh. A changed lineage/writer epoch retires the old projection,
pending bridge ownership, and registered mutation settlements before the outbox
admits writes against the replacement database.
