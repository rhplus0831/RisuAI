import type { DatabaseSync } from 'node:sqlite'
import type { BardWikiGlobalSettings } from '@risuai/protocol'
import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { getBardWikiChatSettings } from '../bardWikiRepository.js'
import {
  readBardWikiGlobalSettings,
  resolveBardWikiMemoryBudgets,
  resolveEffectiveBardWikiSettings,
  type BardWikiMemoryBudgets,
} from '../bardWikiSettings.js'
import { buildPromptMemoryQueryTexts, type PromptMemoryQuerySourceInput } from '../promptMemoryQuery.js'
import { loadBardWikiPromptSnapshot } from './bardWikiPromptRepository.js'
import { buildBardWikiQuery } from './bardWikiQuery.js'
import { selectBardWikiPromptRows, type BardWikiSelectionDiagnostics } from './bardWikiSelection.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

export type BardWikiPromptReason = 'disabled' | 'hypa_mode' | BardWikiSelectionDiagnostics['reason']

export interface BardWikiPromptDiagnostics {
  reason: BardWikiPromptReason
  memoryMode: BardWikiGlobalSettings['memoryMode']
  bardWikiTokenBudget: number
  hypaTokenBudget: number | null
  queryHash: string | null
  candidateCount: number
  selectedCount: number
  linkedCandidateCount: number
  unresolvedLinkCount: number
  consumedTokens: number
  selected: BardWikiSelectionDiagnostics['selected']
  candidateLimitReached: boolean
  linkLimitReached: boolean
}

export interface BardWikiPromptAssembly {
  settings: BardWikiGlobalSettings
  budgets: BardWikiMemoryBudgets
  rows: OpenAIChat[]
  diagnostics: BardWikiPromptDiagnostics
}

/** Build committed BardWiki rows for the shared memory_bridge stage. */
export function buildBardWikiPromptRows(input: {
  db: DatabaseSync
  database: Database
  querySource: PromptMemoryQuerySourceInput
}): BardWikiPromptAssembly {
  const globalSettings = readBardWikiGlobalSettings(input.database.bardWiki)
  const settings = resolveEffectiveBardWikiSettings(
    globalSettings,
    getBardWikiChatSettings(input.db, input.querySource.chatId),
  )
  const budgets = resolveBardWikiMemoryBudgets(settings)
  if (!settings.enabledByDefault) return emptyAssembly(settings, budgets, 'disabled')
  if (settings.memoryMode === 'hypa') return emptyAssembly(settings, budgets, 'hypa_mode')

  const queryTexts = buildPromptMemoryQueryTexts(input.database, input.querySource, settings.recentMessageCount)
  const currentInput =
    typeof input.querySource.userMessage === 'string' ? input.querySource.userMessage : (queryTexts.at(-1) ?? '')
  const recentMessages = [...queryTexts]
  if (recentMessages.at(-1) === currentInput) recentMessages.pop()
  const query = buildBardWikiQuery({
    currentInput,
    recentMessages,
    recentMessageCount: settings.recentMessageCount,
  })
  const maxLinkHops: 0 | 1 | 2 = settings.maxLinkHops === 2 ? 2 : settings.maxLinkHops === 1 ? 1 : 0
  const snapshot = loadBardWikiPromptSnapshot(input.db, {
    chatId: input.querySource.chatId,
    query,
    maxLinkHops,
  })
  const { encoding, options } = tokenizerOptionsFromDb(input.database)
  const selection = selectBardWikiPromptRows({
    snapshot,
    query,
    maxDocuments: settings.maxDocuments,
    maxLinkHops,
    tokenBudget: budgets.bardWikiTokenBudget,
    countRowTokens: (content) => tokenizeChat({ role: 'system', content, memo: 'bardWiki' }, encoding, options),
  })
  return {
    settings,
    budgets,
    rows: selection.rows.map((row) => ({
      role: 'system',
      content: row.content,
      memo: 'bardWiki',
      removable: !row.pinned,
    })),
    diagnostics: {
      reason: selection.diagnostics.reason,
      memoryMode: settings.memoryMode,
      bardWikiTokenBudget: budgets.bardWikiTokenBudget,
      hypaTokenBudget: budgets.hypaTokenBudget,
      queryHash: selection.diagnostics.queryHash,
      candidateCount: selection.diagnostics.candidateCount,
      selectedCount: selection.diagnostics.selectedCount,
      linkedCandidateCount: selection.diagnostics.linkedCandidateCount,
      unresolvedLinkCount: selection.diagnostics.unresolvedLinkCount,
      consumedTokens: selection.diagnostics.consumedTokens,
      selected: selection.diagnostics.selected,
      candidateLimitReached: selection.diagnostics.candidateLimitReached,
      linkLimitReached: selection.diagnostics.linkLimitReached,
    },
  }
}

function emptyAssembly(
  settings: BardWikiGlobalSettings,
  budgets: BardWikiMemoryBudgets,
  reason: 'disabled' | 'hypa_mode',
): BardWikiPromptAssembly {
  return {
    settings,
    budgets,
    rows: [],
    diagnostics: {
      reason,
      memoryMode: settings.memoryMode,
      bardWikiTokenBudget: budgets.bardWikiTokenBudget,
      hypaTokenBudget: budgets.hypaTokenBudget,
      queryHash: null,
      candidateCount: 0,
      selectedCount: 0,
      linkedCandidateCount: 0,
      unresolvedLinkCount: 0,
      consumedTokens: 0,
      selected: [],
      candidateLimitReached: false,
      linkLimitReached: false,
    },
  }
}
