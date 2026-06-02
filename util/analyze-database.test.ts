import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../server/fastify/src/db.js'
import { writePersistedWithMessages, type Persisted } from '../server/fastify/src/repository.js'
import { analyzeDataDir } from './analyze-database.js'

const ASSET_IMAGE = 'a'.repeat(64)
const ASSET_HAPPY = 'b'.repeat(64)
const ASSET_INLAY = 'c'.repeat(64)
const ASSET_ORPHAN = 'd'.repeat(64)

function fixturePersisted(): Persisted {
  return {
    _version: 1,
    database: {
      version: 1,
      formatingOrder: ['main', 'description', 'chats'],
      characters: [
        {
          type: 'character',
          chaId: 'char-ada',
          name: 'Ada',
          image: ASSET_IMAGE,
          emotionImages: [['happy', ASSET_HAPPY]],
          chats: [
            {
              id: 'chat-1',
              name: 'Chat 1',
              note: '',
              localLore: [],
              message: [
                { role: 'user', data: 'hello', chatId: 'm1' },
                { role: 'char', data: `see {{inlay::${ASSET_INLAY}}}`, chatId: 'm2' },
              ],
            },
          ],
        },
        {
          type: 'character',
          chaId: 'char-bob',
          name: 'Bob',
          chats: [{ id: 'chat-2', name: 'Chat 2', note: '', localLore: [], message: [] }],
        },
      ],
      characterOrder: ['char-ada', 'char-bob'],
      botPresets: [{ id: 'p1', name: 'Preset' }],
      modules: [],
      loadouts: [],
      plugins: [],
      pluginCustomStorage: {},
    },
    assets: [
      { id: ASSET_IMAGE, ext: 'png', size: 200_000, contentType: 'image/png' },
      { id: ASSET_HAPPY, ext: 'png', size: 100_000, contentType: 'image/png' },
      { id: ASSET_INLAY, ext: 'png', size: 300_000, contentType: 'image/png' },
      { id: ASSET_ORPHAN, ext: 'mp3', size: 1_000_000, contentType: 'audio/mpeg' },
    ],
  }
}

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-analyze-test-'))
  const db = openDatabase(dataDir)
  try {
    writePersistedWithMessages(db, dataDir, fixturePersisted())
  } finally {
    db.close()
  }
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('analyzeDataDir', () => {
  it('reports the corpus shape with messages rehydrated from SQLite', () => {
    const analysis = analyzeDataDir(dataDir, 'test')
    expect(analysis.corpus).toEqual({
      characters: 2,
      chats: 2,
      messages: 2,
      storedAssets: 4,
    })
  })

  it('measures export materialization for every envelope', () => {
    const analysis = analyzeDataDir(dataDir, 'test')
    const labels = analysis.export.envelopes.map((row) => row.envelope)
    expect(labels).toEqual([
      'risusave-blocks',
      'risusave-blocks+gzip',
      'legacy-raw',
      'legacy-compressed',
    ])
    for (const row of analysis.export.envelopes) {
      expect(row.outputBytes).toBeGreaterThan(0)
      expect(row.encodeMs).toBeGreaterThanOrEqual(0)
    }
    expect(analysis.export.snapshotLoadMs).toBeGreaterThanOrEqual(0)
    // gzip shrinks the block envelope.
    const blocks = analysis.export.envelopes.find((r) => r.envelope === 'risusave-blocks')!
    const gzip = analysis.export.envelopes.find((r) => r.envelope === 'risusave-blocks+gzip')!
    expect(gzip.outputBytes).toBeLessThan(blocks.outputBytes)
    // Peak is the largest materialized buffer.
    expect(analysis.export.peakOutputBytes).toBe(
      Math.max(...analysis.export.envelopes.map((r) => r.outputBytes)),
    )
  })

  it('measures the full-bootstrap projection payload', () => {
    const analysis = analyzeDataDir(dataDir, 'test')
    expect(analysis.bootstrap.payloadBytes).toBeGreaterThan(0)
    expect(analysis.bootstrap.stubLoadMs).toBeGreaterThanOrEqual(0)
    // Message-light: far smaller than the full block export of the same corpus.
    expect(analysis.bootstrap.payloadBytes).toBeLessThan(analysis.export.peakOutputBytes)
  })

  it('reports asset inventory, references, and per-character fanout', () => {
    const analysis = analyzeDataDir(dataDir, 'test')
    expect(analysis.assets.storedCount).toBe(4)
    expect(analysis.assets.storedBytes).toBe(1_600_000)
    // image, happy, inlay are referenced; orphan is not.
    expect(analysis.assets.referencedCount).toBe(3)
    expect(analysis.assets.missingCount).toBe(0)
    expect(analysis.assets.orphanedCount).toBe(1)
    // Ada references 3 distinct assets (image + happy + inlay); Bob none.
    const top = analysis.assets.worstCharacterFanout[0]
    expect(top.name).toBe('Ada')
    expect(top.distinctAssets).toBe(3)
    // Largest stored asset surfaces first.
    expect(analysis.assets.largest[0]).toEqual({
      id: ASSET_ORPHAN,
      contentType: 'audio/mpeg',
      bytes: 1_000_000,
    })
  })
})
