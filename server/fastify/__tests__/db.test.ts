import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { applyMigrations, CURRENT_SCHEMA_VERSION, getSchemaState, openDatabase } from '../src/db.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-db-'))
  dataDirs.push(dataDir)
  return dataDir
}

function seedSchemaVersion(dataDir: string, version: number, revision = 0): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.prepare('INSERT INTO schema_version (id, version, revision) VALUES (1, ?, ?)').run(
      version,
      revision,
    )
  } finally {
    db.close()
  }
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('schema migrations', () => {
  it('opens a fresh database at the current schema version', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 0 })
    } finally {
      db.close()
    }
  })

  it('applies the migration runner version bump without changing revision', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 0, 7)

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 7 })
    } finally {
      db.close()
    }
  })

  it('is safe to reopen and reapply after migrations are current', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 0, 3)

    const first = openDatabase(dataDir)
    first.close()

    const second = openDatabase(dataDir)
    try {
      applyMigrations(second, getSchemaState(second).version)
      expect(getSchemaState(second)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 3 })
    } finally {
      second.close()
    }
  })

  it('rejects databases newer than the app schema version', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, CURRENT_SCHEMA_VERSION + 1)

    expect(() => openDatabase(dataDir)).toThrow(/newer than supported version/)
  })

  it('requires the singleton schema_version row when applying migrations', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0
        )
      `)

      expect(() => applyMigrations(db, 0)).toThrow(/schema_version row missing/)
    } finally {
      db.close()
    }
  })
})
