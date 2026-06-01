import fs, { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assetById,
  missingAssetIds,
  writePersisted,
  type Persisted,
  type PersistedAsset,
} from '../src/repository.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-assets-index-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function asset(id: string, ext = 'png'): PersistedAsset {
  return {
    id,
    ext,
    size: 10,
    contentType: 'image/png',
  }
}

function persisted(assets: PersistedAsset[]): Persisted {
  return { _version: 1, database: { characters: [] }, assets }
}

function dbJsonReadCount(spy: ReturnType<typeof vi.spyOn>, dataDir: string): number {
  const file = path.join(dataDir, 'db.json')
  return spy.mock.calls.filter((call) => call[0] === file).length
}

describe('asset metadata index', () => {
  it('reuses one db.json parse for repeated metadata lookups', () => {
    const dataDir = makeDataDir()
    const known = 'a'.repeat(64)
    const missing = 'b'.repeat(64)
    writePersisted(dataDir, persisted([asset(known)]))

    const readSpy = vi.spyOn(fs, 'readFileSync')

    expect(assetById(dataDir, known)).toEqual(asset(known))
    expect(missingAssetIds(dataDir, [known, missing])).toEqual([missing])
    expect(assetById(dataDir, known)).toEqual(asset(known))

    expect(dbJsonReadCount(readSpy, dataDir)).toBe(1)
  })

  it('refreshes the index after repository writes', () => {
    const dataDir = makeDataDir()
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    writePersisted(dataDir, persisted([asset(first)]))

    expect(assetById(dataDir, first)).toEqual(asset(first))

    writePersisted(dataDir, persisted([asset(second, 'webp')]))

    expect(assetById(dataDir, first)).toBeNull()
    expect(assetById(dataDir, second)).toEqual(asset(second, 'webp'))
  })

  it('refreshes the index after direct db.json replacement', () => {
    const dataDir = makeDataDir()
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    writePersisted(dataDir, persisted([asset(first)]))

    expect(assetById(dataDir, first)).toEqual(asset(first))

    const file = path.join(dataDir, 'db.json')
    writeFileSync(file, JSON.stringify(persisted([asset(second, 'webp')])))
    const future = new Date(Date.now() + 10_000)
    utimesSync(file, future, future)

    expect(assetById(dataDir, first)).toBeNull()
    expect(assetById(dataDir, second)).toEqual(asset(second, 'webp'))
  })
})
