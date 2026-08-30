import type { MemorySummaryMessage } from './memorySummaryMessage.js'

const LOG_PREFIX = '[HypaV3]'
const MEMORY_PROMPT_TAG = 'Past Events Summary'

export interface HypaV3Settings {
  summarizationModel: string
  summarizationPrompt: string
  reSummarizationPrompt: string
  memoryTokensRatio: number
  extraSummarizationRatio: number
  maxChatsPerSummary: number
  recentMemoryRatio: number
  similarMemoryRatio: number
  enableSimilarityCorrection: boolean
  preserveOrphanedMemory: boolean
  processRegexScript: boolean
  doNotSummarizeUserMessage: boolean
  summaryChunkSeparator: string
  useExperimentalImpl: boolean
  summarizationRequestsPerMinute: number
  summarizationMaxConcurrent: number
  embeddingRequestsPerMinute: number
  embeddingMaxConcurrent: number
  alwaysToggleOn: boolean
  queryChatCount: number
}

export type HypaV3SettingsWarningCode = 'experimental_planner_fallback'

export interface HypaV3SettingsWarning {
  code: HypaV3SettingsWarningCode
  message: string
}

export interface NormalizeHypaV3SettingsResult {
  settings: HypaV3Settings
  warnings: HypaV3SettingsWarning[]
}

export interface HypaV3SettingsValidationError {
  field: keyof HypaV3Settings | 'recentMemoryRatio+similarMemoryRatio'
  message: string
}

export type HypaV3PlannerMode = 'standard'

export interface HypaV3SummaryRef {
  chatMemos: readonly string[]
}

export type HypaV3SkippedMessageReason = 'example' | 'new_chat_marker' | 'empty' | 'user_message_disabled'

export interface HypaV3SkippedMessage {
  index: number
  memo: string | null
  reason: HypaV3SkippedMessageReason
}

export interface HypaV3PlannedWindow {
  startIndex: number
  endIndexExclusive: number
  messageIndexes: number[]
  chatMemos: string[]
  evaluatedTokenCount: number
  skipped: HypaV3SkippedMessage[]
  tokenDelta: number
}

export type HypaV3PlannerErrorCode = 'invalid_settings' | 'cannot_summarize_further'

export interface HypaV3PlannerError {
  code: HypaV3PlannerErrorCode
  message: string
  details?: unknown
}

export interface HypaV3TokenDelta {
  kind: 'max_response' | 'summarized_history' | 'memory_reservation' | 'planned_window'
  amount: number
  currentTokens: number
}

export interface PlanHypaV3MemoryInput {
  chats: readonly MemorySummaryMessage[]
  currentTokens: number
  maxContextTokens: number
  maxResponseTokens: number
  settings?: Partial<HypaV3Settings> | null
  summaries?: readonly HypaV3SummaryRef[]
  tokenizeChat: (chat: MemorySummaryMessage) => number
  tokenizeSummarizedPrefixChat?: (chat: MemorySummaryMessage) => number
}

export interface HypaV3MemoryPlan {
  mode: HypaV3PlannerMode
  settings: HypaV3Settings
  warnings: HypaV3SettingsWarning[]
  errors: HypaV3PlannerError[]
  startIndex: number
  currentTokens: number
  memoryTokens: number
  emptyMemoryTokens: number
  availableMemoryTokens: number
  reservedEmptyMemoryPrompt: boolean
  summarizationMode: boolean
  targetTokens: number
  tokenDeltas: HypaV3TokenDelta[]
  plannedWindows: HypaV3PlannedWindow[]
  skippedMessages: HypaV3SkippedMessage[]
}

type HypaV3SettingsKey = keyof HypaV3Settings

export const DEFAULT_HYPA_V3_SETTINGS: HypaV3Settings = {
  summarizationModel: 'subModel',
  summarizationPrompt: '',
  reSummarizationPrompt: '',
  memoryTokensRatio: 0.2,
  extraSummarizationRatio: 0,
  maxChatsPerSummary: 6,
  recentMemoryRatio: 0.4,
  similarMemoryRatio: 0.4,
  enableSimilarityCorrection: false,
  preserveOrphanedMemory: false,
  processRegexScript: false,
  doNotSummarizeUserMessage: false,
  summaryChunkSeparator: '\\n\\n',
  useExperimentalImpl: false,
  summarizationRequestsPerMinute: 20,
  summarizationMaxConcurrent: 1,
  embeddingRequestsPerMinute: 100,
  embeddingMaxConcurrent: 1,
  alwaysToggleOn: false,
  queryChatCount: 3,
}

export function normalizeHypaV3Settings(
  existingSettings?: Partial<HypaV3Settings> | null,
): NormalizeHypaV3SettingsResult {
  const settings: HypaV3Settings = { ...DEFAULT_HYPA_V3_SETTINGS }
  const warnings: HypaV3SettingsWarning[] = []

  if (existingSettings && typeof existingSettings === 'object' && !Array.isArray(existingSettings)) {
    for (const [key, value] of Object.entries(existingSettings)) {
      if (isHypaV3SettingsKey(key) && typeof value === typeof settings[key]) {
        assignSetting(settings, key, value)
      }
    }
  }

  if (settings.useExperimentalImpl) {
    settings.useExperimentalImpl = false
    warnings.push({
      code: 'experimental_planner_fallback',
      message: 'Hypa V3 experimental planner settings are routed to the standard server planner.',
    })
  }

  return { settings, warnings }
}

export function validateHypaV3Settings(settings: HypaV3Settings): HypaV3SettingsValidationError[] {
  const errors: HypaV3SettingsValidationError[] = []

  requireRatio(settings.memoryTokensRatio, 'memoryTokensRatio', errors)
  requireRatio(settings.extraSummarizationRatio, 'extraSummarizationRatio', errors)
  requireRatio(settings.recentMemoryRatio, 'recentMemoryRatio', errors)
  requireRatio(settings.similarMemoryRatio, 'similarMemoryRatio', errors)

  if (settings.recentMemoryRatio + settings.similarMemoryRatio > 1) {
    errors.push({
      field: 'recentMemoryRatio+similarMemoryRatio',
      message: 'Recent Memory Ratio and Similar Memory Ratio must not sum above 1.',
    })
  }

  requirePositiveInteger(settings.maxChatsPerSummary, 'maxChatsPerSummary', errors)
  requirePositiveInteger(settings.summarizationRequestsPerMinute, 'summarizationRequestsPerMinute', errors)
  requirePositiveInteger(settings.summarizationMaxConcurrent, 'summarizationMaxConcurrent', errors)
  requirePositiveInteger(settings.embeddingRequestsPerMinute, 'embeddingRequestsPerMinute', errors)
  requirePositiveInteger(settings.embeddingMaxConcurrent, 'embeddingMaxConcurrent', errors)
  requireNonNegativeInteger(settings.queryChatCount, 'queryChatCount', errors)

  if (settings.summaryChunkSeparator.length === 0) {
    errors.push({
      field: 'summaryChunkSeparator',
      message: 'summaryChunkSeparator must not be empty.',
    })
  }

  return errors
}

export function planStandardHypaV3Memory(input: PlanHypaV3MemoryInput): HypaV3MemoryPlan {
  const normalized = normalizeHypaV3Settings(input.settings)
  const settings = normalized.settings
  const validationErrors = validateHypaV3Settings(settings)
  const memoryTokens = Math.floor(input.maxContextTokens * settings.memoryTokensRatio)
  const emptyMemoryTokens = input.tokenizeChat({
    role: 'system',
    content: wrapWithXml(MEMORY_PROMPT_TAG, ''),
  })
  const errors: HypaV3PlannerError[] = validationErrors.map((error) => ({
    code: 'invalid_settings',
    message: error.message,
    details: error,
  }))

  let currentTokens = input.currentTokens
  const tokenDeltas: HypaV3TokenDelta[] = []
  const plannedWindows: HypaV3PlannedWindow[] = []
  const skippedMessages: HypaV3SkippedMessage[] = []
  let startIndex = determineHypaV3SummarizedPrefixStartIndex(input.chats, input.summaries ?? [])

  currentTokens -= input.maxResponseTokens
  tokenDeltas.push({
    kind: 'max_response',
    amount: -input.maxResponseTokens,
    currentTokens,
  })

  if (startIndex > 0) {
    const summarizedTokens = sumChatTokens(
      input.chats.slice(0, startIndex),
      input.tokenizeSummarizedPrefixChat ?? input.tokenizeChat,
    )
    currentTokens -= summarizedTokens
    tokenDeltas.push({
      kind: 'summarized_history',
      amount: -summarizedTokens,
      currentTokens,
    })
  }

  const hasSummaries = (input.summaries?.length ?? 0) > 0
  const reservedEmptyMemoryPrompt = !hasSummaries && currentTokens + emptyMemoryTokens <= input.maxContextTokens
  const memoryReservation = reservedEmptyMemoryPrompt ? emptyMemoryTokens : memoryTokens
  currentTokens += memoryReservation
  tokenDeltas.push({
    kind: 'memory_reservation',
    amount: memoryReservation,
    currentTokens,
  })

  const availableMemoryTokens = reservedEmptyMemoryPrompt ? 0 : memoryTokens - emptyMemoryTokens
  const summarizationMode = currentTokens > input.maxContextTokens
  const targetTokens = input.maxContextTokens * (1 - settings.extraSummarizationRatio)

  if (errors.length === 0) {
    while (summarizationMode) {
      if (currentTokens <= targetTokens) break

      if (input.chats.length - startIndex <= settings.queryChatCount) {
        if (currentTokens <= input.maxContextTokens) {
          break
        }
        errors.push({
          code: 'cannot_summarize_further',
          message: `${LOG_PREFIX} Cannot summarize further: input token count (${currentTokens}) exceeds max context size (${input.maxContextTokens}), but minimum ${settings.queryChatCount} messages required.`,
          details: {
            currentTokens,
            maxContextTokens: input.maxContextTokens,
            queryChatCount: settings.queryChatCount,
          },
        })
        break
      }

      const endIndexExclusive = Math.min(
        startIndex + settings.maxChatsPerSummary,
        input.chats.length - settings.queryChatCount,
      )
      const window = planWindow(input.chats, startIndex, endIndexExclusive, settings, input.tokenizeChat)

      skippedMessages.push(...window.skipped)

      if (currentTokens <= input.maxContextTokens && currentTokens + window.tokenDelta < targetTokens) {
        break
      }

      if (window.messageIndexes.length > 0) {
        plannedWindows.push(window)
      }
      currentTokens += window.tokenDelta
      tokenDeltas.push({
        kind: 'planned_window',
        amount: window.tokenDelta,
        currentTokens,
      })
      startIndex = endIndexExclusive
    }
  }

  return {
    mode: 'standard',
    settings,
    warnings: normalized.warnings,
    errors,
    startIndex,
    currentTokens,
    memoryTokens,
    emptyMemoryTokens,
    availableMemoryTokens,
    reservedEmptyMemoryPrompt,
    summarizationMode,
    targetTokens,
    tokenDeltas,
    plannedWindows,
    skippedMessages,
  }
}

function planWindow(
  chats: readonly MemorySummaryMessage[],
  startIndex: number,
  endIndexExclusive: number,
  settings: HypaV3Settings,
  tokenizeChat: (chat: MemorySummaryMessage) => number,
): HypaV3PlannedWindow {
  const messageIndexes: number[] = []
  const chatMemos: string[] = []
  const skipped: HypaV3SkippedMessage[] = []
  let evaluatedTokenCount = 0

  for (let i = startIndex; i < endIndexExclusive; i++) {
    const chat = chats[i]
    evaluatedTokenCount += tokenizeChat(chat)

    const reason = skipReasonForChat(chat, settings)
    if (reason) {
      skipped.push({ index: i, memo: chat.memo ?? null, reason })
      continue
    }

    messageIndexes.push(i)
    if (chat.memo) {
      chatMemos.push(chat.memo)
    }
  }

  return {
    startIndex,
    endIndexExclusive,
    messageIndexes,
    chatMemos,
    evaluatedTokenCount,
    skipped,
    tokenDelta: -evaluatedTokenCount,
  }
}

export function determineHypaV3SummarizedPrefixStartIndex(
  chats: readonly MemorySummaryMessage[],
  summaries: readonly HypaV3SummaryRef[],
): number {
  const lastSummary = summaries.at(-1)
  const lastMemo = lastSummary?.chatMemos.at(-1)
  if (!lastMemo) return 0
  const lastChatIndex = chats.findIndex((chat) => chat.memo === lastMemo)
  return lastChatIndex === -1 ? 0 : lastChatIndex + 1
}

function skipReasonForChat(chat: MemorySummaryMessage, settings: HypaV3Settings): HypaV3SkippedMessageReason | null {
  if (chat.name === 'example_user' || chat.name === 'example_assistant' || chat.memo === 'NewChatExample') {
    return 'example'
  }
  if (chat.memo === 'NewChat') return 'new_chat_marker'
  if (chat.content.trim().length === 0) return 'empty'
  if (settings.doNotSummarizeUserMessage && chat.role === 'user') {
    return 'user_message_disabled'
  }
  return null
}

function sumChatTokens(
  chats: readonly MemorySummaryMessage[],
  tokenizeChat: (chat: MemorySummaryMessage) => number,
): number {
  let total = 0
  for (const chat of chats) {
    total += tokenizeChat(chat)
  }
  return total
}

function wrapWithXml(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`
}

function requireRatio(value: number, field: keyof HypaV3Settings, errors: HypaV3SettingsValidationError[]): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push({ field, message: `${field} must be a number from 0 to 1.` })
  }
}

function requirePositiveInteger(
  value: number,
  field: keyof HypaV3Settings,
  errors: HypaV3SettingsValidationError[],
): void {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push({ field, message: `${field} must be a positive integer.` })
  }
}

function requireNonNegativeInteger(
  value: number,
  field: keyof HypaV3Settings,
  errors: HypaV3SettingsValidationError[],
): void {
  if (!Number.isInteger(value) || value < 0) {
    errors.push({ field, message: `${field} must be a non-negative integer.` })
  }
}

function isHypaV3SettingsKey(key: string): key is HypaV3SettingsKey {
  return key in DEFAULT_HYPA_V3_SETTINGS
}

function assignSetting<T extends HypaV3SettingsKey>(settings: HypaV3Settings, key: T, value: unknown): void {
  settings[key] = value as HypaV3Settings[T]
}
