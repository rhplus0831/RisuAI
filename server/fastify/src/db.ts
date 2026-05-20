import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const CURRENT_SCHEMA_VERSION = 0

export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
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
  return db
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
