import { describe, expect, it } from 'vitest'
import { allocateMemorySummaries } from '../src/memoryBudgetAllocator.js'
import type { MemoryChunk, MemorySummary } from '../src/memoryRepository.js'
import type { RankedMemorySummary } from '../src/memorySimilarityRanking.js'

function summary(input: Partial<MemorySummary> & { id: string }): MemorySummary {
  return {
    id: input.id,
    chatId: input.chatId ?? 'chat-1',
    chunkId: input.chunkId ?? input.id.replace('summary', 'chunk'),
    model: input.model ?? 'summary-model',
    text: input.text ?? input.id,
    metadata: input.metadata ?? null,
    tokens: input.tokens ?? 10,
    createdAt: input.createdAt ?? '2026-05-25T00:00:00.000Z',
  }
}

function chunk(input: Partial<MemoryChunk> & { id: string; rangeStartSeq: number }): MemoryChunk {
  return {
    id: input.id,
    chatId: input.chatId ?? 'chat-1',
    messageId: input.messageId ?? null,
    rangeStartSeq: input.rangeStartSeq,
    rangeEndSeq: input.rangeEndSeq ?? input.rangeStartSeq,
    text: input.text ?? input.id,
    status: input.status ?? 'summarized',
    createdAt: input.createdAt ?? '2026-05-25T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-05-25T00:00:00.000Z',
  }
}

function ranked(row: MemorySummary, score: number): RankedMemorySummary {
  return {
    summary: row,
    chunk: chunk({ id: row.chunkId, rangeStartSeq: Number(row.id.replace(/\D/g, '')) || 0 }),
    score,
    bestSimilarity: score,
    matchedEmbeddingIds: [`embedding-${row.id}`],
  }
}

describe('memory budget allocator', () => {
  it('prioritizes important memories before ratio buckets', () => {
    const summaries = [
      summary({ id: 'summary-1', tokens: 8 }),
      summary({ id: 'summary-2', tokens: 12, metadata: { isImportant: true } }),
      summary({ id: 'summary-3', tokens: 8 }),
      summary({ id: 'summary-4', tokens: 8 }),
    ]

    const result = allocateMemorySummaries({
      summaries,
      rankedSimilarSummaries: [ranked(summaries[0], 0.9)],
      availableTokens: 32,
      settings: { recentMemoryRatio: 0.5, similarMemoryRatio: 0.5 },
    })

    expect(result.important.map((row) => row.id)).toEqual(['summary-2'])
    expect(result.recent.map((row) => row.id)).toEqual(['summary-4'])
    expect(result.similar.map((row) => row.id)).toEqual(['summary-1'])
    expect(result.selected.map((row) => row.id)).toEqual(['summary-1', 'summary-2', 'summary-4'])
    expect(result.diagnostics.consumedTokens).toBe(28)
  })

  it('reports budget exhaustion and stops ordered buckets on the first oversized summary', () => {
    const summaries = [
      summary({ id: 'summary-1', tokens: 20, metadata: { isImportant: true } }),
      summary({ id: 'summary-2', tokens: 5 }),
    ]

    const result = allocateMemorySummaries({
      summaries,
      availableTokens: 10,
      settings: { recentMemoryRatio: 0.5, similarMemoryRatio: 0.5 },
    })

    expect(result.selected.map((row) => row.id)).toEqual(['summary-2'])
    expect(result.diagnostics.categories.important.skippedForBudget).toEqual([
      { summaryId: 'summary-1', tokens: 20 },
    ])
    expect(result.diagnostics.missingCategories).toContainEqual({
      category: 'important',
      reason: 'budget-exhausted',
    })
  })

  it('preserves recent, similar, and random ratio behavior with spillover to random', () => {
    const summaries = [
      summary({ id: 'summary-1', tokens: 9 }),
      summary({ id: 'summary-2', tokens: 9 }),
      summary({ id: 'summary-3', tokens: 9 }),
      summary({ id: 'summary-4', tokens: 9 }),
      summary({ id: 'summary-5', tokens: 9 }),
    ]

    const result = allocateMemorySummaries({
      summaries,
      rankedSimilarSummaries: [ranked(summaries[0], 0.9), ranked(summaries[1], 0.8)],
      availableTokens: 45,
      settings: { recentMemoryRatio: 0.2, similarMemoryRatio: 0.2 },
      randomSeed: 'ratio-test',
    })

    expect(result.recent.map((row) => row.id)).toEqual(['summary-5'])
    expect(result.similar.map((row) => row.id)).toEqual(['summary-1'])
    expect(result.random).toHaveLength(3)
    expect(result.selected).toHaveLength(5)
    expect(result.diagnostics.categories.random.reservedTokens).toBe(27)
    expect(result.diagnostics.remainingTokens).toBe(0)
  })

  it('uses deterministic randomness controlled by seed', () => {
    const summaries = [
      summary({ id: 'summary-a', tokens: 5 }),
      summary({ id: 'summary-b', tokens: 5 }),
      summary({ id: 'summary-c', tokens: 5 }),
      summary({ id: 'summary-d', tokens: 5 }),
    ]
    const input = {
      summaries,
      availableTokens: 10,
      settings: { recentMemoryRatio: 0, similarMemoryRatio: 0 },
    }

    const first = allocateMemorySummaries({ ...input, randomSeed: 'one' })
    const second = allocateMemorySummaries({ ...input, randomSeed: 'one' })
    const third = allocateMemorySummaries({ ...input, randomSeed: 'two' })

    expect(second.random.map((row) => row.id)).toEqual(first.random.map((row) => row.id))
    expect(third.random.map((row) => row.id)).not.toEqual(first.random.map((row) => row.id))
    expect(first.random).toHaveLength(2)
  })

  it('suppresses duplicates across inputs and categories', () => {
    const summaries = [
      summary({ id: 'summary-1', tokens: 5, metadata: { isImportant: true } }),
      summary({ id: 'summary-1', tokens: 5 }),
      summary({ id: 'summary-2', tokens: 5 }),
      summary({ id: 'summary-3', tokens: 5 }),
    ]

    const result = allocateMemorySummaries({
      summaries,
      rankedSimilarSummaries: [ranked(summaries[0], 0.9), ranked(summaries[2], 0.8)],
      availableTokens: 20,
      settings: { recentMemoryRatio: 0.25, similarMemoryRatio: 0.75 },
    })

    expect(result.important.map((row) => row.id)).toEqual(['summary-1'])
    expect(result.similar.map((row) => row.id)).toEqual(['summary-2'])
    expect(result.selected.map((row) => row.id)).toEqual(['summary-1', 'summary-2'])
    expect(result.diagnostics.duplicateSummaryIds).toEqual(['summary-1'])
  })

  it('returns diagnostics for empty inputs and unknown ranked rows', () => {
    const unknown = summary({ id: 'summary-unknown' })

    const result = allocateMemorySummaries({
      summaries: [],
      rankedSimilarSummaries: [ranked(unknown, 1)],
      availableTokens: 50,
      settings: { recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 },
    })

    expect(result.selected).toEqual([])
    expect(result.diagnostics).toMatchObject({
      inputSummaries: 0,
      uniqueSummaries: 0,
      unknownRankedSimilarSummaryIds: ['summary-unknown'],
    })
    expect(result.diagnostics.missingCategories).toEqual([
      { category: 'important', reason: 'no-candidates' },
      { category: 'recent', reason: 'no-candidates' },
      { category: 'similar', reason: 'no-candidates' },
      { category: 'random', reason: 'no-candidates' },
    ])
  })
})
