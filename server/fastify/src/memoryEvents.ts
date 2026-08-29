import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { MemoryJob, MemoryJobListItem } from './memoryRepository.js'
import type { BardWikiJob } from './bardWikiJobs.js'
import type { BardWikiJobSummary } from './bardWikiRepository.js'
import { emitProtocolMetric, jsonPayloadBytes } from './protocolMetrics.js'

export interface MemoryJobEvent {
  type: 'memory.job'
  streamId?: string
  version?: number
  chatId: string
  job: Omit<MemoryJobListItem, 'chatId' | 'error' | 'updatedAt'> &
    Partial<Pick<MemoryJobListItem, 'error' | 'updatedAt'>>
}

export interface BardWikiJobEvent {
  type: 'bardwiki.job'
  streamId?: string
  version?: number
  chatId: string
  job: {
    id: string
    instanceId: string
    receiptId: string | null
    kind: BardWikiJob['kind']
    status: BardWikiJob['status']
    attemptCount: number
    maxAttempts: number
    progressCurrent: number | null
    progressTotal: number | null
    errorCode?: string | null
    errorSummary?: string | null
    updatedAt: string
  }
}

export type MemoryEvent = MemoryJobEvent | BardWikiJobEvent

export interface MemoryJobSnapshot {
  type: 'memory.snapshot'
  streamId: string
  version: number
  jobs: MemoryJobListItem[]
  bardWikiJobs: BardWikiJobSummary[]
}

export type MemoryEventSink = (event: MemoryEvent) => void
export type MemoryEventListener = (event: MemoryEvent) => void

export interface MemoryEventBus {
  emit(event: MemoryEvent): void
  subscribe(listener: MemoryEventListener): () => void
  snapshotVersion(): { streamId: string; version: number }
}

export function emitMemoryEventSafely(sink: MemoryEventSink, event: MemoryEvent): void {
  try {
    sink(event)
  } catch {
    // Memory events are best-effort progress notifications; delivery
    // failures must not abort committed memory work.
  }
}

export function createMemoryEventBus(logger?: FastifyBaseLogger): MemoryEventBus {
  const listeners = new Set<MemoryEventListener>()
  const streamId = randomUUID()
  let version = 0
  return {
    emit(event) {
      const publishedEvent: MemoryEvent = {
        ...event,
        streamId,
        version: ++version,
      }
      emitProtocolMetric(
        'memory_event_fanout',
        () => {
          const payloadBytes = jsonPayloadBytes(publishedEvent)
          const frameBytes =
            payloadBytes === null ? null : payloadBytes + Buffer.byteLength('event: memory\ndata: \n\n', 'utf8')
          return {
            payloadBytes,
            frameBytes,
            listenerCount: listeners.size,
            deliveredBytes: frameBytes === null ? null : frameBytes * listeners.size,
            jobKind: publishedEvent.job.kind,
            jobStatus: publishedEvent.job.status,
            hasSideEffect: false,
          }
        },
        logger,
      )
      for (const listener of listeners) {
        emitMemoryEventSafely(listener, publishedEvent)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshotVersion() {
      return { streamId, version }
    },
  }
}

export function buildMemoryJobEvent(job: MemoryJob): MemoryJobEvent {
  const event: MemoryJobEvent = {
    type: 'memory.job',
    chatId: job.chatId,
    job: {
      id: job.id,
      instanceId: job.instanceId,
      kind: job.kind,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      updatedAt: job.updatedAt,
    },
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    event.job.error = sanitizeMemoryJobError(job.error)
  }
  return event
}

export function buildBardWikiJobEvent(job: BardWikiJobSummary): BardWikiJobEvent {
  const event: BardWikiJobEvent = {
    type: 'bardwiki.job',
    chatId: job.chatId,
    job: {
      id: job.id,
      instanceId: job.instanceId,
      receiptId: job.receiptId,
      kind: job.kind,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      progressCurrent: job.progressCurrent,
      progressTotal: job.progressTotal,
      updatedAt: job.updatedAt,
    },
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    event.job.errorCode = sanitizeMemoryJobError(job.errorCode)
    event.job.errorSummary = sanitizeMemoryJobError(job.errorSummary)
  }
  return event
}

export function sanitizeMemoryJobError(error: string | null): string | null {
  if (!error) return null
  return error
    .slice(0, 1000)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/giu, '$1[redacted]@')
    .replace(/\b(?:bearer|basic)\s+[^\s"',;&}]+/giu, (value) => `${value.split(/\s/gu, 1)[0]} [redacted]`)
    .replace(
      /((?:["']?(?:access[_ -]?key(?:[_ -]?id)?|access[_ -]?token|api[_ -]?key|authorization|client[_ -]?secret|cookie|id[_ -]?token|key|password|passwd|private[_ -]?key|proxy[_ -]?authorization|refresh[_ -]?token|secret|secret[_ -]?access[_ -]?key|session[_ -]?token|set-cookie|token|x[_ -]?api[_ -]?key|xi[_ -]?api[_ -]?key)["']?)\s*[:=]\s*)(?:bearer\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/giu,
      '$1[redacted]',
    )
    .replace(/\b(?:api|pk|rk|sk)[-_][A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/\b(?:AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|gh[opsu]_[A-Za-z0-9]{20,})\b/gu, '[redacted]')
}
