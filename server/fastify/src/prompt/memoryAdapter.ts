import type { DatabaseSync } from 'node:sqlite'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { MemoryBudgetAllocatorSettings } from '../memoryBudgetAllocator.js'
import type { MemorySummary } from '../memoryRepository.js'
import {
  selectMemorySummaries,
  type MemorySelectionInput,
  type MemorySelectionResult,
} from '../memorySelectionService.js'

export type PromptMemoryAdapterDisabledReason =
  | 'feature-disabled'
  | 'missing-chat-id'
  | 'missing-summary-model'
  | 'missing-embedding-model'
  | 'no-token-budget'

export interface PromptMemoryHotPathWorkDiagnostics {
  generatedQueryEmbeddings: false
  calledProviders: false
  generatedSummaries: false
  enqueuedJobs: false
  assembledPromptRows: false
}

export interface PromptMemoryMissingMemoryDiagnostics {
  emptySelection: boolean
  hasMissingMemory: boolean
  summaryIdsMissingChunks: string[]
  summaryIdsMissingEmbeddings: string[]
  chunkIdsMissingEmbeddings: string[]
  chunkIdsMissingSummaries: string[]
  followUpEligible: boolean
}

export interface PromptMemoryAdapterDiagnostics {
  enabled: boolean
  disabledReason: PromptMemoryAdapterDisabledReason | null
  selectionAttempted: boolean
  hotPathWork: PromptMemoryHotPathWorkDiagnostics
  missingMemory: PromptMemoryMissingMemoryDiagnostics
  selection: MemorySelectionResult['diagnostics'] | null
}

export interface PromptMemoryAdapterResult {
  enabled: boolean
  disabledReason: PromptMemoryAdapterDisabledReason | null
  selectedSummaries: MemorySummary[]
  importantSummaries: MemorySummary[]
  recentSummaries: MemorySummary[]
  similarSummaries: MemorySummary[]
  randomSummaries: MemorySummary[]
  rankedSimilarSummaries: MemorySelectionResult['rankedSimilarSummaries']
  diagnostics: PromptMemoryAdapterDiagnostics
}

export interface PromptMemoryRowAssemblyDiagnostics {
  inputSummaries: number
  rows: number
  skippedEmptySummaryIds: string[]
  hotPathWork: {
    generatedQueryEmbeddings: false
    calledProviders: false
    generatedSummaries: false
    enqueuedJobs: false
    assembledPromptRows: true
  }
}

export interface PromptMemoryRowAssemblyResult {
  rows: OpenAIChat[]
  diagnostics: PromptMemoryRowAssemblyDiagnostics
  selectionDiagnostics: PromptMemoryAdapterDiagnostics
}

export type PromptMemorySelector = (input: MemorySelectionInput) => MemorySelectionResult

export interface PromptMemoryAdapterInput {
  db: DatabaseSync
  enabled: boolean
  chatId: string
  summaryModel: string
  embeddingModel: string
  queryVectors: MemorySelectionInput['queryVectors']
  availableTokens: number
  settings: MemoryBudgetAllocatorSettings
  randomSeed?: string
  summarySnapshot?: MemorySelectionInput['summarySnapshot']
  getSummaryTokenCost?: MemorySelectionInput['getSummaryTokenCost']
  isImportantSummary?: MemorySelectionInput['isImportantSummary']
  selectMemory?: PromptMemorySelector
}

export function selectPromptMemory(input: PromptMemoryAdapterInput): PromptMemoryAdapterResult {
  const disabledReason = getDisabledReason(input)
  if (disabledReason) return emptyPromptMemoryResult(false, disabledReason)

  const selectMemory = input.selectMemory ?? selectMemorySummaries
  const selection = selectMemory({
    db: input.db,
    chatId: input.chatId.trim(),
    summaryModel: input.summaryModel.trim(),
    embeddingModel: input.embeddingModel.trim(),
    queryVectors: input.queryVectors,
    availableTokens: input.availableTokens,
    settings: input.settings,
    randomSeed: input.randomSeed,
    summarySnapshot: input.summarySnapshot,
    getSummaryTokenCost: input.getSummaryTokenCost,
    isImportantSummary: input.isImportantSummary,
  })

  return {
    enabled: true,
    disabledReason: null,
    selectedSummaries: selection.selectedSummaries,
    importantSummaries: selection.importantSummaries,
    recentSummaries: selection.recentSummaries,
    similarSummaries: selection.similarSummaries,
    randomSummaries: selection.randomSummaries,
    rankedSimilarSummaries: selection.rankedSimilarSummaries,
    diagnostics: {
      enabled: true,
      disabledReason: null,
      selectionAttempted: true,
      hotPathWork: noHotPathWorkDiagnostics(),
      missingMemory: buildMissingMemoryDiagnostics(selection),
      selection: selection.diagnostics,
    },
  }
}

export function assemblePromptMemoryRows(
  selection: PromptMemoryAdapterResult,
): PromptMemoryRowAssemblyResult {
  const rows: OpenAIChat[] = []
  const skippedEmptySummaryIds: string[] = []

  for (const summary of selection.selectedSummaries) {
    const content = summary.text.trim()
    if (content === '') {
      skippedEmptySummaryIds.push(summary.id)
      continue
    }
    rows.push({ role: 'system', content, memo: 'hypaMemory' })
  }

  return {
    rows,
    diagnostics: {
      inputSummaries: selection.selectedSummaries.length,
      rows: rows.length,
      skippedEmptySummaryIds,
      hotPathWork: promptMemoryRowAssemblyWorkDiagnostics(),
    },
    selectionDiagnostics: selection.diagnostics,
  }
}

function getDisabledReason(
  input: PromptMemoryAdapterInput,
): PromptMemoryAdapterDisabledReason | null {
  if (!input.enabled) return 'feature-disabled'
  if (input.chatId.trim() === '') return 'missing-chat-id'
  if (input.summaryModel.trim() === '') return 'missing-summary-model'
  if (input.embeddingModel.trim() === '') return 'missing-embedding-model'
  if (input.availableTokens <= 0) return 'no-token-budget'
  return null
}

function emptyPromptMemoryResult(
  enabled: boolean,
  disabledReason: PromptMemoryAdapterDisabledReason | null,
): PromptMemoryAdapterResult {
  return {
    enabled,
    disabledReason,
    selectedSummaries: [],
    importantSummaries: [],
    recentSummaries: [],
    similarSummaries: [],
    randomSummaries: [],
    rankedSimilarSummaries: [],
    diagnostics: {
      enabled,
      disabledReason,
      selectionAttempted: false,
      hotPathWork: noHotPathWorkDiagnostics(),
      missingMemory: emptyMissingMemoryDiagnostics(),
      selection: null,
    },
  }
}

function noHotPathWorkDiagnostics(): PromptMemoryHotPathWorkDiagnostics {
  return {
    generatedQueryEmbeddings: false,
    calledProviders: false,
    generatedSummaries: false,
    enqueuedJobs: false,
    assembledPromptRows: false,
  }
}

function promptMemoryRowAssemblyWorkDiagnostics(): PromptMemoryRowAssemblyDiagnostics['hotPathWork'] {
  return {
    generatedQueryEmbeddings: false,
    calledProviders: false,
    generatedSummaries: false,
    enqueuedJobs: false,
    assembledPromptRows: true,
  }
}

function emptyMissingMemoryDiagnostics(): PromptMemoryMissingMemoryDiagnostics {
  return {
    emptySelection: true,
    hasMissingMemory: false,
    summaryIdsMissingChunks: [],
    summaryIdsMissingEmbeddings: [],
    chunkIdsMissingEmbeddings: [],
    chunkIdsMissingSummaries: [],
    followUpEligible: false,
  }
}

function buildMissingMemoryDiagnostics(
  selection: MemorySelectionResult,
): PromptMemoryMissingMemoryDiagnostics {
  const repository = selection.diagnostics.repository
  const hasMissingMemory =
    repository.summaryIdsMissingChunks.length > 0 ||
    repository.summaryIdsMissingEmbeddings.length > 0 ||
    repository.chunkIdsMissingEmbeddings.length > 0 ||
    repository.chunkIdsMissingSummaries.length > 0

  return {
    emptySelection: selection.selectedSummaries.length === 0,
    hasMissingMemory,
    summaryIdsMissingChunks: repository.summaryIdsMissingChunks,
    summaryIdsMissingEmbeddings: repository.summaryIdsMissingEmbeddings,
    chunkIdsMissingEmbeddings: repository.chunkIdsMissingEmbeddings,
    chunkIdsMissingSummaries: repository.chunkIdsMissingSummaries,
    followUpEligible: hasMissingMemory,
  }
}
