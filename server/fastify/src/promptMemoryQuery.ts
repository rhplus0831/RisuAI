import type { DatabaseSync } from 'node:sqlite'
import type { Database, Message } from '../../../src/ts/storage/database.svelte'
import { embedTextGroups, embedTexts } from './memoryEmbeddingAdapter.js'
import { resolveMemoryEmbeddingModel } from './memoryEmbeddingModel.js'
import { normalizeHypaV3Settings, type HypaV3Settings } from './memoryPlanner.js'
import { armMemoryProviderFetchDeadline, resolveMemoryProviderFetchDeadlineMs } from './memoryProviderDeadline.js'
import { listMemoryEmbeddings, listMemorySummaries } from './memoryRepository.js'
import { filterMemorySummariesForModel } from './memorySummaryCompatibility.js'

export type PromptMemoryQueryStatus = 'skipped' | 'success' | 'failed' | 'timed-out' | 'aborted'

export type PromptMemoryQuerySkipReason =
  | 'feature-disabled'
  | 'similarity-disabled'
  | 'no-embedded-summaries'
  | 'no-query-texts'

export interface PromptMemoryQueryDiagnostics {
  status: PromptMemoryQueryStatus
  skipReason: PromptMemoryQuerySkipReason | null
  providerCallAttempted: boolean
  queryTexts: number
  vectors: number
  embeddingModel: string | null
  deadlineMs: number
  error: string | null
}

export interface PromptMemoryQueryPrefetchResult {
  vectors: Float32Array[]
  diagnostics: PromptMemoryQueryDiagnostics
}

export interface PromptMemoryQuerySourceInput {
  chatId: string
  characterId: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  regenerateMessageId?: string
  userMessage?: string
}

export interface PrefetchPromptMemoryQueryInput {
  db: DatabaseSync
  database: Database
  input: PromptMemoryQuerySourceInput
  signal?: AbortSignal
  deadlineMs?: number
  embed?: typeof embedTexts
  embedGroups?: typeof embedTextGroups
}

interface SettledEmbedding<T> {
  value?: T
  error?: unknown
  aborted: boolean
}

export function emptyPromptMemoryQueryDiagnostics(
  deadlineMs?: number,
  skipReason: PromptMemoryQuerySkipReason = 'feature-disabled',
): PromptMemoryQueryDiagnostics {
  return {
    status: 'skipped',
    skipReason,
    providerCallAttempted: false,
    queryTexts: 0,
    vectors: 0,
    embeddingModel: null,
    deadlineMs: resolveMemoryProviderFetchDeadlineMs(deadlineMs),
    error: null,
  }
}

/**
 * Build the baseline Hypa V3 similarity queries and embed them before prompt
 * assembly. Provider/configuration/deadline failures are deliberately data:
 * callers receive an empty vector list plus diagnostics and generation can
 * continue through the existing non-similarity allocation path.
 */
export async function prefetchPromptMemoryQueryVectors(
  input: PrefetchPromptMemoryQueryInput,
): Promise<PromptMemoryQueryPrefetchResult> {
  const deadlineMs = resolveMemoryProviderFetchDeadlineMs(input.deadlineMs)
  const character = input.database.characters.find((candidate) => candidate.chaId === input.input.characterId)
  if (input.database.hypaV3 !== true || character?.supaMemory !== true) {
    return { vectors: [], diagnostics: emptyPromptMemoryQueryDiagnostics(deadlineMs, 'feature-disabled') }
  }

  const settings = normalizeHypaV3Settings(resolveHypaV3PresetSettings(input.database)).settings
  if (settings.similarMemoryRatio <= 0) {
    return { vectors: [], diagnostics: emptyPromptMemoryQueryDiagnostics(deadlineMs, 'similarity-disabled') }
  }

  const embeddingModel = input.database.hypaModel || 'MiniLM'
  const baseDiagnostics: PromptMemoryQueryDiagnostics = {
    status: 'skipped',
    skipReason: null,
    providerCallAttempted: false,
    queryTexts: 0,
    vectors: 0,
    embeddingModel,
    deadlineMs,
    error: null,
  }

  try {
    const summaries = filterMemorySummariesForModel(
      listMemorySummaries(input.db, { chatId: input.input.chatId }),
      settings.summarizationModel,
    )
    const summaryChunkIds = new Set(summaries.map((summary) => summary.chunkId))
    const hasEmbeddedSummary = listMemoryEmbeddings(input.db, {
      chatId: input.input.chatId,
      model: embeddingModel,
    }).some((embedding) => summaryChunkIds.has(embedding.chunkId))
    if (!hasEmbeddedSummary) {
      return {
        vectors: [],
        diagnostics: { ...baseDiagnostics, skipReason: 'no-embedded-summaries' },
      }
    }

    const queryTexts = buildPromptMemoryQueryTexts(input.database, input.input, settings.queryChatCount)
    if (queryTexts.length === 0) {
      return {
        vectors: [],
        diagnostics: { ...baseDiagnostics, skipReason: 'no-query-texts' },
      }
    }

    const model = resolveMemoryEmbeddingModel(input.database)
    if (model.ok === false) {
      return {
        vectors: [],
        diagnostics: {
          ...baseDiagnostics,
          status: 'failed',
          queryTexts: queryTexts.length,
          error: model.error,
        },
      }
    }

    const deadlineController = new AbortController()
    const combinedSignal = input.signal
      ? AbortSignal.any([deadlineController.signal, input.signal])
      : deadlineController.signal
    const clearDeadline = armMemoryProviderFetchDeadline(deadlineController, deadlineMs)
    const run =
      model.request.provider === 'voyage-contextual'
        ? (input.embedGroups ?? embedTextGroups)({
            request: model.request,
            groups: queryTexts.map((text) => [text]),
            inputType: 'query',
            signal: combinedSignal,
          }).then((result) => {
            if ('error' in result) return result
            return {
              model: result.model,
              vectors: result.groups.flatMap((group) => (group[0] ? [group[0]] : [])),
              dim: result.dim,
            }
          })
        : (input.embed ?? embedTexts)({
            request: model.request,
            input: queryTexts,
            signal: combinedSignal,
          })

    let settled: SettledEmbedding<Awaited<typeof run>>
    try {
      settled = await settleEmbedding(run, combinedSignal)
    } finally {
      clearDeadline()
    }

    if (settled.aborted) {
      const timedOut = deadlineController.signal.aborted && input.signal?.aborted !== true
      return {
        vectors: [],
        diagnostics: {
          ...baseDiagnostics,
          status: timedOut ? 'timed-out' : 'aborted',
          providerCallAttempted: true,
          queryTexts: queryTexts.length,
          error: timedOut ? `prompt memory query embedding timed out after ${deadlineMs}ms` : 'aborted',
        },
      }
    }
    if (settled.error) {
      return {
        vectors: [],
        diagnostics: {
          ...baseDiagnostics,
          status: 'failed',
          providerCallAttempted: true,
          queryTexts: queryTexts.length,
          error: errorMessage(settled.error),
        },
      }
    }

    const result = settled.value
    if (!result || 'error' in result) {
      return {
        vectors: [],
        diagnostics: {
          ...baseDiagnostics,
          status: 'failed',
          providerCallAttempted: true,
          queryTexts: queryTexts.length,
          error: result?.error ?? 'embedding provider returned no result',
        },
      }
    }
    if (result.vectors.length !== queryTexts.length) {
      return {
        vectors: [],
        diagnostics: {
          ...baseDiagnostics,
          status: 'failed',
          providerCallAttempted: true,
          queryTexts: queryTexts.length,
          error: `embedding response count mismatch: expected ${queryTexts.length}, got ${result.vectors.length}`,
        },
      }
    }

    return {
      vectors: result.vectors,
      diagnostics: {
        ...baseDiagnostics,
        status: 'success',
        providerCallAttempted: true,
        queryTexts: queryTexts.length,
        vectors: result.vectors.length,
      },
    }
  } catch (error) {
    return {
      vectors: [],
      diagnostics: {
        ...baseDiagnostics,
        status: 'failed',
        error: errorMessage(error),
      },
    }
  }
}

export function buildPromptMemoryQueryTexts(
  database: Database,
  input: PromptMemoryQuerySourceInput,
  queryChatCount: number,
): string[] {
  const character = database.characters.find((candidate) => candidate.chaId === input.characterId)
  const chat = character?.chats.find((candidate) => candidate.id === input.chatId)
  if (!chat) return []

  const messages = prepareQueryMessages(chat.message ?? [], input)
  const enabledMessages = messagesFromLastReset(messages)
  const recentMessages = queryChatCount === 0 ? enabledMessages : enabledMessages.slice(-queryChatCount)
  return recentMessages.flatMap((message) => {
    const text = typeof message.data === 'string' ? message.data : ''
    return text.trim().length > 0 ? [text] : []
  })
}

function prepareQueryMessages(
  source: readonly Message[],
  input: PromptMemoryQuerySourceInput,
): Array<Pick<Message, 'role' | 'data' | 'chatId' | 'name' | 'disabled' | 'saying'>> {
  const messages = source.map((message) => ({
    role: message.role,
    data: message.data,
    chatId: message.chatId,
    name: message.name,
    disabled: message.disabled,
    saying: message.saying,
  }))

  if (input.mode === 'regenerate' && input.regenerateMessageId) {
    const targetIndex = messages.findIndex((message) => message.chatId === input.regenerateMessageId)
    if (targetIndex === messages.length - 1 && messages[targetIndex]?.role !== 'user') {
      const saying = messages[targetIndex]?.saying
      let sayingQuota = 2
      while (messages.length > 0 && messages.at(-1)?.role !== 'user') {
        if (messages.at(-1)?.saying === saying) {
          sayingQuota -= 1
          if (sayingQuota === 0) break
        }
        messages.pop()
      }
    }
  }

  if (input.mode === 'send' && typeof input.userMessage === 'string') {
    const last = messages.at(-1)
    const alreadyAppended =
      last?.role === 'user' && last.data === input.userMessage && (last.name === null || last.name === undefined)
    if (!alreadyAppended) {
      messages.push({
        role: 'user',
        data: input.userMessage,
        chatId: undefined,
        name: undefined,
        disabled: false,
        saying: undefined,
      })
    }
  }

  return messages
}

function messagesFromLastReset<T extends Pick<Message, 'disabled'>>(messages: readonly T[]): T[] {
  const enabled: T[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.disabled === true) continue
    if (message.disabled === 'allBefore') break
    enabled.unshift(message)
  }
  return enabled
}

function resolveHypaV3PresetSettings(database: Database): Partial<HypaV3Settings> | null | undefined {
  const presetId = typeof database.hypaV3PresetId === 'number' ? database.hypaV3PresetId : 0
  const preset = database.hypaV3Presets?.[presetId]
  if (preset && typeof preset === 'object' && 'settings' in preset) {
    return preset.settings as Partial<HypaV3Settings>
  }
  return database.hypaV3Settings as Partial<HypaV3Settings> | null | undefined
}

async function settleEmbedding<T>(promise: Promise<T>, signal: AbortSignal): Promise<SettledEmbedding<T>> {
  if (signal.aborted) return { aborted: true }
  return await new Promise((resolve) => {
    let settled = false
    const finish = (result: SettledEmbedding<T>): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish({ aborted: true })
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => finish({ value, aborted: false }),
      (error) => finish({ error, aborted: false }),
    )
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return 'prompt memory query embedding failed'
}
