import type { MemoryChunk, MemoryEmbedding, MemorySummary } from './memoryRepository.js'

export interface MemorySimilarityRankingInput {
  queryVectors: readonly (Float32Array | readonly number[])[]
  summaries: readonly MemorySummary[]
  chunks: readonly MemoryChunk[]
  embeddings: readonly MemoryEmbedding[]
}

export interface RankedMemorySummary {
  summary: MemorySummary
  chunk: MemoryChunk
  score: number
  bestSimilarity: number
  matchedEmbeddingIds: string[]
}

export interface MemorySimilarityRankingDiagnostics {
  queryVectors: number
  validQueryVectors: number
  skippedQueryVectors: number
  embeddings: number
  scoredEmbeddings: number
  skippedEmbeddings: Array<{ id: string; reason: string }>
  missingChunks: string[]
  missingSummaries: string[]
}

export interface MemorySimilarityRankingResult {
  ranked: RankedMemorySummary[]
  diagnostics: MemorySimilarityRankingDiagnostics
}

interface ValidVector {
  sourceIndex: number
  vector: Float32Array | readonly number[]
  magnitude: number
}

interface ScoredChild {
  embedding: MemoryEmbedding
  summary: MemorySummary
  chunk: MemoryChunk
  score: number
}

interface ParentScore {
  summary: MemorySummary
  chunk: MemoryChunk
  score: number
  bestSimilarity: number
  matchedEmbeddingIds: Set<string>
  firstChildRank: number
}

const RRF_K = 60

export function rankMemorySummariesBySimilarity(
  input: MemorySimilarityRankingInput,
): MemorySimilarityRankingResult {
  const validQueries = toValidVectors(input.queryVectors)
  const chunksById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]))
  const summariesByChunkId = new Map(input.summaries.map((summary) => [summary.chunkId, summary]))
  const missingChunks = new Set<string>()
  const missingSummaries = new Set<string>()
  const skippedEmbeddings: Array<{ id: string; reason: string }> = []
  const scoredLists: ScoredChild[][] = []
  let scoredEmbeddings = 0

  for (const query of validQueries) {
    const scored: ScoredChild[] = []

    for (const embedding of input.embeddings) {
      const chunk = chunksById.get(embedding.chunkId)
      if (!chunk) {
        missingChunks.add(embedding.chunkId)
        continue
      }

      const summary = summariesByChunkId.get(chunk.id)
      if (!summary) {
        missingSummaries.add(chunk.id)
        continue
      }

      const embeddingMagnitude = vectorMagnitude(embedding.vector)
      if (embeddingMagnitude === 0) {
        skippedEmbeddings.push({ id: embedding.id, reason: 'zero-vector' })
        continue
      }

      const score = cosineSimilarityWithMagnitudes(
        query.vector,
        query.magnitude,
        embedding.vector,
        embeddingMagnitude,
      )
      if (score === null) {
        skippedEmbeddings.push({ id: embedding.id, reason: 'dimension-mismatch' })
        continue
      }

      scored.push({ embedding, summary, chunk, score })
    }

    scored.sort(compareScoredChildren)
    scoredEmbeddings += scored.length
    scoredLists.push(scored)
  }

  return {
    ranked: rankParents(scoredLists),
    diagnostics: {
      queryVectors: input.queryVectors.length,
      validQueryVectors: validQueries.length,
      skippedQueryVectors: input.queryVectors.length - validQueries.length,
      embeddings: input.embeddings.length,
      scoredEmbeddings,
      skippedEmbeddings: uniqueSkippedEmbeddings(skippedEmbeddings),
      missingChunks: [...missingChunks].sort(),
      missingSummaries: [...missingSummaries].sort(),
    },
  }
}

export function cosineSimilarity(
  a: Float32Array | readonly number[],
  b: Float32Array | readonly number[],
): number | null {
  const magnitudeA = vectorMagnitude(a)
  const magnitudeB = vectorMagnitude(b)
  if (magnitudeA === 0 || magnitudeB === 0) return null
  return cosineSimilarityWithMagnitudes(a, magnitudeA, b, magnitudeB)
}

function toValidVectors(vectors: readonly (Float32Array | readonly number[])[]): ValidVector[] {
  return vectors.flatMap((vector, sourceIndex) => {
    const magnitude = vectorMagnitude(vector)
    if (magnitude === 0) return []
    return [{ sourceIndex, vector, magnitude }]
  })
}

function vectorMagnitude(vector: Float32Array | readonly number[]): number {
  let sum = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) return 0
    sum += value * value
  }
  return Math.sqrt(sum)
}

function cosineSimilarityWithMagnitudes(
  a: Float32Array | readonly number[],
  magnitudeA: number,
  b: Float32Array | readonly number[],
  magnitudeB: number,
): number | null {
  if (a.length !== b.length) return null
  let dot = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
  }
  return dot / (magnitudeA * magnitudeB)
}

function compareScoredChildren(a: ScoredChild, b: ScoredChild): number {
  return (
    b.score - a.score ||
    a.chunk.rangeStartSeq - b.chunk.rangeStartSeq ||
    a.chunk.rangeEndSeq - b.chunk.rangeEndSeq ||
    compareNullableNumber(a.embedding.groupIndex, b.embedding.groupIndex) ||
    compareNullableString(a.embedding.groupId, b.embedding.groupId) ||
    a.summary.id.localeCompare(b.summary.id) ||
    a.chunk.id.localeCompare(b.chunk.id) ||
    a.embedding.id.localeCompare(b.embedding.id)
  )
}

function rankParents(scoredLists: readonly ScoredChild[][]): RankedMemorySummary[] {
  const parents = new Map<string, ParentScore>()

  for (let listIndex = 0; listIndex < scoredLists.length; listIndex++) {
    const list = scoredLists[listIndex]
    const weight = (listIndex + 1) / ((scoredLists.length * (scoredLists.length + 1)) / 2)

    for (let childIndex = 0; childIndex < list.length; childIndex++) {
      const child = list[childIndex]
      const rank = childIndex + 1
      const rrfTerm = weight / (RRF_K + rank)
      const existing = parents.get(child.summary.id)

      if (existing) {
        existing.score += rrfTerm
        existing.bestSimilarity = Math.max(existing.bestSimilarity, child.score)
        existing.matchedEmbeddingIds.add(child.embedding.id)
        existing.firstChildRank = Math.min(existing.firstChildRank, rank)
      } else {
        parents.set(child.summary.id, {
          summary: child.summary,
          chunk: child.chunk,
          score: rrfTerm,
          bestSimilarity: child.score,
          matchedEmbeddingIds: new Set([child.embedding.id]),
          firstChildRank: rank,
        })
      }
    }
  }

  return [...parents.values()]
    .sort(compareParentScores)
    .map((parent) => ({
      summary: parent.summary,
      chunk: parent.chunk,
      score: parent.score,
      bestSimilarity: parent.bestSimilarity,
      matchedEmbeddingIds: [...parent.matchedEmbeddingIds].sort(),
    }))
}

function compareParentScores(a: ParentScore, b: ParentScore): number {
  return (
    b.score - a.score ||
    b.bestSimilarity - a.bestSimilarity ||
    a.firstChildRank - b.firstChildRank ||
    a.chunk.rangeStartSeq - b.chunk.rangeStartSeq ||
    a.chunk.rangeEndSeq - b.chunk.rangeEndSeq ||
    a.summary.id.localeCompare(b.summary.id) ||
    a.chunk.id.localeCompare(b.chunk.id)
  )
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}

function uniqueSkippedEmbeddings(
  skippedEmbeddings: Array<{ id: string; reason: string }>,
): Array<{ id: string; reason: string }> {
  const seen = new Set<string>()
  const unique: Array<{ id: string; reason: string }> = []

  for (const skipped of skippedEmbeddings) {
    const key = `${skipped.id}:${skipped.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(skipped)
  }

  return unique.sort(
    (a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason),
  )
}
