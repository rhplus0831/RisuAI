import type { MemorySummary } from './memoryRepository.js'
import type { RankedMemorySummary } from './memorySimilarityRanking.js'

export type MemoryBudgetAllocationCategory = 'important' | 'recent' | 'similar' | 'random'

export interface MemoryBudgetAllocatorSettings {
  recentMemoryRatio: number
  similarMemoryRatio: number
}

export interface MemoryBudgetAllocatorInput {
  summaries: readonly MemorySummary[]
  rankedSimilarSummaries?: readonly RankedMemorySummary[]
  availableTokens: number
  settings: MemoryBudgetAllocatorSettings
  randomSeed?: string
  getSummaryTokenCost?: (summary: MemorySummary) => number
  isImportantSummary?: (summary: MemorySummary) => boolean
}

export interface MemoryBudgetAllocationCategoryDiagnostics {
  category: MemoryBudgetAllocationCategory
  reservedTokens: number
  consumedTokens: number
  candidateCount: number
  selectedCount: number
  skippedForBudget: Array<{ summaryId: string; tokens: number }>
}

export interface MemoryBudgetAllocationMissingCategory {
  category: MemoryBudgetAllocationCategory
  reason: 'no-candidates' | 'budget-exhausted'
}

export interface MemoryBudgetAllocationDiagnostics {
  inputSummaries: number
  uniqueSummaries: number
  duplicateSummaryIds: string[]
  availableTokens: number
  consumedTokens: number
  remainingTokens: number
  recentMemoryRatio: number
  similarMemoryRatio: number
  randomMemoryRatio: number
  unknownRankedSimilarSummaryIds: string[]
  categories: Record<MemoryBudgetAllocationCategory, MemoryBudgetAllocationCategoryDiagnostics>
  missingCategories: MemoryBudgetAllocationMissingCategory[]
}

export interface MemoryBudgetAllocationResult {
  selected: MemorySummary[]
  important: MemorySummary[]
  recent: MemorySummary[]
  similar: MemorySummary[]
  random: MemorySummary[]
  diagnostics: MemoryBudgetAllocationDiagnostics
}

interface BudgetCategoryState {
  reservedTokens: number
  consumedTokens: number
  candidateIds: Set<string>
  skippedForBudget: Array<{ summaryId: string; tokens: number }>
}

const CATEGORY_ORDER: readonly MemoryBudgetAllocationCategory[] = [
  'important',
  'recent',
  'similar',
  'random',
]

export function allocateMemorySummaries(
  input: MemoryBudgetAllocatorInput,
): MemoryBudgetAllocationResult {
  const { summaries, duplicateSummaryIds } = uniqueSummaries(input.summaries)
  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]))
  const selectedIds = new Set<string>()
  const selectedByCategory: Record<MemoryBudgetAllocationCategory, MemorySummary[]> = {
    important: [],
    recent: [],
    similar: [],
    random: [],
  }
  const categoryStates = createCategoryStates()
  const tokenCost = input.getSummaryTokenCost ?? defaultSummaryTokenCost
  const isImportant = input.isImportantSummary ?? defaultIsImportantSummary
  const initialBudget = normalizeTokenCount(input.availableTokens)
  const recentMemoryRatio = normalizeRatio(input.settings.recentMemoryRatio)
  const similarMemoryRatio = normalizeRatio(input.settings.similarMemoryRatio)
  const randomMemoryRatio = Math.max(0, 1 - recentMemoryRatio - similarMemoryRatio)
  let availableTokens = initialBudget

  const importantCandidates = summaries.filter(isImportant)
  categoryStates.important.candidateIds = toIdSet(importantCandidates)
  for (const summary of importantCandidates) {
    const tokens = normalizeTokenCount(tokenCost(summary))
    if (tokens > availableTokens) {
      categoryStates.important.skippedForBudget.push({ summaryId: summary.id, tokens })
      break
    }
    selectSummary(summary, 'important', tokens)
    availableTokens -= tokens
  }

  const reservedRecentTokens = Math.floor(availableTokens * recentMemoryRatio)
  categoryStates.recent.reservedTokens = reservedRecentTokens
  const recentCandidates = summaries.filter((summary) => !selectedIds.has(summary.id)).reverse()
  categoryStates.recent.candidateIds = toIdSet(recentCandidates)
  if (recentMemoryRatio > 0) {
    for (const summary of recentCandidates) {
      const tokens = normalizeTokenCount(tokenCost(summary))
      if (tokens + categoryStates.recent.consumedTokens > reservedRecentTokens) {
        categoryStates.recent.skippedForBudget.push({ summaryId: summary.id, tokens })
        break
      }
      selectSummary(summary, 'recent', tokens)
    }
  }

  let reservedSimilarTokens = Math.floor(availableTokens * similarMemoryRatio)
  if (similarMemoryRatio > 0 && randomMemoryRatio <= 0) {
    reservedSimilarTokens += reservedRecentTokens - categoryStates.recent.consumedTokens
  }
  categoryStates.similar.reservedTokens = reservedSimilarTokens

  const { rankedSimilarCandidates, unknownRankedSimilarSummaryIds } = resolveRankedSimilarCandidates(
    input.rankedSimilarSummaries ?? [],
    summariesById,
    selectedIds,
  )
  categoryStates.similar.candidateIds = toIdSet(rankedSimilarCandidates)
  if (similarMemoryRatio > 0) {
    for (const summary of rankedSimilarCandidates) {
      const tokens = normalizeTokenCount(tokenCost(summary))
      if (tokens + categoryStates.similar.consumedTokens > reservedSimilarTokens) {
        categoryStates.similar.skippedForBudget.push({ summaryId: summary.id, tokens })
        break
      }
      selectSummary(summary, 'similar', tokens)
    }
  }

  let reservedRandomTokens = Math.floor(availableTokens * randomMemoryRatio)
  if (randomMemoryRatio > 0) {
    reservedRandomTokens +=
      reservedRecentTokens -
      categoryStates.recent.consumedTokens +
      reservedSimilarTokens -
      categoryStates.similar.consumedTokens
  }
  categoryStates.random.reservedTokens = reservedRandomTokens

  const randomCandidates = deterministicShuffle(
    summaries.filter((summary) => !selectedIds.has(summary.id)),
    input.randomSeed ?? '',
  )
  categoryStates.random.candidateIds = toIdSet(randomCandidates)
  if (randomMemoryRatio > 0) {
    for (const summary of randomCandidates) {
      const tokens = normalizeTokenCount(tokenCost(summary))
      if (tokens + categoryStates.random.consumedTokens > reservedRandomTokens) {
        categoryStates.random.skippedForBudget.push({ summaryId: summary.id, tokens })
        continue
      }
      selectSummary(summary, 'random', tokens)
    }
  }

  const selected = summaries.filter((summary) => selectedIds.has(summary.id))
  const consumedTokens = CATEGORY_ORDER.reduce(
    (sum, category) => sum + categoryStates[category].consumedTokens,
    0,
  )

  return {
    selected,
    important: selectedByCategory.important,
    recent: selectedByCategory.recent,
    similar: selectedByCategory.similar,
    random: selectedByCategory.random,
    diagnostics: {
      inputSummaries: input.summaries.length,
      uniqueSummaries: summaries.length,
      duplicateSummaryIds,
      availableTokens: initialBudget,
      consumedTokens,
      remainingTokens: initialBudget - consumedTokens,
      recentMemoryRatio,
      similarMemoryRatio,
      randomMemoryRatio,
      unknownRankedSimilarSummaryIds,
      categories: buildCategoryDiagnostics(categoryStates, selectedByCategory),
      missingCategories: buildMissingCategories(categoryStates, selectedByCategory, {
        important: true,
        recent: recentMemoryRatio > 0,
        similar: similarMemoryRatio > 0,
        random: randomMemoryRatio > 0,
      }),
    },
  }

  function selectSummary(
    summary: MemorySummary,
    category: MemoryBudgetAllocationCategory,
    tokens: number,
  ): void {
    if (selectedIds.has(summary.id)) return
    selectedIds.add(summary.id)
    selectedByCategory[category].push(summary)
    categoryStates[category].consumedTokens += tokens
  }
}

function uniqueSummaries(summaries: readonly MemorySummary[]): {
  summaries: MemorySummary[]
  duplicateSummaryIds: string[]
} {
  const seen = new Set<string>()
  const duplicateSummaryIds = new Set<string>()
  const unique: MemorySummary[] = []

  for (const summary of summaries) {
    if (seen.has(summary.id)) {
      duplicateSummaryIds.add(summary.id)
      continue
    }
    seen.add(summary.id)
    unique.push(summary)
  }

  return { summaries: unique, duplicateSummaryIds: [...duplicateSummaryIds].sort() }
}

function createCategoryStates(): Record<MemoryBudgetAllocationCategory, BudgetCategoryState> {
  return {
    important: createCategoryState(0),
    recent: createCategoryState(0),
    similar: createCategoryState(0),
    random: createCategoryState(0),
  }
}

function createCategoryState(reservedTokens: number): BudgetCategoryState {
  return {
    reservedTokens,
    consumedTokens: 0,
    candidateIds: new Set(),
    skippedForBudget: [],
  }
}

function resolveRankedSimilarCandidates(
  rankedSimilarSummaries: readonly RankedMemorySummary[],
  summariesById: ReadonlyMap<string, MemorySummary>,
  selectedIds: ReadonlySet<string>,
): { rankedSimilarCandidates: MemorySummary[]; unknownRankedSimilarSummaryIds: string[] } {
  const seen = new Set<string>()
  const unknown = new Set<string>()
  const candidates: MemorySummary[] = []

  for (const ranked of rankedSimilarSummaries) {
    const summaryId = ranked.summary.id
    if (seen.has(summaryId)) continue
    seen.add(summaryId)
    const summary = summariesById.get(summaryId)
    if (!summary) {
      unknown.add(summaryId)
      continue
    }
    if (selectedIds.has(summaryId)) continue
    candidates.push(summary)
  }

  return {
    rankedSimilarCandidates: candidates,
    unknownRankedSimilarSummaryIds: [...unknown].sort(),
  }
}

function buildCategoryDiagnostics(
  categoryStates: Record<MemoryBudgetAllocationCategory, BudgetCategoryState>,
  selectedByCategory: Record<MemoryBudgetAllocationCategory, MemorySummary[]>,
): Record<MemoryBudgetAllocationCategory, MemoryBudgetAllocationCategoryDiagnostics> {
  return {
    important: buildSingleCategoryDiagnostics('important', categoryStates, selectedByCategory),
    recent: buildSingleCategoryDiagnostics('recent', categoryStates, selectedByCategory),
    similar: buildSingleCategoryDiagnostics('similar', categoryStates, selectedByCategory),
    random: buildSingleCategoryDiagnostics('random', categoryStates, selectedByCategory),
  }
}

function buildSingleCategoryDiagnostics(
  category: MemoryBudgetAllocationCategory,
  categoryStates: Record<MemoryBudgetAllocationCategory, BudgetCategoryState>,
  selectedByCategory: Record<MemoryBudgetAllocationCategory, MemorySummary[]>,
): MemoryBudgetAllocationCategoryDiagnostics {
  const state = categoryStates[category]
  return {
    category,
    reservedTokens: state.reservedTokens,
    consumedTokens: state.consumedTokens,
    candidateCount: state.candidateIds.size,
    selectedCount: selectedByCategory[category].length,
    skippedForBudget: state.skippedForBudget,
  }
}

function buildMissingCategories(
  categoryStates: Record<MemoryBudgetAllocationCategory, BudgetCategoryState>,
  selectedByCategory: Record<MemoryBudgetAllocationCategory, MemorySummary[]>,
  enabled: Record<MemoryBudgetAllocationCategory, boolean>,
): MemoryBudgetAllocationMissingCategory[] {
  const missing: MemoryBudgetAllocationMissingCategory[] = []

  for (const category of CATEGORY_ORDER) {
    if (!enabled[category] || selectedByCategory[category].length > 0) continue
    const state = categoryStates[category]
    if (state.candidateIds.size === 0) {
      missing.push({ category, reason: 'no-candidates' })
    } else {
      missing.push({
        category,
        reason: state.skippedForBudget.length > 0 ? 'budget-exhausted' : 'no-candidates',
      })
    }
  }

  return missing
}

function defaultSummaryTokenCost(summary: MemorySummary): number {
  return summary.tokens
}

function defaultIsImportantSummary(summary: MemorySummary): boolean {
  return isRecord(summary.metadata) && summary.metadata.isImportant === true
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function toIdSet(summaries: readonly MemorySummary[]): Set<string> {
  return new Set(summaries.map((summary) => summary.id))
}

function deterministicShuffle(
  summaries: readonly MemorySummary[],
  seed: string,
): MemorySummary[] {
  return [...summaries].sort((a, b) => {
    const scoreA = stableHash(`${seed}:${a.id}`)
    const scoreB = stableHash(`${seed}:${b.id}`)
    return scoreA - scoreB || a.id.localeCompare(b.id)
  })
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
