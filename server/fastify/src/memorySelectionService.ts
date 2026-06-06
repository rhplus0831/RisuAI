import type { DatabaseSync } from 'node:sqlite'
import {
  allocateMemorySummaries,
  type MemoryBudgetAllocationResult,
  type MemoryBudgetAllocatorSettings,
} from './memoryBudgetAllocator.js'
import {
  type MemoryChunk,
  type MemoryEmbedding,
  type MemorySummary,
  type MemorySummarySnapshot,
  listMemoryChunks,
  listMemoryEmbeddings,
  listMemorySummaries,
} from './memoryRepository.js'
import {
  rankMemorySummariesBySimilarity,
  type MemorySimilarityRankingDiagnostics,
  type RankedMemorySummary,
} from './memorySimilarityRanking.js'

export interface MemorySelectionInput {
  db: DatabaseSync
  chatId: string
  summaryModel: string
  embeddingModel: string
  queryVectors: readonly (Float32Array | readonly number[])[]
  availableTokens: number
  settings: MemoryBudgetAllocatorSettings
  randomSeed?: string
  summarySnapshot?: MemorySummarySnapshot
  getSummaryTokenCost?: (summary: MemorySummary) => number
  isImportantSummary?: (summary: MemorySummary) => boolean
}

export interface MemorySelectionRepositoryDiagnostics {
  summaries: number
  chunks: number
  embeddings: number
  summaryIdsMissingChunks: string[]
  summaryIdsMissingEmbeddings: string[]
  chunkIdsMissingEmbeddings: string[]
  chunkIdsMissingSummaries: string[]
}

export interface MemorySelectionDiagnostics {
  repository: MemorySelectionRepositoryDiagnostics
  ranking: MemorySimilarityRankingDiagnostics
  allocation: MemoryBudgetAllocationResult['diagnostics']
}

export interface MemorySelectionResult {
  selectedSummaries: MemorySummary[]
  importantSummaries: MemorySummary[]
  recentSummaries: MemorySummary[]
  similarSummaries: MemorySummary[]
  randomSummaries: MemorySummary[]
  rankedSimilarSummaries: RankedMemorySummary[]
  diagnostics: MemorySelectionDiagnostics
}

export function selectMemorySummaries(input: MemorySelectionInput): MemorySelectionResult {
  const summaries = resolveSelectionSummaries(input)
  const chunks = listMemoryChunks(input.db, { chatId: input.chatId })
  const embeddings = listMemoryEmbeddings(input.db, {
    chatId: input.chatId,
    model: input.embeddingModel,
  })

  const ranking = rankMemorySummariesBySimilarity({
    queryVectors: input.queryVectors,
    summaries,
    chunks,
    embeddings,
  })
  const allocation = allocateMemorySummaries({
    summaries,
    rankedSimilarSummaries: ranking.ranked,
    availableTokens: input.availableTokens,
    settings: input.settings,
    randomSeed: input.randomSeed ?? defaultMemorySelectionSeed(input),
    getSummaryTokenCost: input.getSummaryTokenCost,
    isImportantSummary: input.isImportantSummary,
  })

  return {
    selectedSummaries: allocation.selected,
    importantSummaries: allocation.important,
    recentSummaries: allocation.recent,
    similarSummaries: allocation.similar,
    randomSummaries: allocation.random,
    rankedSimilarSummaries: ranking.ranked,
    diagnostics: {
      repository: buildRepositoryDiagnostics({ summaries, chunks, embeddings }),
      ranking: ranking.diagnostics,
      allocation: allocation.diagnostics,
    },
  }
}

function resolveSelectionSummaries(input: MemorySelectionInput): MemorySummary[] {
  if (!input.summarySnapshot) {
    return listMemorySummaries(input.db, {
      chatId: input.chatId,
      model: input.summaryModel,
    })
  }
  if (input.summarySnapshot.chatId !== input.chatId) {
    throw new Error('memory summary snapshot chatId must match selection chatId')
  }
  return input.summarySnapshot.summaries.filter((summary) => {
    if (summary.chatId !== input.chatId) {
      throw new Error('memory summary snapshot contains summaries from another chat')
    }
    return summary.model === input.summaryModel
  })
}

function defaultMemorySelectionSeed(input: MemorySelectionInput): string {
  return `${input.chatId}:${input.summaryModel}:${input.embeddingModel}`
}

function buildRepositoryDiagnostics(input: {
  summaries: readonly MemorySummary[]
  chunks: readonly MemoryChunk[]
  embeddings: readonly MemoryEmbedding[]
}): MemorySelectionRepositoryDiagnostics {
  const chunkIds = new Set(input.chunks.map((chunk) => chunk.id))
  const summaryChunkIds = new Set(input.summaries.map((summary) => summary.chunkId))
  const embeddingChunkIds = new Set(input.embeddings.map((embedding) => embedding.chunkId))
  const summaryIdsMissingChunks = new Set<string>()
  const summaryIdsMissingEmbeddings = new Set<string>()
  const chunkIdsMissingEmbeddings = new Set<string>()
  const chunkIdsMissingSummaries = new Set<string>()

  for (const summary of input.summaries) {
    if (!chunkIds.has(summary.chunkId)) {
      summaryIdsMissingChunks.add(summary.id)
      continue
    }
    if (!embeddingChunkIds.has(summary.chunkId)) {
      summaryIdsMissingEmbeddings.add(summary.id)
      chunkIdsMissingEmbeddings.add(summary.chunkId)
    }
  }

  for (const chunk of input.chunks) {
    if (!summaryChunkIds.has(chunk.id)) {
      chunkIdsMissingSummaries.add(chunk.id)
    }
  }

  return {
    summaries: input.summaries.length,
    chunks: input.chunks.length,
    embeddings: input.embeddings.length,
    summaryIdsMissingChunks: [...summaryIdsMissingChunks].sort(),
    summaryIdsMissingEmbeddings: [...summaryIdsMissingEmbeddings].sort(),
    chunkIdsMissingEmbeddings: [...chunkIdsMissingEmbeddings].sort(),
    chunkIdsMissingSummaries: [...chunkIdsMissingSummaries].sort(),
  }
}
