import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from '../../server/activeWriterSession'
import { getNodeServerProxyAuth } from '../../storage/fastifyStorage'
import { hypaV3ProgressStore } from '../../stores.svelte'

const MEMORY_ENDPOINT = '/api/v1/memory'

export type ServerMemoryChunkStatus = 'pending' | 'summarized' | 'failed'
export type ServerMemoryJobKind = 'chunk' | 'embed' | 'summarize'
export type ServerMemoryJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ServerHypaV3ProgressPayload {
  open: boolean
  miniMsg: string
  msg: string
  subMsg: string
  status?: ServerMemoryJobStatus
  queuedCount?: number
}

export interface ServerMemoryChunk {
  id: string
  chatId: string
  messageId: string | null
  rangeStartSeq: number
  rangeEndSeq: number
  text: string
  status: ServerMemoryChunkStatus
  createdAt: string
  updatedAt: string
}

export interface ServerMemorySummary {
  id: string
  chatId: string
  chunkId: string
  model: string
  text: string
  metadata: unknown | null
  tokens: number
  createdAt: string
}

export interface PatchServerMemorySummaryInput {
  text?: string
  isImportant?: boolean
  categoryId?: string | null
  tags?: string[] | null
}

export interface ServerMemoryJob {
  id: string
  chatId: string
  kind: ServerMemoryJobKind
  status: ServerMemoryJobStatus
  attemptCount: number
  maxAttempts: number
}

export interface ListServerMemoryJobsInput {
  chatId?: string
  kind?: ServerMemoryJobKind
  status?: ServerMemoryJobStatus
  etag?: string
}

export type ServerMemoryResult<T> =
  | ({ status: 'ok'; etag?: string } & T)
  | { status: 'error'; error: string }
  | { status: 'unavailable' }
  | { status: 'not-modified'; etag?: string }

export function canUseServerMemoryApi(): boolean {
  return true
}

export function applyServerHypaV3Progress(payload: unknown): boolean {
  if (!canUseServerMemoryApi()) return false
  if (!payload || typeof payload !== 'object') return false

  const progress = payload as Partial<ServerHypaV3ProgressPayload>
  if (typeof progress.open !== 'boolean') return false
  if (typeof progress.miniMsg !== 'string') return false
  if (typeof progress.msg !== 'string') return false
  if (typeof progress.subMsg !== 'string') return false

  hypaV3ProgressStore.set({
    open: progress.open,
    miniMsg: progress.miniMsg,
    msg: progress.msg,
    subMsg: progress.subMsg,
  })
  return true
}

function appendQuery(path: string, entries: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) params.set(key, value)
  }
  const query = params.toString()
  return query.length > 0 ? `${path}?${query}` : path
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}

async function requestMemoryJson<T>(
  path: string,
  init: RequestInit = {},
  options: { activeWriter?: boolean } = {},
): Promise<ServerMemoryResult<T>> {
  if (!canUseServerMemoryApi()) return { status: 'unavailable' }

  let response: Response
  try {
    const auth = await getNodeServerProxyAuth()
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'risu-auth': auth,
        ...(options.activeWriter ? activeWriterSessionHeader() : {}),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  const etag = response.headers.get('etag') ?? undefined
  if (response.status === 304) {
    return { status: 'not-modified', ...(etag ? { etag } : {}) }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error bodies are reduced to their HTTP status below.
  }

  if (!response.ok) {
    handleActiveWriterStaleResponse(response)
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  return { status: 'ok', ...(etag ? { etag } : {}), ...(body as T) }
}

export async function listServerMemoryChunks(
  chatId: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ chunks: ServerMemoryChunk[] }>> {
  return requestMemoryJson<{ chunks: ServerMemoryChunk[] }>(`${MEMORY_ENDPOINT}/chunks/${encodeURIComponent(chatId)}`, {
    signal: signal ?? undefined,
  })
}

export async function listServerMemorySummaries(
  chatId: string,
  model?: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ summaries: ServerMemorySummary[] }>> {
  return requestMemoryJson<{ summaries: ServerMemorySummary[] }>(
    appendQuery(`${MEMORY_ENDPOINT}/summaries/${encodeURIComponent(chatId)}`, { model }),
    { signal: signal ?? undefined },
  )
}

export async function patchServerMemorySummary(
  summaryId: string,
  patch: PatchServerMemorySummaryInput,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ summaryId: string }>> {
  return requestMemoryJson<{ summaryId: string }>(
    `${MEMORY_ENDPOINT}/summaries/${encodeURIComponent(summaryId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(patch),
      signal: signal ?? undefined,
    },
    { activeWriter: true },
  )
}

export async function deleteServerMemorySummary(
  summaryId: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ summaryId: string }>> {
  return requestMemoryJson<{ summaryId: string }>(
    `${MEMORY_ENDPOINT}/summaries/${encodeURIComponent(summaryId)}`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' }, signal: signal ?? undefined },
    { activeWriter: true },
  )
}

export async function listServerMemoryJobs(
  input: ListServerMemoryJobsInput = {},
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ jobs: ServerMemoryJob[] }>> {
  return requestMemoryJson<{ jobs: ServerMemoryJob[] }>(
    appendQuery(`${MEMORY_ENDPOINT}/jobs`, {
      chatId: input.chatId,
      kind: input.kind,
      status: input.status,
    }),
    {
      signal: signal ?? undefined,
      headers: input.etag ? { 'If-None-Match': input.etag } : undefined,
    },
  )
}

export async function cancelServerMemoryJob(
  jobId: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ job: ServerMemoryJob }>> {
  return requestMemoryJson<{ job: ServerMemoryJob }>(
    `${MEMORY_ENDPOINT}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE', signal: signal ?? undefined },
    { activeWriter: true },
  )
}
