import type { MemoryJob, MemoryJobListItem, MemoryJobStatus } from './memoryRepository.js'

export interface HypaV3ProgressPayload {
  open: boolean
  miniMsg: string
  msg: string
  subMsg: string
  status: MemoryJobStatus
  queuedCount?: number
}

export interface MemoryHypaV3ProgressSideEffect {
  kind: 'hypav3_progress'
  payload: HypaV3ProgressPayload
}

export interface MemoryJobEvent {
  type: 'memory.job'
  chatId: string
  job: Omit<MemoryJobListItem, 'chatId' | 'error' | 'updatedAt'> &
    Partial<Pick<MemoryJobListItem, 'error' | 'updatedAt'>>
  sideEffect?: MemoryHypaV3ProgressSideEffect
}

export type MemoryEvent = MemoryJobEvent

export type MemoryEventSink = (event: MemoryEvent) => void
export type MemoryEventListener = (event: MemoryEvent) => void

export interface MemoryEventBus {
  emit(event: MemoryEvent): void
  subscribe(listener: MemoryEventListener): () => void
}

export function emitMemoryEventSafely(sink: MemoryEventSink, event: MemoryEvent): void {
  try {
    sink(event)
  } catch {
    // Memory events are best-effort progress notifications; delivery
    // failures must not abort committed memory work.
  }
}

export function createMemoryEventBus(): MemoryEventBus {
  const listeners = new Set<MemoryEventListener>()
  return {
    emit(event) {
      for (const listener of listeners) {
        emitMemoryEventSafely(listener, event)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function buildMemoryJobEvent(
  job: MemoryJob,
  options: { includeHypaV3Progress?: boolean; queuedCount?: number } = {},
): MemoryJobEvent {
  const event: MemoryJobEvent = {
    type: 'memory.job',
    chatId: job.chatId,
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
    },
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    event.job.error = sanitizeMemoryJobError(job.error)
    event.job.updatedAt = job.updatedAt
  }
  if (options.includeHypaV3Progress) {
    event.sideEffect = buildHypaV3ProgressSideEffect(job, options.queuedCount)
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

export function buildHypaV3ProgressSideEffect(job: MemoryJob, queuedCount?: number): MemoryHypaV3ProgressSideEffect {
  const queueText = queuedCount === undefined ? '' : `${queuedCount}`
  const active = job.status === 'pending' || job.status === 'running'
  const payload: HypaV3ProgressPayload = {
    open: active,
    miniMsg: active ? queueText : '',
    msg: active ? `[Hypa V3] ${memoryProgressVerb(job)}` : '',
    subMsg: active && queuedCount !== undefined ? `${queuedCount} queued` : '',
    status: job.status,
  }
  if (queuedCount !== undefined) {
    payload.queuedCount = queuedCount
  }
  return {
    kind: 'hypav3_progress',
    payload,
  }
}

function memoryProgressVerb(job: MemoryJob): string {
  switch (job.kind) {
    case 'chunk':
      return job.status === 'running' ? 'Chunking...' : 'Waiting to chunk...'
    case 'embed':
      return job.status === 'running' ? 'Similarity searching...' : 'Waiting to embed...'
    case 'summarize':
      return job.status === 'running' ? 'Summarizing...' : 'Waiting to summarize...'
  }
}
