import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createChatBlobTable, createMessageTable } from './messageStore.js'

export const CURRENT_SCHEMA_VERSION = 5

export interface MigrationStep {
  version: number
  name: string
  up: (db: DatabaseSync) => void
}

export const MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 1,
    name: 'migration-runner-bootstrap',
    up: () => {
      // Version 1 establishes the migration runner. Memory tables start in v2.
    },
  },
  {
    version: 2,
    name: 'hypa-v3-memory-tables',
    up: (db) => {
      createMemoryTables(db)
    },
  },
  {
    version: 3,
    name: 'memory-job-retry-scheduling',
    up: (db) => {
      createMemoryTables(db)
    },
  },
  {
    version: 4,
    name: 'chat-messages-table',
    up: (db) => {
      // Lazy-projection Phase 4: chat messages move to their own SQLite table.
      // The migration only creates the table; embedded `db.json` messages are
      // lossless-migrated on first read (SQLite-or-embedded join) and persisted
      // to the table on the next write — see `loadPersistedWithMessages` /
      // `writePersistedWithMessages` in repository.ts.
      createMessageTable(db)
    },
  },
  {
    version: 5,
    name: 'chat-hypa-v3-table',
    up: (db) => {
      // Lazy-projection Phase 4.4: the per-chat hypaV3Data blob moves to its own
      // table (same boundary treatment as messages; extracted from db.json on
      // startup via ensureMessagesExtracted).
      createChatBlobTable(db)
    },
  },
]

export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.exec(
      `INSERT OR IGNORE INTO schema_version (id, version, revision) VALUES (1, ${CURRENT_SCHEMA_VERSION}, 0)`,
    )
    const schemaState = getSchemaState(db)
    if (schemaState.version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${schemaState.version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
      )
    }
    if (schemaState.version === CURRENT_SCHEMA_VERSION) {
      createMemoryTables(db)
      createMessageTable(db)
      createChatBlobTable(db)
    }
    applyMigrations(db, schemaState.version)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

export function applyMigrations(db: DatabaseSync, fromVersion: number): void {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`Invalid schema version: ${fromVersion}`)
  }
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    )
  }
  if (fromVersion === CURRENT_SCHEMA_VERSION) {
    return
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > fromVersion)
  assertContiguousMigrations(fromVersion, pending)

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db)
      const result = db
        .prepare('UPDATE schema_version SET version = ? WHERE id = 1')
        .run(migration.version)
      if (result.changes !== 1) {
        throw new Error('schema_version row missing; database not initialized')
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(
        `Failed to apply schema migration ${migration.version} (${migration.name}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }
  }
}

function assertContiguousMigrations(
  fromVersion: number,
  migrations: readonly MigrationStep[],
): void {
  let expectedVersion = fromVersion + 1
  for (const migration of migrations) {
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Missing schema migration ${expectedVersion}; next registered migration is ${migration.version}`,
      )
    }
    expectedVersion += 1
  }
  if (expectedVersion - 1 !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Missing schema migration ${expectedVersion}; current schema version is ${CURRENT_SCHEMA_VERSION}`,
    )
  }
}

export function getSchemaState(db: DatabaseSync): { version: number; revision: number } {
  const row = db.prepare('SELECT version, revision FROM schema_version WHERE id = 1').get() as
    | { version: number; revision: number }
    | undefined
  if (!row) {
    return { version: CURRENT_SCHEMA_VERSION, revision: 0 }
  }
  return row
}

export function bumpRevision(db: DatabaseSync): number {
  const row = db
    .prepare('UPDATE schema_version SET revision = revision + 1 WHERE id = 1 RETURNING revision')
    .get() as { revision: number } | undefined
  if (!row) {
    throw new Error('schema_version row missing; database not initialized')
  }
  return row.revision
}

function createMemoryTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT,
      range_start_seq INTEGER NOT NULL CHECK (range_start_seq >= 0),
      range_end_seq INTEGER NOT NULL CHECK (range_end_seq >= range_start_seq),
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'summarized', 'failed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_chunks_chat_id
      ON memory_chunks (chat_id);
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_chat_status
      ON memory_chunks (chat_id, status);
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_chat_range
      ON memory_chunks (chat_id, range_start_seq, range_end_seq);

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
      tokens INTEGER NOT NULL CHECK (tokens >= 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (chunk_id) REFERENCES memory_chunks(id) ON DELETE CASCADE,
      UNIQUE (chunk_id, model)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_summaries_chat_id
      ON memory_summaries (chat_id);
    CREATE INDEX IF NOT EXISTS idx_memory_summaries_chunk_id
      ON memory_summaries (chunk_id);
    CREATE INDEX IF NOT EXISTS idx_memory_summaries_chat_model
      ON memory_summaries (chat_id, model);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      model TEXT NOT NULL,
      vector_blob BLOB NOT NULL,
      dim INTEGER NOT NULL CHECK (dim > 0),
      group_id TEXT,
      group_index INTEGER CHECK (group_index IS NULL OR group_index >= 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (chunk_id) REFERENCES memory_chunks(id) ON DELETE CASCADE,
      UNIQUE (chunk_id, model)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chat_id
      ON memory_embeddings (chat_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chunk_id
      ON memory_embeddings (chunk_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chat_model
      ON memory_embeddings (chat_id, model);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_group
      ON memory_embeddings (group_id, group_index);

    CREATE TABLE IF NOT EXISTS memory_jobs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('chunk', 'embed', 'summarize')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
      next_run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_jobs_chat_id
      ON memory_jobs (chat_id);
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_status_created
      ON memory_jobs (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_kind_status
      ON memory_jobs (kind, status);
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_status_next_run
      ON memory_jobs (status, next_run_at, created_at, id);
  `)
  ensureColumn(
    db,
    'memory_summaries',
    'metadata_json',
    'ALTER TABLE memory_summaries ADD COLUMN metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))',
  )
  ensureColumn(
    db,
    'memory_jobs',
    'attempt_count',
    'ALTER TABLE memory_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)',
  )
  ensureColumn(
    db,
    'memory_jobs',
    'max_attempts',
    'ALTER TABLE memory_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0)',
  )
  ensureColumn(
    db,
    'memory_jobs',
    'next_run_at',
    "ALTER TABLE memory_jobs ADD COLUMN next_run_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'",
  )
}

function ensureColumn(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
  alterSql: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
  if (!rows.some((row) => row.name === columnName)) {
    db.exec(alterSql)
  }
}
