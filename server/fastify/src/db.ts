import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const CURRENT_SCHEMA_VERSION = 1

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
    applyMigrations(db, getSchemaState(db).version)
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
