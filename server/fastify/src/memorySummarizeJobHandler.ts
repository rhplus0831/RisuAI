import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyChat as Chat, FastifyDatabase as Database } from './prompt/serverTypes.js'
import { buildHypaV3SummaryPrompt } from './memorySummaryPrompt.js'
import { normalizeHypaV3Settings, type HypaV3Settings } from './memoryPlanner.js'
import {
  createMemorySummary,
  getMemoryChunk,
  getMemoryJob,
  listMemorySummaries,
  updateMemoryChunkStatus,
  type MemoryJob,
} from './memoryRepository.js'
import { isMemorySummaryCompatibleWithModel } from './memorySummaryCompatibility.js'
import { summarizeOnce, type SummaryAdapterResult } from './memorySummaryAdapter.js'
import { resolveMemorySummaryModel, type MemorySummaryModelRequest } from './memorySummaryModel.js'
import { loadPersistedDatabaseForMemoryJob } from './repository.js'
import { MEMORY_JOB_BATCH_MAX_JOBS, type MemoryJobBatchHandler, type MemoryJobHandlerContext } from './memoryWorker.js'
import { createMemoryProviderAbortScope, throwIfMemoryProviderAborted } from './memoryProviderDeadline.js'
import { resolveModelProfile } from '@risuai/shared-core/model-profile-resolver'
import {
  completeRequestHistory,
  requestHistoryProfileSnapshot,
  tryBeginRequestHistory,
  type RequestHistoryContext,
} from './requestHistory.js'
import { applyEffectivePresetComposition } from '@risuai/shared-core/preset-split'

export interface SummarizeMemoryJobHandlerOptions {
  db: DatabaseSync
  dataDir?: string
  loadDatabase?: () => unknown
  summarize?: (
    messages: Parameters<typeof summarizeOnce>[0],
    opts: Parameters<typeof summarizeOnce>[1],
  ) => Promise<SummaryAdapterResult>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Provider-call deadline override for tests; production uses a generous shared default. */
  providerFetchDeadlineMs?: number
}

interface HypaV3SummarizeJobPayload {
  schemaVersion: 1
  chunkId: string
  model: string
  rangeStartSeq: number
  rangeEndSeq: number
  messageIndexes: number[]
  chatMemos: string[]
}

interface DatabaseLike {
  hypaV3Presets?: unknown
  hypaV3PresetId?: unknown
  hypaV3Settings?: unknown
  characters?: unknown
}

interface ChatLike {
  id?: unknown
  generationSettings?: {
    modelPresetId?: string
    promptPresetId?: string
  }
}

export function createSummarizeMemoryJobHandler(
  opts: SummarizeMemoryJobHandlerOptions,
): (job: MemoryJob, context?: MemoryJobHandlerContext) => Promise<void> {
  const summarize = opts.summarize ?? summarizeOnce
  const acquireRateLimit = createSummaryRateLimiter(opts)

  return async (job: MemoryJob, context?: MemoryJobHandlerContext): Promise<void> => {
    if (job.kind !== 'summarize') {
      throw new Error(`summarize handler received ${job.kind} job`)
    }

    const database = resolveChatBoundMemoryDatabase(loadDatabase(opts, job.chatId), job.chatId)
    const settings = resolveHypaV3Settings(database)
    const result = await executeSummarizeJob({
      opts,
      job,
      database,
      settings,
      summarize,
      acquireRateLimit,
      signal: context?.signal,
    })
    if (result.kind === 'existing') return
    const currentJob = getMemoryJob(opts.db, job.id)
    if (currentJob?.status !== 'pending' && currentJob?.status !== 'running') return
    persistSummary(opts.db, result)
  }
}

export function createSummarizeMemoryJobBatchHandler(opts: SummarizeMemoryJobHandlerOptions): MemoryJobBatchHandler {
  const summarize = opts.summarize ?? summarizeOnce
  const acquireRateLimit = createSummaryRateLimiter(opts)

  return async (firstJob, context): Promise<void> => {
    const database = resolveChatBoundMemoryDatabase(loadDatabase(opts, firstJob.chatId), firstJob.chatId)
    const settings = resolveHypaV3Settings(database)
    const maxConcurrent = Math.max(1, settings.summarizationMaxConcurrent)
    const jobs = [firstJob]
    // Bounded drain leave any overflow pending for later
    // ticks instead of holding the single-flight worker for one chat's
    // whole backlog.
    while (jobs.length < MEMORY_JOB_BATCH_MAX_JOBS) {
      const next = context.claimNext({ chatId: firstJob.chatId, kind: 'summarize' })
      if (!next) break
      jobs.push(next)
    }

    const orderedJobs = [...jobs].sort(compareSummarizeJobs)
    const results = await runWithConcurrency(orderedJobs, maxConcurrent, async (job) => {
      try {
        return {
          job,
          result: await executeSummarizeJob({
            opts,
            job,
            database,
            settings,
            summarize,
            acquireRateLimit,
            signal: context.signalFor(job.id),
          }),
        } satisfies BatchJobResult
      } catch (error) {
        return {
          job,
          error: error instanceof Error && error.message ? error.message : String(error),
        } satisfies BatchJobResult
      }
    })

    for (const item of results) {
      if ('error' in item) {
        context.retryOrFail(item.job.id, item.error || 'summarize job failed')
        continue
      }

      try {
        if (getMemoryJob(opts.db, item.job.id)?.status !== 'running') {
          continue
        }
        if (item.result.kind === 'summary') {
          persistSummary(opts.db, item.result)
        }
        context.complete(item.job.id)
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : String(error)
        context.retryOrFail(item.job.id, message)
      }
    }
  }
}

type SummaryRateLimiter = (settings: HypaV3Settings) => Promise<void>

type SummarizeExecutionResult =
  | {
      kind: 'existing'
      job: MemoryJob
      payload: HypaV3SummarizeJobPayload
      chunkId: string
    }
  | {
      kind: 'summary'
      job: MemoryJob
      payload: HypaV3SummarizeJobPayload
      request: MemorySummaryModelRequest
      text: string
      tokens: number
    }

type BatchJobResult = { job: MemoryJob; result: SummarizeExecutionResult } | { job: MemoryJob; error: string }

async function executeSummarizeJob(input: {
  opts: SummarizeMemoryJobHandlerOptions
  job: MemoryJob
  database: Database
  settings: HypaV3Settings
  summarize: NonNullable<SummarizeMemoryJobHandlerOptions['summarize']>
  acquireRateLimit: SummaryRateLimiter
  signal?: AbortSignal
}): Promise<SummarizeExecutionResult> {
  const payload = parseSummarizePayload(input.job.payload)
  const chunk = getMemoryChunk(input.opts.db, payload.chunkId)
  if (!chunk) {
    throw new Error(`memory chunk not found: ${payload.chunkId}`)
  }
  if (chunk.chatId !== input.job.chatId) {
    throw new Error(`memory chunk ${payload.chunkId} does not belong to chat ${input.job.chatId}`)
  }
  if (chunk.rangeStartSeq !== payload.rangeStartSeq || chunk.rangeEndSeq !== payload.rangeEndSeq) {
    throw new Error(`memory chunk ${payload.chunkId} range does not match summarize payload`)
  }

  const existing = listMemorySummaries(input.opts.db, {
    chatId: input.job.chatId,
    chunkId: chunk.id,
  }).find((summary) => isMemorySummaryCompatibleWithModel(summary, payload.model))
  if (existing) {
    updateMemoryChunkStatus(input.opts.db, chunk.id, 'summarized')
    return { kind: 'existing', job: input.job, payload, chunkId: chunk.id }
  }

  assertChatExists(input.database, input.job.chatId)
  const modelRequest = resolveMemorySummaryModel(input.database, payload.model)
  if (modelRequest.ok === false) {
    markChunkFailed(input.opts.db, chunk.id)
    throw new Error(modelRequest.error)
  }

  const prompt = buildHypaV3SummaryPrompt({
    chunkText: chunk.text,
    settings: input.settings,
    isResummarize: false,
  })
  await input.acquireRateLimit(input.settings)
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error ? input.signal.reason : new Error('memory job cancelled')
  }
  const abortScope = createMemoryProviderAbortScope(input.signal, input.opts.providerFetchDeadlineMs)
  let summary: SummaryAdapterResult
  const historyScope = memoryRequestHistoryScope(input.database, input.job.chatId)
  const historyHandle = tryBeginRequestHistory({
    db: input.opts.db,
    limit: input.database.requestHistoryLimit,
    source: 'memory-summary',
    profile: requestHistoryProfileSnapshot(resolveModelProfile({ database: input.database, role: 'memory' })),
    prompt: prompt.messages,
    context: historyScope.context,
    toggles: historyScope.toggles,
    metadata: {
      memoryJobId: input.job.id,
      memoryChunkId: chunk.id,
      rangeStartSeq: chunk.rangeStartSeq,
      rangeEndSeq: chunk.rangeEndSeq,
      responseBudget: prompt.options.maxTokens,
      provider: modelRequest.request.provider,
      requestModel: modelRequest.request.model,
    },
  })
  try {
    throwIfMemoryProviderAborted(abortScope.signal)
    summary = await input.summarize(prompt.messages, {
      ...modelRequest.request,
      maxTokens: prompt.options.maxTokens,
      temperature: prompt.options.temperature,
      signal: abortScope.signal,
    })
    if ('error' in summary) {
      completeRequestHistory(historyHandle, {
        status: abortScope.signal.aborted ? 'cancelled' : 'error',
        error: summary.error,
      })
    } else {
      completeRequestHistory(historyHandle, {
        status: 'success',
        response: summary.text,
        metadata: { outputTokens: summary.tokens },
      })
    }
  } catch (error) {
    completeRequestHistory(historyHandle, {
      status: abortScope.signal.aborted ? 'cancelled' : 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    abortScope.dispose()
  }
  if ('error' in summary) {
    markChunkFailed(input.opts.db, chunk.id)
    throw new Error(summary.error)
  }

  return {
    kind: 'summary',
    job: input.job,
    payload,
    request: modelRequest.request,
    text: summary.text,
    tokens: summary.tokens,
  }
}

function memoryRequestHistoryScope(
  database: Database,
  chatId: string,
): { context: RequestHistoryContext; toggles?: Record<string, string> } {
  for (const character of database.characters ?? []) {
    const chat = character.chats?.find((candidate: Chat) => candidate.id === chatId)
    if (!chat) continue
    return {
      context: {
        characterId: character.chaId,
        characterName: character.name,
        chatId,
        ...(chat.name ? { chatName: chat.name } : {}),
      },
      ...(chat.generationSettings?.sidebarToggles ? { toggles: { ...chat.generationSettings.sidebarToggles } } : {}),
    }
  }
  return { context: { chatId } }
}

function createSummaryRateLimiter(opts: SummarizeMemoryJobHandlerOptions): SummaryRateLimiter {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  let nextRequestAtMs = 0

  return async (settings) => {
    const requestsPerMinute = Math.max(1, settings.summarizationRequestsPerMinute)
    const intervalMs = Math.ceil(60_000 / requestsPerMinute)
    const current = now()
    const waitMs = Math.max(0, nextRequestAtMs - current)
    nextRequestAtMs = Math.max(current, nextRequestAtMs) + intervalMs
    if (waitMs > 0) await sleep(waitMs)
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await run(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function compareSummarizeJobs(left: MemoryJob, right: MemoryJob): number {
  const leftPayload = tryParseSummarizePayload(left.payload)
  const rightPayload = tryParseSummarizePayload(right.payload)
  if (left.chatId !== right.chatId) return left.chatId.localeCompare(right.chatId)
  if (leftPayload && rightPayload) {
    const startDiff = leftPayload.rangeStartSeq - rightPayload.rangeStartSeq
    if (startDiff !== 0) return startDiff
    const endDiff = leftPayload.rangeEndSeq - rightPayload.rangeEndSeq
    if (endDiff !== 0) return endDiff
  }
  const createdDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdDiff !== 0) return createdDiff
  return left.id.localeCompare(right.id)
}

function tryParseSummarizePayload(payload: unknown): HypaV3SummarizeJobPayload | null {
  try {
    return parseSummarizePayload(payload)
  } catch {
    return null
  }
}

function parseSummarizePayload(payload: unknown): HypaV3SummarizeJobPayload {
  if (!isRecord(payload)) throw new Error('summarize payload must be an object')
  if (payload.schemaVersion !== 1) throw new Error('summarize payload schemaVersion must be 1')
  if (typeof payload.chunkId !== 'string' || payload.chunkId.length === 0) {
    throw new Error('summarize payload chunkId must be a non-empty string')
  }
  if (typeof payload.model !== 'string' || payload.model.length === 0) {
    throw new Error('summarize payload model must be a non-empty string')
  }
  const rangeStartSeq = payload.rangeStartSeq
  if (typeof rangeStartSeq !== 'number' || !Number.isInteger(rangeStartSeq) || rangeStartSeq < 0) {
    throw new Error('summarize payload rangeStartSeq must be a non-negative integer')
  }
  const rangeEndSeq = payload.rangeEndSeq
  if (typeof rangeEndSeq !== 'number' || !Number.isInteger(rangeEndSeq) || rangeEndSeq < rangeStartSeq) {
    throw new Error('summarize payload rangeEndSeq must be >= rangeStartSeq')
  }
  if (!isIntegerArray(payload.messageIndexes)) {
    throw new Error('summarize payload messageIndexes must be an integer array')
  }
  if (!isStringArray(payload.chatMemos)) {
    throw new Error('summarize payload chatMemos must be a string array')
  }
  return {
    schemaVersion: 1,
    chunkId: payload.chunkId,
    model: payload.model,
    rangeStartSeq,
    rangeEndSeq,
    messageIndexes: payload.messageIndexes,
    chatMemos: payload.chatMemos,
  }
}

function loadDatabase(opts: SummarizeMemoryJobHandlerOptions, chatId: string): Database {
  // The default scoped read keeps only the target chat's generation settings
  // and bound model/prompt preset rows; sibling chats remain id-only stubs.
  const database = opts.loadDatabase
    ? opts.loadDatabase()
    : opts.dataDir
      ? loadPersistedDatabaseForMemoryJob(opts.db, opts.dataDir, chatId)
      : null
  if (!isRecord(database)) {
    throw new Error('persisted database is missing')
  }
  return database as unknown as Database
}

function resolveChatBoundMemoryDatabase(database: Database, chatId: string): Database {
  const chat = findChatById(database, chatId)
  const modelPresetId = chat?.generationSettings?.modelPresetId?.trim()
  if (!modelPresetId) return database

  const modelPreset = database.modelPresets?.find((preset: Record<string, any>) => preset?.id === modelPresetId)
  if (!modelPreset) {
    throw new Error(`model preset ${modelPresetId} bound to chat ${chatId} was not found`)
  }

  const promptPresetId = chat?.generationSettings?.promptPresetId?.trim()
  const promptPreset = promptPresetId
    ? database.promptPresets?.find((preset: Record<string, any>) => preset?.id === promptPresetId)
    : undefined
  if (promptPresetId && !promptPreset) {
    throw new Error(`prompt preset ${promptPresetId} bound to chat ${chatId} was not found`)
  }
  const effectiveDatabase = structuredClone(database) as Database
  applyEffectivePresetComposition(effectiveDatabase as unknown as Record<string, unknown>, {
    modelPreset,
    promptPreset,
    scope: 'model-runtime',
  })
  return effectiveDatabase
}

function findChatById(database: Database, chatId: string): ChatLike | undefined {
  for (const character of database.characters ?? []) {
    const chat = character.chats?.find((candidate: Chat) => candidate.id === chatId)
    if (chat) return chat
  }
  return undefined
}

function resolveHypaV3Settings(database: Database): HypaV3Settings {
  const db = database as DatabaseLike
  let rawSettings: unknown = db.hypaV3Settings
  const presetId = typeof db.hypaV3PresetId === 'number' ? db.hypaV3PresetId : 0
  if (Array.isArray(db.hypaV3Presets)) {
    const preset = db.hypaV3Presets[presetId]
    if (isRecord(preset)) rawSettings = preset.settings
  }
  return normalizeHypaV3Settings(isRecord(rawSettings) ? rawSettings : null).settings
}

function assertChatExists(database: Database, chatId: string): void {
  const db = database as DatabaseLike
  if (!Array.isArray(db.characters)) {
    throw new Error(`chat data not found for chat ${chatId}`)
  }
  for (const character of db.characters) {
    if (!isRecord(character) || !Array.isArray(character.chats)) continue
    for (const chat of character.chats as ChatLike[]) {
      if (chat?.id === chatId) return
    }
  }
  throw new Error(`chat data not found for chat ${chatId}`)
}

function persistSummary(
  db: DatabaseSync,
  input: {
    job: MemoryJob
    payload: HypaV3SummarizeJobPayload
    request: MemorySummaryModelRequest
    text: string
    tokens: number
  },
): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = listMemorySummaries(db, {
      chatId: input.job.chatId,
      chunkId: input.payload.chunkId,
    }).find((summary) => isMemorySummaryCompatibleWithModel(summary, input.payload.model))
    if (!existing) {
      createMemorySummary(db, {
        id: buildSummaryId(input.job.chatId, input.payload.chunkId, input.payload.model),
        chatId: input.job.chatId,
        chunkId: input.payload.chunkId,
        model: input.payload.model,
        text: input.text,
        tokens: input.tokens,
        metadata: {
          source: 'hypav3-summarize-job',
          provider: input.request.provider,
          providerModel: input.request.model,
          jobId: input.job.id,
          rangeStartSeq: input.payload.rangeStartSeq,
          rangeEndSeq: input.payload.rangeEndSeq,
          messageIndexes: input.payload.messageIndexes,
          chatMemos: input.payload.chatMemos,
        },
      })
    }
    updateMemoryChunkStatus(db, input.payload.chunkId, 'summarized')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    markChunkFailed(db, input.payload.chunkId)
    throw error
  }
}

function markChunkFailed(db: DatabaseSync, chunkId: string): void {
  if (getMemoryChunk(db, chunkId)) {
    updateMemoryChunkStatus(db, chunkId, 'failed')
  }
}

function buildSummaryId(chatId: string, chunkId: string, model: string): string {
  return `hypav3-summary-${shortHash(JSON.stringify({ chatId, chunkId, model }))}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
