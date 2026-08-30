import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertMigrationCatalog,
  CURRENT_SCHEMA_VERSION,
  DamagedDatabaseRefusalError,
  getSchemaState,
  MIGRATIONS,
  openDatabase,
  type MigrationStep,
} from '../src/db.js'
import {
  installMigrationVersionCommitFailure,
  loadCompatibilityMigrationFixtureAdapters,
  removeMigrationVersionCommitFailure,
} from './support/migrationFoundationHarness.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-migration-foundation-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) rmSync(dataDir, { recursive: true, force: true })
})

describe('migration and recovery foundation', () => {
  it('keeps the production migration catalog named, unique, and contiguous', () => {
    expect(() => assertMigrationCatalog()).not.toThrow()
    expect(MIGRATIONS.map(({ version }) => version)).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1),
    )
    expect(new Set(MIGRATIONS.map(({ name }) => name)).size).toBe(CURRENT_SCHEMA_VERSION)

    const duplicateName: MigrationStep[] = [
      { version: 1, name: 'same-name', up: () => undefined },
      { version: 2, name: 'same-name', up: () => undefined },
    ]
    expect(() => assertMigrationCatalog(duplicateName, 2)).toThrow('Duplicate schema migration name: same-name')
    expect(() => assertMigrationCatalog([duplicateName[1]!], 1)).toThrow('Missing schema migration 1')
    expect(() => assertMigrationCatalog([{ version: 1, name: 'Not Named', up: () => undefined }], 1)).toThrow(
      'Invalid schema migration name',
    )
  })

  it('rolls a failed named step and its version back, then retries and reopens idempotently', () => {
    const dataDir = makeDataDir()
    const fresh = openDatabase(dataDir)
    fresh.close()

    const seed = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      for (const table of [
        'bardwiki_document_search',
        'bardwiki_change_manifest',
        'bardwiki_document_sources',
        'bardwiki_document_versions',
        'bardwiki_links',
        'bardwiki_rebuild_staging',
        'bardwiki_turn_receipts',
        'bardwiki_documents',
        'bardwiki_jobs',
        'bardwiki_chat_settings',
      ]) {
        seed.exec(`DROP TABLE ${table}`)
      }
      seed.prepare('UPDATE schema_version SET version = 32, revision = 41 WHERE id = 1').run()
      seed.exec('CREATE TABLE migration_foundation_marker (value TEXT NOT NULL)')
      seed.prepare('INSERT INTO migration_foundation_marker (value) VALUES (?)').run('before')
      installMigrationVersionCommitFailure(seed, 33)
    } finally {
      seed.close()
    }

    expect(() => openDatabase(dataDir)).toThrow(
      'Failed to apply schema migration 33 (bardwiki-authoritative-storage): injected migration version commit failure',
    )

    const interrupted = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      expect(getSchemaState(interrupted)).toEqual({ version: 32, revision: 41 })
      expect(interrupted.prepare('SELECT value FROM migration_foundation_marker').get()).toEqual({ value: 'before' })
      expect(
        interrupted
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bardwiki_documents'")
          .get(),
      ).toBeUndefined()
      removeMigrationVersionCommitFailure(interrupted)
    } finally {
      interrupted.close()
    }

    const retried = openDatabase(dataDir)
    expect(getSchemaState(retried)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 41 })
    expect(retried.prepare('SELECT value FROM migration_foundation_marker').get()).toEqual({ value: 'before' })
    expect(
      retried.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bardwiki_documents'").get(),
    ).toEqual({ name: 'bardwiki_documents' })
    retried.close()

    const reopened = openDatabase(dataDir)
    expect(getSchemaState(reopened)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 41 })
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM bardwiki_documents').get()).toEqual({ count: 0 })
    reopened.close()
  })

  it('refuses existing databases outside the automatic migration envelope', () => {
    const noVersionTableDir = makeDataDir()
    const noVersionTable = new DatabaseSync(path.join(noVersionTableDir, 'risu.db'))
    noVersionTable.exec('CREATE TABLE user_state (value TEXT)')
    noVersionTable.close()

    expect(() => openDatabase(noVersionTableDir)).toThrow(DamagedDatabaseRefusalError)
    expect(() => openDatabase(noVersionTableDir)).toThrow('schema_version table is missing')

    const noVersionRowDir = makeDataDir()
    const noVersionRow = new DatabaseSync(path.join(noVersionRowDir, 'risu.db'))
    noVersionRow.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )
    `)
    noVersionRow.close()
    expect(() => openDatabase(noVersionRowDir)).toThrow('schema_version singleton row is missing or invalid')

    const incompleteCurrentDir = makeDataDir()
    const incompleteCurrent = new DatabaseSync(path.join(incompleteCurrentDir, 'risu.db'))
    incompleteCurrent.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO schema_version (id, version, revision) VALUES (1, ${CURRENT_SCHEMA_VERSION}, 0);
    `)
    incompleteCurrent.close()
    expect(() => openDatabase(incompleteCurrentDir)).toThrow('current schema is missing required tables')
  })

  it('adapts every Phase 0 historical fixture into an owning verification lane', () => {
    const adapters = loadCompatibilityMigrationFixtureAdapters(repositoryRoot)
    expect(adapters).toHaveLength(19)
    expect(new Set(adapters.map(({ surfaceId }) => surfaceId)).size).toBe(19)
    expect(
      Object.fromEntries(
        ['model-configuration', 'prompt-template', 'translator', 'repair', 'interchange'].map((family) => [
          family,
          adapters.filter((adapter) => adapter.family === family).length,
        ]),
      ),
    ).toEqual({
      'model-configuration': 4,
      'prompt-template': 5,
      translator: 4,
      repair: 3,
      interchange: 3,
    })

    for (const adapter of adapters) {
      expect(existsSync(path.join(repositoryRoot, adapter.fixturePath)), adapter.surfaceId).toBe(true)
      expect(adapter.command, adapter.surfaceId).toMatch(/^pnpm /)
    }
  })
})
