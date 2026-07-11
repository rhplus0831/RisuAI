import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { backfillLegacyHypaV3MemoryRows, LEGACY_HYPA_V3_SUMMARY_MODEL } from '../src/memoryLegacyImport.js'
import {
  createMemoryJob,
  listMemoryChunks,
  listMemoryEmbeddings,
  listMemoryJobs,
  listMemorySummaries,
} from '../src/memoryRepository.js'
import { writePersistedWithMessages } from '../src/repository.js'
import { selectMemorySummaries } from '../src/memorySelectionService.js'
import { setupAuthedClient } from './helpers/auth.js'

process.env.LOG_LEVEL = 'silent'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-legacy-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function legacyDatabase() {
  return {
    characters: [
      {
        chaId: 'char-1',
        chats: [
          {
            id: 'chat-1',
            message: [
              { role: 'user', data: 'hello', chatId: 'm-1' },
              { role: 'char', data: 'hi', chatId: 'm-2' },
              { role: 'user', data: 'remember the garden', chatId: 'm-3' },
            ],
            hypaV3Data: {
              summaries: [
                {
                  text: 'They greeted each other.',
                  chatMemos: ['m-1', 'm-2'],
                  isImportant: true,
                  categoryId: 'cat-lore',
                  tags: ['greeting', 'first-meet'],
                },
                {
                  text: 'The garden matters.',
                  chatMemos: ['m-3'],
                  isImportant: false,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function legacySummaryIndex(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return -1
  const value = (metadata as { summaryIndex?: unknown }).summaryIndex
  return typeof value === 'number' ? value : -1
}

describe('legacy Hypa V3 memory import', () => {
  it('backfills legacy summaries into summarized chunk and summary rows idempotently', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(backfillLegacyHypaV3MemoryRows(db, legacyDatabase())).toEqual({
        chunksCreated: 2,
        summariesCreated: 2,
      })
      expect(backfillLegacyHypaV3MemoryRows(db, legacyDatabase())).toEqual({
        chunksCreated: 0,
        summariesCreated: 0,
      })

      const chunks = listMemoryChunks(db, { chatId: 'chat-1' })
      expect(chunks).toHaveLength(2)
      expect(chunks[0]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'm-2',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'user: hello\nchar: hi',
        status: 'summarized',
      })

      const summaries = listMemorySummaries(db, {
        chatId: 'chat-1',
        model: LEGACY_HYPA_V3_SUMMARY_MODEL,
      })
      expect(summaries).toHaveLength(2)
      const summariesByIndex = [...summaries].sort((left, right) => {
        return legacySummaryIndex(left.metadata) - legacySummaryIndex(right.metadata)
      })
      expect(summariesByIndex[0]).toMatchObject({
        chatId: 'chat-1',
        chunkId: chunks[0].id,
        model: LEGACY_HYPA_V3_SUMMARY_MODEL,
        text: 'They greeted each other.',
        tokens: 0,
        metadata: {
          source: 'legacy-hypav3',
          summaryIndex: 0,
          chatMemos: ['m-1', 'm-2'],
          isImportant: true,
          categoryId: 'cat-lore',
          tags: ['greeting', 'first-meet'],
        },
      })
      expect(listMemoryEmbeddings(db)).toEqual([])
      expect(listMemoryJobs(db)).toEqual([])

      const selected = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'configured-summary-model',
        embeddingModel: 'configured-embedding-model',
        queryVectors: [],
        availableTokens: 100,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
      })
      expect(selected.selectedSummaries.map((summary) => summary.text).sort()).toEqual([
        'The garden matters.',
        'They greeted each other.',
      ])
      expect(selected.importantSummaries.map((summary) => summary.text)).toEqual(['They greeted each other.'])
    } finally {
      db.close()
    }
  })

  it('replaces memory rows during JSON import without creating embeddings or jobs', async () => {
    const dataDir = makeDataDir()
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 1024 * 1024,
        importMaxBytes: Infinity,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
    })
    try {
      const { assertion } = await setupAuthedClient(app)
      const imported = await app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: { 'risu-auth': assertion },
        payload: { database: legacyDatabase() },
      })
      expect(imported.statusCode).toBe(200)

      let db = openDatabase(dataDir)
      try {
        createMemoryJob(db, {
          id: 'old-job',
          chatId: 'chat-1',
          kind: 'summarize',
          payload: {},
        })
        expect(listMemorySummaries(db, { chatId: 'chat-1' })).toHaveLength(2)
        // The backfill must read messages that no longer live in db.json. The
        // import route splits messages in place, so the backfill must run against
        // the still-hydrated payload.
        const chunks = listMemoryChunks(db, { chatId: 'chat-1' })
        expect(chunks).toHaveLength(2)
        expect(chunks[0]).toMatchObject({
          chatId: 'chat-1',
          messageId: 'm-2',
          rangeStartSeq: 0,
          rangeEndSeq: 1,
          text: 'user: hello\nchar: hi',
          status: 'summarized',
        })
      } finally {
        db.close()
      }

      const replaced = await app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: { 'risu-auth': assertion },
        payload: { database: { characters: [] } },
      })
      expect(replaced.statusCode).toBe(200)

      db = openDatabase(dataDir)
      try {
        expect(listMemoryChunks(db)).toEqual([])
        expect(listMemorySummaries(db)).toEqual([])
        expect(listMemoryEmbeddings(db)).toEqual([])
        expect(listMemoryJobs(db)).toEqual([])
        expect(db.prepare('SELECT COUNT(*) AS count FROM memory_legacy_summary_tombstones').get()).toEqual({
          count: 0,
        })
      } finally {
        db.close()
      }
    } finally {
      await app.close()
    }
  })

  it('boot backfills legacy rows from an existing database', async () => {
    const dataDir = makeDataDir()
    const seedDb = openDatabase(dataDir)
    try {
      writePersistedWithMessages(seedDb, dataDir, {
        _version: 1,
        database: legacyDatabase(),
        assets: [],
      })
    } finally {
      seedDb.close()
    }
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 1024 * 1024,
        importMaxBytes: Infinity,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
    })
    try {
      const db = openDatabase(dataDir)
      try {
        expect(listMemoryChunks(db, { chatId: 'chat-1' })).toHaveLength(2)
        expect(listMemorySummaries(db, { chatId: 'chat-1' })).toHaveLength(2)
        expect(listMemoryEmbeddings(db)).toEqual([])
        expect(listMemoryJobs(db)).toEqual([])
      } finally {
        db.close()
      }
    } finally {
      await app.close()
    }
  })

  it('does not resurrect an explicitly deleted imported summary after restart', async () => {
    const dataDir = makeDataDir()
    const config = {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    }
    const first = await buildApp({ config, memoryWorker: false, assetGc: false })
    let deletedSummaryId = ''
    try {
      const { assertion } = await setupAuthedClient(first.app)
      const imported = await first.app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: { 'risu-auth': assertion },
        payload: { database: legacyDatabase() },
      })
      expect(imported.statusCode).toBe(200)

      const db = openDatabase(dataDir)
      try {
        deletedSummaryId =
          listMemorySummaries(db, { chatId: 'chat-1' }).find((summary) => summary.text === 'They greeted each other.')
            ?.id ?? ''
      } finally {
        db.close()
      }
      expect(deletedSummaryId).not.toBe('')

      const deleted = await first.app.inject({
        method: 'DELETE',
        url: `/api/v1/memory/summaries/${encodeURIComponent(deletedSummaryId)}`,
        headers: { 'risu-auth': assertion },
      })
      expect(deleted.statusCode).toBe(200)
    } finally {
      await first.app.close()
    }

    const restarted = await buildApp({ config, memoryWorker: false, assetGc: false })
    try {
      const db = openDatabase(dataDir)
      try {
        expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((summary) => summary.text)).toEqual([
          'The garden matters.',
        ])
        expect(
          db
            .prepare('SELECT summary_id FROM memory_legacy_summary_tombstones WHERE summary_id = ?')
            .get(deletedSummaryId),
        ).toEqual({ summary_id: deletedSummaryId })
      } finally {
        db.close()
      }
    } finally {
      await restarted.app.close()
    }
  })
})
