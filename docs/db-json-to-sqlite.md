# db.json to SQLite Migration Plan

## Agent Brief

Use this as an implementation map, not as one large refactor. Land one phase
at a time. Each phase should add the SQLite migration, move the repository
read/write boundary, update backup/import/export/projection paths that touch
the moved data, and add focused tests before starting the next phase.

Keep caller-facing shapes stable during the migration. `loadPersisted`,
`writePersisted`, and the command mutation engines should continue to expose
the same `Persisted` / `database` objects while their internals move from JSON
file I/O to SQLite. Narrow individual callers only after the table-backed
boundary works.

## Current State

`data/db.json` is a single ~11 MB JSON file with three top-level keys:

| Key                    | Size   | Share | Contents                                                                        |
| ---------------------- | ------ | ----- | ------------------------------------------------------------------------------- |
| `database.characters`  | 9.3 MB | 78%   | 50 characters, each with chats, lorebooks, scripts, assets                      |
| `assets`               | 1.6 MB | 13%   | 12 344 `PersistedAsset` metadata entries (id, ext, size, contentType)           |
| settings + collections | 0.8 MB | 7%    | ~271 scalars, 27 arrays, 26 objects (presets, personas, modules, plugins, etc.) |

Already in SQLite (migrations v2-v9 in `db.ts`):

- Chat messages and reroll alternates (`messages` table, v4/v6)
- Per-chat `hypaV3Data` (`chat_hypa_v3` table, v5)
- Hypa V3 memory tables (chunks, summaries, embeddings, jobs; v2/v3)
- Command-event replay history (`command_events` table, v7/v9)
- Generation finalization retry queue (v8)
- Schema version + global revision (`schema_version` table)

Still in db.json: characters (minus messages), settings, presets, personas,
modules, plugins, lorebooks, loadouts, translator presets, prompt templates,
asset metadata manifest, and ~200 scalar settings.

### How db.json works today

Every mutation:

1. Reads `db.json` from disk (`loadPersisted` / `loadPersistedWithMessages`).
2. Parses the full ~11 MB JSON, clones the database object.
3. Applies one mutation to the clone.
4. Bumps the SQLite revision + writes the command event inside a transaction.
5. Serializes the full ~11 MB JSON back to disk (`writePersisted`; atomic
   write-to-tmp + rename).

This means every single settings toggle, character edit, or lorebook change
reads and rewrites the entire file. Reads that only need one character still
parse the full blob.

### Why migrate

| Problem                                  | Impact                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Full-file read+write on every mutation   | O(n) I/O per mutation regardless of change size                     |
| Full JSON parse on every read            | CPU proportional to total db.json size, not the queried data        |
| No concurrent-read isolation             | The file is rewritten atomically, but readers can race with writers |
| Asset manifest in JSON                   | 12k entries searched linearly; no indexed lookup                    |
| Backup/restore copies the file wholesale | Cannot snapshot or restore individual resources                     |
| Character data dominates (78%)           | One large character inflates every unrelated mutation's I/O         |

## Migration Strategy

### Guiding principles

1. One table family at a time. Each phase introduces a SQLite table, a
   migration step, and a read/write boundary. Then remove the corresponding
   field from `db.json`. This is the same pattern used for the messages
   extraction (v4-v6).

2. Lossless on-boot migration. Like messages, old data embedded in db.json
   is read on first boot after the migration, written to SQLite, and stripped
   from db.json on the next write. No data loss, no manual step.

3. `db.json` shrinks monotonically. After each phase, db.json no longer
   carries the migrated fields. At the end, db.json is either gone or reduced
   to a thin envelope.

4. Callers never change interface. The repository boundary
   (`loadPersisted`, `writePersisted`, the mutation engines) should continue to
   present a unified `Persisted` / `database` object to callers. The internal
   implementation moves from JSON file I/O to SQLite queries behind the same
   functions. Callers can be narrowed later (reading only what they need), but
   are not forced to change in the migration phase.

5. One SQLite migration version per phase. Each phase bumps
   `CURRENT_SCHEMA_VERSION` and adds a `MigrationStep`.

---

## Phase 1: Asset Metadata

Moves: `Persisted.assets: PersistedAsset[]` (12 344 entries, 1.6 MB).

Why first: the asset manifest is self-contained (no foreign keys into the
database object), is the second-largest piece of db.json, and is queried by ID
on every asset read. A SQLite table with a primary key index replaces the
in-memory `Map` cache that `getAssetMetadataIndex` maintains today.

### Schema

```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,       -- sha256 hex
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL
);
```

### Migration step

```
version: 10, name: 'asset-metadata-table'
up: create table, INSERT from the db.json `assets` array if it exists,
    then strip `assets` from the persisted JSON on next write.
```

### Boundary changes

| Function                              | Change                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `assetById`                           | SELECT from `assets` table instead of the cached Map                               |
| `addAssets` (in repository.ts)        | INSERT into `assets` table; stop appending to `Persisted.assets`                   |
| `loadPersisted`                       | Stop reading `assets` from JSON; fill from SQLite for callers that still expect it |
| `writePersisted`                      | Stop writing `assets` to JSON                                                      |
| Asset GC (`assetGc.ts`)               | DELETE from `assets` table instead of filtering the array                          |
| Backup create/restore                 | Include `assets` table rows in backup scope                                        |
| `.risu` export (`assetReferences.ts`) | Read from SQLite instead of the parsed array                                       |

### Callers to update

- `repository.ts`: `getAssetMetadataIndex`, `assetById`, `addAssets`,
  `loadPersisted`, `writePersisted`, `createBackup`, `restoreBackup`
- `assetGc.ts`: `runAssetGc`
- `risuSave/assetReferences.ts`: `collectAssetReferences`
- `risuSave/exportSnapshot.ts`: reads `persisted.assets`
- `routes/save.ts`: bundle import writes assets
- `routes/realmImport.ts`: writes assets during import

---

## Phase 2: Characters

Moves: `database.characters[]` (50 entries, 9.3 MB, 78% of db.json).

This is the largest and most complex extraction. Each character is a rich
object with ~60 fields, nested chats (already message-free thanks to v4),
nested lorebooks, trigger scripts, custom scripts, and additional assets.

### Schema

```sql
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,               -- chaId
  position INTEGER NOT NULL,         -- array index / display order
  data_json TEXT NOT NULL             -- full character JSON blob minus chats
    CHECK (json_valid(data_json))
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,               -- chat.id (UUID)
  character_id TEXT NOT NULL          -- FK -> characters.id
    REFERENCES characters(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,         -- index within character's chat array
  data_json TEXT NOT NULL             -- chat JSON blob (message-free)
    CHECK (json_valid(data_json))
);

CREATE INDEX IF NOT EXISTS idx_chats_character_id ON chats (character_id);
```

### Design notes

- Character data is stored as a JSON blob column. The character object has
  ~60 heterogeneous fields that change across versions; a typed column per
  field would be fragile and unmaintainable. JSON blob with `json_extract`
  for the few indexed lookups (name, chaId) is the pragmatic choice.
- `chats` are a separate table because they are already independently
  addressed (hydration, message store, generation jobs all key on chat ID).
- `position` preserves array ordering for display.
- `globalLore` stays inside the character JSON blob. It is already
  lazy-stubbed in the projection path and hydrated separately. Extracting it
  to its own table is a possible follow-up but not required for the
  migration.

### Migration step

```
version: 11, name: 'characters-table'
up: create tables, INSERT each character + chats from the db.json
    `database.characters` array.
```

### Boundary changes

| Function          | Change                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `loadPersisted`   | Reconstruct `database.characters` from SQLite rows instead of JSON        |
| `writePersisted`  | Write character changes to SQLite rows; stop including characters in JSON |
| Mutation engines  | Character/chat/lorebook commands write to the `characters`/`chats` tables |
| Projection routes | Character-keyed projections can SELECT individual rows                    |
| Bootstrap         | Assemble the stub projection from SQLite (already message-free)           |

### Incremental narrowing opportunity

Once characters are in SQLite, mutations that touch one character no longer
need to serialize all 50. The mutation engine can UPDATE a single row. This
is the primary performance win: the biggest source of I/O amplification is
eliminated.

---

## Phase 3: Collections (presets, personas, modules, plugins, loadouts)

Moves: the medium-sized entity arrays that have their own command
families.

| Collection                        | Size   | Count   | Command family                |
| --------------------------------- | ------ | ------- | ----------------------------- |
| `modules`                         | 298 KB | 3       | `module.*`                    |
| `plugins` + `pluginCustomStorage` | 311 KB | 1 + obj | `plugin.*`, `pluginStorage.*` |
| `botPresets`                      | 137 KB | 2       | `preset.*`, `prompt.*`        |
| `promptTemplate`                  | 56 KB  | 30      | `prompt.*`                    |
| `personas`                        | 11 KB  | 6       | `persona.*`                   |
| `loadouts`                        | <1 KB  | 0       | `loadout.*`                   |
| `loreBook`                        | <1 KB  | 1       | `lorebook.*`                  |
| `translatorPresets`               | <1 KB  | 1       | `translatorPreset.*`          |
| `hypaV3Presets`                   | 6 KB   | 2       | none                          |

### Schema (one table per collection)

Each collection follows the same pattern:

```sql
CREATE TABLE IF NOT EXISTS <collection> (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json))
);
```

`pluginCustomStorage` is a key-value store:

```sql
CREATE TABLE IF NOT EXISTS plugin_custom_storage (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
);
```

### Migration step

```
version: 12, name: 'collections-tables'
up: create all collection tables, INSERT from db.json arrays.
```

This can be a single migration or split into sub-versions if the scope is too
wide for one review. The collections are independent so order does not matter.

### Boundary changes

Each collection's command handler (in `commands/*.ts`) switches from
mutating the in-memory database array to INSERT/UPDATE/DELETE on its table.
The projection route for each resource reads from its table instead of
loading the full db.json.

Selection scalars (`currentChar`, `botPresetsId`, `selectedPersona`,
`loreBookPage`, `enabledModules`, etc.) move to Phase 4 with the rest of the
scalar settings.

---

## Phase 4: Scalar Settings

Moves: the ~271 scalar settings, ~26 nested setting objects, and the
remaining small arrays (`hotkeys`, `characterOrder`, `formatingOrder`,
`customQuotesData`, `globalscript`, `togglePresets`, `themePresets`, etc.).

These are the "settings" resource: the one that today triggers a full
bootstrap fallback because it sprawls across many top-level keys.

### Schema options

#### Option A: Single settings row (recommended)

```sql
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL CHECK (json_valid(data_json))
);
```

Store the entire settings blob as one JSON column. This mirrors how settings
are consumed today (always loaded as a group) and avoids hundreds of typed
columns. Individual setting reads use `json_extract`; writes use
`json_set` or full-row replacement.

#### Option B: Key-value table

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

More granular but adds overhead for the common case of loading all settings
at bootstrap. Useful if individual setting reads become a hot path.

Recommendation: Option A. Settings are always loaded together at
bootstrap time, and the total size (~800 KB) is small enough that a single
JSON column is practical. The mutation path can use `json_set` for surgical
updates without deserializing the full blob.

### Migration step

```
version: 13, name: 'settings-table'
up: create table, INSERT all non-character, non-collection fields from
    the db.json database object.
```

### After Phase 4

`db.json` is empty or contains only `{ "_version": 1 }`. At this point:

- `loadPersisted` assembles the `Persisted` object entirely from SQLite.
- `writePersisted` writes only to SQLite (db.json can be kept as a
  tombstone or removed).
- The full-file parse+serialize cycle is gone.

---

## Phase 5: Remove db.json

What happens: after all data lives in SQLite, db.json is no longer
read or written on the hot path.

### Steps

1. Remove `loadPersisted`'s JSON file read; it now assembles from SQLite
   only.
2. Remove `writePersisted`'s JSON file write; it now writes to SQLite only.
3. Keep a one-time boot migration that reads any leftover db.json and
   imports it into SQLite (idempotent, using the same pattern as the message
   extraction).
4. After the boot migration succeeds, rename db.json to
   `db.json.migrated` (or delete it).
5. Update backup create/restore to work with SQLite only.
6. Update `.risu` import/export to work without db.json.
7. Update `KNOWN_DATA_DIR_CHILDREN` and documentation.

### Migration step

```
version: 14, name: 'remove-db-json'
up: no-op table change; the boot path handles the file removal.
```

---

## Cross-Cutting Concerns

### Backup and Restore

Today, backups copy `db.json`, `assets/`, `risu.db`, and `save/` as
separate artifacts. After the migration, all durable state is in `risu.db`
plus the `assets/` directory. Backup create/restore must work with the new
layout from Phase 1 onward, while remaining able to restore old-format
backups that contain a `db.json`.

### `.risu` Import/Export

The export codec reads a `Persisted` object. As long as `loadPersisted`
continues to return the same shape (assembled from SQLite instead of JSON),
the export path does not change. Import writes through the same boundary
functions.

### Projection and Bootstrap

The bootstrap route currently calls `loadStubProjection` which reads db.json
and stubs chat messages. After Phase 2, the stub projection is assembled
from SQLite character/chat rows with messages already absent. After Phase 4,
all projection fields come from SQLite.

The targeted projection route (`GET /api/v1/projection/:resource`) currently
loads specific fields via `loadPersistedDatabaseFields` or
`loadStubbedProjectionFields`. These functions already take field-key lists;
their implementation moves from JSON field selection to SQLite table reads.

### Mutation Engines

The three mutation engines in `commands/mutations.ts` all follow the same
pattern: load -> clone -> mutate -> sync -> commit -> write. The internal
representation stays the same (a `database` object with the full shape);
what changes is where the object is loaded from and persisted to. The
engines do not need structural changes, only re-pointed I/O.

Later, individual command handlers can be narrowed to read/write only the
table they touch (e.g., a preset update only touches the `presets` table),
but this optimization is not required during the migration.

### Testing

Each phase should include:

- Migration test: verify the `up` function creates the table and populates
  it from a synthetic db.json.
- Round-trip test: verify `loadPersisted` -> mutate -> `writePersisted` ->
  `loadPersisted` produces identical data before and after the migration.
- Projection test: verify bootstrap and targeted projection responses are
  byte-identical before and after.

Existing test suites (`pnpm api:test`, `pnpm test`) should pass unchanged
after each phase because the caller-facing interface does not change.

---

## Phase Ordering and Dependencies

```
Phase 1 (assets)        independent, no FK dependencies
Phase 2 (characters)    depends on messages table (v4) already existing
Phase 3 (collections)   independent of Phase 2
Phase 4 (settings)      after collections, so only scalars remain
Phase 5 (remove db.json) after all phases complete
```

Phases 1-3 can be developed in any order. Phase 4 depends on collections
being out so the settings blob is clean. Phase 5 is the final cleanup.

## Size Impact Summary

| Phase   | Data moved            | db.json after |
| ------- | --------------------- | ------------- |
| Phase 1 | 1.6 MB (assets)       | ~10.1 MB      |
| Phase 2 | 9.3 MB (characters)   | ~0.8 MB       |
| Phase 3 | ~0.8 MB (collections) | ~0.05 MB      |
| Phase 4 | ~0.05 MB (settings)   | 0 (removed)   |
| Phase 5 | none                  | file deleted  |
