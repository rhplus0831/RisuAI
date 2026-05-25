import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemoryEmbedding,
  createMemorySummary,
  type MemorySummary,
} from '../src/memoryRepository.js'
import {
  assemblePromptMemoryRows,
  selectPromptMemory,
  type PromptMemorySelector,
} from '../src/prompt/memoryAdapter.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-prompt-memory-adapter-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('prompt memory adapter', () => {
  it('returns disabled memory without invoking selection work', () => {
    const db = openDatabase(makeDataDir())
    const selectMemory = vi.fn<PromptMemorySelector>()
    try {
      const result = selectPromptMemory({
        db,
        enabled: false,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 },
        selectMemory,
      })

      expect(selectMemory).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        enabled: false,
        disabledReason: 'feature-disabled',
        selectedSummaries: [],
        rankedSimilarSummaries: [],
        diagnostics: {
          enabled: false,
          disabledReason: 'feature-disabled',
          selectionAttempted: false,
          selection: null,
          hotPathWork: {
            generatedQueryEmbeddings: false,
            calledProviders: false,
            generatedSummaries: false,
            enqueuedJobs: false,
            assembledPromptRows: false,
          },
        },
      })
    } finally {
      db.close()
    }
  })

  it('reports empty ready memory with selection diagnostics and no hot-path work', () => {
    const db = openDatabase(makeDataDir())
    try {
      const result = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-empty',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 },
      })

      expect(result.enabled).toBe(true)
      expect(result.disabledReason).toBeNull()
      expect(result.selectedSummaries).toEqual([])
      expect(result.diagnostics.selectionAttempted).toBe(true)
      expect(result.diagnostics.selection?.repository).toEqual({
        summaries: 0,
        chunks: 0,
        embeddings: 0,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: [],
      })
      expect(result.diagnostics.missingMemory).toEqual({
        emptySelection: true,
        hasMissingMemory: false,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: [],
        followUpEligible: false,
      })
      expect(result.diagnostics.hotPathWork).toEqual({
        generatedQueryEmbeddings: false,
        calledProviders: false,
        generatedSummaries: false,
        enqueuedJobs: false,
        assembledPromptRows: false,
      })
    } finally {
      db.close()
    }
  })

  it('passes selected summaries and buckets through from the memory selection facade', () => {
    const db = openDatabase(makeDataDir())
    try {
      seedMemory(db, {
        chunkId: 'chunk-a',
        summaryId: 'summary-a',
        embeddingId: 'embedding-a',
        vector: [1, 0],
        tokens: 5,
      })
      seedMemory(db, {
        chunkId: 'chunk-b',
        summaryId: 'summary-b',
        embeddingId: 'embedding-b',
        vector: [0, 1],
        tokens: 5,
      })

      const result = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 10,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      })

      expect(result.selectedSummaries.map((summary) => summary.id)).toEqual([
        'summary-a',
        'summary-b',
      ])
      expect(result.similarSummaries.map((summary) => summary.id)).toEqual([
        'summary-a',
        'summary-b',
      ])
      expect(result.rankedSimilarSummaries.map((row) => row.summary.id)).toEqual([
        'summary-a',
        'summary-b',
      ])
      expect(result.importantSummaries).toEqual([])
      expect(result.recentSummaries).toEqual([])
      expect(result.randomSummaries).toEqual([])
      expect(result.diagnostics.missingMemory).toMatchObject({
        emptySelection: false,
        hasMissingMemory: false,
        followUpEligible: false,
      })
    } finally {
      db.close()
    }
  })

  it('passes repository, ranking, and allocation diagnostics through', () => {
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

      const result = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
      })

      expect(result.diagnostics.selection?.repository).toMatchObject({
        summaryIdsMissingEmbeddings: ['summary-without-embedding'],
        chunkIdsMissingEmbeddings: ['chunk-with-summary'],
        chunkIdsMissingSummaries: ['chunk-with-embedding'],
      })
      expect(result.diagnostics.selection?.ranking.missingSummaries).toEqual([
        'chunk-with-embedding',
      ])
      expect(result.diagnostics.selection?.allocation.missingCategories).toContainEqual({
        category: 'similar',
        reason: 'no-candidates',
      })
      expect(result.diagnostics.missingMemory).toEqual({
        emptySelection: true,
        hasMissingMemory: true,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: ['summary-without-embedding'],
        chunkIdsMissingEmbeddings: ['chunk-with-summary'],
        chunkIdsMissingSummaries: ['chunk-with-embedding'],
        followUpEligible: true,
      })
    } finally {
      db.close()
    }
  })

  it('keeps hot-path work outside the adapter contract', () => {
    const db = openDatabase(makeDataDir())
    const selected = makeSummary('summary-a')
    const selectMemory = vi.fn<PromptMemorySelector>(() => ({
      selectedSummaries: [selected],
      importantSummaries: [],
      recentSummaries: [selected],
      similarSummaries: [],
      randomSummaries: [],
      rankedSimilarSummaries: [],
      diagnostics: {
        repository: {
          summaries: 1,
          chunks: 1,
          embeddings: 1,
          summaryIdsMissingChunks: [],
          summaryIdsMissingEmbeddings: [],
          chunkIdsMissingEmbeddings: [],
          chunkIdsMissingSummaries: [],
        },
        ranking: {
          queryVectors: 1,
          validQueryVectors: 1,
          skippedQueryVectors: 0,
          embeddings: 1,
          scoredEmbeddings: 1,
          skippedEmbeddings: [],
          missingChunks: [],
          missingSummaries: [],
        },
        allocation: {
          inputSummaries: 1,
          uniqueSummaries: 1,
          duplicateSummaryIds: [],
          availableTokens: 20,
          consumedTokens: 5,
          remainingTokens: 15,
          recentMemoryRatio: 1,
          similarMemoryRatio: 0,
          randomMemoryRatio: 0,
          unknownRankedSimilarSummaryIds: [],
          categories: {
            important: categoryDiagnostics('important'),
            recent: categoryDiagnostics('recent', 5, 1, 1),
            similar: categoryDiagnostics('similar'),
            random: categoryDiagnostics('random'),
          },
          missingCategories: [],
        },
      },
    }))

    try {
      const result = selectPromptMemory({
        db,
        enabled: true,
        chatId: ' chat-1 ',
        summaryModel: ' summary-model ',
        embeddingModel: ' embedding-model ',
        queryVectors: [[1, 0]],
        availableTokens: 20,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
        selectMemory,
      })

      expect(selectMemory).toHaveBeenCalledOnce()
      expect(selectMemory.mock.calls[0]?.[0]).toMatchObject({
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 20,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
      })
      expect(result.selectedSummaries).toEqual([selected])
      expect(result.diagnostics.hotPathWork).toEqual({
        generatedQueryEmbeddings: false,
        calledProviders: false,
        generatedSummaries: false,
        enqueuedJobs: false,
        assembledPromptRows: false,
      })
    } finally {
      db.close()
    }
  })

  it('assembles no prompt rows for an empty selection while preserving diagnostics', () => {
    const db = openDatabase(makeDataDir())
    try {
      const selection = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-empty',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 100,
        settings: { recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 },
      })

      const assembled = assemblePromptMemoryRows(selection)

      expect(assembled.rows).toEqual([])
      expect(assembled.selectionDiagnostics).toBe(selection.diagnostics)
      expect(assembled.diagnostics).toEqual({
        inputSummaries: 0,
        rows: 0,
        skippedEmptySummaryIds: [],
        hotPathWork: {
          generatedQueryEmbeddings: false,
          calledProviders: false,
          generatedSummaries: false,
          enqueuedJobs: false,
          assembledPromptRows: true,
        },
      })
      expect(selection.diagnostics.hotPathWork.assembledPromptRows).toBe(false)
    } finally {
      db.close()
    }
  })

  it('assembles selected summaries as canonical hypa memory prompt rows', () => {
    const db = openDatabase(makeDataDir())
    const selected = makeSummary('summary-a', '  Summary: user likes quiet gardens.  ')
    const selectMemory = vi.fn<PromptMemorySelector>(() =>
      selectionResult({
        selectedSummaries: [selected],
        recentSummaries: [selected],
      }),
    )
    try {
      const selection = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 20,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
        selectMemory,
      })

      const assembled = assemblePromptMemoryRows(selection)

      expect(assembled.rows).toEqual([
        {
          role: 'system',
          content: 'Summary: user likes quiet gardens.',
          memo: 'hypaMemory',
        },
      ])
      expect(assembled.diagnostics).toMatchObject({
        inputSummaries: 1,
        rows: 1,
        skippedEmptySummaryIds: [],
      })
    } finally {
      db.close()
    }
  })

  it('preserves selected summary order when assembling multiple rows', () => {
    const db = openDatabase(makeDataDir())
    const first = makeSummary('summary-first', 'first selected summary')
    const second = makeSummary('summary-second', 'second selected summary')
    const third = makeSummary('summary-third', 'third selected summary')
    const selectMemory = vi.fn<PromptMemorySelector>(() =>
      selectionResult({
        selectedSummaries: [first, second, third],
        importantSummaries: [first],
        similarSummaries: [second],
        randomSummaries: [third],
      }),
    )
    try {
      const selection = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 20,
        settings: { recentMemoryRatio: 0, similarMemoryRatio: 1 },
        selectMemory,
      })

      const assembled = assemblePromptMemoryRows(selection)

      expect(assembled.rows.map((row) => row.content)).toEqual([
        'first selected summary',
        'second selected summary',
        'third selected summary',
      ])
      expect(assembled.rows.every((row) => row.role === 'system')).toBe(true)
      expect(assembled.rows.every((row) => row.memo === 'hypaMemory')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('skips whitespace-only summaries without changing selection diagnostics', () => {
    const db = openDatabase(makeDataDir())
    const empty = makeSummary('summary-empty', ' \n\t ')
    const selected = makeSummary('summary-selected', 'usable summary')
    const selectMemory = vi.fn<PromptMemorySelector>(() =>
      selectionResult({
        selectedSummaries: [empty, selected],
        recentSummaries: [empty, selected],
      }),
    )
    try {
      const selection = selectPromptMemory({
        db,
        enabled: true,
        chatId: 'chat-1',
        summaryModel: 'summary-model',
        embeddingModel: 'embedding-model',
        queryVectors: [[1, 0]],
        availableTokens: 20,
        settings: { recentMemoryRatio: 1, similarMemoryRatio: 0 },
        selectMemory,
      })

      const assembled = assemblePromptMemoryRows(selection)

      expect(selection.selectedSummaries.map((summary) => summary.id)).toEqual([
        'summary-empty',
        'summary-selected',
      ])
      expect(assembled.rows).toEqual([
        { role: 'system', content: 'usable summary', memo: 'hypaMemory' },
      ])
      expect(assembled.diagnostics).toMatchObject({
        inputSummaries: 2,
        rows: 1,
        skippedEmptySummaryIds: ['summary-empty'],
      })
      expect(assembled.selectionDiagnostics).toBe(selection.diagnostics)
    } finally {
      db.close()
    }
  })
})

function seedMemory(
  db: ReturnType<typeof openDatabase>,
  input: {
    chunkId: string
    summaryId: string
    embeddingId: string
    vector: readonly number[]
    tokens: number
  },
): void {
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: 'chat-1',
    rangeStartSeq: input.chunkId === 'chunk-a' ? 0 : 2,
    rangeEndSeq: input.chunkId === 'chunk-a' ? 1 : 3,
    text: input.chunkId,
    status: 'summarized',
  })
  createMemorySummary(db, {
    id: input.summaryId,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: 'summary-model',
    text: input.summaryId,
    tokens: input.tokens,
  })
  createMemoryEmbedding(db, {
    id: input.embeddingId,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: 'embedding-model',
    vector: [...input.vector],
  })
}

function makeSummary(id: string, text = id): MemorySummary {
  return {
    id,
    chatId: 'chat-1',
    chunkId: 'chunk-a',
    model: 'summary-model',
    text,
    metadata: null,
    tokens: 5,
    createdAt: '2026-05-25T00:00:00.000Z',
  }
}

function selectionResult(
  overrides: Partial<ReturnType<PromptMemorySelector>> = {},
): ReturnType<PromptMemorySelector> {
  const selectedCount = overrides.selectedSummaries?.length ?? 0
  return {
    selectedSummaries: [],
    importantSummaries: [],
    recentSummaries: [],
    similarSummaries: [],
    randomSummaries: [],
    rankedSimilarSummaries: [],
    diagnostics: {
      repository: {
        summaries: selectedCount,
        chunks: selectedCount,
        embeddings: selectedCount,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: [],
        chunkIdsMissingEmbeddings: [],
        chunkIdsMissingSummaries: [],
      },
      ranking: {
        queryVectors: 1,
        validQueryVectors: 1,
        skippedQueryVectors: 0,
        embeddings: selectedCount,
        scoredEmbeddings: selectedCount,
        skippedEmbeddings: [],
        missingChunks: [],
        missingSummaries: [],
      },
      allocation: {
        inputSummaries: selectedCount,
        uniqueSummaries: selectedCount,
        duplicateSummaryIds: [],
        availableTokens: 20,
        consumedTokens: selectedCount * 5,
        remainingTokens: 20 - selectedCount * 5,
        recentMemoryRatio: 1,
        similarMemoryRatio: 0,
        randomMemoryRatio: 0,
        unknownRankedSimilarSummaryIds: [],
        categories: {
          important: categoryDiagnostics(
            'important',
            (overrides.importantSummaries?.length ?? 0) * 5,
            overrides.importantSummaries?.length ?? 0,
            overrides.importantSummaries?.length ?? 0,
          ),
          recent: categoryDiagnostics(
            'recent',
            (overrides.recentSummaries?.length ?? 0) * 5,
            overrides.recentSummaries?.length ?? 0,
            overrides.recentSummaries?.length ?? 0,
          ),
          similar: categoryDiagnostics(
            'similar',
            (overrides.similarSummaries?.length ?? 0) * 5,
            overrides.similarSummaries?.length ?? 0,
            overrides.similarSummaries?.length ?? 0,
          ),
          random: categoryDiagnostics(
            'random',
            (overrides.randomSummaries?.length ?? 0) * 5,
            overrides.randomSummaries?.length ?? 0,
            overrides.randomSummaries?.length ?? 0,
          ),
        },
        missingCategories: [],
      },
    },
    ...overrides,
  }
}

function categoryDiagnostics(
  category: 'important' | 'recent' | 'similar' | 'random',
  consumedTokens = 0,
  candidateCount = 0,
  selectedCount = 0,
) {
  return {
    category,
    reservedTokens: consumedTokens,
    consumedTokens,
    candidateCount,
    selectedCount,
    skippedForBudget: [],
  }
}
