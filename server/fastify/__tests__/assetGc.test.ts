import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAssetGc } from '../src/assetGc.js'
import { assetsDir, loadPersisted, type PersistedAsset } from '../src/repository.js'

const REFERENCED = 'a'.repeat(64)
const SHARED = 'b'.repeat(64)
const ORPHAN_OLD = 'c'.repeat(64)
const ORPHAN_FRESH = 'd'.repeat(64)
const STRAY_OLD = 'e'.repeat(64)
const STRAY_FRESH = 'f'.repeat(64)

const GRACE_MS = 60 * 60_000
const NOW = 10_000_000_000
const OLD_MTIME = NOW - GRACE_MS - 60_000
const FRESH_MTIME = NOW - 60_000

function asset(id: string): PersistedAsset {
  return { id, ext: 'png', size: 1, contentType: 'image/png' }
}

let dataDir: string

function writeAssetFile(id: string, mtimeMs: number): string {
  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.png`)
  writeFileSync(file, Buffer.from([1, 2, 3]))
  const secs = mtimeMs / 1000
  utimesSync(file, secs, secs)
  return file
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-asset-gc-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('runAssetGc', () => {
  it('reclaims only orphaned assets past the grace window; keeps referenced + shared + fresh', () => {
    // Two characters share SHARED; only char-a references REFERENCED.
    const database = {
      characters: [
        { chaId: 'char-a', image: REFERENCED, emotionImages: [['happy', SHARED]] },
        { chaId: 'char-b', image: SHARED },
      ],
    }
    writeFileSync(
      path.join(dataDir, 'db.json'),
      JSON.stringify({
        _version: 1,
        database,
        assets: [
          asset(REFERENCED),
          asset(SHARED),
          asset(ORPHAN_OLD),
          asset(ORPHAN_FRESH),
        ],
      }),
    )
    const refFile = writeAssetFile(REFERENCED, OLD_MTIME)
    const sharedFile = writeAssetFile(SHARED, OLD_MTIME)
    const orphanOldFile = writeAssetFile(ORPHAN_OLD, OLD_MTIME)
    const orphanFreshFile = writeAssetFile(ORPHAN_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { graceMs: GRACE_MS, now: () => NOW })

    // Only the old orphan is reclaimed.
    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
    expect(result.skippedByGrace).toBe(1)
    expect(existsSync(orphanOldFile)).toBe(false)

    // Referenced, shared (refcount > 0 even though char-b alone references it),
    // and the freshly-uploaded orphan all survive.
    expect(existsSync(refFile)).toBe(true)
    expect(existsSync(sharedFile)).toBe(true)
    expect(existsSync(orphanFreshFile)).toBe(true)

    // Metadata array drops only the reclaimed entry.
    const persisted = loadPersisted(dataDir)
    expect(persisted.assets.map((a) => a.id).sort()).toEqual(
      [REFERENCED, SHARED, ORPHAN_FRESH].sort(),
    )
    // database blob is untouched (no revision-visible change).
    expect(persisted.database).toEqual(database)
  })

  it('never deletes a just-uploaded (within-grace) asset even if not yet referenced', () => {
    writeFileSync(
      path.join(dataDir, 'db.json'),
      JSON.stringify({ _version: 1, database: { characters: [] }, assets: [asset(ORPHAN_FRESH)] }),
    )
    const freshFile = writeAssetFile(ORPHAN_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([])
    expect(result.skippedByGrace).toBe(1)
    expect(existsSync(freshFile)).toBe(true)
    expect(loadPersisted(dataDir).assets.map((a) => a.id)).toEqual([ORPHAN_FRESH])
  })

  it('drops a metadata entry whose backing file is already gone', () => {
    writeFileSync(
      path.join(dataDir, 'db.json'),
      JSON.stringify({ _version: 1, database: { characters: [] }, assets: [asset(ORPHAN_OLD)] }),
    )
    // No file on disk for ORPHAN_OLD.

    const result = runAssetGc(dataDir, { graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
    expect(loadPersisted(dataDir).assets).toEqual([])
  })

  it('sweeps stray, unreferenced, grace-aged files with no metadata entry', () => {
    writeFileSync(
      path.join(dataDir, 'db.json'),
      JSON.stringify({ _version: 1, database: { characters: [] }, assets: [] }),
    )
    const strayOld = writeAssetFile(STRAY_OLD, OLD_MTIME)
    const strayFresh = writeAssetFile(STRAY_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedStrayFiles).toEqual([`${STRAY_OLD}.png`])
    expect(existsSync(strayOld)).toBe(false)
    expect(existsSync(strayFresh)).toBe(true)
  })

  it('does not rewrite db.json when nothing is reclaimed', () => {
    const database = { characters: [{ chaId: 'char-a', image: REFERENCED }] }
    writeFileSync(
      path.join(dataDir, 'db.json'),
      JSON.stringify({ _version: 1, database, assets: [asset(REFERENCED)] }),
    )
    writeAssetFile(REFERENCED, OLD_MTIME)

    const result = runAssetGc(dataDir, { graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([])
    expect(result.deletedStrayFiles).toEqual([])
    expect(loadPersisted(dataDir).assets).toEqual([asset(REFERENCED)])
  })
})
