import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assetById,
  createAssetMetadataTable,
  getAllAssetMetadata,
  getAssetMetadataById,
  getAssetMetadataCount,
  insertAssetMetadataBatch,
  deleteAssetMetadataByIds,
  getMissingAssetIds,
  missingAssetIds,
  type PersistedAsset,
} from '../src/repository.js'

const dataDirs: string[] = []
const dbs: DatabaseSync[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-assets-index-'))
  dataDirs.push(dataDir)
  return dataDir
}

function makeDb(): DatabaseSync {
  const dataDir = makeDataDir()
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  createAssetMetadataTable(db)
  dbs.push(db)
  return db
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    db.close()
  }
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function asset(id: string, ext = 'png'): PersistedAsset {
  return { id, ext, size: 10, contentType: 'image/png' }
}

describe('SQLite asset metadata', () => {
  it('inserts and retrieves assets by id', () => {
    const db = makeDb()
    const known = 'a'.repeat(64)
    insertAssetMetadataBatch(db, [asset(known)])

    expect(assetById(db, known)).toEqual(asset(known))
    expect(getAssetMetadataById(db, known)).toEqual(asset(known))
  })

  it('returns null for unknown assets', () => {
    const db = makeDb()
    const missing = 'b'.repeat(64)
    expect(assetById(db, missing)).toBeNull()
    expect(getAssetMetadataById(db, missing)).toBeNull()
  })

  it('returns null for invalid asset ids', () => {
    const db = makeDb()
    expect(assetById(db, 'not-a-sha256')).toBeNull()
  })

  it('lists all assets', () => {
    const db = makeDb()
    const a = asset('a'.repeat(64))
    const b = asset('b'.repeat(64), 'webp')
    insertAssetMetadataBatch(db, [a, b])

    const all = getAllAssetMetadata(db)
    expect(all).toEqual([a, b])
  })

  it('counts assets', () => {
    const db = makeDb()
    expect(getAssetMetadataCount(db)).toBe(0)
    insertAssetMetadataBatch(db, [asset('a'.repeat(64)), asset('b'.repeat(64))])
    expect(getAssetMetadataCount(db)).toBe(2)
  })

  it('deletes assets by ids', () => {
    const db = makeDb()
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    insertAssetMetadataBatch(db, [asset(a), asset(b)])

    deleteAssetMetadataByIds(db, [a])
    expect(getAssetMetadataById(db, a)).toBeNull()
    expect(getAssetMetadataById(db, b)).toEqual(asset(b))
    expect(getAssetMetadataCount(db)).toBe(1)
  })

  it('reports missing asset ids', () => {
    const db = makeDb()
    const known = 'a'.repeat(64)
    const unknown = 'b'.repeat(64)
    insertAssetMetadataBatch(db, [asset(known)])

    expect(missingAssetIds(db, [known, unknown])).toEqual([unknown])
    expect(getMissingAssetIds(db, [known, unknown])).toEqual([unknown])
  })

  it('INSERT OR IGNORE skips duplicates', () => {
    const db = makeDb()
    const id = 'a'.repeat(64)
    insertAssetMetadataBatch(db, [asset(id)])
    insertAssetMetadataBatch(db, [asset(id, 'webp')])

    const result = getAssetMetadataById(db, id)
    expect(result?.ext).toBe('png')
    expect(getAssetMetadataCount(db)).toBe(1)
  })
})
