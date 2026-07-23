import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { activeWriterSessionHeader } from './activeWriterSession'
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

export interface ActiveMessageTranslation {
  chatId: string
  messageId: string
  jobId: string
  status: 'running' | 'succeeded' | 'failed'
  error?: string
  completedAt?: number
}

export interface ActiveGreetingTranslation {
  characterId: string
  greetingIndex: number
  settingsHash: string
  jobId: string
  status: 'running' | 'succeeded' | 'failed'
  error?: string
  completedAt?: number
}

export interface ServerBootstrapRuntime {
  initialized: boolean
  revision: number
  schemaVersion?: number
  assetBaseUrl?: string
  /** True when this writer already owned the server before registration. */
  requestedWriterWasActive?: boolean
  /** Durable identity of the concrete server database/realm. */
  databaseLineage?: string
  /** Persistent ownership generation, incremented whenever the writer changes. */
  writerEpoch?: number
  /**
   * Generations still running server-side, so a reloaded browser can re-attach to
   * the live stream of the open chat instead of only seeing the result after it
   * lands. Empty when none.
   */
  activeGenerationJobs?: ActiveGenerationJob[]
  /**
   * Message translations still running server-side after a detached request.
   * Used to keep row-level translation spinners and mutation controls stable
   * after reload.
   */
  activeMessageTranslations?: ActiveMessageTranslation[]
  activeGreetingTranslations?: ActiveGreetingTranslation[]
}

export type ServerBootstrapResult =
  | { status: 'ok'; bootstrap: ServerBootstrapRuntime }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export function canUseServerBootstrap(): boolean {
  return true
}

export async function fetchServerBootstrap(signal?: AbortSignal | null): Promise<ServerBootstrapResult> {
  return fetchServerBootstrapWithMode({
    signal,
    registerActiveWriter: true,
    cacheRevision: true,
  })
}

export async function fetchServerBootstrapReadOnly(
  signal?: AbortSignal | null,
  options: { cacheRevision?: boolean } = {},
): Promise<ServerBootstrapResult> {
  return fetchServerBootstrapWithMode({
    signal,
    registerActiveWriter: false,
    cacheRevision: options.cacheRevision ?? true,
  })
}

async function fetchServerBootstrapWithMode(input: {
  signal?: AbortSignal | null
  registerActiveWriter: boolean
  cacheRevision: boolean
}): Promise<ServerBootstrapResult> {
  if (!canUseServerBootstrap()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: 'GET',
      signal: input.signal ?? undefined,
      headers: {
        'risu-auth': auth,
        ...(input.registerActiveWriter ? activeWriterSessionHeader() : {}),
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
  if (typeof record.initialized !== 'boolean') {
    return { status: 'error', error: 'Invalid bootstrap initialization state' }
  }
  const revision = record.revision
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { status: 'error', error: 'Invalid bootstrap revision' }
  }

  if (input.cacheRevision) {
    setCachedServerCommandRevision(revision as number)
  }

  const bootstrap: ServerBootstrapRuntime = {
    initialized: record.initialized,
    revision: revision as number,
    schemaVersion: Number.isInteger(record.schemaVersion) ? (record.schemaVersion as number) : undefined,
    assetBaseUrl: typeof record.assetBaseUrl === 'string' ? record.assetBaseUrl : undefined,
    requestedWriterWasActive:
      typeof record.requestedWriterWasActive === 'boolean' ? record.requestedWriterWasActive : undefined,
    databaseLineage: typeof record.databaseLineage === 'string' ? record.databaseLineage : undefined,
    writerEpoch: Number.isSafeInteger(record.writerEpoch) ? (record.writerEpoch as number) : undefined,
    activeGenerationJobs: parseActiveGenerationJobs(record.activeGenerationJobs),
    activeMessageTranslations: parseActiveMessageTranslations(record.activeMessageTranslations),
    activeGreetingTranslations: parseActiveGreetingTranslations(record.activeGreetingTranslations),
  }
  return {
    status: 'ok',
    bootstrap,
  }
}

function parseActiveGreetingTranslations(value: unknown): ActiveGreetingTranslation[] {
  if (!Array.isArray(value)) return []
  const jobs: ActiveGreetingTranslation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (
      typeof record.characterId !== 'string' ||
      !Number.isInteger(record.greetingIndex) ||
      (record.greetingIndex as number) < -1 ||
      typeof record.settingsHash !== 'string' ||
      typeof record.jobId !== 'string' ||
      record.jobId.length === 0
    ) {
      continue
    }
    const status =
      record.status === 'succeeded' || record.status === 'failed' || record.status === 'running'
        ? record.status
        : 'running'
    const job: ActiveGreetingTranslation = {
      characterId: record.characterId,
      greetingIndex: record.greetingIndex as number,
      settingsHash: record.settingsHash,
      jobId: record.jobId,
      status,
    }
    if (status === 'failed' && typeof record.error === 'string') job.error = record.error
    if (status !== 'running' && typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)) {
      job.completedAt = record.completedAt
    }
    jobs.push(job)
  }
  return jobs
}

function parseActiveMessageTranslations(value: unknown): ActiveMessageTranslation[] {
  if (!Array.isArray(value)) return []
  const jobs: ActiveMessageTranslation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.chatId !== 'string' || typeof record.messageId !== 'string') continue
    const status =
      record.status === 'succeeded' || record.status === 'failed' || record.status === 'running'
        ? record.status
        : 'running'
    const job: ActiveMessageTranslation = {
      chatId: record.chatId,
      messageId: record.messageId,
      jobId:
        typeof record.jobId === 'string' && record.jobId.length > 0
          ? record.jobId
          : `legacy:${record.chatId}:${record.messageId}`,
      status,
    }
    if (status === 'failed' && typeof record.error === 'string') job.error = record.error
    if (status !== 'running' && typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)) {
      job.completedAt = record.completedAt
    }
    jobs.push(job)
  }
  return jobs
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
