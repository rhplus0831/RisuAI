import {
  DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
  isBardWikiGlobalSettings,
  type BardWikiGlobalSettings,
} from '@risuai/protocol'
import type { BardWikiChatSettings } from './bardWikiRepository.js'

export interface BardWikiMemoryBudgets {
  hypaTokenBudget: number | null
  bardWikiTokenBudget: number
}

export function readBardWikiGlobalSettings(value: unknown): BardWikiGlobalSettings {
  return isBardWikiGlobalSettings(value) ? { ...value } : { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS }
}

export function resolveEffectiveBardWikiSettings(
  global: BardWikiGlobalSettings,
  chat: BardWikiChatSettings | null,
): BardWikiGlobalSettings {
  if (!chat) return { ...global }
  return {
    enabledByDefault: chat.enabledOverride ?? global.enabledByDefault,
    memoryMode: chat.memoryModeOverride ?? global.memoryMode,
    confirmationPolicy: chat.confirmationPolicyOverride ?? global.confirmationPolicy,
    modelProfileId: chat.modelProfileIdIsSet ? chat.modelProfileIdOverride : global.modelProfileId,
    promptPresetId: chat.promptPresetIdIsSet ? chat.promptPresetIdOverride : global.promptPresetId,
    canonicalUpdates: chat.canonicalUpdatesOverride ?? global.canonicalUpdates,
    totalTokenBudget: chat.totalTokenBudgetOverride ?? global.totalTokenBudget,
    hybridHypaTokenBudget: chat.hybridHypaTokenBudgetOverride ?? global.hybridHypaTokenBudget,
    hybridBardWikiTokenBudget: chat.hybridBardWikiTokenBudgetOverride ?? global.hybridBardWikiTokenBudget,
    maxDocuments: chat.maxDocumentsOverride ?? global.maxDocuments,
    maxLinkHops: chat.maxLinkHopsOverride ?? global.maxLinkHops,
    recentMessageCount: chat.recentMessageCountOverride ?? global.recentMessageCount,
  }
}

/** Resolve exact mode partitions; null means the legacy Hypa cap is unchanged. */
export function resolveBardWikiMemoryBudgets(settings: BardWikiGlobalSettings): BardWikiMemoryBudgets {
  if (!settings.enabledByDefault || settings.memoryMode === 'hypa') {
    return { hypaTokenBudget: null, bardWikiTokenBudget: 0 }
  }
  const total = Math.max(0, Math.trunc(settings.totalTokenBudget))
  if (settings.memoryMode === 'bardwiki') {
    return { hypaTokenBudget: 0, bardWikiTokenBudget: total }
  }
  const hypaTokenBudget = Math.min(total, Math.max(0, Math.trunc(settings.hybridHypaTokenBudget)))
  const requestedBardWiki = Math.min(total, Math.max(0, Math.trunc(settings.hybridBardWikiTokenBudget)))
  return {
    hypaTokenBudget,
    bardWikiTokenBudget: Math.min(requestedBardWiki, Math.max(0, total - hypaTokenBudget)),
  }
}
