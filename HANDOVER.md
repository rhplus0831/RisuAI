# db.json → SQLite Migration Handover

Reference plan: `docs/db-json-to-sqlite.md`

## Completed

### Phase 1: Asset Metadata (v10) — `d494a202`

Moved `Persisted.assets` (12 344 entries, 1.6 MB) from db.json to the SQLite
`assets` table. Migration v10 creates the table; `ensureAssetsExtracted` runs
on boot to losslessly import any legacy db.json assets.

After this commit:
- `loadPersisted` returns `assets: []` — db.json no longer carries assets
- `writePersisted` strips the `assets` field before writing
- All asset reads/writes go through SQLite (`getAllAssetMetadata`,
  `getAssetMetadataById`, `insertAssetMetadataBatch`, `deleteAssetMetadataByIds`)
- `assetById` and `missingAssetIds` take `db: DatabaseSync` instead of
  `dataDir: string`
- Asset validators (`commands/assets.ts`) take `db: DatabaseSync`
- Callers pass `{ assetDb: db }` instead of `{ assetDataDir: dataDir }`
- Backup/restore includes `assets` in `SQLITE_BACKUP_TABLES`
- The in-memory `AssetMetadataIndex` cache is removed (replaced by indexed table)

Verification: api:test 1515/test 948/audit green.

### Phase 2: Characters (v11) — `4c8d725b`

Moved `database.characters[]` (50 entries, 9.3 MB, 78% of db.json) from
db.json to SQLite `characters` + `chats` tables. Migration v11 creates the
tables; `ensureCharactersExtracted` runs on boot to losslessly import any
legacy db.json characters.

After this commit:
- `loadPersisted(db, dataDir)` gains a `db` parameter; reconstructs
  `database.characters` from SQLite (falls back to db.json during migration)
- All mutation engines (`applyJsonCommandMutation`, message-free, targeted)
  call `replaceAllCharactersInTable` inside the transaction
- Each write path calls `stripCharacters(persisted)` before `writePersisted`
  so db.json no longer carries characters
- `writePersistedWithMessages` also syncs characters to SQLite
- Backup/restore includes `characters` and `chats` in `SQLITE_BACKUP_TABLES`
- All callers updated to pass `db`: mutation engines, projection routes,
  bootstrap, generation, memory job handlers
- `globalLore` stays inside the character JSON blob (lazy-stubbed separately)

Verification: api:test 1515/test 948/audit green.

### Phase 3: Collections (v12)

Moved `database.modules`, `plugins`, `botPresets`, `promptTemplate`,
`personas`, `loadouts`, `loreBook`, `translatorPresets`, `hypaV3Presets`,
and `pluginCustomStorage` from db.json to ten SQLite tables. Migration v12
creates the tables; `ensureCollectionsExtracted` runs on boot to losslessly
import any legacy db.json collections.

After this commit:
- Each array collection has a `(position INTEGER PRIMARY KEY, data_json TEXT)`
  table; `pluginCustomStorage` has a `(key TEXT PRIMARY KEY, value_json TEXT)`
  key-value table
- `loadPersisted` reconstructs collections from SQLite via
  `loadCollectionsFromSqlite`; falls back to db.json markers during migration
- All mutation engines call `replaceAllCollectionsInTable` inside the
  transaction, then `stripCollections` before `writePersisted`
- `stripCollections` replaces non-empty arrays with `[]` markers in db.json
  (preserves field-presence semantics for normalization; absent vs `[]` matters)
- `ensureCollectionsExtracted` on boot moves data to SQLite and replaces
  arrays with `[]` markers in db.json
- `writePersistedWithMessages`, `applyImport`, `initializeDefaultDatabase`,
  and `ensureMessagesExtracted` all updated with the collection table sync
- Backup/restore includes all ten collection tables in `SQLITE_BACKUP_TABLES`

Verification: api:test 1515/test 948/audit green.

### Phase 4: Scalar Settings (v13)

Moved the ~271 scalar settings, nested setting objects, and remaining small
arrays from db.json to a single-row SQLite `settings` table. Migration v13
creates the table; `ensureSettingsExtracted` runs on boot to losslessly import
any legacy db.json settings.

After this commit:
- `settings` table has schema `(id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)))` — one row, JSON blob
- `loadPersisted` reads settings from SQLite first; falls back to db.json
  only when the settings table is empty (legacy migration path)
- All mutation engines call `replaceAllSettingsInTable` inside the transaction,
  then `stripSettings` before `writePersisted`
- `extractSettings` filters out characters, collections, and
  `pluginCustomStorage` from the database object — everything else is settings
- `stripSettings` is the inverse: keeps only collection fields in db.json
- Collection defaults are seeded when loading from SQLite, except
  `promptTemplate` (absent ≠ empty `[]` for the prompt assembler)
- `ensureSettingsExtracted` on boot moves settings from db.json to SQLite and
  deletes them from db.json
- Backup/restore includes `settings` in `SQLITE_BACKUP_TABLES`
- db.json after Phase 4: `{ "_version": 1, "database": { <collection markers> },
  "assets": [] }` — all content is in SQLite

Verification: api:test 1515/test 948/audit green.

### Incremental narrowing opportunity

Once characters are in SQLite, mutations that touch one character no longer need
to serialize all 50. The mutation engine can UPDATE a single row. This is the
primary performance win.

## Phase 5 (future)

See `docs/db-json-to-sqlite.md` for the full plan. Phase 5 removes db.json
entirely.
