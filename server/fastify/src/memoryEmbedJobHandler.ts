import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { HypaModel } from '../../../src/ts/process/memory/hypamemory'
import { embedTexts, type MemoryEmbeddingAdapterResult } from './memoryEmbeddingAdapter.js'
import {
  resolveMemoryEmbeddingModel,
  type MemoryEmbeddingModelRequest,
} from './memoryEmbeddingModel.js'
import { normalizeHypaV3Settings, type HypaV3Settings } from './memoryPlanner.js'
import {
  createMemoryEmbedding,
  getMemoryChunk,
  getMemoryJob,
  listMemoryEmbeddings,
  type MemoryJob,
} from './memoryRepository.js'
import { loadPersisted } from './repository.js'
import type { MemoryJobBatchHandler } from './memoryWorker.js'

export interface EmbedMemoryJobHandlerOptions {
  db: DatabaseSync
  dataDir?: string
  loadDatabase?: () => unknown
  embed?: (
    opts: Parameters<typeof embedTexts>[0],
  ) => Promise<MemoryEmbeddingAdapterResult | { error: string }>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface HypaV3EmbedJobPayload {
  schemaVersion: 1
  chunkId: string
  model: string
}

interface DatabaseLike {
  hypaV3Presets?: unknown
  hypaV3PresetId?: unknown
  hypaV3Settings?: unknown
}

export function createEmbedMemoryJobHandler(
  opts: EmbedMemoryJobHandlerOptions,
): (job: MemoryJob) => Promise<void> {
  const embed = opts.embed ?? embedTexts
  const acquireRateLimit = createEmbeddingRateLimiter(opts)

  return async (job: MemoryJob): Promise<void> => {
    if (job.kind !== 'embed') {
      throw new Error(`embed handler received ${job.kind} job`)
    }

    const database = loadDatabase(opts)
    const settings = resolveHypaV3Settings(database)
    const result = await executeEmbedJob({
      opts,
      job,
      database,
      settings,
      embed,
      acquireRateLimit,
    })
    if (result.kind === 'existing') return
    persistEmbedding(opts.db, result)
  }
}

export function createEmbedMemoryJobBatchHandler(
  opts: EmbedMemoryJobHandlerOptions,
): MemoryJobBatchHandler {
  const embed = opts.embed ?? embedTexts
  const acquireRateLimit = createEmbeddingRateLimiter(opts)

  return async (firstJob, context): Promise<void> => {
    const database = loadDatabase(opts)
    const settings = resolveHypaV3Settings(database)
    const maxConcurrent = Math.max(1, settings.embeddingMaxConcurrent)
    const jobs = [firstJob]
    while (true) {
      const next = context.claimNext({ chatId: firstJob.chatId, kind: 'embed' })
      if (!next) break
      jobs.push(next)
    }

    const orderedJobs = [...jobs].sort(compareEmbedJobs)
    const results = await runWithConcurrency(orderedJobs, maxConcurrent, async (job) => {
      try {
        return {
          job,
          result: await executeEmbedJob({
            opts,
            job,
            database,
            settings,
            embed,
            acquireRateLimit,
          }),
        } satisfies BatchJobResult
      } catch (error) {
        return {
          job,
          error: error instanceof Error && error.message ? error.message : String(error),
        } satisfies BatchJobResult
      }
    })

    let blockedByFailure: string | null = null
    for (const item of results) {
      if (blockedByFailure !== null) {
        context.retryOrFail(item.job.id, blockedByFailure)
        continue
      }

      if ('error' in item) {
        blockedByFailure = item.error || 'embed job failed'
        context.retryOrFail(item.job.id, blockedByFailure)
        continue
      }

      try {
        if (getMemoryJob(opts.db, item.job.id)?.status !== 'running') {
          blockedByFailure = `embed job ${item.job.id} is no longer running`
          continue
        }
        if (item.result.kind === 'embedding') {
          persistEmbedding(opts.db, item.result)
        }
        context.complete(item.job.id)
      } catch (error) {
        blockedByFailure = error instanceof Error && error.message ? error.message : String(error)
        context.retryOrFail(item.job.id, blockedByFailure)
      }
    }
  }
}

type EmbeddingRateLimiter = (settings: HypaV3Settings) => Promise<void>

type EmbedExecutionResult =
  | {
      kind: 'existing'
      job: MemoryJob
      payload: HypaV3EmbedJobPayload
      chunkId: string
    }
  | {
      kind: 'embedding'
      job: MemoryJob
      payload: HypaV3EmbedJobPayload
      request: MemoryEmbeddingModelRequest
      vector: Float32Array
      dim: number
    }

type BatchJobResult = { job: MemoryJob; result: EmbedExecutionResult } | { job: MemoryJob; error: string }

async function executeEmbedJob(input: {
  opts: EmbedMemoryJobHandlerOptions
  job: MemoryJob
  database: Database
  settings: HypaV3Settings
  embed: NonNullable<EmbedMemoryJobHandlerOptions['embed']>
  acquireRateLimit: EmbeddingRateLimiter
}): Promise<EmbedExecutionResult> {
  const payload = parseEmbedPayload(input.job.payload)
  const chunk = getMemoryChunk(input.opts.db, payload.chunkId)
  if (!chunk) {
    throw new Error(`memory chunk not found: ${payload.chunkId}`)
  }
  if (chunk.chatId !== input.job.chatId) {
    throw new Error(`memory chunk ${payload.chunkId} does not belong to chat ${input.job.chatId}`)
  }

  const existing = listMemoryEmbeddings(input.opts.db, {
    chatId: input.job.chatId,
    chunkId: chunk.id,
    model: payload.model,
    groupId: null,
  })[0]
  if (existing) {
    return { kind: 'existing', job: input.job, payload, chunkId: chunk.id }
  }

  const modelRequest = resolveMemoryEmbeddingModel(input.database, payload.model as HypaModel)
  if (!modelRequest.ok) {
    throw new Error(modelRequest.error)
  }

  const controller = new AbortController()
  await input.acquireRateLimit(input.settings)
  const embedding = await input.embed({
    request: modelRequest.request,
    input: [chunk.text],
    signal: controller.signal,
  })
  if ('error' in embedding) {
    throw new Error(embedding.error)
  }
  const vector = embedding.vectors[0]
  if (!vector) {
    throw new Error('embedding response did not include a vector')
  }

  return {
    kind: 'embedding',
    job: input.job,
    payload,
    request: modelRequest.request,
    vector,
    dim: embedding.dim,
  }
}

function createEmbeddingRateLimiter(opts: EmbedMemoryJobHandlerOptions): EmbeddingRateLimiter {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  let nextRequestAtMs = 0

  return async (settings) => {
    const requestsPerMinute = Math.max(1, settings.embeddingRequestsPerMinute)
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

function compareEmbedJobs(left: MemoryJob, right: MemoryJob): number {
  const leftPayload = tryParseEmbedPayload(left.payload)
  const rightPayload = tryParseEmbedPayload(right.payload)
  if (left.chatId !== right.chatId) return left.chatId.localeCompare(right.chatId)
  if (leftPayload && rightPayload) {
    const chunkDiff = leftPayload.chunkId.localeCompare(rightPayload.chunkId)
    if (chunkDiff !== 0) return chunkDiff
    const modelDiff = leftPayload.model.localeCompare(rightPayload.model)
    if (modelDiff !== 0) return modelDiff
  }
  const createdDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdDiff !== 0) return createdDiff
  return left.id.localeCompare(right.id)
}

function tryParseEmbedPayload(payload: unknown): HypaV3EmbedJobPayload | null {
  try {
    return parseEmbedPayload(payload)
  } catch {
    return null
  }
}

function parseEmbedPayload(payload: unknown): HypaV3EmbedJobPayload {
  if (!isRecord(payload)) throw new Error('embed payload must be an object')
  if (payload.schemaVersion !== 1) throw new Error('embed payload schemaVersion must be 1')
  if (typeof payload.chunkId !== 'string' || payload.chunkId.length === 0) {
    throw new Error('embed payload chunkId must be a non-empty string')
  }
  if (typeof payload.model !== 'string' || payload.model.length === 0) {
    throw new Error('embed payload model must be a non-empty string')
  }
  return {
    schemaVersion: 1,
    chunkId: payload.chunkId,
    model: payload.model,
  }
}

function loadDatabase(opts: EmbedMemoryJobHandlerOptions): Database {
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

function persistEmbedding(
  db: DatabaseSync,
  input: {
    job: MemoryJob
    payload: HypaV3EmbedJobPayload
    request: MemoryEmbeddingModelRequest
    vector: Float32Array
    dim: number
  },
): void {
  if (input.vector.length !== input.dim) {
    throw new Error(`embedding dimension mismatch: expected ${input.dim}, got ${input.vector.length}`)
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = listMemoryEmbeddings(db, {
      chatId: input.job.chatId,
      chunkId: input.payload.chunkId,
      model: input.payload.model,
      groupId: null,
    })[0]
    if (!existing) {
      createMemoryEmbedding(db, {
        id: buildEmbeddingId(input.job.chatId, input.payload.chunkId, input.payload.model),
        chatId: input.job.chatId,
        chunkId: input.payload.chunkId,
        model: input.payload.model,
        vector: input.vector,
      })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function buildEmbeddingId(chatId: string, chunkId: string, model: string): string {
  return `hypav3-embedding-${shortHash(JSON.stringify({ chatId, chunkId, model }))}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
