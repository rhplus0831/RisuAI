import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { buildHypaV3SummaryPrompt } from './memorySummaryPrompt.js'
import { normalizeHypaV3Settings, type HypaV3Settings } from './memoryPlanner.js'
import {
  createMemorySummary,
  getMemoryChunk,
  listMemorySummaries,
  updateMemoryChunkStatus,
  type MemoryJob,
} from './memoryRepository.js'
import { summarizeOnce, type SummaryAdapterResult } from './memorySummaryAdapter.js'
import {
  resolveMemorySummaryModel,
  type MemorySummaryModelRequest,
} from './memorySummaryModel.js'
import { loadPersisted } from './repository.js'

export interface SummarizeMemoryJobHandlerOptions {
  db: DatabaseSync
  dataDir?: string
  loadDatabase?: () => unknown
  summarize?: (
    messages: Parameters<typeof summarizeOnce>[0],
    opts: Parameters<typeof summarizeOnce>[1],
  ) => Promise<SummaryAdapterResult>
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
}

export function createSummarizeMemoryJobHandler(
  opts: SummarizeMemoryJobHandlerOptions,
): (job: MemoryJob) => Promise<void> {
  const summarize = opts.summarize ?? summarizeOnce

  return async (job: MemoryJob): Promise<void> => {
    if (job.kind !== 'summarize') {
      throw new Error(`summarize handler received ${job.kind} job`)
    }

    const payload = parseSummarizePayload(job.payload)
    const chunk = getMemoryChunk(opts.db, payload.chunkId)
    if (!chunk) {
      throw new Error(`memory chunk not found: ${payload.chunkId}`)
    }
    if (chunk.chatId !== job.chatId) {
      throw new Error(`memory chunk ${payload.chunkId} does not belong to chat ${job.chatId}`)
    }
    if (chunk.rangeStartSeq !== payload.rangeStartSeq || chunk.rangeEndSeq !== payload.rangeEndSeq) {
      throw new Error(`memory chunk ${payload.chunkId} range does not match summarize payload`)
    }

    const existing = listMemorySummaries(opts.db, {
      chatId: job.chatId,
      chunkId: chunk.id,
      model: payload.model,
    })[0]
    if (existing) {
      updateMemoryChunkStatus(opts.db, chunk.id, 'summarized')
      return
    }

    const database = loadDatabase(opts)
    assertChatExists(database, job.chatId)
    const settings = resolveHypaV3Settings(database)
    const modelRequest = resolveMemorySummaryModel(database, payload.model)
    if (!modelRequest.ok) {
      markChunkFailed(opts.db, chunk.id)
      throw new Error(modelRequest.error)
    }

    const prompt = buildHypaV3SummaryPrompt({
      chunkText: chunk.text,
      settings,
      isResummarize: false,
    })
    const controller = new AbortController()
    const summary = await summarize(prompt.messages, {
      ...modelRequest.request,
      maxTokens: prompt.options.maxTokens,
      temperature: prompt.options.temperature,
      signal: controller.signal,
    })
    if ('error' in summary) {
      markChunkFailed(opts.db, chunk.id)
      throw new Error(summary.error)
    }

    persistSummary(opts.db, {
      job,
      payload,
      request: modelRequest.request,
      text: summary.text,
      tokens: summary.tokens,
    })
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
  if (!Number.isInteger(payload.rangeStartSeq) || payload.rangeStartSeq < 0) {
    throw new Error('summarize payload rangeStartSeq must be a non-negative integer')
  }
  if (!Number.isInteger(payload.rangeEndSeq) || payload.rangeEndSeq < payload.rangeStartSeq) {
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
    rangeStartSeq: payload.rangeStartSeq,
    rangeEndSeq: payload.rangeEndSeq,
    messageIndexes: payload.messageIndexes,
    chatMemos: payload.chatMemos,
  }
}

function loadDatabase(opts: SummarizeMemoryJobHandlerOptions): Database {
  const database = opts.loadDatabase
    ? opts.loadDatabase()
    : opts.dataDir
      ? loadPersisted(opts.dataDir).database
      : null
  if (!isRecord(database)) {
    throw new Error('persisted database is missing')
  }
  return database as Database
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
      model: input.payload.model,
    })[0]
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
