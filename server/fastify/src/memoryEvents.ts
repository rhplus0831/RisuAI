import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { MemoryJob, MemoryJobListItem } from './memoryRepository.js'
import { emitProtocolMetric, jsonPayloadBytes } from './protocolMetrics.js'

export interface MemoryJobEvent {
  type: 'memory.job'
  streamId?: string
  version?: number
  chatId: string
  job: Omit<MemoryJobListItem, 'chatId' | 'error' | 'updatedAt'> &
    Partial<Pick<MemoryJobListItem, 'error' | 'updatedAt'>>
}

export type MemoryEvent = MemoryJobEvent

export interface MemoryJobSnapshot {
  type: 'memory.snapshot'
  streamId: string
  version: number
  jobs: MemoryJobListItem[]
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

export function sanitizeMemoryJobError(error: string | null): string | null {
  if (!error) return null
  return error
    .slice(0, 1000)
    .replace(/([?&](?:key|api[_-]?key|token|secret)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/((?:authorization|api[_ -]?key|token|secret)\s*[:=]\s*)(?:bearer\s+)?\S+/giu, '$1[redacted]')
}
