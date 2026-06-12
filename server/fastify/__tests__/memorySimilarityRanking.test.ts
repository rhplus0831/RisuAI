import { describe, expect, it } from 'vitest'
import { cosineSimilarity, rankMemorySummariesBySimilarity } from '../src/memorySimilarityRanking.js'
import type { MemoryChunk, MemoryEmbedding, MemorySummary } from '../src/memoryRepository.js'

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

function summary(input: Partial<MemorySummary> & { id: string; chunkId: string }): MemorySummary {
  return {
    id: input.id,
    chatId: input.chatId ?? 'chat-1',
    chunkId: input.chunkId,
    model: input.model ?? 'summary-model',
    text: input.text ?? input.id,
    metadata: input.metadata ?? null,
    tokens: input.tokens ?? 8,
    createdAt: input.createdAt ?? '2026-05-25T00:00:00.000Z',
  }
}

function embedding(
  input: Omit<Partial<MemoryEmbedding>, 'vector'> & { id: string; chunkId: string; vector: readonly number[] },
): MemoryEmbedding {
  return {
    id: input.id,
    chatId: input.chatId ?? 'chat-1',
    chunkId: input.chunkId,
    model: input.model ?? 'embedding-model',
    vector: Float32Array.from(input.vector),
    dim: input.dim ?? input.vector.length,
    groupId: input.groupId ?? null,
    groupIndex: input.groupIndex ?? null,
    createdAt: input.createdAt ?? '2026-05-25T00:00:00.000Z',
  }
}

function trackedEmbedding(
  input: Omit<Partial<MemoryEmbedding>, 'vector'> & {
    id: string
    chunkId: string
    vector: readonly number[]
  },
): { embedding: MemoryEmbedding; reads: () => number } {
  const row = embedding(input)
  const vector = row.vector
  let reads = 0
  Object.defineProperty(row, 'vector', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1
      return vector
    },
  })
  return { embedding: row, reads: () => reads }
}

describe('memory similarity ranking', () => {
  it('computes defensive cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 2], [1])).toBeNull()
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull()
  })

  it('ranks summaries by cosine similarity over supplied query vectors', () => {
    const chunks = [
      chunk({ id: 'chunk-a', rangeStartSeq: 0 }),
      chunk({ id: 'chunk-b', rangeStartSeq: 2 }),
      chunk({ id: 'chunk-c', rangeStartSeq: 4 }),
    ]
    const summaries = [
      summary({ id: 'summary-a', chunkId: 'chunk-a' }),
      summary({ id: 'summary-b', chunkId: 'chunk-b' }),
      summary({ id: 'summary-c', chunkId: 'chunk-c' }),
    ]
    const embeddings = [
      embedding({ id: 'embedding-a', chunkId: 'chunk-a', vector: [1, 0] }),
      embedding({ id: 'embedding-b', chunkId: 'chunk-b', vector: [0, 1] }),
      embedding({ id: 'embedding-c', chunkId: 'chunk-c', vector: [0.8, 0.2] }),
    ]

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[1, 0]],
      summaries,
      chunks,
      embeddings,
    })

    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-a', 'summary-c', 'summary-b'])
    expect(result.ranked[0].bestSimilarity).toBeCloseTo(1)
    expect(result.diagnostics).toMatchObject({
      queryVectors: 1,
      validQueryVectors: 1,
      skippedQueryVectors: 0,
      embeddings: 3,
      scoredEmbeddings: 3,
      skippedEmbeddings: [],
      missingChunks: [],
      missingSummaries: [],
    })
  })

  it('K1: skips embedding vector reads when query vectors are empty or invalid', () => {
    const chunks = [chunk({ id: 'chunk-a', rangeStartSeq: 0 })]
    const summaries = [summary({ id: 'summary-a', chunkId: 'chunk-a' })]
    const tracked = trackedEmbedding({
      id: 'embedding-a',
      chunkId: 'chunk-a',
      vector: [1, 0],
    })

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[0, 0]],
      summaries,
      chunks,
      embeddings: [tracked.embedding],
    })

    expect(tracked.reads()).toBe(0)
    expect(result).toEqual({
      ranked: [],
      diagnostics: {
        queryVectors: 1,
        validQueryVectors: 0,
        skippedQueryVectors: 1,
        embeddings: 1,
        scoredEmbeddings: 0,
        skippedEmbeddings: [],
        missingChunks: [],
        missingSummaries: [],
      },
    })
  })

  it('K1: reads embedding vectors and preserves ranking diagnostics for valid query vectors', () => {
    const chunks = [
      chunk({ id: 'chunk-a', rangeStartSeq: 0 }),
      chunk({ id: 'chunk-b', rangeStartSeq: 2 }),
      chunk({ id: 'chunk-c', rangeStartSeq: 4 }),
    ]
    const summaries = [
      summary({ id: 'summary-a', chunkId: 'chunk-a' }),
      summary({ id: 'summary-b', chunkId: 'chunk-b' }),
      summary({ id: 'summary-c', chunkId: 'chunk-c' }),
    ]
    const embeddingA = trackedEmbedding({
      id: 'embedding-a',
      chunkId: 'chunk-a',
      vector: [1, 0],
    })
    const embeddingB = trackedEmbedding({
      id: 'embedding-b',
      chunkId: 'chunk-b',
      vector: [0, 1],
    })
    const embeddingC = trackedEmbedding({
      id: 'embedding-c',
      chunkId: 'chunk-c',
      vector: [0.8, 0.2],
    })

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[1, 0]],
      summaries,
      chunks,
      embeddings: [embeddingA.embedding, embeddingB.embedding, embeddingC.embedding],
    })

    const vectorReads = [embeddingA.reads(), embeddingB.reads(), embeddingC.reads()]
    expect(vectorReads.every((reads) => reads > 0)).toBe(true)
    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-a', 'summary-c', 'summary-b'])
    expect(result.diagnostics).toMatchObject({
      queryVectors: 1,
      validQueryVectors: 1,
      skippedQueryVectors: 0,
      embeddings: 3,
      scoredEmbeddings: 3,
      skippedEmbeddings: [],
      missingChunks: [],
      missingSummaries: [],
    })
  })

  it('combines multiple query vectors deterministically', () => {
    const chunks = [
      chunk({ id: 'chunk-a', rangeStartSeq: 0 }),
      chunk({ id: 'chunk-b', rangeStartSeq: 2 }),
      chunk({ id: 'chunk-c', rangeStartSeq: 4 }),
    ]
    const summaries = chunks.map((row) => summary({ id: row.id.replace('chunk', 'summary'), chunkId: row.id }))
    const embeddings = [
      embedding({ id: 'embedding-a', chunkId: 'chunk-a', vector: [1, 0] }),
      embedding({ id: 'embedding-b', chunkId: 'chunk-b', vector: [0, 1] }),
      embedding({ id: 'embedding-c', chunkId: 'chunk-c', vector: [0.7, 0.7] }),
    ]

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [
        [1, 0],
        [0, 1],
      ],
      summaries,
      chunks,
      embeddings,
    })

    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-b', 'summary-c', 'summary-a'])
  })

  it('handles Voyage contextual rows from the flat embedding shape', () => {
    const chunks = [chunk({ id: 'chunk-a', rangeStartSeq: 0 }), chunk({ id: 'chunk-b', rangeStartSeq: 1 })]
    const summaries = [
      summary({ id: 'summary-a', chunkId: 'chunk-a' }),
      summary({ id: 'summary-b', chunkId: 'chunk-b' }),
    ]
    const embeddings = [
      embedding({
        id: 'embedding-b',
        chunkId: 'chunk-b',
        vector: [0.1, 0.9],
        groupId: 'group-1',
        groupIndex: 1,
      }),
      embedding({
        id: 'embedding-a',
        chunkId: 'chunk-a',
        vector: [0.9, 0.1],
        groupId: 'group-1',
        groupIndex: 0,
      }),
    ]

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[1, 0]],
      summaries,
      chunks,
      embeddings,
    })

    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-a', 'summary-b'])
    expect(result.ranked.map((row) => row.matchedEmbeddingIds)).toEqual([['embedding-a'], ['embedding-b']])
  })

  it('skips invalid vectors and reports missing relationships', () => {
    const chunks = [chunk({ id: 'chunk-a', rangeStartSeq: 0 })]
    const summaries = [summary({ id: 'summary-a', chunkId: 'chunk-a' })]
    const embeddings = [
      embedding({ id: 'embedding-good', chunkId: 'chunk-a', vector: [1, 0] }),
      embedding({ id: 'embedding-zero', chunkId: 'chunk-a', vector: [0, 0] }),
      embedding({ id: 'embedding-mismatch', chunkId: 'chunk-a', vector: [1, 0, 0] }),
      embedding({ id: 'embedding-missing-chunk', chunkId: 'missing-chunk', vector: [1, 0] }),
    ]

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [
        [1, 0],
        [0, 0],
      ],
      summaries,
      chunks,
      embeddings,
    })

    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-a'])
    expect(result.diagnostics).toMatchObject({
      queryVectors: 2,
      validQueryVectors: 1,
      skippedQueryVectors: 1,
      embeddings: 4,
      scoredEmbeddings: 1,
      missingChunks: ['missing-chunk'],
      missingSummaries: [],
    })
    expect(result.diagnostics.skippedEmbeddings).toEqual([
      { id: 'embedding-mismatch', reason: 'dimension-mismatch' },
      { id: 'embedding-zero', reason: 'zero-vector' },
    ])
  })

  it('reports chunks without summaries and returns empty ranks for empty inputs', () => {
    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[1, 0]],
      summaries: [],
      chunks: [chunk({ id: 'chunk-a', rangeStartSeq: 0 })],
      embeddings: [embedding({ id: 'embedding-a', chunkId: 'chunk-a', vector: [1, 0] })],
    })

    expect(result.ranked).toEqual([])
    expect(result.diagnostics.missingSummaries).toEqual(['chunk-a'])

    expect(
      rankMemorySummariesBySimilarity({
        queryVectors: [],
        summaries: [],
        chunks: [],
        embeddings: [],
      }).ranked,
    ).toEqual([])
  })

  it('uses stable tie-breaking for equal scores', () => {
    const chunks = [
      chunk({ id: 'chunk-b', rangeStartSeq: 4 }),
      chunk({ id: 'chunk-a', rangeStartSeq: 0 }),
      chunk({ id: 'chunk-c', rangeStartSeq: 2 }),
    ]
    const summaries = [
      summary({ id: 'summary-b', chunkId: 'chunk-b' }),
      summary({ id: 'summary-a', chunkId: 'chunk-a' }),
      summary({ id: 'summary-c', chunkId: 'chunk-c' }),
    ]
    const embeddings = [
      embedding({ id: 'embedding-b', chunkId: 'chunk-b', vector: [1, 0] }),
      embedding({ id: 'embedding-a', chunkId: 'chunk-a', vector: [1, 0] }),
      embedding({ id: 'embedding-c', chunkId: 'chunk-c', vector: [1, 0] }),
    ]

    const result = rankMemorySummariesBySimilarity({
      queryVectors: [[1, 0]],
      summaries,
      chunks,
      embeddings,
    })

    expect(result.ranked.map((row) => row.summary.id)).toEqual(['summary-a', 'summary-c', 'summary-b'])
  })
})
