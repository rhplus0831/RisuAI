import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { HypaModel } from '../../../src/ts/process/memory/hypamemory'
import {
  embedTextGroups,
  embedTexts,
  type MemoryEmbeddingAdapterResult,
} from './memoryEmbeddingAdapter.js'
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
import { loadPersistedDatabaseForMemoryJob } from './repository.js'
import { MEMORY_JOB_BATCH_MAX_JOBS, type MemoryJobBatchHandler } from './memoryWorker.js'

/**
 * Default token budget per contextual (`voyageContext3`) sub-batch request
 * (audit M7). Approximated at ~4 chars/token; conservative against the
 * provider's request limits so a long imported chat's first embedding pass
 * never materializes into one uncapped request.
 */
export const CONTEXTUAL_EMBED_SUB_BATCH_TOKEN_BUDGET = 12_000

export interface EmbedMemoryJobHandlerOptions {
  db: DatabaseSync
  dataDir?: string
  loadDatabase?: () => unknown
  embed?: (
    opts: Parameters<typeof embedTexts>[0],
  ) => Promise<MemoryEmbeddingAdapterResult | { error: string }>
  embedGroups?: (
    opts: Parameters<typeof embedTextGroups>[0],
  ) => Promise<Awaited<ReturnType<typeof embedTextGroups>>>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Token budget per contextual sub-batch (test seam; defaults to
   *  {@link CONTEXTUAL_EMBED_SUB_BATCH_TOKEN_BUDGET}). */
  contextualSubBatchTokenBudget?: number
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
  const embedGroups = opts.embedGroups ?? embedTextGroups
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
      embedGroups,
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
  const embedGroups = opts.embedGroups ?? embedTextGroups
  const acquireRateLimit = createEmbeddingRateLimiter(opts)

  return async (firstJob, context): Promise<void> => {
    const database = loadDatabase(opts)
    const settings = resolveHypaV3Settings(database)
    const maxConcurrent = Math.max(1, settings.embeddingMaxConcurrent)
    const jobs = [firstJob]
    // Bounded drain (audit M7/L17): leave any overflow pending for later
    // ticks instead of materializing one chat's whole backlog into a single
    // batch (and a single worker turn).
    while (jobs.length < MEMORY_JOB_BATCH_MAX_JOBS) {
      const next = context.claimNext({ chatId: firstJob.chatId, kind: 'embed' })
      if (!next) break
      jobs.push(next)
    }

    const orderedJobs = [...jobs].sort(compareEmbedJobs)
    if (isContextualVoyageBatch(orderedJobs)) {
      // Token-aware sub-batches, each committed independently (audit M7): an
      // oversized or failing sub-batch retries alone instead of failing the
      // unrelated chunks drained alongside it.
      for (const subBatch of planContextualSubBatches(opts, orderedJobs)) {
        const results = await executeContextualEmbedJobs({
          opts,
          jobs: subBatch,
          database,
          settings,
          embedGroups,
          acquireRateLimit,
        })
        commitBatchResults(opts, context, results)
      }
      return
    }

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
            embedGroups,
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

    commitBatchResults(opts, context, results)
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
      groupId: string | null
      groupIndex: number | null
    }

type BatchJobResult =
  | { job: MemoryJob; result: EmbedExecutionResult }
  | { job: MemoryJob; error: string }

async function executeEmbedJob(input: {
  opts: EmbedMemoryJobHandlerOptions
  job: MemoryJob
  database: Database
  settings: HypaV3Settings
  embed: NonNullable<EmbedMemoryJobHandlerOptions['embed']>
  embedGroups: NonNullable<EmbedMemoryJobHandlerOptions['embedGroups']>
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

  const isContextualModel = payload.model === 'voyageContext3'
  const existing = listMemoryEmbeddings(input.opts.db, {
    chatId: input.job.chatId,
    chunkId: chunk.id,
    model: payload.model,
    ...(isContextualModel ? {} : { groupId: null }),
  })[0]
  if (existing) {
    return { kind: 'existing', job: input.job, payload, chunkId: chunk.id }
  }

  const modelRequest = resolveMemoryEmbeddingModel(input.database, payload.model as HypaModel)
  if (modelRequest.ok === false) {
    throw new Error(modelRequest.error)
  }

  const controller = new AbortController()
  await input.acquireRateLimit(input.settings)
  if (modelRequest.request.provider === 'voyage-contextual') {
    const embedding = await input.embedGroups({
      request: modelRequest.request,
      groups: [[chunk.text]],
      signal: controller.signal,
    })
    if ('error' in embedding) {
      throw new Error(embedding.error)
    }
    const vector = embedding.groups[0]?.[0]
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
      groupId: buildEmbeddingGroupId(input.job.chatId, payload.model, [chunk.id]),
      groupIndex: 0,
    }
  }

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
    groupId: null,
    groupIndex: null,
  }
}

/** ~4 chars/token approximation for contextual sub-batch sizing (M7). */
function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Slice an ordered contextual batch into token-aware sub-batches (audit M7).
 * Greedy walk in batch order: a sub-batch closes once adding the next chunk
 * would exceed the token budget (an oversized single chunk still travels
 * alone). A job whose chunk cannot be resolved is isolated into its own
 * sub-batch, so `executeContextualEmbedJobs` fails just that job with the
 * existing error message instead of poisoning unrelated chunks.
 */
function planContextualSubBatches(
  opts: EmbedMemoryJobHandlerOptions,
  jobs: readonly MemoryJob[],
): MemoryJob[][] {
  const budget = Math.max(
    1,
    opts.contextualSubBatchTokenBudget ?? CONTEXTUAL_EMBED_SUB_BATCH_TOKEN_BUDGET,
  )
  const subBatches: MemoryJob[][] = []
  let current: MemoryJob[] = []
  let currentTokens = 0
  const flush = (): void => {
    if (current.length > 0) {
      subBatches.push(current)
      current = []
      currentTokens = 0
    }
  }
  for (const job of jobs) {
    const payload = tryParseEmbedPayload(job.payload)
    const chunk = payload ? getMemoryChunk(opts.db, payload.chunkId) : null
    if (!chunk || chunk.chatId !== job.chatId) {
      flush()
      subBatches.push([job])
      continue
    }
    const tokens = approximateTokenCount(chunk.text)
    if (current.length > 0 && currentTokens + tokens > budget) {
      flush()
    }
    current.push(job)
    currentTokens += tokens
  }
  flush()
  return subBatches
}

async function executeContextualEmbedJobs(input: {
  opts: EmbedMemoryJobHandlerOptions
  jobs: readonly MemoryJob[]
  database: Database
  settings: HypaV3Settings
  embedGroups: NonNullable<EmbedMemoryJobHandlerOptions['embedGroups']>
  acquireRateLimit: EmbeddingRateLimiter
}): Promise<BatchJobResult[]> {
  try {
    const parsed = input.jobs.map((job) => {
      const payload = parseEmbedPayload(job.payload)
      const chunk = getMemoryChunk(input.opts.db, payload.chunkId)
      if (!chunk) {
        throw new Error(`memory chunk not found: ${payload.chunkId}`)
      }
      if (chunk.chatId !== job.chatId) {
        throw new Error(`memory chunk ${payload.chunkId} does not belong to chat ${job.chatId}`)
      }
      return { job, payload, chunk }
    })

    const modelRequest = resolveMemoryEmbeddingModel(input.database, 'voyageContext3')
    if (modelRequest.ok === false) {
      throw new Error(modelRequest.error)
    }

    const groupChunkIds = parsed.map((item) => item.chunk.id)
    const groupId = buildEmbeddingGroupId(input.jobs[0].chatId, 'voyageContext3', groupChunkIds)
    const existing = new Map(
      parsed.map((item) => [
        item.chunk.id,
        listMemoryEmbeddings(input.opts.db, {
          chatId: item.job.chatId,
          chunkId: item.chunk.id,
          model: item.payload.model,
        })[0],
      ]),
    )
    if ([...existing.values()].every(Boolean)) {
      return parsed.map(({ job, payload, chunk }) => ({
        job,
        result: { kind: 'existing', job, payload, chunkId: chunk.id },
      }))
    }

    const controller = new AbortController()
    await input.acquireRateLimit(input.settings)
    const embedding = await input.embedGroups({
      request: modelRequest.request,
      groups: [parsed.map((item) => item.chunk.text)],
      signal: controller.signal,
    })
    if ('error' in embedding) {
      throw new Error(embedding.error)
    }
    const vectors = embedding.groups[0]
    if (!vectors || vectors.length !== parsed.length) {
      throw new Error(
        `embedding response count mismatch: expected ${parsed.length}, got ${vectors?.length ?? 0}`,
      )
    }

    return parsed.map(({ job, payload, chunk }, index) => {
      const existingEmbedding = existing.get(chunk.id)
      if (existingEmbedding) {
        return {
          job,
          result: { kind: 'existing', job, payload, chunkId: chunk.id },
        }
      }
      return {
        job,
        result: {
          kind: 'embedding',
          job,
          payload,
          request: modelRequest.request,
          vector: vectors[index],
          dim: embedding.dim,
          groupId,
          groupIndex: index,
        },
      }
    })
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return input.jobs.map((job) => ({ job, error: message }))
  }
}

function commitBatchResults(
  opts: EmbedMemoryJobHandlerOptions,
  context: Parameters<MemoryJobBatchHandler>[1],
  results: readonly BatchJobResult[],
): void {
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

function isContextualVoyageBatch(jobs: readonly MemoryJob[]): boolean {
  return (
    jobs.length > 0 &&
    jobs.every((job) => tryParseEmbedPayload(job.payload)?.model === 'voyageContext3')
  )
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
  // Memory-job-scoped read (audit L18): settings + hypa presets + chat-id
  // stubs only — never the whole characters/chats/collections payload parse.
  const database = opts.loadDatabase
    ? opts.loadDatabase()
    : opts.dataDir
      ? loadPersistedDatabaseForMemoryJob(opts.db, opts.dataDir)
      : null
  if (!isRecord(database)) {
    throw new Error('persisted database is missing')
  }
  return database as unknown as Database
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
    groupId: string | null
    groupIndex: number | null
  },
): void {
  if (input.vector.length !== input.dim) {
    throw new Error(
      `embedding dimension mismatch: expected ${input.dim}, got ${input.vector.length}`,
    )
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = listMemoryEmbeddings(db, {
      chatId: input.job.chatId,
      chunkId: input.payload.chunkId,
      model: input.payload.model,
    })[0]
    if (!existing) {
      createMemoryEmbedding(db, {
        id: buildEmbeddingId(
          input.job.chatId,
          input.payload.chunkId,
          input.payload.model,
          input.groupId,
        ),
        chatId: input.job.chatId,
        chunkId: input.payload.chunkId,
        model: input.payload.model,
        vector: input.vector,
        groupId: input.groupId,
        groupIndex: input.groupIndex,
      })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function buildEmbeddingId(
  chatId: string,
  chunkId: string,
  model: string,
  groupId: string | null = null,
): string {
  if (groupId === null) {
    return `hypav3-embedding-${shortHash(JSON.stringify({ chatId, chunkId, model }))}`
  }
  return `hypav3-embedding-${shortHash(JSON.stringify({ chatId, chunkId, model, groupId }))}`
}

function buildEmbeddingGroupId(chatId: string, model: string, chunkIds: readonly string[]): string {
  return `hypav3-embedding-group-${shortHash(JSON.stringify({ chatId, model, chunkIds }))}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
