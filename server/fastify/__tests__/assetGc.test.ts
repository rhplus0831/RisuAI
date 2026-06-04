import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAssetGc } from '../src/assetGc.js'
import {
  assetsDir,
  getAllAssetMetadata,
  insertAssetMetadataBatch,
  loadPersistedWithMessages,
  writePersistedWithMessages,
  type PersistedAsset,
} from '../src/repository.js'
import { openDatabase } from '../src/db.js'
import { replaceAllChatMessages } from '../src/messageStore.js'
import {
  buildRepositoryRisuSaveAssetReport,
  buildRisuSaveAssetReport,
} from '../src/risuSave/assetReferences.js'
import { CORPUS_TABLES, assertScopedLoadOnHotPath } from './helpers/loadCostHarness.js'

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
let db: DatabaseSync

function writeAssetFile(id: string, mtimeMs: number): string {
  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.png`)
  writeFileSync(file, Buffer.from([1, 2, 3]))
  const secs = mtimeMs / 1000
  utimesSync(file, secs, secs)
  return file
}

function seedDatabase(database: unknown, assets: PersistedAsset[]): void {
  writePersistedWithMessages(db, dataDir, { _version: 1, database, assets: [] })
  insertAssetMetadataBatch(db, assets)
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-asset-gc-'))
  db = openDatabase(dataDir)
})

afterEach(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('runAssetGc', () => {
  it('reclaims only orphaned assets past the grace window; keeps referenced + shared + fresh', () => {
    const database = {
      characters: [
        { chaId: 'char-a', image: REFERENCED, emotionImages: [['happy', SHARED]] },
        { chaId: 'char-b', image: SHARED },
      ],
    }
    seedDatabase(database, [asset(REFERENCED), asset(SHARED), asset(ORPHAN_OLD), asset(ORPHAN_FRESH)])
    const refFile = writeAssetFile(REFERENCED, OLD_MTIME)
    const sharedFile = writeAssetFile(SHARED, OLD_MTIME)
    const orphanOldFile = writeAssetFile(ORPHAN_OLD, OLD_MTIME)
    const orphanFreshFile = writeAssetFile(ORPHAN_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
    expect(result.skippedByGrace).toBe(1)
    expect(existsSync(orphanOldFile)).toBe(false)

    expect(existsSync(refFile)).toBe(true)
    expect(existsSync(sharedFile)).toBe(true)
    expect(existsSync(orphanFreshFile)).toBe(true)

    expect(
      getAllAssetMetadata(db)
        .map((a) => a.id)
        .sort(),
    ).toEqual([REFERENCED, SHARED, ORPHAN_FRESH].sort())
  })

  it('never deletes a just-uploaded (within-grace) asset even if not yet referenced', () => {
    seedDatabase({ characters: [] }, [asset(ORPHAN_FRESH)])
    const freshFile = writeAssetFile(ORPHAN_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([])
    expect(result.skippedByGrace).toBe(1)
    expect(existsSync(freshFile)).toBe(true)
    expect(getAllAssetMetadata(db).map((a) => a.id)).toEqual([ORPHAN_FRESH])
  })

  it('drops a metadata entry whose backing file is already gone', () => {
    seedDatabase({ characters: [] }, [asset(ORPHAN_OLD)])

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
    expect(getAllAssetMetadata(db)).toEqual([])
  })

  it('sweeps stray, unreferenced, grace-aged files with no metadata entry', () => {
    seedDatabase({ characters: [] }, [])
    const strayOld = writeAssetFile(STRAY_OLD, OLD_MTIME)
    const strayFresh = writeAssetFile(STRAY_FRESH, FRESH_MTIME)

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedStrayFiles).toEqual([`${STRAY_OLD}.png`])
    expect(existsSync(strayOld)).toBe(false)
    expect(existsSync(strayFresh)).toBe(true)
  })

  it('is a no-op when nothing is reclaimed', () => {
    const database = { characters: [{ chaId: 'char-a', image: REFERENCED }] }
    seedDatabase(database, [asset(REFERENCED)])
    writeAssetFile(REFERENCED, OLD_MTIME)

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([])
    expect(result.deletedStrayFiles).toEqual([])
    expect(getAllAssetMetadata(db)).toEqual([asset(REFERENCED)])
  })

  it('never hydrates the message corpus during a sweep (M10)', async () => {
    const database = {
      characters: [{ chaId: 'char-a', image: REFERENCED, chats: [{ id: 'chat-a' }] }],
    }
    seedDatabase(database, [asset(REFERENCED), asset(ORPHAN_OLD)])
    writeAssetFile(REFERENCED, OLD_MTIME)
    writeAssetFile(ORPHAN_OLD, OLD_MTIME)
    replaceAllChatMessages(db, [
      {
        chatId: 'chat-a',
        messages: [{ chatId: 'message-a', role: 'user', data: `{{inlay::${SHARED}}}` }],
      },
    ])

    // The sweep may keep its message-free broad walk (that is its union source),
    // but the message/hypa corpus must never hydrate — the inlay references come
    // from the column-only `messages.data` scan.
    const allowEverythingButMessages = Object.keys(CORPUS_TABLES).filter(
      (table) => table !== 'messages' && table !== 'chat_hypa_v3',
    )
    const result = await assertScopedLoadOnHotPath(
      () => runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW }),
      { allowTables: allowEverythingButMessages },
    )
    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
  })

  it('reports identical referenced/missing/orphaned sets to the hydrated walker (M10)', () => {
    const MISSING = '9'.repeat(64)
    const database = {
      userIcon: REFERENCED,
      characters: [
        {
          chaId: 'char-a',
          image: SHARED,
          chats: [
            { id: 'chat-a' },
            { id: 'chat-b', message: [{ chatId: 'embedded-1', role: 'user', data: 'plain' }] },
          ],
        },
        { chaId: 'char-b', chats: [{ id: 'chat-c' }] },
      ],
    }
    seedDatabase(database, [asset(REFERENCED), asset(SHARED), asset(ORPHAN_OLD)])
    replaceAllChatMessages(db, [
      {
        chatId: 'chat-a',
        messages: [
          { chatId: 'message-a', role: 'user', data: `one {{inlay::${SHARED}}}` },
          { chatId: 'message-b', role: 'char', data: `two {{inlayed::${MISSING}}}` },
        ],
      },
      {
        chatId: 'chat-c',
        messages: [{ chatId: 'message-c', role: 'user', data: `{{inlayeddata::${REFERENCED}}}` }],
      },
    ])

    const scoped = buildRepositoryRisuSaveAssetReport(dataDir, db)
    const hydrated = buildRisuSaveAssetReport(
      loadPersistedWithMessages(db, dataDir).database,
      getAllAssetMetadata(db),
    )
    // Byte-identical report: same ids, same path labels, same counts.
    expect(scoped).toEqual(hydrated)
    expect(scoped.referenced.map((reference) => reference.id)).toContain(SHARED)
    expect(scoped.missing.map((reference) => reference.id)).toEqual([MISSING])
    expect(scoped.orphaned.map((entry) => entry.id)).toEqual([ORPHAN_OLD])
  })

  it('keeps assets referenced only by SQLite chat-message inlay tokens', () => {
    const database = { characters: [{ chaId: 'char-a', chats: [{ id: 'chat-a' }] }] }
    seedDatabase(database, [asset(REFERENCED), asset(ORPHAN_OLD)])
    const referencedFile = writeAssetFile(REFERENCED, OLD_MTIME)
    const orphanFile = writeAssetFile(ORPHAN_OLD, OLD_MTIME)
    replaceAllChatMessages(db, [
      {
        chatId: 'chat-a',
        messages: [
          {
            chatId: 'message-a',
            role: 'user',
            data: `look {{inlayeddata::${REFERENCED}}}`,
          },
        ],
      },
    ])

    const result = runAssetGc(dataDir, { db, graceMs: GRACE_MS, now: () => NOW })

    expect(result.deletedAssetIds).toEqual([ORPHAN_OLD])
    expect(existsSync(referencedFile)).toBe(true)
    expect(existsSync(orphanFile)).toBe(false)
  })
})
