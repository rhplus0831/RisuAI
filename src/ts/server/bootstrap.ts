import type { Database } from '../storage/database.svelte'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { activeWriterSessionHeader } from './activeWriterSession'
import {
  BODY_CACHE_MANIFEST_HEADER,
  mergeBootstrapBodyCache,
  parseBootstrapBodyCachePayload,
  prepareBootstrapBodyCacheRequest,
  type ServerBootstrapBodyCachePayload,
} from './bootstrapBodyCache'
import { setCachedServerCommandRevision } from './commands'

const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'

export interface ActiveGenerationJob {
  chatId: string
  jobId: string
  /**
   * The generating mode of the running job. Lets a reload-resume reattach render
   * a `continue` / `regenerate` on the right row instead of as a fresh send.
   * Absent (treated as `send`) for older server builds.
   */
  mode?: 'send' | 'continue' | 'regenerate'
  /** The regenerate target id, present only for `mode === 'regenerate'`. */
  regenerateMessageId?: string
}

export interface ServerBootstrapProjection {
  revision: number
  schemaVersion?: number
  database: Database | null
  assetBaseUrl?: string
  /**
   * Generations still running server-side, so a reloaded browser can re-attach to
   * the live stream of the open chat instead of only seeing the result after it
   * lands. Empty when none.
   */
  activeGenerationJobs?: ActiveGenerationJob[]
  bodyCache?: ServerBootstrapBodyCachePayload
}

export type ServerBootstrapResult =
  | { status: 'ok'; projection: ServerBootstrapProjection }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerBootstrap(): boolean {
  return true
}

export async function fetchServerBootstrapProjection(signal?: AbortSignal | null): Promise<ServerBootstrapResult> {
  return fetchServerBootstrapProjectionWithMode({
    signal,
    registerActiveWriter: true,
    cacheRevision: true,
  })
}

export async function fetchServerBootstrapProjectionReadOnly(
  signal?: AbortSignal | null,
  options: { cacheRevision?: boolean } = {},
): Promise<ServerBootstrapResult> {
  return fetchServerBootstrapProjectionWithMode({
    signal,
    registerActiveWriter: false,
    cacheRevision: options.cacheRevision ?? true,
  })
}

async function fetchServerBootstrapProjectionWithMode(input: {
  signal?: AbortSignal | null
  registerActiveWriter: boolean
  cacheRevision: boolean
}): Promise<ServerBootstrapResult> {
  if (!canUseServerBootstrap()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  const bodyCacheRequest = prepareBootstrapBodyCacheRequest()
  let response: Response
  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: 'GET',
      signal: input.signal ?? undefined,
      headers: {
        'risu-auth': auth,
        ...(input.registerActiveWriter ? activeWriterSessionHeader() : {}),
        ...(bodyCacheRequest.headerValue ? { [BODY_CACHE_MANIFEST_HEADER]: bodyCacheRequest.headerValue } : {}),
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
    // HTTP status handling below reports non-JSON failures.
  }

  if (!response.ok) {
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Invalid bootstrap response' }
  }

  const record = body as Record<string, unknown>
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid bootstrap revision' }
  }

  const database = record.database
  if (database !== null && (typeof database !== 'object' || Array.isArray(database))) {
    return { status: 'error', error: 'Invalid bootstrap database' }
  }
  const bodyCache = parseBootstrapBodyCachePayload(record.bodyCache)
  if (bodyCache === null) {
    return { status: 'error', error: 'Invalid bootstrap body cache' }
  }
  const mergedDatabase = mergeBootstrapBodyCache(database as Database | null, bodyCache, bodyCacheRequest)

  if (input.cacheRevision) {
    setCachedServerCommandRevision(revision as number)
  }

  const projection: ServerBootstrapProjection = {
    revision: revision as number,
    schemaVersion: Number.isInteger(record.schemaVersion) ? (record.schemaVersion as number) : undefined,
    database: mergedDatabase,
    assetBaseUrl: typeof record.assetBaseUrl === 'string' ? record.assetBaseUrl : undefined,
    activeGenerationJobs: parseActiveGenerationJobs(record.activeGenerationJobs),
  }
  if (bodyCache) projection.bodyCache = bodyCache

  return {
    status: 'ok',
    projection,
  }
}

function parseActiveGenerationJobs(value: unknown): ActiveGenerationJob[] {
  if (!Array.isArray(value)) return []
  const jobs: ActiveGenerationJob[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.chatId === 'string' && typeof record.jobId === 'string') {
      const job: ActiveGenerationJob = { chatId: record.chatId, jobId: record.jobId }
      if (record.mode === 'send' || record.mode === 'continue' || record.mode === 'regenerate') {
        job.mode = record.mode
      }
      if (typeof record.regenerateMessageId === 'string') {
        job.regenerateMessageId = record.regenerateMessageId
      }
      jobs.push(job)
    }
  }
  return jobs
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
