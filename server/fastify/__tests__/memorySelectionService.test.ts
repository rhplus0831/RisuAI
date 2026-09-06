import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemoryEmbedding,
  createMemorySummary,
  loadMemorySummarySnapshot,
} from '../src/memoryRepository.js'
import { selectMemorySummaries } from '../src/memorySelectionService.js'
import { LEGACY_HYPA_V3_SUMMARY_MODEL } from '../src/memorySummaryCompatibility.js'
import { ValidationError } from '../src/repository.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-selection-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('memory selection service', () => {
  it('selects imported legacy summaries for any active model and keeps their metadata over duplicate replacements', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'legacy-chunk',
        summaryId: 'legacy-summary',
        summaryModel: LEGACY_HYPA_V3_SUMMARY_MODEL,
        embeddingId: 'legacy-embedding',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
        metadata: {
          source: 'legacy-hypav3',
          chatMemos: ['memo-a', 'memo-b'],
          isImportant: true,
          categoryId: 'story',
          tags: ['imported'],
        },
      })

      const input = {
        db,
        chatId: 'chat-1',
        summaryModel: 'current-summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      }
      const selected = selectMemorySummaries(input)
      expect(selected.selectedSummaries.map((summary) => summary.id)).toEqual(['legacy-summary'])
      expect(selected.importantSummaries.map((summary) => summary.id)).toEqual(['legacy-summary'])
      expect(selected.selectedSummaries[0].metadata).toMatchObject({
        chatMemos: ['memo-a', 'memo-b'],
        isImportant: true,
        categoryId: 'story',
        tags: ['imported'],
      })

      const fromSnapshot = selectMemorySummaries({
        ...input,
        summarySnapshot: loadMemorySummarySnapshot(db, { chatId: 'chat-1' }),
      })
      expect(fromSnapshot.selectedSummaries.map((summary) => summary.id)).toEqual(['legacy-summary'])

      createMemorySummary(db, {
        id: 'active-summary',
        chatId: 'chat-1',
        chunkId: 'legacy-chunk',
        model: 'current-summary-model',
        text: 'replacement summary',
        tokens: 5,
      })
      const replacement = selectMemorySummaries({
        ...input,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
      })
      expect(replacement.selectedSummaries.map((summary) => summary.id)).toEqual(['legacy-summary'])
      expect(replacement.selectedSummaries[0].metadata).toMatchObject({
        isImportant: true,
        categoryId: 'story',
        tags: ['imported'],
      })
    } finally {
      db.close()
    }
  })

  it('reads repository rows by chat and model, ranks them, and allocates the selected summaries', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-a',
        summaryId: 'summary-a',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-a',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
      })
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-b',
        summaryId: 'summary-b',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-b',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 2,
        vector: [0, 1],
        tokens: 5,
      })
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-other-model',
        summaryId: 'summary-other-model',
        summaryModel: 'other-summary-model',
        embeddingId: 'embedding-other-model',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 4,
        vector: [1, 0],
        tokens: 5,
      })
      seedMemory(db, {
        chatId: 'chat-2',
        chunkId: 'chunk-other-chat',
        summaryId: 'summary-other-chat',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-other-chat',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
      })

      const result = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 10,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      })

      expect(result.rankedSimilarSummaries.map((row) => row.summary.id)).toEqual(['summary-a', 'summary-b'])
      expect(result.similarSummaries.map((row) => row.id)).toEqual(['summary-a', 'summary-b'])
      expect(result.selectedSummaries.map((row) => row.id)).toEqual(['summary-a', 'summary-b'])
      expect(result.diagnostics.repository).toMatchObject({
        summaries: 2,
        chunks: 3,
        embeddings: 3,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: ['chunk-other-model'],
      })
      expect(result.diagnostics.ranking.missingSummaries).toEqual(['chunk-other-model'])
    } finally {
      db.close()
    }
  })

  it('reports empty inputs without provider, queue, or write work', () => {
    const db = openDatabase(makeDataDir())
    try {
      const result = selectMemorySummaries({
        db,
        chatId: 'chat-empty',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 },
      })

      expect(result.selectedSummaries).toEqual([])
      expect(result.rankedSimilarSummaries).toEqual([])
      expect(result.diagnostics.repository).toEqual({
        summaries: 0,
        chunks: 0,
        embeddings: 0,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: [],
      })
      expect(result.diagnostics.ranking).toMatchObject({
        queryVectors: 0,
        validQueryVectors: 0,
        embeddings: 0,
        scoredEmbeddings: 0,
      })
      expect(result.diagnostics.allocation.inputSummaries).toBe(0)
    } finally {
      db.close()
    }
  })

  it('empty-query selection keeps embedding diagnostics without reading malformed vectors', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-a',
        summaryId: 'summary-a',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-a',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
      })
      db.prepare('UPDATE memory_embeddings SET vector_blob = ?, dim = ? WHERE id = ?').run(
        Buffer.from([1, 2, 3]),
        2,
        'embedding-a',
      )

      const result = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [],
        availableTokens: 100,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
      })

      expect(result.selectedSummaries.map((summary) => summary.id)).toEqual(['summary-a'])
      expect(result.rankedSimilarSummaries).toEqual([])
      expect(result.diagnostics.repository).toMatchObject({
        summaries: 1,
        chunks: 1,
        embeddings: 1,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: [],
      })
      expect(result.diagnostics.ranking).toMatchObject({
        queryVectors: 0,
        validQueryVectors: 0,
        skippedQueryVectors: 0,
        embeddings: 1,
        scoredEmbeddings: 0,
        skippedEmbeddings: [],
        missingChunks: [],
        missingSummaries: [],
      })
    } finally {
      db.close()
    }
  })

  it('valid-query selection still fails when a malformed vector must be decoded', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-a',
        summaryId: 'summary-a',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-a',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
      })
      db.prepare('UPDATE memory_embeddings SET vector_blob = ?, dim = ? WHERE id = ?').run(
        Buffer.from([1, 2, 3]),
        2,
        'embedding-a',
      )

      expect(() =>
        selectMemorySummaries({
          db,
          chatId: 'chat-1',
          summaryModel: 'summary-model',
          embeddingModel: 'embedding-model',
          queryVectors: [[1, 0]],
          availableTokens: 100,
          settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })

  it('selects from a shared summary snapshot without rereading summaries', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-a',
        summaryId: 'summary-a',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-a',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 5,
      })
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-b',
        summaryId: 'summary-b',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-b',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 2,
        vector: [0, 1],
        tokens: 5,
      })
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-other-model',
        summaryId: 'summary-other-model',
        summaryModel: 'other-summary-model',
        embeddingId: 'embedding-other-model',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 4,
        vector: [1, 0],
        tokens: 5,
      })

      const summarySnapshot = loadMemorySummarySnapshot(db, { chatId: 'chat-1' })
      const preparedSql: string[] = []
      const originalPrepare = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        preparedSql.push(sql)
        return originalPrepare(sql)
      }) as typeof db.prepare

      const result = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 10,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
        summarySnapshot,
      })

      expect(result.selectedSummaries.map((summary) => summary.id)).toEqual(['summary-a', 'summary-b'])
      expect(result.diagnostics.repository).toMatchObject({
        summaries: 2,
        chunks: 3,
        embeddings: 3,
        chunkIdsMissingSummaries: ['chunk-other-model'],
      })
      expect(preparedSql.some((sql) => sql.includes('memory_summaries'))).toBe(false)
    } finally {
      db.close()
    }
  })

  it('surfaces missing embedding and missing summary diagnostics from repository rows', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-with-summary',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk with summary',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-without-embedding',
        chatId: 'chat-1',
        chunkId: 'chunk-with-summary',
        model: 'summary-model',
        text: 'summary without embedding',
        tokens: 5,
      })
      createMemoryChunk(db, {
        id: 'chunk-with-embedding',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk with embedding',
        status: 'summarized',
      })
      createMemoryEmbedding(db, {
        id: 'embedding-without-summary',
        chatId: 'chat-1',
        chunkId: 'chunk-with-embedding',
        model: 'embedding-model',
        vector: [1, 0],
      })
      createMemoryChunk(db, {
        id: 'chunk-without-summary-or-embedding',
        chatId: 'chat-1',
        rangeStartSeq: 4,
        rangeEndSeq: 5,
        text: 'chunk without summary or embedding',
        status: 'pending',
      })

      const result = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      })

      expect(result.selectedSummaries).toEqual([])
      expect(result.rankedSimilarSummaries).toEqual([])
      expect(result.diagnostics.repository).toMatchObject({
        summaryIdsMissingEmbeddings: ['summary-without-embedding'],
        chunkIdsMissingEmbeddings: ['chunk-with-summary'],
        chunkIdsMissingSummaries: ['chunk-with-embedding', 'chunk-without-summary-or-embedding'],
      })
      expect(result.diagnostics.ranking.missingSummaries).toEqual(['chunk-with-embedding'])
      expect(result.diagnostics.allocation.missingCategories).toContainEqual({
        category: 'similar',
        reason: 'no-candidates',
      })
    } finally {
      db.close()
    }
  })

  it('passes budget pressure through allocator diagnostics', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chatId: 'chat-1',
        chunkId: 'chunk-important',
        summaryId: 'summary-important',
        summaryModel: 'summary-model',
        embeddingId: 'embedding-important',
        embeddingModel: 'embedding-model',
        rangeStartSeq: 0,
        vector: [1, 0],
        tokens: 50,
        metadata: { isImportant: true },
      })

      const result = selectMemorySummaries({
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 10,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      })

      expect(result.selectedSummaries).toEqual([])
      expect(result.diagnostics.allocation.categories.important.skippedForBudget).toEqual([
        { summaryId: 'summary-important', tokens: 50 },
      ])
      expect(result.diagnostics.allocation.missingCategories).toContainEqual({
        category: 'important',
        reason: 'budget-exhausted',
      })
    } finally {
      db.close()
    }
  })

  it('uses deterministic default random seeding for allocation wiring', () => {
    const db = openDatabase(makeDataDir())
    try {
      for (let index = 1; index <= 4; index++) {
        seedMemory(db, {
          chatId: 'chat-1',
          chunkId: `chunk-${index}`,
          summaryId: `summary-${index}`,
          summaryModel: 'summary-model',
          embeddingId: `embedding-${index}`,
          embeddingModel: 'embedding-model',
          rangeStartSeq: index,
          vector: [index, 1],
          tokens: 5,
        })
      }

      const input = {
        db,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 10,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 0 },
      }

      const first = selectMemorySummaries(input)
      const second = selectMemorySummaries(input)
      const explicit = selectMemorySummaries({ ...input, randomSeed: 'explicit-seed' })

      expect(second.randomSummaries.map((row) => row.id)).toEqual(first.randomSummaries.map((row) => row.id))
      expect(first.randomSummaries).toHaveLength(2)
      expect(explicit.randomSummaries.map((row) => row.id)).not.toEqual(first.randomSummaries.map((row) => row.id))
    } finally {
      db.close()
    }
  })
})

function seedMemory(
  db: ReturnType<typeof openDatabase>,
  input: {
    chatId: string
    chunkId: string
    summaryId: string
    summaryModel: string
    embeddingId: string
    embeddingModel: string
    rangeStartSeq: number
    vector: readonly number[]
    tokens: number
    metadata?: unknown
  },
): void {
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: input.chatId,
    rangeStartSeq: input.rangeStartSeq,
    rangeEndSeq: input.rangeStartSeq + 1,
    text: input.chunkId,
    status: 'summarized',
  })
  createMemorySummary(db, {
    id: input.summaryId,
    chatId: input.chatId,
    chunkId: input.chunkId,
    model: input.summaryModel,
    text: input.summaryId,
    metadata: input.metadata ?? null,
    tokens: input.tokens,
  })
  createMemoryEmbedding(db, {
    id: input.embeddingId,
    chatId: input.chatId,
    chunkId: input.chunkId,
    model: input.embeddingModel,
    vector: [...input.vector],
  })
}
