import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { iterateSseEvents } from '../process/request/sseParse'
import type { CommandEvent } from './commands'
import type {
  ServerHypaV3ProgressPayload,
  ServerMemoryJob,
  ServerMemoryJobKind,
  ServerMemoryJobStatus,
} from '../process/request/serverMemory'
import { isWriterAccessLost } from './activeWriterSession'

const EVENTS_ENDPOINT = '/api/v1/events'

export type ServerCommandEventHandler = (event: CommandEvent) => void

export interface ServerMemoryJobEvent {
  type: 'memory.job'
  chatId: string
  job: Omit<ServerMemoryJob, 'chatId'>
  sideEffect?: {
    kind: 'hypav3_progress'
    payload: ServerHypaV3ProgressPayload
  }
}

export type ServerMemoryEvent = ServerMemoryJobEvent
export type ServerMemoryEventHandler = (event: ServerMemoryEvent) => void

export interface ServerWriterEvent {
  sessionId: string | null
  epoch: number
}

export type ServerWriterEventHandler = (event: ServerWriterEvent) => void

export interface SubscribeServerCommandEventsInput {
  onCommandEvent: ServerCommandEventHandler
  onMemoryEvent?: ServerMemoryEventHandler
  onWriterEvent?: ServerWriterEventHandler
  onFrame?: (frame: { event: string; data: string; id?: string }) => void
  onError?: (error: string) => void
  onClose?: () => void
  sinceRevision?: number | null
  signal?: AbortSignal | null
}

export type ServerCommandEventSubscriptionResult =
  | { status: 'ok'; unsubscribe: () => void }
  | { status: 'error'; error: string }
  | {
      status: 'replay-unavailable'
      error: string
      currentRevision: number
      oldestRevision?: number
      latestRevision?: number
    }
  | { status: 'unavailable' }

export function canUseServerEvents(): boolean {
  return !isWriterAccessLost()
}

export async function subscribeServerCommandEvents(
  input: SubscribeServerCommandEventsInput,
): Promise<ServerCommandEventSubscriptionResult> {
  if (!canUseServerEvents()) return { status: 'unavailable' }

  const controller = new AbortController()
  let stopped = false
  const stop = (): void => {
    stopped = true
    controller.abort()
  }

  if (input.signal) {
    if (input.signal.aborted) {
      stop()
    } else {
      input.signal.addEventListener('abort', stop, { once: true })
    }
  }

  const auth = await getNodeServerProxyAuth()
  const headers: Record<string, string> = {
    'risu-auth': auth,
  }
  const sinceRevision =
    Number.isInteger(input.sinceRevision) && (input.sinceRevision as number) >= 0
      ? (input.sinceRevision as number)
      : null
  const endpoint =
    sinceRevision === null
      ? EVENTS_ENDPOINT
      : `${EVENTS_ENDPOINT}?sinceRevision=${encodeURIComponent(String(sinceRevision))}`
  if (sinceRevision !== null) {
    headers['Last-Event-ID'] = String(sinceRevision)
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers,
    })
  } catch (err) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  if (response.status === 409) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    const replayError = await parseReplayUnavailableResponse(response)
    if (replayError) return replayError
  }

  if (!response.ok) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    return { status: 'error', error: `HTTP ${response.status}` }
  }

  if (!response.body) {
    if (input.signal) input.signal.removeEventListener('abort', stop)
    return { status: 'error', error: 'Event stream response has no body' }
  }

  void (async () => {
    let completed = false
    try {
      for await (const frame of iterateSseEvents(response.body!, controller.signal)) {
        if (stopped) continue
        input.onFrame?.(frame)
        if (frame.event === 'command') {
          const event = parseCommandEvent(frame.data)
          if (!event) {
            throw new Error('Malformed command event frame')
          }
          input.onCommandEvent(event)
        } else if (frame.event === 'memory') {
          const event = parseMemoryEvent(frame.data)
          if (event) input.onMemoryEvent?.(event)
        } else if (frame.event === 'writer') {
          const event = parseWriterEvent(frame.data)
          if (event) input.onWriterEvent?.(event)
        }
      }
      completed = true
    } catch (err) {
      if (!stopped && !controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err)
        input.onError?.(`Event stream error: ${message}`)
      }
    } finally {
      if (completed && !stopped && !controller.signal.aborted) {
        input.onClose?.()
      }
      if (input.signal) input.signal.removeEventListener('abort', stop)
    }
  })()

  return {
    status: 'ok',
    unsubscribe: stop,
  }
}

function parseWriterEvent(data: string): ServerWriterEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (
    record.sessionId !== null &&
    (typeof record.sessionId !== 'string' ||
      record.sessionId.trim() !== record.sessionId ||
      record.sessionId.length === 0 ||
      record.sessionId.length > 128)
  ) {
    return null
  }
  if (!Number.isSafeInteger(record.epoch) || (record.epoch as number) < 0) return null
  return {
    sessionId: record.sessionId as string | null,
    epoch: record.epoch as number,
  }
}

async function parseReplayUnavailableResponse(
  response: Response,
): Promise<Extract<ServerCommandEventSubscriptionResult, { status: 'replay-unavailable' }> | null> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (record.error !== 'event_replay_unavailable') return null
  if (!Number.isInteger(record.currentRevision) || (record.currentRevision as number) < 0) {
    return null
  }

  return {
    status: 'replay-unavailable',
    error: 'event_replay_unavailable',
    currentRevision: record.currentRevision as number,
    ...(Number.isInteger(record.oldestRevision) ? { oldestRevision: record.oldestRevision as number } : {}),
    ...(Number.isInteger(record.latestRevision) ? { latestRevision: record.latestRevision as number } : {}),
  }
}

function parseMemoryEvent(data: string): ServerMemoryEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (record.type !== 'memory.job') return null
  if (typeof record.chatId !== 'string') return null
  if (!record.job || typeof record.job !== 'object' || Array.isArray(record.job)) return null
  const jobRecord = record.job as Record<string, unknown>
  if (typeof jobRecord.id !== 'string') return null
  if (!isMemoryJobKind(jobRecord.kind)) return null
  if (!isMemoryJobStatus(jobRecord.status)) return null
  if (!Number.isInteger(jobRecord.attemptCount) || (jobRecord.attemptCount as number) < 0) return null
  if (!Number.isInteger(jobRecord.maxAttempts) || (jobRecord.maxAttempts as number) <= 0) return null

  const event: ServerMemoryJobEvent = {
    type: 'memory.job',
    chatId: record.chatId,
    job: {
      id: jobRecord.id,
      kind: jobRecord.kind,
      status: jobRecord.status,
      attemptCount: jobRecord.attemptCount as number,
      maxAttempts: jobRecord.maxAttempts as number,
      ...(jobRecord.error === null
        ? { error: null }
        : typeof jobRecord.error === 'string'
          ? { error: jobRecord.error }
          : {}),
      ...(typeof jobRecord.updatedAt === 'string' ? { updatedAt: jobRecord.updatedAt } : {}),
    },
  }

  if (record.sideEffect !== undefined) {
    const sideEffect = parseMemorySideEffect(record.sideEffect)
    if (!sideEffect) return null
    event.sideEffect = sideEffect
  }

  return event
}

function parseMemorySideEffect(value: unknown): ServerMemoryJobEvent['sideEffect'] | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind !== 'hypav3_progress') return null
  if (!isHypaV3ProgressPayload(record.payload)) return null
  return {
    kind: 'hypav3_progress',
    payload: record.payload,
  }
}

function isHypaV3ProgressPayload(value: unknown): value is ServerHypaV3ProgressPayload {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.open !== 'boolean') return false
  if (typeof record.miniMsg !== 'string') return false
  if (typeof record.msg !== 'string') return false
  if (typeof record.subMsg !== 'string') return false
  if (record.status !== undefined && !isMemoryJobStatus(record.status)) return false
  if (record.queuedCount !== undefined && !Number.isInteger(record.queuedCount)) return false
  return true
}

function isMemoryJobKind(value: unknown): value is ServerMemoryJobKind {
  return value === 'chunk' || value === 'embed' || value === 'summarize'
}

function isMemoryJobStatus(value: unknown): value is ServerMemoryJobStatus {
  return (
    value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'cancelled'
  )
}

function parseCommandEvent(data: string): CommandEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (typeof record.type !== 'string') return null
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
  if (typeof record.resource !== 'string') return null
  if (record.id !== undefined && typeof record.id !== 'string') return null
  if (record.parentId !== undefined && typeof record.parentId !== 'string') return null
  if (record.origin !== undefined && !isCommandEventOrigin(record.origin)) return null

  return {
    type: record.type,
    revision: record.revision as number,
    resource: record.resource,
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.parentId === 'string' ? { parentId: record.parentId } : {}),
    ...(isCommandEventOrigin(record.origin) ? { origin: record.origin } : {}),
  }
}

function isCommandEventOrigin(value: unknown): value is { writerSessionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const writerSessionId = (value as { writerSessionId?: unknown }).writerSessionId
  return typeof writerSessionId === 'string' && writerSessionId.trim() !== ''
}
