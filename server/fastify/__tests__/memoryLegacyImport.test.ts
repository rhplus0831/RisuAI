import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import {
  backfillLegacyHypaV3MemoryRows,
  LEGACY_HYPA_V3_SUMMARY_MODEL,
} from '../src/memoryLegacyImport.js'
import {
  createMemoryJob,
  listMemoryChunks,
  listMemoryEmbeddings,
  listMemoryJobs,
  listMemorySummaries,
} from '../src/memoryRepository.js'
import { writePersisted } from '../src/repository.js'

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
      expect(summaries[0]).toMatchObject({
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
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
    })
    try {
      const imported = await app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
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
        // The backfill must read the chat's messages — which Phase 4 moves out
        // of db.json. The import route splits messages in place, so the backfill
        // must run against the still-hydrated payload (regression guard: a
        // stripped payload would yield bare summary text + a fallback seq range).
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
        payload: { database: { characters: [] } },
      })
      expect(replaced.statusCode).toBe(200)

      db = openDatabase(dataDir)
      try {
        expect(listMemoryChunks(db)).toEqual([])
        expect(listMemorySummaries(db)).toEqual([])
        expect(listMemoryEmbeddings(db)).toEqual([])
        expect(listMemoryJobs(db)).toEqual([])
      } finally {
        db.close()
      }
    } finally {
      await app.close()
    }
  })

  it('boot backfills legacy rows from an existing db.json', async () => {
    const dataDir = makeDataDir()
    writePersisted(dataDir, { _version: 1, database: legacyDatabase(), assets: [] })
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 1024 * 1024,
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
})
