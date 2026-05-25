import { isFastifyServer } from '../../platform'
import { getNodeServerProxyAuth } from '../../storage/nodeStorage'

const MEMORY_ENDPOINT = '/api/v1/memory'

export type ServerMemoryChunkStatus = 'pending' | 'summarized' | 'failed'
export type ServerMemoryJobKind = 'chunk' | 'embed' | 'summarize'
export type ServerMemoryJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

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

export interface ServerMemoryJob {
  id: string
  chatId: string
  kind: ServerMemoryJobKind
  status: ServerMemoryJobStatus
  payload: unknown
  error: string | null
  attemptCount: number
  maxAttempts: number
  nextRunAt: string
  createdAt: string
  updatedAt: string
}

export interface ListServerMemoryJobsInput {
  chatId?: string
  kind?: ServerMemoryJobKind
  status?: ServerMemoryJobStatus
}

export type ServerMemoryResult<T> =
  | ({ status: 'ok' } & T)
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerMemoryApi(): boolean {
  return isFastifyServer
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
): Promise<ServerMemoryResult<T>> {
  if (!canUseServerMemoryApi()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'risu-auth': auth,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error bodies are reduced to their HTTP status below.
  }

  if (!response.ok) {
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  return { status: 'ok', ...(body as T) }
}

export async function listServerMemoryChunks(
  chatId: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ chunks: ServerMemoryChunk[] }>> {
  return requestMemoryJson<{ chunks: ServerMemoryChunk[] }>(
    `${MEMORY_ENDPOINT}/chunks/${encodeURIComponent(chatId)}`,
    { signal: signal ?? undefined },
  )
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
    { signal: signal ?? undefined },
  )
}

export async function cancelServerMemoryJob(
  jobId: string,
  signal?: AbortSignal | null,
): Promise<ServerMemoryResult<{ job: ServerMemoryJob }>> {
  return requestMemoryJson<{ job: ServerMemoryJob }>(
    `${MEMORY_ENDPOINT}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE', signal: signal ?? undefined },
  )
}
